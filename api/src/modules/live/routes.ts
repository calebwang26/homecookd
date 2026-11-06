// GET /v1/live/<topic>?since=<version>. A new live screen is one line in `topics`: see docs/build/LIVE-UPDATES.md.
//
// Every poll checks the session, so an ended session or a deleted person gets nothing from the next poll on, and the family comes
// only from that session. A failure keeps nothing: the phone holds what it last saw, which SYSTEM-DESIGN.md allows for this data.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireSession, signedIn, type Signed } from "../../auth.js";
import { db } from "../../db.js";
import { ApiError, tooMany, unavailable } from "../../errors.js";
import { liveJobs } from "../jobs/service.js";
import { isDatabaseDown, pollAfterMs, versionOf, windowCounter } from "./service.js";

type Topic = {
  name: string;
  activeMs: number; // while something may still move
  idleMs: number;
  read: (signed: Signed) => Promise<{ data: unknown; active: boolean }>;
};

export const topics: Topic[] = [{ name: "jobs", activeMs: 5_000, idleMs: 30_000, read: (signed) => liveJobs(signed) }];

const QUERY = {
  type: "object",
  properties: { since: { type: "string", maxLength: 64, pattern: "^[A-Za-z0-9_-]*$" } },
  additionalProperties: false,
};

// This many requests queued for a connection means Postgres is slow or swamped: polls step aside for sign-in and messages. At 50,
// a stall of a few hundred ms under load set it off (scripts/live-load.ts), and that's a 5xx nobody needs to act on.
export const SHED_WAITING = 100;
const STATS_EVERY_MS = 60_000;

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isInteger(value) && value >= 0 ? value : fallback;
};

export async function liveRoutes(app: FastifyInstance): Promise<void> {
  // A phone on Home polls several topics, and a person can have two phones. Well above that; only a broken client meets it.
  const perPerson = windowCounter(envInt("LIVE_PERSON_PER_MIN", 120), 60_000);
  // Only refusals count, so families behind one carrier's address never slow each other down.
  const refusedByIp = windowCounter(envInt("LIVE_REFUSED_IP_PER_MIN", 30), 60_000);
  const floorMs = envInt("LIVE_POLL_FLOOR_MS", 0); // raise it to slow every phone, with no app release
  const off = new Set((process.env.LIVE_OFF ?? "").split(",").map((name) => name.trim()));

  let stats = { polls: 0, changed: 0, refused: 0, limited: 0, shed: 0, failed: 0 };
  let statsAt = Date.now();
  const writeStats = () => {
    if (stats.polls > 0) app.log.info({ live: stats }, "live polls");
    stats = { polls: 0, changed: 0, refused: 0, limited: 0, shed: 0, failed: 0 };
    statsAt = Date.now();
  };
  app.addHook("onClose", async () => writeStats());

  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    stats.polls += 1;
    const status = reply.statusCode;
    if (status === 401) {
      stats.refused += 1;
      refusedByIp.add(req.ip);
    } else if (status === 429) stats.limited += 1;
    else if (status === 503) stats.shed += 1;
    else if (status >= 500) stats.failed += 1;
    if (Date.now() - statsAt >= STATS_EVERY_MS) writeStats();
  });

  // The database being away is a wait, not an error to report thousands of times. Anything else goes on to the main handler.
  app.setErrorHandler((error) => {
    throw isDatabaseDown(error) ? unavailable() : error;
  });

  const beforeTheDatabase = async (req: FastifyRequest) => {
    const waitS = refusedByIp.waitS(req.ip);
    if (waitS > 0) throw tooMany(waitS);
    if (db().waitingCount >= SHED_WAITING) throw unavailable();
  };
  const capPerson = async (req: FastifyRequest) => {
    const { personId } = signedIn(req);
    const waitS = perPerson.waitS(personId);
    if (waitS > 0) throw tooMany(waitS);
    perPerson.add(personId);
  };

  for (const topic of topics) {
    app.get<{ Querystring: { since?: string } }>(
      `/v1/live/${topic.name}`,
      {
        // A line per poll would be most of the logs; writeStats() says how they went, once a minute.
        logLevel: "warn",
        schema: { querystring: QUERY },
        preValidation: [
          async () => {
            // The way back: the app goes to Convex for this topic (LIVE-UPDATES.md).
            if (off.has(topic.name)) throw new ApiError(410, "live_off");
          },
          beforeTheDatabase,
          requireSession,
          capPerson,
        ],
      },
      async (req, reply) => {
        const { data, active } = await topic.read(signedIn(req));
        const version = versionOf(data);
        const next = pollAfterMs(active ? topic.activeMs : topic.idleMs, floorMs);
        reply.header("cache-control", "no-store");
        if (req.query.since === version) return { changed: false, version, pollAfterMs: next };
        stats.changed += 1;
        return { changed: true, version, pollAfterMs: next, data };
      },
    );
  }
}

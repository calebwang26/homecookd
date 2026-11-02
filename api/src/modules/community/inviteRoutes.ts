// POST /invite/open { token, deviceId } (convex/lib/inviteRoutes.ts): someone opened a dinner's invite link (homecookd.app/d?t=…, or the app's homecookd://d?t=…). Public: the
// token is the capability, so anyone a guest sends the link to counts in "X going", once per phone or browser (deviceId is a random id that page keeps). The reply is only
// { dish, hostName, startsAt }, or 404 when the link doesn't work. Browsers may call it from homecookd.app and local dev pages; a request from any other site is refused. The
// app's own fetch sends no Origin. Errors are `{error}`, and the site reads only the status. The path stays unversioned, so the site and old apps need only a new host.
import * as Sentry from "@sentry/node";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isPoolWait } from "../../db.js";
import { isBusy, Overloaded } from "../../overload.js";
import { ApiError, unavailable } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { openInvite } from "./dinners.js";

const ORIGINS = [/^https:\/\/(www\.)?homecookd\.app$/, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/];
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
const BODY_BYTES = 1000;
const MINUTE = 60;

/** Convex had a per-dinner limit only. A link is passed around a dorm, so this is roomy; a guessed token is what it's for. */
export const RATE = {
  opens: { bucket: "invite-open", max: 120, windowS: 10 * MINUTE },
  badTokens: { bucket: "invite-bad", max: 20, windowS: 10 * MINUTE },
};

/** The CORS headers for an allowed origin; false for a site that may not call this. */
function corsFor(origin: string | undefined): Record<string, string> | false {
  if (!origin) return { Vary: "Origin" };
  if (!ORIGINS.some((o) => o.test(origin))) return false;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function onError(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ApiError && error.statusCode === 429) return reply.headers(error.headers).code(429).send({ error: "too many tries" });
  if (isBusy(error)) {
    req.log.warn({ err: { type: error.name, code: error.code }, poolWait: isPoolWait(error), shed: error instanceof Overloaded ? error.reason : undefined }, "too busy to answer");
    return reply.headers(unavailable().headers).code(503).send({ error: "try again in a moment" });
  }
  if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") return reply.code(400).send({ error: "body too large" });
  if (error.validation) return reply.code(400).send({ error: "token and deviceId are required" });
  if ((error.statusCode ?? 500) < 500) return reply.code(400).send({ error: "body must be JSON" });
  // Not the message: Postgres errors can carry row values.
  req.log.error({ err: { type: error.name, code: error.code } }, "invite open failed");
  Sentry.captureException(error, { tags: { request_id: String(req.id) } });
  return reply.code(500).send({ error: "something went wrong" });
}

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    const cors = corsFor(req.headers.origin);
    if (!cors) {
      reply.header("Vary", "Origin");
      if (req.method === "OPTIONS") return reply.code(403).send();
      return reply.code(403).send({ error: "not allowed from this site" });
    }
    reply.headers(cors);
    reply.header("Cache-Control", "no-store");
  });

  // JSON whatever its Content-Type, as Convex read it.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string", bodyLimit: BODY_BYTES }, (_req, body, done) => {
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(Object.assign(new Error("body must be JSON"), { statusCode: 400 }));
    }
  });

  app.setErrorHandler(onError);
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not found" }));
  app.options("/open", async (_req, reply) => reply.code(204).send());

  app.post(
    "/open",
    { bodyLimit: BODY_BYTES, schema: { body: { type: "object", properties: { token: {}, deviceId: {} } } } },
    async (req, reply) => {
      const subject = subjectKey(req.ip);
      await hit(subject, [RATE.opens]);
      const { token, deviceId } = (req.body ?? {}) as { token?: unknown; deviceId?: unknown };
      if (typeof token !== "string" || !TOKEN.test(token) || typeof deviceId !== "string" || !DEVICE.test(deviceId)) {
        return reply.code(400).send({ error: "token and deviceId are required" });
      }
      const { dinner, known } = await openInvite(token, deviceId);
      if (dinner) return dinner;
      // Only a token that names nothing is a guess. A real link to a dinner that's off is a dorm opening what it was sent, and it must not use up that address's limit.
      if (!known) await hit(subject, [RATE.badTokens]);
      return reply.code(404).send({ error: "no such dinner" });
    },
  );
}

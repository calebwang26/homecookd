// POST /web-events: the lander's visit log (landerEvents.ts; docs/build/API.md). Public and unversioned, the same path, body, limits and 204 as Supabase's, so the
// site changes only its base URL. It has no CORS on purpose: the site sends it with navigator.sendBeacon as text/plain, a simple request whose answer the page
// never reads.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { invalid } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { logVisit } from "./landerEvents.js";

const BODY_BYTES = 64 * 1024;
const TYPES = new Set(["application/json", "text/plain"]);
const NOT_JSON = "The body must be JSON.";

/** Supabase's: 120 per 10 minutes per IP. The key holds only a keyed hash of the IP (rateLimit.ts). */
export const RATE = { bucket: "web-events", max: 120, windowS: 600 };

const FIELDS = ["event", "aud", "signal", "app", "utm_source", "utm_campaign", "path", "ui", "host"];

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  // JSON as application/json, as text/plain (a beacon's), or with no type, as Supabase read it. Only in this plugin: the rest of the api keeps its own parsers.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string", bodyLimit: BODY_BYTES }, (_req, body, done) => {
    const json = String(body);
    if (!json.trim()) return done(null, {});
    try {
      done(null, JSON.parse(json));
    } catch {
      done(invalid(undefined, NOT_JSON));
    }
  });

  // In Supabase's order, before the body is read: the limit, then the type.
  const before = async (req: FastifyRequest) => {
    await hit(subjectKey(req.ip), [RATE]);
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type && !TYPES.has(type)) throw invalid(undefined, NOT_JSON);
  };

  app.post(
    "/web-events",
    {
      onRequest: before,
      preValidation: async (req) => {
        if (req.body === undefined) req.body = {}; // no body at all reads as {}, so the answer names the missing field. JSON's null is refused
      },
      schema: { body: { type: "object", properties: Object.fromEntries(FIELDS.map((name) => [name, {}])) } },
      config: { notFileKeys: ["path"] }, // the page's path on the site, never a file
    },
    async (req, reply) => {
      await logVisit(req.body as Record<string, unknown>);
      return reply.status(204).send();
    },
  );
}

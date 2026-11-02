// Browsers. The app's web build calls /v1 from a page on staging: APP_WEB_ORIGINS holds its exact origins, comma-separated, and unset (production) means none.
// This is the one CORS layer for every route with none of its own. /dish/*, /invite/* and /link/open check their own pages' origins, and the family routes answer
// any site (accounts/routes.ts), so it leaves those alone. Sessions and device keys are headers, never cookies, so there's no allow-credentials.
import type { FastifyInstance, FastifyRequest } from "fastify";

/** What every CORS answer lets a page read: when to come back, and the id to quote with an error. */
export const EXPOSE = "retry-after, x-request-id";

const PREFLIGHT = {
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-device-key, x-profile-id, x-tz, x-request-id, idempotency-key",
  "access-control-max-age": "86400",
};

export const appWebOrigins = (env: NodeJS.ProcessEnv = process.env) =>
  new Set((env.APP_WEB_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));

/** Whether a route answers CORS itself: `config.ownCors`, and the two prefixes whose plugins answer for every path under them, unknown ones included. */
const ownCors = (req: FastifyRequest) => req.routeOptions.config?.ownCors === true || /^\/(dish|invite)(\/|$)/.test(req.url.split("?")[0]);

export function appCors(app: FastifyInstance, origins = appWebOrigins()): void {
  if (!origins.size) return;
  const listed = (req: FastifyRequest) => {
    const origin = req.headers.origin;
    return typeof origin === "string" && origins.has(origin) && !ownCors(req) ? origin : null;
  };
  const allowed = (origin: string) => ({ "access-control-allow-origin": origin, vary: "Origin", "access-control-expose-headers": EXPOSE });

  // A preflight is answered for any path, before routing, so a route needs no OPTIONS of its own.
  app.addHook("onRequest", async (req, reply) => {
    const origin = listed(req);
    if (origin && req.method === "OPTIONS") return reply.code(204).headers({ ...allowed(origin), ...PREFLIGHT }).send();
  });
  app.addHook("onSend", async (req, reply) => {
    const origin = listed(req);
    if (origin) reply.headers(allowed(origin));
  });
}

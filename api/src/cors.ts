// Browsers. Two settings, each exact origins, comma-separated; unset means none.
//   APP_WEB_ORIGINS: the app's web build, calling /v1 from a page on staging. Production sets none.
//   SITE_ORIGINS: the website's own pages (homecookd.app and www; staging's site on staging), for the public routes it calls: POST /v1/shares/open here, and
//   /invite/* and /dish/* beside their own lists.
// appCors is the one layer for every route with no CORS of its own. /dish/*, /invite/*, /link/open and /v1/shares/open check their own pages' origins, and the
// family routes answer any site (accounts/routes.ts), so it leaves those alone. Sessions and device keys are headers, never cookies, so there's no allow-credentials.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { refused } from "./errors.js";

/** What every CORS answer lets a page read: when to come back, and the id to quote with an error. */
export const EXPOSE = "retry-after, x-request-id";

const PREFLIGHT = {
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-device-key, x-profile-id, x-tz, x-request-id, idempotency-key",
  "access-control-max-age": "86400",
};

const originList = (value: string | undefined) => new Set((value ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));

export const appWebOrigins = (env: NodeJS.ProcessEnv = process.env) => originList(env.APP_WEB_ORIGINS);
/** Read on each request, as DISH_WEB_ORIGIN is: a route's own CORS asks when the call comes in. */
export const siteOrigins = (env: NodeJS.ProcessEnv = process.env) => originList(env.SITE_ORIGINS);

/** The CORS headers for a website route (SITE_ORIGINS only); false for another site. The app's fetch sends no Origin, so it needs none. */
export function siteCors(origin: string | undefined): Record<string, string> | false {
  if (!origin) return { vary: "Origin" };
  if (!siteOrigins().has(origin)) return false;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-request-id, idempotency-key",
    "access-control-expose-headers": EXPOSE,
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/** A website route's onRequest: the headers go on first, so the page can read a refusal or a 429 too. Another site is refused, its preflight included. */
export async function siteGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cors = siteCors(req.headers.origin);
  if (!cors) {
    reply.header("vary", "Origin");
    throw refused(403, "origin", "This site can't use these routes.");
  }
  reply.headers(cors);
}

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

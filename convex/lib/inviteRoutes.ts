// POST /invite/open { token, deviceId }: someone opened a dinner's invite link (homecookd.app/d?t=…, or
// the app's homecookd://d?t=…). Public: no secret and no sign-in, so anyone a guest sends the link to
// counts in "X going" (once per phone or browser: deviceId is a random id that page keeps). The reply is
// only { dish, hostFirstName, startsAt } (dinners.openInvite); 404 when the link doesn't work.
// Browsers may call it from homecookd.app and local dev pages (CORS); a request from any other site is
// refused. The app's own fetch sends no Origin.
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";

const ORIGINS = [/^https:\/\/(www\.)?homecookd\.app$/, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/];
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;

/** The CORS headers for an allowed origin; false for a site that may not call this. */
function corsFor(origin: string | null): Record<string, string> | false {
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

export function registerInviteRoutes(http: HttpRouter): void {
  http.route({
    path: "/invite/open",
    method: "POST",
    handler: httpAction(async (ctx, req) => {
      const cors = corsFor(req.headers.get("Origin"));
      const reply = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...(cors || {}) } });
      if (!cors) return reply({ error: "not allowed from this site" }, 403);
      const text = await req.text();
      if (text.length > 1000) return reply({ error: "body too large" }, 400);
      let body: { token?: unknown; deviceId?: unknown } | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        return reply({ error: "body must be JSON" }, 400);
      }
      const { token, deviceId } = body && typeof body === "object" ? body : { token: null, deviceId: null };
      if (typeof token !== "string" || !TOKEN.test(token) || typeof deviceId !== "string" || !DEVICE.test(deviceId)) {
        return reply({ error: "token and deviceId are required" }, 400);
      }
      const dinner = await ctx.runMutation(internal.dinners.openInvite, { token, deviceId });
      return dinner ? reply(dinner) : reply({ error: "no such dinner" }, 404);
    }),
  });

  http.route({
    path: "/invite/open",
    method: "OPTIONS",
    handler: httpAction(async (_ctx, req) => {
      const cors = corsFor(req.headers.get("Origin"));
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }),
  });
}

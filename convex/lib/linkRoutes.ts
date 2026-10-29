// POST /link/open { token }: the app opened a dish card's link (homecookd://miss?k=…, /a?t=…, or pasted after
// installing; docs/build/V2-LINKING.md §2.5). Public: whoever holds the link is not signed in yet. It says what
// the card is and, when the card is an open invite to its family, hands back a join ticket for Supabase's
// POST /auth/link. It changes nothing but the rate-limit counters, so opening a link twice is harmless.
//   200 { side, dish, kidName, relation, familyName, taken, ticket, language, joinable }
//   404 an unknown token (counts toward the bad-token limit) · 429 too many tries
// `joinable` says why there's no ticket: "taken" (that side brought someone in already), "window" (the card's
// last activity is too old), "no_family" (nobody's in the app yet: sign in first), "off" (LINK_JOIN_SECRET unset).
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { sha256Hex } from "./dishAskRoutes";
import { cardRef, newJti, signTicket, TICKET_MS } from "./joinTicket";
import { allowed, clientIp, ipKeyOf, LIMITS, type Limit } from "./rateLimit";
import { isWebOrigin } from "./webOrigin";

const ORIGINS = [/^https:\/\/(www\.)?homecookd\.app$/, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/];
const TOKEN = /^[0-9A-Za-z]{22}$/;
const MINUTE = 60_000;
const OPENS: Limit = { bucket: "link-open", max: 30, windowMs: 10 * MINUTE };
/** Keyed by card and side, not IP: one card can't mint tickets faster than this, from anywhere. */
const TICKETS: Limit = { bucket: "link-ticket", max: 5, windowMs: 60 * MINUTE };

function corsFor(origin: string | null): Record<string, string> | false {
  if (!origin) return { Vary: "Origin" };
  if (!ORIGINS.some((o) => o.test(origin)) && !isWebOrigin(origin)) return false;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function registerLinkRoutes(http: HttpRouter): void {
  http.route({
    path: "/link/open",
    method: "POST",
    handler: httpAction(async (ctx, req) => {
      const cors = corsFor(req.headers.get("Origin"));
      const reply = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(cors || { Vary: "Origin" }) },
        });
      if (!cors) return reply(403, { error: "This site can't use these routes.", code: "origin" });
      const ipKey = await ipKeyOf(clientIp(req));
      const tooMany = () => reply(429, { error: "Too many tries. Please wait a few minutes and try again.", code: "rate" });
      if (!(await allowed(ctx, ipKey, [OPENS]))) return tooMany();

      const text = await req.text();
      let token: unknown = null;
      try {
        token = text.length <= 1000 ? (JSON.parse(text) as { token?: unknown })?.token : null;
      } catch {
        // falls through to the 400
      }
      if (typeof token !== "string" || !token) return reply(400, { error: "token is required", code: "bad_request" });
      const found = TOKEN.test(token) ? await ctx.runQuery(internal.links.forOpen, { tokenHash: await sha256Hex(token), now: Date.now() }) : null;
      if (!found) {
        if (!(await allowed(ctx, ipKey, [LIMITS.badTokens]))) return tooMany();
        return reply(404, { error: "This link doesn't work anymore.", code: "not_found" });
      }

      const { askId, supabaseFamilyId, joinable, ...shown } = found;
      const secret = process.env.LINK_JOIN_SECRET?.trim();
      let ticket: string | null = null;
      let why: string = joinable;
      if (joinable === "yes" && !secret) why = "off";
      else if (joinable === "yes" && secret && supabaseFamilyId) {
        const card = await cardRef(askId);
        if (!(await allowed(ctx, `${found.side}:${card}`, [TICKETS]))) return tooMany();
        const name = found.side === "kid" ? found.kidName : found.relation.charAt(0).toUpperCase() + found.relation.slice(1);
        ticket = await signTicket(secret, {
          v: 1,
          fam: supabaseFamilyId,
          card,
          side: found.side,
          name,
          exp: Date.now() + TICKET_MS,
          jti: newJti(),
        });
      }
      return reply(200, { ...shown, ticket, joinable: why });
    }),
  });

  http.route({
    path: "/link/open",
    method: "OPTIONS",
    handler: httpAction(async (_ctx, req) => {
      const cors = corsFor(req.headers.get("Origin"));
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }),
  });
}

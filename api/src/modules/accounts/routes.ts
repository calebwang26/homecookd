// Sign-in, invites and account deletion (docs/build/ACCOUNTS-MIGRATION.md has the mapping from each old route). A route checks the input and who's asking; the files beside this hold the rules.
//
// Same paths, shapes, statuses and sentences as Supabase's `api`, proven by a device key or a family code (old builds; proofs.ts):
//   GET  /family                       POST /profiles, /profiles/self, /profiles/:id/remove
//   POST /devices, /devices/revoke     POST /invites, /invites/peek, /invites/accept
//   POST /join-links, /join-links/revoke
//   POST /move-requests                GET /move-requests, /move-requests/mine     POST /move-requests/:id/approve, /decline
//   POST /auth/apple, /auth/google     (public)
// What Convex held, as plain routes, proven by a session token (auth.ts):
//   POST /v1/sessions/start  (a device key, not a session)   POST /v1/sessions/end
//   POST /v1/account/delete
//   GET  /v1/apple/revoke-ready        POST /v1/apple/revoke
//   POST /v1/links/claim               POST /v1/links/moved
//   POST /link/open                    (public)
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from "fastify";
import { requireSession, requireSessionEvenIfRemoved, signedIn } from "../../auth.js";
import { webOrigin } from "../dish/values.js";
import { appleKey, revokeWithApple } from "./appleRevoke.js";
import { deleteMe } from "./deletion.js";
import { addProfile, addSelf, familyView, leaveFamily, signOutPhone, swapCodeForKey } from "./family.js";
import { acceptInvite, familyJoinLink, makeInvite, peek, revokeFamilyLinks } from "./invites.js";
import { afterMove, claimCard, openLink } from "./links.js";
import { approveMove, askToMove, declineMove, movesICanAnswer, myMove } from "./moves.js";
import { ctxOf, requireProof, type ProofOptions } from "./proofs.js";
import { endSession, startSession } from "./sessions.js";
import { signInWith } from "./signin.js";
import { refuse, type Body } from "./values.js";

// Supabase's: any site may call these, because each needs a key or a code, and the web /i page reads /invites/peek.
const OPEN_CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-device-key, x-family-code, x-profile-id, x-tz, authorization, apikey, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "86400",
};

const LINK_ORIGINS = [/^https:\/\/(www\.)?homecookd\.app$/, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/];

/** POST /link/open's own CORS: only our pages (convex/lib/linkRoutes.ts). The app's fetch sends no Origin. */
function linkCors(origin: string | undefined): Record<string, string> | false {
  if (!origin) return { Vary: "Origin" };
  if (!LINK_ORIGINS.some((o) => o.test(origin)) && origin !== webOrigin()) return false;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const bodyOf = (req: FastifyRequest) => (req.body ?? {}) as Body;

/** An empty POST is `{}`, as it was on Supabase. Runs before validation so the schema sees an object. */
const emptyIsObject = async (req: FastifyRequest) => {
  req.body ??= {};
};

const bearer = (req: FastifyRequest) => {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : "";
};

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const seen = new Set<string>();

  /** One old-contract route: its CORS, its OPTIONS, and the proof it needs. `null` means public. */
  const on = (method: "GET" | "POST", url: string, proof: ProofOptions | null, handler: (req: FastifyRequest) => Promise<unknown>) => {
    if (!seen.has(url)) {
      seen.add(url);
      app.options(url, async (_req, reply) => reply.status(204).headers(OPEN_CORS).send());
    }
    const route: RouteHandlerMethod = async (req, reply) => {
      const out = await handler(req);
      // JSON's null, as on Supabase: reply.send(null) would send no body at all, and old builds parse one.
      return out === null || out === undefined ? reply.type("application/json").send("null") : reply.send(out);
    };
    if (method === "GET") {
      app.get(url, { preValidation: proof ? requireProof(proof) : undefined }, route);
    } else {
      const hooks = proof ? [emptyIsObject, requireProof(proof)] : [emptyIsObject];
      app.post(url, { schema: { body: { type: "object" } }, preValidation: hooks }, route);
    }
  };

  // Answers and refusals both carry it, or the web page can't read the sentence. Only these routes: /dish and /link/open have their own.
  app.addHook("onSend", async (req, reply) => {
    if (seen.has(req.routeOptions.url ?? "")) reply.headers(OPEN_CORS);
  });

  // ---- old builds: a device key or a family code

  on("GET", "/family", { lenientMe: true }, (req) => familyView(ctxOf(req)));
  on("POST", "/profiles", {}, (req) => addProfile(ctxOf(req), bodyOf(req)));
  on("POST", "/profiles/self", { ignoreMe: true }, (req) => addSelf(ctxOf(req), bodyOf(req)));
  on("POST", "/profiles/:id/remove", { keepOwner: true, tombstoneOk: true }, (req) => leaveFamily(ctxOf(req), (req.params as { id: string }).id));
  on("POST", "/devices", {}, (req) => swapCodeForKey(ctxOf(req), bodyOf(req)));
  on("POST", "/devices/revoke", { ignoreMe: true }, (req) => signOutPhone(ctxOf(req)));

  on("POST", "/invites", {}, (req) => makeInvite(ctxOf(req), bodyOf(req)));
  on("POST", "/invites/peek", null, (req) => peek(req, bodyOf(req)));
  on("POST", "/invites/accept", null, (req) => acceptInvite(req, bodyOf(req)));
  on("POST", "/join-links", {}, (req) => familyJoinLink(ctxOf(req)));
  on("POST", "/join-links/revoke", {}, (req) => revokeFamilyLinks(ctxOf(req)));

  on("POST", "/move-requests", { ignoreMe: true }, (req) => askToMove(ctxOf(req), bodyOf(req)));
  on("GET", "/move-requests/mine", { ignoreMe: true }, (req) => myMove(ctxOf(req)));
  on("GET", "/move-requests", {}, (req) => movesICanAnswer(ctxOf(req)));
  on("POST", "/move-requests/:id/approve", {}, (req) => approveMove(ctxOf(req), (req.params as { id: string }).id));
  on("POST", "/move-requests/:id/decline", {}, (req) => declineMove(ctxOf(req), (req.params as { id: string }).id));

  const authLog = (req: FastifyRequest) => req.log.error.bind(req.log) as (fields: object, message: string) => void;
  on("POST", "/auth/apple", null, (req) => signInWith("apple", bodyOf(req), req.ip, authLog(req)));
  on("POST", "/auth/google", null, (req) => signInWith("google", bodyOf(req), req.ip, authLog(req)));

  // ---- what Convex held: a session token

  const object = { schema: { body: { type: "object" } } };

  app.post("/v1/sessions/start", { ...object, preValidation: emptyIsObject }, async (req) => startSession(bodyOf(req), req.ip));
  app.post("/v1/sessions/end", { ...object, preValidation: emptyIsObject }, async (req) => endSession(bearer(req)));

  app.post("/v1/account/delete", { ...object, preValidation: [emptyIsObject, requireSessionEvenIfRemoved] }, async (req) => deleteMe(signedIn(req).personId, String(req.id)));

  /** The app asks before showing "Apple will ask you to confirm.": true once the key is set. */
  app.get("/v1/apple/revoke-ready", { preValidation: requireSessionEvenIfRemoved }, async () => ({ ready: appleKey() !== null }));
  app.post("/v1/apple/revoke", { ...object, preValidation: [emptyIsObject, requireSessionEvenIfRemoved] }, async (req) => {
    const k = appleKey();
    if (!k) return { revoked: false, reason: "not configured" };
    const raw = bodyOf(req).authorizationCode;
    const code = typeof raw === "string" ? raw.trim() : "";
    if (!code || code.length > 2000) return { revoked: false, reason: "no code" };
    return revokeWithApple(k, code, (reason) => req.log.warn({ reason }, "Apple didn't revoke"));
  });

  app.post("/v1/links/claim", { ...object, preValidation: [emptyIsObject, requireSession] }, async (req) => claimCard(signedIn(req), bodyOf(req)));
  app.post("/v1/links/moved", { ...object, preValidation: [emptyIsObject, requireSession] }, async (req) => afterMove(signedIn(req), bodyOf(req)));

  const linkGuard = async (req: FastifyRequest, reply: FastifyReply) => {
    const cors = linkCors(req.headers.origin);
    if (!cors) throw refuse(403, "This site can't use these routes.", { code: "origin" });
    reply.headers(cors);
  };
  app.post("/link/open", { ...object, preValidation: [linkGuard, emptyIsObject] }, async (req, reply) => {
    reply.header("cache-control", "no-store");
    return openLink(bodyOf(req), req.ip);
  });
  app.options("/link/open", async (req, reply) => {
    const cors = linkCors(req.headers.origin);
    return reply.status(cors ? 204 : 403).headers(cors || {}).send();
  });
}

// Sign in with Apple revocation (Apple's TN3194, App Store guideline 5.1.1(v)). When someone who signed
// in with Apple deletes their account, the app asks Apple to confirm once more and sends the fresh
// authorization code here, before account.deleteMe. revoke swaps the code for a refresh token at Apple
// and revokes that token, so homecookd leaves their Apple ID's "Sign in with Apple" list. Nothing of
// Apple's is stored or logged, and Apple trouble never throws: the deletion goes on either way.
//
// Env (docs/build/STACK.md, "Sign in with Apple revocation"): APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID,
// APPLE_SIGNIN_PRIVATE_KEY (the .p8 file) and APPLE_CLIENT_ID (default: the app's bundle id). Until
// they are set, revokeReady is false and revoke calls nobody. `npx convex run apple:checkSetup` asks
// Apple whether it takes the key.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction, internalQuery, query } from "./_generated/server";
import { requireSession } from "./lib/auth";

export const APPLE = "https://appleid.apple.com";
/** The app's bundle id: the client id for Sign in with Apple in the app. */
export const DEFAULT_CLIENT_ID = "com.salik.homecookd";
/** Each call signs its own client secret, good for 5 minutes (Apple allows up to 6 months). */
export const SECRET_TTL_S = 300;

export type AppleKey = { teamId: string; keyId: string; privateKey: string; clientId: string };
type Revoked = { revoked: boolean; reason?: string };

/** The Sign in with Apple key from Convex env, or null while any part is missing. */
export function appleKey(): AppleKey | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_SIGNIN_KEY_ID?.trim();
  const privateKey = process.env.APPLE_SIGNIN_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey, clientId: process.env.APPLE_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID };
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The .p8 file's PKCS#8 bytes. Pasted on one line, its line breaks may come as a literal "\n". */
function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\\n|\s/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** Apple's client secret: an ES256 JWT. Web Crypto's ECDSA signature is already the r||s JOSE wants. */
export async function clientSecret(k: AppleKey, nowMs = Date.now()): Promise<string> {
  const iat = Math.floor(nowMs / 1000);
  const header = { alg: "ES256", kid: k.keyId };
  const claims = { iss: k.teamId, iat, exp: iat + SECRET_TTL_S, aud: APPLE, sub: k.clientId };
  const input = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(k.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/** A form POST to Apple: its status and JSON body ({} when empty, as a revoke's is). */
async function post(path: string, form: Record<string, string>) {
  const res = await fetch(`${APPLE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Apple's status and error word (invalid_grant, invalid_client): safe to log, unlike the tokens. */
const said = (r: { status: number; body: Record<string, unknown> }) => `${r.status}${typeof r.body.error === "string" ? ` ${r.body.error}` : ""}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

function notRevoked(reason: string): Revoked {
  console.warn(`apple.revoke: not revoked (${reason})`);
  return { revoked: false, reason };
}

/** Swaps the code for a refresh token, then revokes that. Never throws. */
export async function revokeWithApple(k: AppleKey, code: string): Promise<Revoked> {
  try {
    const client = { client_id: k.clientId, client_secret: await clientSecret(k) };
    const token = await post("/auth/token", { ...client, code, grant_type: "authorization_code" });
    const refresh = token.body.refresh_token;
    if (!token.ok || typeof refresh !== "string" || !refresh) return notRevoked(`token ${said(token)}`);
    const revoked = await post("/auth/revoke", { ...client, token: refresh, token_type_hint: "refresh_token" });
    return revoked.ok ? { revoked: true } : notRevoked(`revoke ${said(revoked)}`);
  } catch (e) {
    return notRevoked(errText(e));
  }
}

/** The app asks before showing "Apple will ask you to confirm.": true once the key is set. */
export const revokeReady = query({
  args: { sessionToken: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { sessionToken }) => {
    await requireSession(ctx, sessionToken);
    return appleKey() !== null;
  },
});

export const revoke = action({
  args: { sessionToken: v.string(), authorizationCode: v.string() },
  returns: v.object({ revoked: v.boolean(), reason: v.optional(v.string()) }),
  handler: async (ctx, { sessionToken, authorizationCode }): Promise<Revoked> => {
    await ctx.runQuery(internal.apple.signedIn, { sessionToken });
    const k = appleKey();
    if (!k) return { revoked: false, reason: "not configured" };
    const code = authorizationCode.trim();
    if (!code || code.length > 2000) return { revoked: false, reason: "no code" };
    return await revokeWithApple(k, code);
  },
});

/** requireSession for revoke (an action has no database of its own). */
export const signedIn = internalQuery({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    await requireSession(ctx, sessionToken);
    return null;
  },
});

/**
 * One-time check after the env is set: sends Apple a made-up code. Apple answering "invalid_grant" means
 * it took the client secret (only the code was wrong); "invalid_client" means the team id, key id,
 * .p8 or client id is off.
 */
export const checkSetup = internalAction({
  args: {},
  returns: v.string(),
  handler: async () => {
    const k = appleKey();
    if (!k) return "not configured: set APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID and APPLE_SIGNIN_PRIVATE_KEY";
    try {
      const client = { client_id: k.clientId, client_secret: await clientSecret(k) };
      const r = await post("/auth/token", { ...client, code: "homecookd-setup-check", grant_type: "authorization_code" });
      return r.body.error === "invalid_grant" ? `ready: Apple took the key for ${k.clientId}` : `not ready: Apple said ${said(r)}`;
    } catch (e) {
      return `not ready: ${errText(e)}`;
    }
  },
});

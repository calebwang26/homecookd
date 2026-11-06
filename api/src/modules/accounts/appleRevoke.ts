// Sign in with Apple revocation (Apple's TN3194, App Store guideline 5.1.1(v); convex/apple.ts). When someone who signed in with Apple deletes their account, the
// app asks Apple to confirm once more and sends the fresh authorization code here, before the delete. The code is swapped for a refresh token, which is revoked,
// so homecookd leaves their Apple ID's "Sign in with Apple" list. Nothing of Apple's is stored or logged, and Apple trouble never throws: the deletion goes on.
//
// Env: APPLE_TEAM_ID, APPLE_SIGNIN_KEY_ID, APPLE_SIGNIN_PRIVATE_KEY (the .p8 file), APPLE_CLIENT_ID (default: the bundle id). Until they're set, nobody is called.
export const APPLE = "https://appleid.apple.com";
export const DEFAULT_CLIENT_ID = "com.salik.homecookd";
/** Each call signs its own client secret, good for 5 minutes (Apple allows up to 6 months). */
export const SECRET_TTL_S = 300;
const TIMEOUT_MS = 10_000;

export type AppleKey = { teamId: string; keyId: string; privateKey: string; clientId: string };
export type Revoked = { revoked: boolean; reason?: string };

export function appleKey(): AppleKey | null {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_SIGNIN_KEY_ID?.trim();
  const privateKey = process.env.APPLE_SIGNIN_PRIVATE_KEY?.trim();
  if (!teamId || !keyId || !privateKey) return null;
  return { teamId, keyId, privateKey, clientId: process.env.APPLE_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID };
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** The .p8 file's PKCS#8 bytes. Pasted on one line, its line breaks may come as a literal "\n". */
function pkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\\n|\s/g, "");
  return new Uint8Array(Buffer.from(body, "base64"));
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Apple's status and error word (invalid_grant, invalid_client): safe to log, unlike the tokens. */
const said = (r: { status: number; body: Record<string, unknown> }) => `${r.status}${typeof r.body.error === "string" ? ` ${r.body.error}` : ""}`;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

/**
 * Swaps the code for a refresh token, then revokes that. Never throws. The code can be used once, so a lost answer from the swap can't be tried again; the revoke
 * can, and gets one more try when Apple is having trouble, since after this nothing else could ever revoke that token.
 */
export async function revokeWithApple(k: AppleKey, code: string, onNotRevoked: (reason: string) => void = () => {}): Promise<Revoked> {
  const notRevoked = (reason: string): Revoked => {
    onNotRevoked(reason);
    return { revoked: false, reason };
  };
  try {
    const client = { client_id: k.clientId, client_secret: await clientSecret(k) };
    const token = await post("/auth/token", { ...client, code, grant_type: "authorization_code" });
    const refresh = token.body.refresh_token;
    if (!token.ok || typeof refresh !== "string" || !refresh) return notRevoked(`token ${said(token)}`);
    const form = { ...client, token: refresh, token_type_hint: "refresh_token" };
    let revoked = await post("/auth/revoke", form).catch(() => null);
    if (!revoked || revoked.status >= 500) revoked = await post("/auth/revoke", form);
    return revoked.ok ? { revoked: true } : notRevoked(`revoke ${said(revoked)}`);
  } catch (e) {
    return notRevoked(errText(e));
  }
}

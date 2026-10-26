import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { APPLE, clientSecret, DEFAULT_CLIENT_ID, SECRET_TTL_S } from "./apple";
import { newBackend, signIn, stubFetch } from "./test.helpers";

const ENV = ["APPLE_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY", "APPLE_CLIENT_ID"] as const;
const TEAM = "TEAM123456";
const KID = "KEY1234567";

/** A fresh P-256 key as Apple's .p8 file holds it (PKCS#8 PEM), and its public half. */
async function p8() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const lines = btoa(String.fromCharCode(...der)).match(/.{1,64}/g)!.join("\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const part = (b64url: string) => JSON.parse(new TextDecoder().decode(bytes(b64url)));

async function verifies(jwt: string, publicKey: CryptoKey) {
  const [header, claims, sig] = jwt.split(".");
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, bytes(sig), new TextEncoder().encode(`${header}.${claims}`));
}

let key: Awaited<ReturnType<typeof p8>>;
beforeEach(async () => {
  key = await p8();
  process.env.APPLE_TEAM_ID = TEAM;
  process.env.APPLE_SIGNIN_KEY_ID = KID;
  process.env.APPLE_SIGNIN_PRIVATE_KEY = key.pem;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of ENV) delete process.env[k];
});

type Sent = { path: string; contentType: string; form: URLSearchParams };
const TOKENS = { access_token: "at-secret", refresh_token: "rt-secret", id_token: "id-secret", token_type: "bearer", expires_in: 3600 };

/** Apple's token and revoke endpoints (plus Supabase's /family for sign-in); keeps each form sent. */
function stubApple(token = () => Response.json(TOKENS), revoke = () => new Response(null, { status: 200 })) {
  const sent: Sent[] = [];
  const fetch = stubFetch(undefined, (url, init) => {
    if (!url.startsWith(APPLE)) return undefined;
    const headers = new Headers(init?.headers);
    sent.push({ path: url.slice(APPLE.length), contentType: headers.get("content-type") ?? "", form: new URLSearchParams(String(init?.body)) });
    return url.endsWith("/auth/token") ? token() : revoke();
  });
  return { fetch, sent };
}

async function signedIn() {
  const t = newBackend();
  const { sessionToken } = await signIn(t, "p-dad");
  return { t, sessionToken };
}

test("the client secret is an ES256 JWT that checks out with the key's public half", async () => {
  const now = Date.UTC(2026, 9, 25, 18, 0, 0);
  const jwt = await clientSecret({ teamId: TEAM, keyId: KID, privateKey: key.pem, clientId: DEFAULT_CLIENT_ID }, now);
  const [header, claims, sig] = jwt.split(".");
  expect(part(header)).toEqual({ alg: "ES256", kid: KID });
  const iat = now / 1000;
  expect(part(claims)).toEqual({ iss: TEAM, iat, exp: iat + SECRET_TTL_S, aud: "https://appleid.apple.com", sub: "com.salik.homecookd" });
  expect(SECRET_TTL_S).toBeLessThanOrEqual(15_777_000); // Apple's limit: 6 months
  expect(bytes(sig)).toHaveLength(64); // raw r||s, not DER
  expect(jwt).not.toMatch(/[=+/]/);
  expect(await verifies(jwt, key.publicKey)).toBe(true);
  // Any other claims don't match the signature.
  const forged = `${header}.${btoa(JSON.stringify({ ...part(claims), sub: "com.other.app" })).replace(/=+$/, "")}.${sig}`;
  expect(await verifies(forged, key.publicKey)).toBe(false);
  // A .p8 pasted on one line, its breaks as literal "\n", signs the same way.
  const oneLine = key.pem.trim().replace(/\n/g, "\\n");
  expect(await verifies(await clientSecret({ teamId: TEAM, keyId: KID, privateKey: oneLine, clientId: DEFAULT_CLIENT_ID }), key.publicKey)).toBe(true);
});

test("revoke swaps the code for a refresh token at Apple, then revokes that token", async () => {
  const apple = stubApple();
  const { t, sessionToken } = await signedIn();
  expect(await t.action(api.apple.revoke, { sessionToken, authorizationCode: " code-1 " })).toEqual({ revoked: true });

  expect(apple.sent.map((s) => s.path)).toEqual(["/auth/token", "/auth/revoke"]);
  const [token, revoke] = apple.sent;
  for (const s of apple.sent) {
    expect(s.contentType).toBe("application/x-www-form-urlencoded");
    expect(s.form.get("client_id")).toBe("com.salik.homecookd");
    expect(await verifies(s.form.get("client_secret")!, key.publicKey)).toBe(true);
  }
  expect([...token.form.keys()].sort()).toEqual(["client_id", "client_secret", "code", "grant_type"]);
  expect(token.form.get("code")).toBe("code-1");
  expect(token.form.get("grant_type")).toBe("authorization_code");
  expect([...revoke.form.keys()].sort()).toEqual(["client_id", "client_secret", "token", "token_type_hint"]);
  expect(revoke.form.get("token")).toBe("rt-secret");
  expect(revoke.form.get("token_type_hint")).toBe("refresh_token");
});

test("APPLE_CLIENT_ID replaces the bundle id", async () => {
  process.env.APPLE_CLIENT_ID = "com.example.other";
  const apple = stubApple();
  const { t, sessionToken } = await signedIn();
  await t.action(api.apple.revoke, { sessionToken, authorizationCode: "code-1" });
  expect(apple.sent.map((s) => s.form.get("client_id"))).toEqual(["com.example.other", "com.example.other"]);
  expect(part(apple.sent[0].form.get("client_secret")!.split(".")[1]).sub).toBe("com.example.other");
});

test("without the key: revokeReady is false and revoke never calls Apple", async () => {
  const apple = stubApple();
  const { t, sessionToken } = await signedIn();
  expect(await t.query(api.apple.revokeReady, { sessionToken })).toBe(true);
  for (const k of ["APPLE_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY"] as const) {
    const saved = process.env[k];
    delete process.env[k];
    expect(await t.query(api.apple.revokeReady, { sessionToken })).toBe(false);
    expect(await t.action(api.apple.revoke, { sessionToken, authorizationCode: "code-1" })).toEqual({ revoked: false, reason: "not configured" });
    process.env[k] = saved;
  }
  expect(apple.sent).toEqual([]);
  expect(apple.fetch.mock.calls.some(([url]) => String(url).startsWith(APPLE))).toBe(false);
});

test("Apple saying no, or not answering, is revoked: false, never an error, and no token is logged", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const cases: [string, () => Response, () => Response, number][] = [
    ["a stale code", () => Response.json({ error: "invalid_grant" }, { status: 400 }), () => new Response(null), 1],
    ["a bad key", () => Response.json({ error: "invalid_client" }, { status: 400 }), () => new Response(null), 1],
    ["no refresh token", () => Response.json({ access_token: "at-secret" }), () => new Response(null), 1],
    ["revoke refused", () => Response.json(TOKENS), () => Response.json({ error: "invalid_request" }, { status: 400 }), 2],
    ["Apple down", () => new Response("<html>", { status: 503 }), () => new Response(null), 1],
  ];
  for (const [name, token, revoke, calls] of cases) {
    const apple = stubApple(token, revoke);
    const { t, sessionToken } = await signedIn();
    const res = await t.action(api.apple.revoke, { sessionToken, authorizationCode: "code-1" });
    expect(res.revoked, name).toBe(false);
    expect(res.reason, name).toBeTruthy();
    expect(apple.sent, name).toHaveLength(calls);
  }
  expect(warn.mock.calls.flat().join(" ")).toMatch(/invalid_grant/);

  stubApple();
  const { t, sessionToken } = await signedIn();
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new TypeError("fetch failed");
  }));
  expect(await t.action(api.apple.revoke, { sessionToken, authorizationCode: "code-1" })).toEqual({ revoked: false, reason: "fetch failed" });

  const logged = warn.mock.calls.flat().join(" ");
  for (const secret of ["code-1", "rt-secret", "at-secret", "id-secret", "PRIVATE KEY"]) expect(logged).not.toContain(secret);
});

test("an empty code is not sent to Apple", async () => {
  const apple = stubApple();
  const { t, sessionToken } = await signedIn();
  expect(await t.action(api.apple.revoke, { sessionToken, authorizationCode: "  " })).toEqual({ revoked: false, reason: "no code" });
  expect(apple.sent).toEqual([]);
});

test("only a signed-in phone may ask", async () => {
  const apple = stubApple();
  const t = newBackend();
  const bad = "x".repeat(43);
  await expect(t.query(api.apple.revokeReady, { sessionToken: bad })).rejects.toThrow(/signed out/);
  await expect(t.action(api.apple.revoke, { sessionToken: bad, authorizationCode: "code-1" })).rejects.toThrow(/signed out/);
  expect(apple.sent).toEqual([]);
});

test("checkSetup: Apple's invalid_grant for a made-up code means the key works", async () => {
  const t = newBackend();
  stubApple(() => Response.json({ error: "invalid_grant" }, { status: 400 }));
  expect(await t.action(internal.apple.checkSetup, {})).toBe("ready: Apple took the key for com.salik.homecookd");
  stubApple(() => Response.json({ error: "invalid_client" }, { status: 400 }));
  expect(await t.action(internal.apple.checkSetup, {})).toBe("not ready: Apple said 400 invalid_client");
  delete process.env.APPLE_SIGNIN_PRIVATE_KEY;
  expect(await t.action(internal.apple.checkSetup, {})).toMatch(/^not configured/);
});

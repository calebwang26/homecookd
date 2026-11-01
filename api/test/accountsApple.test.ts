// Sign in with Apple revocation (TN3194). Carries over convex/apple.test.ts, against a stub of Apple's two endpoints: nothing reaches Apple.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { db } from "../src/db.js";
import { APPLE, clientSecret, DEFAULT_CLIENT_ID, revokeWithApple, SECRET_TTL_S } from "../src/modules/accounts/appleRevoke.js";
import { Api, bearer, freshDatabase, hasDatabase, makeFamily, makePerson, setup } from "./accountsHelpers.js";
import { session } from "./helpers.js";

const skip = !hasDatabase;
const ENV = ["APPLE_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY", "APPLE_CLIENT_ID"] as const;
const TEAM = "TEAM123456";
const KID = "KEY1234567";
const realFetch = globalThis.fetch;

/** A fresh P-256 key as Apple's .p8 file holds it (PKCS#8 PEM), and its public half. */
async function p8() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const lines = der.toString("base64").match(/.{1,64}/g)!.join("\n");
  return { pem: `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

const part = (b64url: string) => JSON.parse(Buffer.from(b64url, "base64url").toString());
const verifies = (jwt: string, publicKey: CryptoKey) => {
  const [header, claims, sig] = jwt.split(".");
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, Buffer.from(sig, "base64url"), new TextEncoder().encode(`${header}.${claims}`));
};

let key: Awaited<ReturnType<typeof p8>>;
let api: Api;
let token: string;

before(async () => {
  if (skip) return;
  await freshDatabase();
  await setup();
  api = new Api();
  const f = await makeFamily();
  token = await session(f.id, await makePerson(f.id));
});

beforeEach(async () => {
  key = await p8();
  process.env.APPLE_TEAM_ID = TEAM;
  process.env.APPLE_SIGNIN_KEY_ID = KID;
  process.env.APPLE_SIGNIN_PRIVATE_KEY = key.pem;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV) delete process.env[k];
});

after(async () => {
  if (!skip) await db().end();
});

type Sent = { path: string; contentType: string; form: URLSearchParams };
const TOKENS = { access_token: "at-secret", refresh_token: "rt-secret", id_token: "id-secret", token_type: "bearer", expires_in: 3600 };

function stubApple(tokenReply = () => Response.json(TOKENS), revokeReply = () => new Response(null, { status: 200 })) {
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.startsWith(APPLE), `only Apple's stub is called, not ${url}`);
    assert.ok(init?.signal, "every outside call has a timeout");
    sent.push({
      path: url.slice(APPLE.length),
      contentType: new Headers(init?.headers).get("content-type") ?? "",
      form: new URLSearchParams(String(init?.body)),
    });
    return url.endsWith("/auth/token") ? tokenReply() : revokeReply();
  }) as typeof fetch;
  return sent;
}

const revoke = (authorizationCode: string, session_ = token) => api.post("/v1/apple/revoke", { authorizationCode }, bearer(session_));

test("the client secret is an ES256 JWT that checks out with the key's public half", async () => {
  const now = Date.UTC(2026, 9, 25, 18, 0, 0);
  const jwt = await clientSecret({ teamId: TEAM, keyId: KID, privateKey: key.pem, clientId: DEFAULT_CLIENT_ID }, now);
  const [header, claims, sig] = jwt.split(".");
  assert.deepEqual(part(header), { alg: "ES256", kid: KID });
  const iat = now / 1000;
  assert.deepEqual(part(claims), { iss: TEAM, iat, exp: iat + SECRET_TTL_S, aud: "https://appleid.apple.com", sub: "com.salik.homecookd" });
  assert.ok(SECRET_TTL_S <= 15_777_000, "Apple's limit: 6 months");
  assert.equal(Buffer.from(sig, "base64url").length, 64, "raw r||s, not DER");
  assert.doesNotMatch(jwt, /[=+/]/);
  assert.equal(await verifies(jwt, key.publicKey), true);
  const forged = `${header}.${Buffer.from(JSON.stringify({ ...part(claims), sub: "com.other.app" })).toString("base64url")}.${sig}`;
  assert.equal(await verifies(forged, key.publicKey), false);
  const oneLine = key.pem.trim().replace(/\n/g, "\\n");
  assert.equal(await verifies(await clientSecret({ teamId: TEAM, keyId: KID, privateKey: oneLine, clientId: DEFAULT_CLIENT_ID }), key.publicKey), true, "a .p8 pasted on one line signs the same");
});

test("revoke swaps the code for a refresh token at Apple, then revokes that token", { skip }, async () => {
  const sent = stubApple();
  const res = await revoke(" code-1 ");
  assert.deepEqual([res.data.revoked, res.data.reason], [true, undefined]);
  assert.deepEqual(sent.map((s) => s.path), ["/auth/token", "/auth/revoke"]);
  const [tokenCall, revokeCall] = sent;
  for (const s of sent) {
    assert.equal(s.contentType, "application/x-www-form-urlencoded");
    assert.equal(s.form.get("client_id"), "com.salik.homecookd");
    assert.equal(await verifies(s.form.get("client_secret")!, key.publicKey), true);
  }
  assert.deepEqual([...tokenCall.form.keys()].sort(), ["client_id", "client_secret", "code", "grant_type"]);
  assert.equal(tokenCall.form.get("code"), "code-1");
  assert.equal(tokenCall.form.get("grant_type"), "authorization_code");
  assert.deepEqual([...revokeCall.form.keys()].sort(), ["client_id", "client_secret", "token", "token_type_hint"]);
  assert.equal(revokeCall.form.get("token"), "rt-secret");
  assert.equal(revokeCall.form.get("token_type_hint"), "refresh_token");
});

test("APPLE_CLIENT_ID replaces the bundle id", { skip }, async () => {
  process.env.APPLE_CLIENT_ID = "com.example.other";
  const sent = stubApple();
  await revoke("code-1");
  assert.deepEqual(sent.map((s) => s.form.get("client_id")), ["com.example.other", "com.example.other"]);
  assert.equal(part(sent[0].form.get("client_secret")!.split(".")[1]).sub, "com.example.other");
});

test("without the key: revoke-ready is false and revoke never calls Apple", { skip }, async () => {
  const sent = stubApple();
  assert.equal((await api.get("/v1/apple/revoke-ready", bearer(token))).data.ready, true);
  for (const k of ["APPLE_TEAM_ID", "APPLE_SIGNIN_KEY_ID", "APPLE_SIGNIN_PRIVATE_KEY"] as const) {
    const saved = process.env[k];
    delete process.env[k];
    assert.equal((await api.get("/v1/apple/revoke-ready", bearer(token))).data.ready, false);
    const res = await revoke("code-1");
    assert.deepEqual([res.data.revoked, res.data.reason], [false, "not configured"]);
    process.env[k] = saved;
  }
  assert.deepEqual(sent, []);
});

test("Apple saying no, or not answering, is revoked: false, never an error, and no token is logged", { skip }, async () => {
  const words: string[] = [];
  const log = (reason: string) => words.push(reason);
  const k = { teamId: TEAM, keyId: KID, privateKey: key.pem, clientId: DEFAULT_CLIENT_ID };
  const cases: [string, () => Response, () => Response, number][] = [
    ["a stale code", () => Response.json({ error: "invalid_grant" }, { status: 400 }), () => new Response(null), 1],
    ["a bad key", () => Response.json({ error: "invalid_client" }, { status: 400 }), () => new Response(null), 1],
    ["no refresh token", () => Response.json({ access_token: "at-secret" }), () => new Response(null), 1],
    ["revoke refused", () => Response.json(TOKENS), () => Response.json({ error: "invalid_request" }, { status: 400 }), 2],
    ["Apple down at the token", () => new Response("<html>", { status: 503 }), () => new Response(null), 1],
    ["Apple down at the revoke: one more try", () => Response.json(TOKENS), () => new Response("<html>", { status: 503 }), 3],
  ];
  for (const [name, tokenReply, revokeReply, calls] of cases) {
    const sent = stubApple(tokenReply, revokeReply);
    const res = await revokeWithApple(k, "code-1", log);
    assert.equal(res.revoked, false, name);
    assert.ok(res.reason, name);
    assert.equal(sent.length, calls, name);
  }
  assert.match(words.join(" "), /invalid_grant/);

  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.deepEqual(await revokeWithApple(k, "code-1", log), { revoked: false, reason: "fetch failed" });
  for (const secret of ["code-1", "rt-secret", "at-secret", "id-secret", "PRIVATE KEY"]) assert.ok(!words.join(" ").includes(secret), secret);
  // Through the route too: a refusal is still a 200 with revoked: false.
  stubApple(() => Response.json({ error: "invalid_grant" }, { status: 400 }));
  const res = await revoke("code-1");
  assert.deepEqual([res.status, res.data.revoked], [200, false]);
});

test("a revoke that works on the second try counts", { skip }, async () => {
  let tries = 0;
  const sent = stubApple(undefined, () => (tries++ === 0 ? new Response("<html>", { status: 502 }) : new Response(null, { status: 200 })));
  assert.deepEqual([(await revoke("code-1")).data.revoked, sent.length], [true, 3]);
});

test("an empty code is not sent to Apple", { skip }, async () => {
  const sent = stubApple();
  const res = await revoke("  ");
  assert.deepEqual([res.data.revoked, res.data.reason], [false, "no code"]);
  assert.deepEqual(sent, []);
});

test("only a signed-in phone may ask", { skip }, async () => {
  const sent = stubApple();
  const bad = bearer("x".repeat(43));
  assert.equal((await api.get("/v1/apple/revoke-ready", bad)).status, 401);
  assert.equal((await api.post("/v1/apple/revoke", { authorizationCode: "code-1" }, bad)).status, 401);
  assert.deepEqual(sent, []);
});

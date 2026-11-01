// What the accounts tests share: the real routes on real Postgres, the real token checks against fake Apple and Google keys, and made-up people. Nothing here reaches Apple, Google, Convex or
// Supabase. Every request comes from a new address unless a test names one, because the routes' rate limits are real.
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { buildApp } from "../src/app.js";
import { hashToken } from "../src/auth.js";
import { db } from "../src/db.js";
import { idTokensWith, useIdTokens } from "../src/modules/accounts/identity.js";
import { JOIN_LINK_SALT, seal } from "../src/modules/accounts/sealed.js";
import { freshDatabase, hasDatabase } from "./helpers.js";

export { hasDatabase };

export const SECRET = "test-link-secret-0123456789abcdef";
export const SIGNED_OUT = "This phone was signed out.";

export const APPLE_ISS = "https://appleid.apple.com";
export const GOOGLE_ISS = "https://accounts.google.com";
export const BUNDLE = "com.salik.homecookd";
export const GOOGLE_CLIENT = "test-client.apps.googleusercontent.com";

type Key = { privateKey: CryptoKey; jwk: JWK };

async function rsa(kid: string): Promise<Key> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  return { privateKey: privateKey as CryptoKey, jwk: { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" } };
}

export type Keys = { apple: Key; google: Key; forger: Key };

/** The env these routes read, and fake provider keys behind the real checks. */
export async function setup(): Promise<Keys> {
  Object.assign(process.env, {
    ACCOUNTS_OWNS_PEOPLE: "1",
    RATE_LIMIT_SALT: "test-salt",
    EDIBLE_CODE_KEY: "test-code-key",
    LINK_JOIN_SECRET: SECRET,
    APPLE_AUDIENCES: BUNDLE,
    GOOGLE_CLIENT_IDS: GOOGLE_CLIENT,
  });
  const keys: Keys = { apple: await rsa("apple-1"), google: await rsa("google-1"), forger: await rsa("apple-1") };
  useIdTokens(idTokensWith({ apple: createLocalJWKSet({ keys: [keys.apple.jwk] }), google: createLocalJWKSet({ keys: [keys.google.jwk] }) }));
  return keys;
}

export type Claims = { sub?: string; aud?: string; iss?: string; expiresIn?: string | number; email?: string; email_verified?: boolean | string; given_name?: string };

export function signToken(key: Key, claims: Claims): Promise<string> {
  const { sub, aud, iss, expiresIn = "10m", email, email_verified, given_name } = claims;
  const jwt = new SignJWT({ ...(email ? { email, email_verified } : {}), ...(given_name ? { given_name } : {}) }).setProtectedHeader({ alg: "RS256", kid: key.jwk.kid });
  if (sub !== undefined) jwt.setSubject(sub);
  if (aud !== undefined) jwt.setAudience(aud);
  if (iss !== undefined) jwt.setIssuer(iss);
  return jwt.setIssuedAt().setExpirationTime(expiresIn).sign(key.privateKey);
}

export const appleToken = (keys: Keys, sub: string, claims: Claims = {}) => signToken(keys.apple, { sub, aud: BUNDLE, iss: APPLE_ISS, email_verified: "true", ...claims });
export const googleToken = (keys: Keys, sub: string, claims: Claims = {}) => signToken(keys.google, { sub, aud: GOOGLE_CLIENT, iss: GOOGLE_ISS, email_verified: true, ...claims });

let nextIp = 0;
export const newIp = () => {
  nextIp += 1;
  return `198.51.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`;
};

export type Reply = { status: number; data: any; headers: Record<string, unknown> };

export class Api {
  readonly app: FastifyInstance = buildApp({ logger: false });

  private async send(method: "GET" | "POST", url: string, body: unknown, headers: Record<string, string>, ip?: string): Promise<Reply> {
    const res = await this.app.inject({
      method,
      url,
      headers,
      remoteAddress: ip ?? newIp(),
      ...(method === "POST" ? { payload: (body ?? {}) as object } : {}),
    });
    const text = res.body;
    return { status: res.statusCode, data: text ? JSON.parse(text) : null, headers: res.headers };
  }
  get = (url: string, headers: Record<string, string> = {}, ip?: string) => this.send("GET", url, undefined, headers, ip);
  post = (url: string, body: unknown = {}, headers: Record<string, string> = {}, ip?: string) => this.send("POST", url, body, headers, ip);
  apple = (body: Record<string, unknown>, ip?: string) => this.post("/auth/apple", body, {}, ip);
  google = (body: Record<string, unknown>, ip?: string) => this.post("/auth/google", body, {}, ip);
}

export const device = (key: string, profileId?: string) => ({ "x-device-key": key, ...(profileId ? { "x-profile-id": profileId } : {}) });
export const code = (familyCode: string, profileId?: string) => ({ "x-family-code": familyCode, ...(profileId ? { "x-profile-id": profileId } : {}) });
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export { freshDatabase };

// ---------------------------------------------------------------------------------------------
// Made-up families, written straight to the tables

let seq = 0;
const n = () => (seq += 1);

export type Fam = { id: string; code: string };

export async function makeFamily(name = `The Testers ${n()}`): Promise<Fam> {
  const familyCode = `TEST-${randomBytes(2).toString("hex").toUpperCase()}${n()}`;
  const { rows } = await db().query(`insert into families (name, code_hash) values ($1, $2) returning id`, [name, hashToken(familyCode.toUpperCase())]);
  return { id: rows[0].id, code: familyCode };
}

export async function makePerson(familyId: string, name = `Person ${n()}`, role: "cook" | "kid" = "cook", extra: { created?: string } = {}): Promise<string> {
  const { rows } = await db().query(
    `insert into people (family_id, name, role, sort, created_at) values ($1, $2, $3, $4, coalesce($5::timestamptz, now())) returning id`,
    [familyId, name, role, n(), extra.created ?? null],
  );
  return rows[0].id;
}

/** A phone: `person` may be null for one with no person yet. Its key is returned; only the hash is stored. */
export async function makeDevice(familyId: string, personId: string | null, via = "apple", created?: string): Promise<{ id: string; key: string }> {
  const key = randomBytes(32).toString("base64url");
  const { rows } = await db().query(
    `insert into devices (family_id, person_id, key_hash, via, label, created_at) values ($1, $2, $3, $4, 'Test phone', coalesce($5::timestamptz, now())) returning id`,
    [familyId, personId, hashToken(key), via, created ?? null],
  );
  return { id: rows[0].id, key };
}

export async function makeJoinLink(familyId: string, inviterId: string | null, options: { expires?: string | null } = {}): Promise<{ id: string; token: string }> {
  const token = randomBytes(16).toString("hex").slice(0, 22);
  const { rows } = await db().query(`select gen_random_uuid()::text as id`);
  const id = rows[0].id as string;
  const expires = options.expires === undefined ? `now() + interval '7 days'` : options.expires === null ? "null" : `'${options.expires}'::timestamptz`;
  await db().query(`insert into join_links (id, family_id, inviter_id, token_hash, token_enc, expires_at) values ($1, $2, $3, $4, $5, ${expires})`, [
    id,
    familyId,
    inviterId,
    hashToken(token),
    await seal(JOIN_LINK_SALT, id, token),
  ]);
  return { id, token };
}

export const count = async (table: string, where = "true", args: unknown[] = []) =>
  (await db().query(`select count(*)::int as n from ${table} where ${where}`, args)).rows[0].n as number;

export const row = async (table: string, where: string, args: unknown[]) => (await db().query(`select * from ${table} where ${where}`, args)).rows[0];

/** The rate-limit counters, for a test that's about something else. */
export const clearLimits = () => db().query(`delete from rate_hits`);

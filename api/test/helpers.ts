// Real Postgres (TEST_DATABASE_URL), wiped and migrated from the real files for each test file. Fake data only.
import { randomBytes } from "node:crypto";
import { hashToken } from "../src/auth.js";
import { db } from "../src/db.js";
import { migrate } from "../src/migrate.js";

export const hasDatabase = Boolean(process.env.TEST_DATABASE_URL);
if (hasDatabase) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

export async function freshDatabase(): Promise<void> {
  await db().query("drop schema public cascade; create schema public");
  await migrate(db());
}

let next = 0;

export async function family(name = "Test family"): Promise<string> {
  next += 1;
  const { rows } = await db().query("insert into families (name) values ($1) returning id", [`${name} ${next}`]);
  return rows[0].id;
}

export async function person(familyId: string, role: "cook" | "kid" = "cook"): Promise<string> {
  next += 1;
  const { rows } = await db().query("insert into people (family_id, name, role) values ($1, $2, $3) returning id", [
    familyId,
    `Person ${next}`,
    role,
  ]);
  return rows[0].id;
}

export async function session(familyId: string, personId: string, expiresInS = 3600): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db().query(
    "insert into sessions (token_hash, family_id, person_id, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))",
    [hashToken(token), familyId, personId, expiresInS],
  );
  return token;
}

export async function file(familyId: string, key = `private/${randomBytes(8).toString("hex")}`): Promise<string> {
  await db().query(
    "insert into files (key, bucket, kind, family_id, uploaded_at) values ($1, 'private', 'voice', $2, now())",
    [key, familyId],
  );
  return key;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

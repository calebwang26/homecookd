// The one session check. A phone holds a random token; only its SHA-256 is stored (convex/lib/auth.ts, so existing sessions
// carry over). A wrong answer here is a security problem, so a database failure refuses rather than guesses.
// Someone who left or deleted, or a phone that was signed out, is refused here too, so no later bug can leave them a working session.
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { db } from "./db.js";
import { forbidden, notFound, removedFromFamily, signedOut } from "./errors.js";

export type Signed = { sessionId: string; personId: string; familyId: string; role: "cook" | "kid" };

declare module "fastify" {
  interface FastifyRequest {
    signed?: Signed;
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function findSession(token: string): Promise<(Signed & { removed: boolean }) | null> {
  if (token.length < 20 || token.length > 200) return null;
  const { rows } = await db().query(
    `select s.id as session_id, p.id as person_id, p.family_id, p.role, p.removed_at is not null as removed
       from sessions s
       join people p on p.id = s.person_id
       left join devices d on d.id = s.device_id
      where s.token_hash = $1
        and s.expires_at > now()
        and s.family_id = p.family_id
        and p.deleted_at is null
        and d.revoked_at is null`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row ? { sessionId: row.session_id, personId: row.person_id, familyId: row.family_id, role: row.role, removed: row.removed } : null;
}

/**
 * A route's preValidation: refuses before the body is looked at. Someone who left the family keeps a session until it ends, so it's refused here, on every route, rather
 * than route by route. It's a 403, not a 401: their phone is still signed in, and only the accounts area can end that (routeCoverage.test.ts holds every route to it).
 */
export async function requireSession(req: FastifyRequest): Promise<void> {
  if ((await readSession(req)).removed) throw removedFromFamily();
}

/**
 * The same check, for the one thing someone who left must still be able to do: delete their account (App Review 5.1.1(v)), with what the app does around it. Every route using
 * this is listed in routeCoverage.test.ts with why.
 */
export async function requireSessionEvenIfRemoved(req: FastifyRequest): Promise<void> {
  await readSession(req);
}

async function readSession(req: FastifyRequest): Promise<{ removed: boolean }> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const signed = token ? await findSession(token) : null;
  if (!signed) throw signedOut();
  req.signed = { sessionId: signed.sessionId, personId: signed.personId, familyId: signed.familyId, role: signed.role };
  return signed;
}

export function signedIn(req: FastifyRequest): Signed {
  if (!req.signed) throw signedOut(); // a route that forgot requireSession refuses rather than runs
  return req.signed;
}

export function requireCook(signed: Signed): void {
  if (signed.role !== "cook") throw forbidden();
}

/** For a row someone asked for by id. Another family's row answers as if it isn't there. */
export function requireFamily(signed: Signed, familyId: string | null | undefined): void {
  if (familyId !== signed.familyId) throw notFound();
}

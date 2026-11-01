// The one session check. A phone holds a random token; only its SHA-256 is stored (convex/lib/auth.ts, so existing sessions
// carry over). A wrong answer here is a security problem, so a database failure refuses rather than guesses.
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { db } from "./db.js";
import { forbidden, notFound, signedOut } from "./errors.js";

export type Signed = { sessionId: string; personId: string; familyId: string; role: "cook" | "kid" };

declare module "fastify" {
  interface FastifyRequest {
    signed?: Signed;
  }
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function findSession(token: string): Promise<Signed | null> {
  if (token.length < 20 || token.length > 200) return null;
  const { rows } = await db().query(
    `select s.id as session_id, p.id as person_id, p.family_id, p.role
       from sessions s
       join people p on p.id = s.person_id
      where s.token_hash = $1
        and s.expires_at > now()
        and s.family_id = p.family_id
        and p.deleted_at is null`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row ? { sessionId: row.session_id, personId: row.person_id, familyId: row.family_id, role: row.role } : null;
}

/** A route's preValidation: refuses before the body is looked at. */
export async function requireSession(req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const signed = token ? await findSession(token) : null;
  if (!signed) throw signedOut();
  req.signed = signed;
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

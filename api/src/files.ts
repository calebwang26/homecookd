// Other tables have no FK to `files`, because a key can also name public library media (SCHEMA.md). So this check is the only
// thing stopping someone attaching another family's file, and then deleting it with their own account's purge.
//
// It can't be forgotten: app.ts refuses to register a route whose body has a key field unless it declares config.fileKeys or
// config.notFileKeys, and adds this check to every declared one.
import type { FastifyRequest } from "fastify";
import { signedIn } from "./auth.js";
import { db } from "./db.js";
import { notFound } from "./errors.js";

/** Body fields that look like S3 keys. An idempotency key is one that isn't: routes say so with config.notFileKeys. */
export const looksLikeFileKey = (field: string) => /(^|_)keys?$|[a-z]Keys?$/.test(field);

export async function requireOwnFiles(familyId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const unique = [...new Set(keys)];
  const { rows } = await db().query(
    `select key from files
      where key = any($1::text[])
        and family_id = $2
        and deleted_at is null
        and delete_requested_at is null`,
    [unique, familyId],
  );
  if (rows.length !== unique.length) throw notFound();
}

export function fileGuard(fields: string[]) {
  return async (req: FastifyRequest): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const keys = fields.flatMap((field) => {
      const value = body[field];
      if (value === undefined || value === null) return [];
      return Array.isArray(value) ? value : [value];
    });
    if (keys.some((key) => typeof key !== "string")) throw notFound();
    await requireOwnFiles(signedIn(req).familyId, keys as string[]);
  };
}

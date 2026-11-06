// Signed-in uploads: a voice note or a photo goes straight to S3 with a short-lived link, then gets confirmed, then a route attaches it.
//
// A route's fileKeys guard (files.ts) says the file is this family's and is uploaded. That's not enough here (DISH-MIGRATION.md, open question 3): a family check
// alone lets one member attach another's upload, and then purging the second account deletes the first's message file. So the attach, in the same transaction as
// the row that holds it, also says: yours (when it has an owner), the right kind, and not already held by something. Two rows can't win one file.
import { randomUUID } from "node:crypto";
import type { Signed } from "../../auth.js";
import { db, type Queryable } from "../../db.js";
import { type ApiError, invalid, notFound, providerDown, refused } from "../../errors.js";
import { hit, subjectKey } from "../../rateLimit.js";
import { objectStore } from "../../storage.js";
import { actorOf } from "./actor.js";

const VOICE_TYPES: Record<string, string> = {
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp" };
/** Convex's limit, the wider of the two (Supabase's is 10 MB), so nothing that sends today stops. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const baseType = (type: string) => type.split(";")[0].trim().toLowerCase();

async function storage<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw Object.assign(providerDown(502), { cause: error });
  }
}

/** The file's row, then a link good for exactly this type and size. */
export async function makeUpload(signed: Signed, body: Record<string, unknown>) {
  await actorOf(signed);
  const kind = body.kind;
  if (kind !== "voice" && kind !== "photo") throw invalid("kind");
  const types = kind === "voice" ? VOICE_TYPES : PHOTO_TYPES;
  const type = baseType(typeof body.contentType === "string" ? body.contentType : "");
  const ext = types[type];
  if (!ext) throw refused(415, "bad_type");
  const size = body.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) throw invalid("size");
  if (size > MAX_FILE_BYTES) throw refused(413, "too_large");
  await hit(subjectKey(signed.personId), [{ bucket: "messages-upload", max: 120, windowS: 3600 }]);
  const stored = type === "image/jpg" ? "image/jpeg" : type;
  const key = `private/messages/${signed.familyId}/${randomUUID()}.${ext}`;
  await db().query(
    `insert into files (key, bucket, kind, content_type, size_bytes, family_id, owner_person_id) values ($1, 'private', $2, $3, $4, $5, $6)`,
    [key, kind, stored, size, signed.familyId, signed.personId],
  );
  const link = await storage(() => objectStore().presignPut(key, stored, size));
  return { key, kind, contentType: stored, size, uploadUrl: link.url, uploadHeaders: link.headers, expiresInS: link.expiresInS, maxBytes: MAX_FILE_BYTES };
}

/** S3 has the bytes, so the file can be used. Repeatable. Only its owner may, and a guess reads like anything else that isn't there. */
export async function confirmUpload(signed: Signed, key: unknown) {
  if (typeof key !== "string" || key.length > 1024) throw notFound();
  const { rows } = await db().query(
    `select key, kind, content_type, size_bytes, uploaded_at from files
      where key = $1 and family_id = $2 and owner_person_id = $3 and deleted_at is null and delete_requested_at is null`,
    [key, signed.familyId, signed.personId],
  );
  const file = rows[0];
  if (!file) throw notFound();
  if (!file.uploaded_at) {
    const seen = await storage(() => objectStore().head(key));
    if (!seen) throw notFound();
    const refuse = async (error: ApiError) => {
      await markForDeletion(db(), [key]);
      return error;
    };
    if (seen.size === 0) throw await refuse(invalid());
    if (seen.size > MAX_FILE_BYTES) throw await refuse(refused(413, "too_large"));
    if (baseType(seen.contentType ?? "") !== file.content_type) throw await refuse(refused(415, "bad_type"));
    await db().query(`update files set uploaded_at = coalesce(uploaded_at, now()), size_bytes = $2 where key = $1`, [key, seen.size]);
  }
  return { key, kind: file.kind, contentType: file.content_type };
}

/** Claims a file for a row in the caller's transaction. Anything else gets the one not-found: someone else's, not uploaded, on its way out, already held, the wrong kind. */
export async function attachFile(c: Queryable, actor: { familyId: string; me: { id: string } }, key: string, kinds: string[]): Promise<void> {
  const { rowCount } = await c.query(
    `update files set attached_at = now()
      where key = $1 and family_id = $2 and kind = any($3::text[]) and uploaded_at is not null and attached_at is null
        and deleted_at is null and delete_requested_at is null and (owner_person_id is null or owner_person_id = $4)`,
    [key, actor.familyId, kinds, actor.me.id],
  );
  if (!rowCount) throw notFound();
}

/** Read without attaching, for the photo note, which saves nothing: the same rules but for "already held". */
export async function usableFile(q: Queryable, actor: { familyId: string; me: { id: string } }, key: string, kind: string): Promise<void> {
  const { rowCount } = await q.query(
    `select 1 from files
      where key = $1 and family_id = $2 and kind = $3 and uploaded_at is not null and deleted_at is null and delete_requested_at is null
        and (owner_person_id is null or owner_person_id = $4)`,
    [key, actor.familyId, kind, actor.me.id],
  );
  if (!rowCount) throw notFound();
}

/** Marked here, deleted from S3 by the sweep (S3 can't join a transaction). */
export async function markForDeletion(q: Queryable, keys: (string | null | undefined)[]): Promise<void> {
  const list = [...new Set(keys.filter((k): k is string => !!k))];
  if (list.length === 0) return;
  await q.query(`update files set delete_requested_at = coalesce(delete_requested_at, now()) where key = any($1::text[]) and deleted_at is null`, [list]);
}

/** The shape of a key in the public library, `<library id>/<file>`. Never one of our private prefixes. The send also refuses any key with a row in `files`. */
export const isPublicClip = (key: string) => /^[a-z0-9][a-z0-9-]{0,99}\/[A-Za-z0-9._/-]{1,300}$/.test(key) && !key.startsWith("private/") && !key.startsWith("uploads/") && !key.includes("..");

const SIGNED_IN_ORPHAN_HOURS = 24;

/** Uploads nothing took. A day, not the anonymous hour: a phone can upload a voice note and send it later, and a file swept early is a message lost. */
export async function markSignedInOrphans(batch = 500): Promise<number> {
  const { rowCount } = await db().query(
    `update files set delete_requested_at = now()
      where key in (select key from files
                     where bucket = 'private' and owner_person_id is not null and attached_at is null and delete_requested_at is null and deleted_at is null
                       and created_at < now() - make_interval(hours => $1)
                     limit $2)`,
    [SIGNED_IN_ORPHAN_HOURS, batch],
  );
  return rowCount ?? 0;
}

// Anonymous uploads. There's no session here, so files.ts's fileKeys guard can't apply. What stands in for it is a capability: `fileId`,
// 22 random characters given to whoever asked for the upload link, of which only the sha256 is stored (files.capability_hash). The rules:
//
//   - A capability reaches its own file and nothing else. A route never takes an S3 key, and never returns one outside a signed link.
//   - A file held by a card or a dish answer is refused, including on another card.
//   - The same caller's retry of the same attach succeeds and changes nothing (the callers below check that first, under the card's row
//     lock, so two at once stay one attach).
//   - Anything else gets the one not-found answer, whatever the reason: a guess, someone else's file, one not uploaded yet, one on its
//     way out, the wrong kind. Nobody can tell why it failed, or that the file exists.
//
// Signed-in routes could pair this with the session guard once a card is claimed: when a card joins a family, its files get `family_id`,
// and then files.ts's requireOwnFiles covers them too (the claim's PR).
import * as Sentry from "@sentry/node";
import { randomUUID } from "node:crypto";
import { db, type Queryable } from "../../db.js";
import { objectStore } from "../../storage.js";
import { baseType } from "./recipe/validate.js";
import * as data from "./data.js";
import type { FileRow } from "./data.js";
import {
  badRequest,
  CLIP_BYTES,
  fail,
  FILE_GONE,
  notFound,
  PHOTO_BYTES,
  PHOTO_TYPES,
  randomBase62,
  sha256Hex,
  SORRY,
  VOICE_BYTES,
  VOICE_TYPES,
} from "./values.js";

export type FileKind = "photo" | "voice";

/** The one answer for every refused capability. */
export const fileGone = () => notFound(FILE_GONE);

/** S3 being down isn't the caller's fault, and retrying is safe. */
async function storage<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw Object.assign(fail(502, "storage", SORRY), { cause: error });
  }
}

const RULES = {
  photo: { types: PHOTO_TYPES, max: PHOTO_BYTES, badType: "That picture type isn't supported.", tooBig: "That picture is too big.", empty: "The file is empty." },
  voice: { types: VOICE_TYPES, max: VOICE_BYTES, badType: "That recording type isn't supported.", tooBig: "That voice note is too long.", empty: "The file is empty." },
  clip: { types: VOICE_TYPES, max: CLIP_BYTES, badType: "That recording type isn't supported.", tooBig: "That answer is too long.", empty: "The recording is empty." },
};
type Rule = keyof typeof RULES;

/** The type and size a link will be signed for: checked before anything exists anywhere. */
export function checkUpload(rule: Rule, contentType: unknown, size: unknown): { type: string; bytes: number } {
  const r = RULES[rule];
  const type = baseType(typeof contentType === "string" ? contentType : "");
  if (!r.types.includes(type)) throw fail(415, "bad_type", r.badType);
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0) throw badRequest("size must be the file's length in bytes");
  if (size === 0) throw badRequest(r.empty);
  if (size > r.max) throw fail(413, "too_large", r.tooBig);
  return { type, bytes: size };
}

/** A new file's row and its upload link. A clip names its card from the start, so it can only ever land there. */
export async function makeUpload(u: { kind: FileKind; type: string; bytes: number; ipKey: string; askId: string | null }) {
  const fileId = randomBase62();
  const key = `private/dish/${randomUUID()}`;
  await data.insertFile(db(), {
    key,
    kind: u.kind,
    contentType: u.type,
    size: u.bytes,
    capabilityHash: sha256Hex(fileId),
    ipKey: u.ipKey,
    askId: u.askId,
  });
  const link = await storage(() => objectStore().presignPut(key, u.type, u.bytes));
  return { fileId, kind: u.kind, contentType: u.type, size: u.bytes, uploadUrl: link.url, uploadHeaders: link.headers, expiresInS: link.expiresInS };
}

const live = (f: FileRow | null): f is FileRow => !!f && !f.delete_requested_at && !f.deleted_at;

/**
 * S3 has the bytes: from here the file can go on a card (uploaded_at). Repeatable. A file that isn't what its link was for is deleted.
 * Throws the one not-found answer for anything that isn't a live file behind this capability.
 */
export async function confirmUpload(hash: string): Promise<FileRow> {
  const file = await data.fileByCapability(db(), hash);
  if (!live(file)) throw fileGone();
  if (file.uploaded_at) return file;
  const seen = await storage(() => objectStore().head(file.key));
  if (!seen) throw fileGone();
  const rule: Rule = file.ask_id ? "clip" : (file.kind as FileKind);
  const r = RULES[rule];
  const refuse = async (error: Error) => {
    await data.markFilesForDeletion(db(), [file.key]);
    return error;
  };
  if (seen.size === 0) throw await refuse(badRequest(r.empty));
  if (seen.size > r.max) throw await refuse(fail(413, "too_large", r.tooBig));
  if (baseType(seen.contentType ?? "") !== file.content_type) throw await refuse(fail(415, "bad_type", r.badType));
  await data.confirmFile(db(), file.key, seen.size);
  return { ...file, uploaded_at: new Date(), size_bytes: String(seen.size) };
}

/** What a new card will be made from: read before any model runs. Attaching checks again, in the same transaction as the card. */
export async function usableFile(q: Queryable, hash: string, kind: FileKind): Promise<FileRow> {
  const f = await data.fileByCapability(q, hash);
  if (!live(f) || !f.uploaded_at || f.attached_at || f.ask_id || f.kind !== kind) throw fileGone();
  return f;
}

/** Attaches a fresh upload to a card, inside its transaction. Two requests racing for one file: the second rolls back with not-found. */
export async function attachFile(q: Queryable, hash: string, askId: string, kind: FileKind): Promise<string> {
  const key = await data.attachFreeFile(q, hash, askId, kind);
  if (!key) throw fileGone();
  return key;
}

export async function readFile(key: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null> {
  return await storage(() => objectStore().read(key));
}

/**
 * A read link, or null when one can't be made, which the pages' shapes already allow. It never throws: a page comes back with the file missing rather
 * than failing, and POST /dish/cards has already committed by now, so a failure there would lose the only copy of the kid's token.
 */
export async function readLink(key: string): Promise<string | null> {
  try {
    return await objectStore().presignGet(key);
  } catch (error) {
    Sentry.captureException(error);
    return null;
  }
}

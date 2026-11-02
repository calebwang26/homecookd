// The outside purge's S3 part (deletion.ts purgeOutside): the folders and files account_deletions lists that no `files` row names. A key with a row is the sweep's (jobs.sweep),
// so it's left to it. Deleting is safe to repeat, so a run that stops part way only has to start again: a folder already emptied lists nothing. Nothing here is deleted while
// anything that's still there names it, and a refusal keeps the deletion open with its reason, so a person looks (pipeline/account_purge.py did the same on GCS).
import { db } from "../../db.js";
import { mediaStore, uploadStore, VIDEO_LINK_S, type ObjectStore } from "../../storage.js";
import type { Deletion } from "./purgeSteps.js";

/** One segment, as the worker names a recipe folder and the signer and the glasses name an upload folder (account_purge.py FOLDER). A deeper prefix could hold anyone's files. */
const FOLDER = /^[a-z0-9][a-z0-9-]{0,99}\/$/;
/** The media bucket's own folders: never one person's. */
const SHARED = new Set(["library/", "jobs/", "trash/", "cancellations/", "deletions/", "glasses/"]);
/**
 * As long as the sweep waits (jobs/tasks.ts GRACE_S): a link still in a phone's hands, the glasses' last upload, or the worker finishing a job it was already on could put a file back in a
 * folder after it's emptied, and nothing would list it again.
 */
export const S3_GRACE_MS = (VIDEO_LINK_S + 3600) * 1000;
/** No recipe or upload comes near this many files, so a folder holding more is a wrong prefix, and waits for a person. */
export const FOLDER_MAX = 5_000;

export type Reached = { counts: { uploadObjects: number; mediaObjects: number }; problems: string[]; outOfTime: boolean };

type Bucket = "uploads" | "media";
/** `folder` comes from the list it's on, never from the key's shape: a recipe folder written down without its slash must be refused, not taken for a file that isn't there. */
type Item = { bucket: Bucket; key: string; folder: boolean };

/** Why this can't be deleted, or null. Asked of the database each time, so whatever has started using it since the deletion was written down is seen. */
async function refusal({ bucket, key, folder }: Item): Promise<string | null> {
  if (folder && (!FOLDER.test(key) || SHARED.has(key))) return "with an unexpected name";
  if (!folder && (key.endsWith("/") || (bucket === "media" && (key === "library.json" || key.startsWith("library/"))))) return "with an unexpected name";
  const like = `${key}%`; // FOLDER has no LIKE wildcards in it, and a single key is only ever compared whole
  const { rows } = await db().query(
    bucket === "uploads"
      ? `select exists (select 1 from jobs where ${folder ? "upload_id = split_part($1, '/', 1)" : "upload_key = $1"})
             or exists (select 1 from files where ${folder ? "upload_id = split_part($1, '/', 1)" : "key = $1"} and delete_requested_at is null and deleted_at is null) as used`
      : folder
        ? `select exists (select 1 from recipes where media_prefix = $1 or recipe_json_key like $2 or cover_key like $2)
               or exists (select 1 from recordings where video_key like $2 or cover_key like $2)
               or exists (select 1 from files where key like $2 and delete_requested_at is null and deleted_at is null) as used`
        : `select exists (select 1 from recipes where recipe_json_key = $1 or cover_key = $1)
               or exists (select 1 from recordings where video_key = $1 or cover_key = $1) as used`,
    bucket === "media" && folder ? [key, like] : [key],
  );
  return rows[0].used ? "still in use" : null;
}

/** A single key the ledger has a row for is the sweep's. */
async function ledgerHas(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const { rows } = await db().query(`select key from files where key = any($1::text[])`, [keys]);
  return new Set(rows.map((r) => r.key));
}

/** Deletes what one item names, and says how many objects that was. */
async function deleteItem(store: ObjectStore, { key, folder }: Item): Promise<number | "too big"> {
  if (!folder) {
    if (!(await store.head(key))) return 0; // so the count is what was there, not what was asked for
    await store.remove(key);
    return 1;
  }
  const keys = await store.list(key, FOLDER_MAX + 1);
  if (keys.length > FOLDER_MAX) return "too big";
  if (keys.length) await store.removeMany(keys);
  return keys.length;
}

export async function reachS3(d: Deletion, deadline: number): Promise<Reached> {
  const all: Item[] = [
    // A job's upload_key is one object or a folder (003_recipes_and_jobs.sql), and only the slash says which.
    ...d.upload_keys.map((key) => ({ bucket: "uploads" as const, key, folder: key.endsWith("/") })),
    ...d.media_prefixes.map((key) => ({ bucket: "media" as const, key, folder: true })),
    ...d.media_keys.map((key) => ({ bucket: "media" as const, key, folder: false })),
  ];
  const owned = await ledgerHas(all.filter((item) => !item.folder).map((item) => item.key));
  const items = all.filter((item) => item.folder || !owned.has(item.key));

  const reached: Reached = { counts: { uploadObjects: 0, mediaObjects: 0 }, problems: [], outOfTime: false };
  const refused = new Map<string, number>();
  const failed = new Map<Bucket, string>();
  for (const item of items) {
    if (Date.now() > deadline) {
      reached.outOfTime = true;
      break;
    }
    if (failed.has(item.bucket)) continue; // S3 said no once, and every other try would say it again
    const why = await refusal(item);
    if (why) {
      const what = `${item.bucket === "uploads" ? "upload" : "media"} ${item.folder ? "folders" : "files"} ${why}`;
      refused.set(what, (refused.get(what) ?? 0) + 1);
      continue;
    }
    try {
      const n = await deleteItem(item.bucket === "uploads" ? uploadStore() : mediaStore(), item);
      if (n === "too big") {
        const what = `${item.bucket === "uploads" ? "upload" : "media"} folders holding more than ${FOLDER_MAX} files`;
        refused.set(what, (refused.get(what) ?? 0) + 1);
      } else reached.counts[item.bucket === "uploads" ? "uploadObjects" : "mediaObjects"] += n;
    } catch (error) {
      failed.set(item.bucket, (error as Error).name || "Error"); // the name only: S3's text can hold the account and the bucket
    }
  }
  for (const [bucket, name] of failed) reached.problems.push(`S3 ${bucket}: ${name}`.slice(0, 120));
  for (const [what, n] of refused) reached.problems.push(`Not reached yet: ${n} ${what}`);
  return reached;
}

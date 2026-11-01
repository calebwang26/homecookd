// What every area's part of an account purge shares (accounts/deletion.ts runs them).
import type { Queryable } from "./db.js";

const present = (keys: (string | null | undefined)[]) => [...new Set(keys.filter((k): k is string => !!k))];

type Bucket = "private" | "media";
type Kind = "photo" | "voice" | "video" | "cover" | "frame";

/**
 * Marks a deleted person's files for the sweep, in the transaction that deletes the row naming them. A key with no row in the ledger gets one, because the mark must not be lost:
 * only a backfill bug could cause that, but the file would be unfindable once this row goes.
 */
export async function markPurged(q: Queryable, personId: string, keys: (string | null | undefined)[], bucket: Bucket, kind: Kind): Promise<void> {
  const list = present(keys);
  if (!list.length) return;
  await q.query(
    `insert into files (key, bucket, kind, delete_requested_at, purge_deletion_id)
     select k, $2, $3, now(), (select id from account_deletions where person_id = $4) from unnest($1::text[]) as k
     on conflict (key) do update set delete_requested_at = coalesce(files.delete_requested_at, now()), purge_deletion_id = coalesce(files.purge_deletion_id, excluded.purge_deletion_id)
       where files.deleted_at is null`,
    [list, bucket, kind, personId],
  );
}

/** For keys that can name public library media, which has no row: only a row that's there is marked. */
export async function markPurgedIfKnown(q: Queryable, personId: string, keys: (string | null | undefined)[]): Promise<void> {
  const list = present(keys);
  if (!list.length) return;
  await q.query(
    `update files set delete_requested_at = coalesce(delete_requested_at, now()), purge_deletion_id = coalesce(purge_deletion_id, (select id from account_deletions where person_id = $2))
      where key = any($1::text[]) and deleted_at is null`,
    [list, personId],
  );
}

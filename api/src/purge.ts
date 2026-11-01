// What every area's part of an account purge shares: batches, each its own transaction, and marking a file before its row goes (accounts/deletion.ts runs them).
import type { PoolClient } from "pg";
import { tx, type Queryable } from "./db.js";

export const PURGE_BATCH = 500;

export type PurgeRun = {
  max: number;
  /** In the batch's transaction. It keeps the deletion marked as running. */
  beforeCommit?: (c: PoolClient, step: string, changed: number) => void | Promise<void>;
  /** Throwing here stops the purge after a batch that's safely done: out of time, or a test acting out a crash. */
  afterCommit?: (step: string, changed: number) => void | Promise<void>;
};

/** An area's purge run on its own, as its tests do. */
export const ON_ITS_OWN: PurgeRun = { max: PURGE_BATCH };

/** Until a batch comes back short. Says how many rows changed, so the purge can tell when a full pass found nothing. */
export async function inBatches(run: PurgeRun, step: string, work: (c: PoolClient, max: number) => Promise<number>): Promise<number> {
  for (let total = 0; ; ) {
    const changed = await tx(async (c) => {
      const n = await work(c, run.max);
      await run.beforeCommit?.(c, step, n);
      return n;
    });
    await run.afterCommit?.(step, changed);
    total += changed;
    if (changed < run.max) return total;
  }
}

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

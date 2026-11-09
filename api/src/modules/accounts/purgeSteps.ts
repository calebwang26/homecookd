// What deleting an account does, table by table (SCHEMA.md section 4). Each area purges its own tables (community/account.ts, messages/account.ts, jobs/account.ts,
// dish/account.ts), and the steps here are the tables this area owns. Each finds only what's left, which is what makes the whole purge safe to stop anywhere and start again.
// The rule for any row holding a file key: the key is marked first, in the same transaction as the delete, so a crash can never lose the only record of a file that must come
// off S3. coverage.ts, with a test, holds this list to the real schema.
import type { Queryable } from "../../db.js";
import type { PurgeRun } from "../../purge.js";
import { purgeCommunityForPerson } from "../community/account.js";
import { purgeDishForPerson } from "../dish/account.js";
import { purgeJobsForPerson } from "../jobs/account.js";
import { purgeMessagesForPerson } from "../messages/account.js";
import { blankFamilyIfEmpty } from "./data.js";
import { ownsPeople } from "./values.js";

export type Deletion = {
  id: string;
  family_id: string;
  person_id: string;
  recipe_ids: string[];
  job_ids: string[];
  upload_keys: string[];
  media_keys: string[];
  media_prefixes: string[];
  media_urls_legacy: string[];
  voice_clone_id: string | null;
  purged_at: Date | null;
  purge_run_at: Date | null;
  purge_restarts: number;
  requested_at: Date;
  external_purged_at: Date | null;
  external_attempts: number;
  external_tried_at: Date | null;
  external_gave_up_at: Date | null;
};

// The driver can't read an array of a domain, so the keys come back as plain text[].
export const DELETION = `id, family_id, person_id, recipe_ids, job_ids, upload_keys::text[] as upload_keys, media_keys::text[] as media_keys, media_prefixes::text[] as media_prefixes,
  media_urls_legacy, voice_clone_id, purged_at, purge_run_at, purge_restarts, requested_at, external_purged_at, external_attempts, external_tried_at,
  external_gave_up_at`;

export type Step = { name: string } & (
  /** Rows changed, at most `max`, in a transaction of the purge's own. */
  | { run: (q: Queryable, d: Deletion, max: number) => Promise<number> }
  /** An area's whole purge, with transactions of its own, so it isn't given one. Rows changed. */
  | { area: (d: Deletion, run: PurgeRun) => Promise<number> }
);

const del = (sql: string) => async (q: Queryable, d: Deletion, max: number) => (await q.query(sql, [d.person_id, max])).rowCount ?? 0;

/** Whatever a sign-in racing the delete managed to make. startDeletion did all this at once; here it's the check that nothing came back. */
async function signInLeftovers(q: Queryable, d: Deletion, max: number): Promise<number> {
  let n = 0;
  const count = async (sql: string, args: unknown[]) => {
    n += (await q.query(sql, args)).rowCount ?? 0;
  };
  await count(`delete from sessions where id in (select id from sessions where person_id = $1 limit $2)`, [d.person_id, max]);
  await count(`update devices set person_id = null, label = null, revoked_at = coalesce(revoked_at, now()) where id in (select id from devices where person_id = $1 limit $2)`, [d.person_id, max]);
  await count(`delete from identities where person_id = $1`, [d.person_id]);
  await count(`delete from push_tokens where person_id = $1`, [d.person_id]);
  await count(`delete from invites where id in (select id from invites where person_id = $1 limit $2)`, [d.person_id, max]);
  await count(`delete from move_requests where id in (select id from move_requests where person_id = $1 limit $2)`, [d.person_id, max]);
  return n;
}

/** Marked by person, so a file nothing else named still goes. Anonymous kids' uploads have no owner: the dish purge finds those by their card. */
const filesOwned = (q: Queryable, d: Deletion, max: number) =>
  q
    .query(
      `update files set delete_requested_at = coalesce(delete_requested_at, now()), purge_deletion_id = $2
        where key in (select key from files where owner_person_id = $1 and purge_deletion_id is null limit $3)`,
      [d.person_id, d.id, max],
    )
    .then((r) => r.rowCount ?? 0);

/** A `link:` row stays, nameless, to keep "one join per side"; any other goes. */
async function signups(q: Queryable, d: Deletion, max: number): Promise<number> {
  const kept = await q.query(
    `update signups set email = null, name = 'Deleted', person_id = null
      where id in (select id from signups where person_id = $1 and share_token like 'link:%' limit $2)`,
    [d.person_id, max],
  );
  const gone = await q.query(`delete from signups where id in (select id from signups where person_id = $1 and (share_token is null or share_token not like 'link:%') limit $2)`, [
    d.person_id,
    max,
  ]);
  return (kept.rowCount ?? 0) + (gone.rowCount ?? 0);
}

// Community first, because it finds dinners and swaps by the person's recipes, and Messages next, for the questions on them. Then their recipes can go.
export const STEPS: Step[] = [
  { name: "community", area: (d, run) => purgeCommunityForPerson(d.person_id, d.family_id, run) },
  { name: "messages", area: (d, run) => purgeMessagesForPerson(d.person_id, d.family_id, run) },
  { name: "recipes, recordings and jobs", area: (d, run) => purgeJobsForPerson(d.person_id, run) },
  {
    name: "dish cards",
    area: async (d, run) => {
      const changed = await purgeDishForPerson(d.person_id);
      await run.afterCommit?.("dish cards", changed);
      return changed;
    },
  },
  { name: "sign-in leftovers", run: signInLeftovers },
  { name: "invites they sent", run: del(`update invites set inviter_id = null where id in (select id from invites where inviter_id = $1 limit $2)`) },
  { name: "join links", run: del(`update join_links set inviter_id = null where id in (select id from join_links where inviter_id = $1 limit $2)`) },
  { name: "moves they decided", run: del(`update move_requests set decided_by = null where id in (select id from move_requests where decided_by = $1 limit $2)`) },
  { name: "signups", run: signups },
  { name: "files", run: filesOwned },
  // While the sync owns families, the copy is read-only and C2 is the sync's (deletion.ts, startDeletionIn).
  { name: "the family, if they were its last", run: async (q, d) => (ownsPeople() && (await blankFamilyIfEmpty(q, d.family_id)) ? 1 : 0) },
];

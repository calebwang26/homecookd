// "Delete my account" (App Store guideline 5.1.1(v); convex/account.ts, pipeline/account_purge.py). It refuses no one who can prove who they are, and once it's begun it can't be
// undone by a failure: a blank tombstone and every way in end together in one transaction, the rest follows in batches, a schedule starts a purge that stopped, and the outside
// purge reports on the same row. Every batch is safe to stop and repeat. Nothing here ever claims a file is gone when the sweep can't reach it (ACCOUNTS-MIGRATION.md).
import * as Sentry from "@sentry/node";
import { db, tx, type Queryable } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { inBatches, PURGE_BATCH, type PurgeRun } from "../../purge.js";
import { cancelDinnersOfPerson } from "../community/account.js";
import type { Trace } from "../dish/budget.js";
import { stopPersonsWork } from "../jobs/account.js";
import { dropPushTokens } from "../messages/account.js";
import * as data from "./data.js";
import { requestMossSync } from "./neighbors.js";
import { DELETION, type Deletion, STEPS } from "./purgeSteps.js";
import { assertOwnsPeople, ownsPeople, refuse } from "./values.js";

/** A purge with no batch for this long stopped; the schedule starts it again. Past this many restarts someone is told, and it's still tried. */
export const PURGE_STUCK_MS = 30 * 60_000;
export const ALERT_AFTER_RESTARTS = 5;
export const MAX_OUTSIDE_ATTEMPTS = 10;
/** A purge message stays well under SQS's 300 s visibility, and what's left goes on a new message. */
export const PURGE_BUDGET_MS = 60_000;
const OUTSIDE_RETRY_MS = 10 * 60_000; // after a failure; doubles each time, up to a day
export const LISTS_KEPT_DAYS = 60; // C5

export const outsideWait = (attempts: number) => Math.min(OUTSIDE_RETRY_MS * 2 ** Math.max(0, attempts - 1), 24 * 3_600_000);

const alert = (name: string, tags: Record<string, string>) => {
  Sentry.captureException(Object.assign(new Error(name), { name }), { tags }); // named, because Sentry gets the type and never the text (sentry.ts)
};

export type DeletionSource = "person" | "sync";

/**
 * At once, in one transaction: write `account_deletions` with what was found; blank the person; end their sessions; revoke their phones; drop their sign-in links and push tokens; cancel
 * their jobs; abandon their recordings; cancel dinners; delete their recipes with those recipes' questions, cooking rows and swaps. Then the batches start.
 *
 * `source`: "person" is the route, and needs the switch (values.ts). "sync" is the one write that passes without it: a deletion arriving from Convex or Supabase while they're still the
 * source reaches Postgres's copy within minutes (SCHEMA.md, M1). The sync calls `startDeletionIn`, in the transaction that writes its own record (sync/data.ts, applyDeletion).
 *
 * Safe to run twice: a person already deleted finds their row, and nothing else happens. Null when there's no such person.
 */
export async function startDeletion(personId: string, source: DeletionSource, requestId?: string): Promise<string | null> {
  return tx((c) => startDeletionIn(c, personId, source, requestId));
}

/** The same, in the caller's transaction. */
export async function startDeletionIn(c: Queryable, personId: string, source: DeletionSource, requestId?: string): Promise<string | null> {
  if (source === "person") assertOwnsPeople();
  const { rows: found } = await c.query(`select family_id from people where id = $1`, [personId]);
  if (!found[0]) return null;
  const familyId: string = found[0].family_id;
  // Whoever they were before they left or moved goes with them. The sync only passes on what the old system did, and that deletes one person.
  const seen = source === "person" ? await data.earlierSelves(c, personId) : [];
  // Family first, then person, everywhere: this is what serializes two last people, and a join, against the delete (C2). In id order, as a move does, so the two can't deadlock.
  for (const id of [...new Set([familyId, ...seen.map((e) => e.family_id)])].sort()) await data.lockFamily(c, id);
  // Read again under the locks: a move that finished while this waited has added to the chain.
  const earlier = source === "person" ? await data.earlierSelves(c, personId) : [];
  const wasSignedIn = source === "person" && (await data.signedInIds(c, [personId])).has(personId);
  const deletionId = await deletePerson(c, personId, familyId, requestId);
  // While the sync owns families, C2 is its own: it waits for its people walk, and gives the name back if someone live lands (sync/data.ts). Two would fight over the row.
  if (ownsPeople()) await endFamilyIfLast(c, familyId, wasSignedIn, requestId);
  for (const e of earlier) {
    await deletePerson(c, e.id, e.family_id, requestId);
    await data.blankFamilyIfEmpty(c, e.family_id);
  }
  return deletionId;
}

/**
 * C2 (Caleb, Nov 1): a family doesn't outlive its last signed-in person. When they go, by deleting, leaving or moving, the phone-less people left are deleted the way anyone is, so
 * their rows and files get purged too, and the family is blanked. Signed in means an identity, or a live phone that's theirs. Someone with neither going ends nothing: that's
 * Grandma deleted from Mom's phone, or a family whose people only ever typed its code. `wasSignedIn` is asked before they're signed out. Run under the family's lock.
 */
export async function endFamilyIfLast(c: Queryable, familyId: string, wasSignedIn: boolean, requestId?: string): Promise<void> {
  if (wasSignedIn) {
    const left = (await data.peopleOf(c, familyId)).filter((p) => !p.removed_at);
    if (left.length && (await data.signedInIds(c, left.map((p) => p.id))).size === 0) {
      for (const p of left) await deletePerson(c, p.id, familyId, requestId);
    }
  }
  await data.blankFamilyIfEmpty(c, familyId);
}

/** One person, in the caller's transaction, with the family's lock held. */
async function deletePerson(c: Queryable, personId: string, familyId: string, requestId?: string): Promise<string> {
  const { rows: locked } = await c.query(
    `select id, family_id, supabase_id, email, cartesia_voice_id, deleted_at from people where id = $1 for no key update`,
    [personId],
  );
  const person = locked[0];
  if (!person || person.family_id !== familyId) throw new Error("the person moved during their deletion");

  const existing = await c.query(`select id from account_deletions where person_id = $1`, [personId]);
  if (existing.rows[0] && person.deleted_at) return existing.rows[0].id as string;

  const hasRecipes = (await c.query(`select 1 from recipes where cook_id = $1 limit 1`, [personId])).rows.length > 0;
  const jobs = (await c.query(`select id, upload_key from jobs where cook_id = $1 limit $2`, [personId, PURGE_BATCH])).rows;
  const recordings = (await c.query(`select id, video_key from recordings where cook_id = $1 limit $2`, [personId, PURGE_BATCH])).rows;
  const { rows: inserted } = await c.query(
    `insert into account_deletions (family_id, person_id, supabase_profile_id, job_ids, upload_keys, media_keys, voice_clone_id)
     values ($1, $2, $3, $4, $5::text[]::s3_key[], $6::text[]::s3_key[], $7)
     on conflict (person_id) do nothing returning ${DELETION}`,
    [
      person.family_id,
      personId,
      person.supabase_id,
      jobs.map((j) => j.id),
      [...new Set(jobs.map((j) => j.upload_key))],
      [...new Set(recordings.map((r) => r.video_key).filter(Boolean))],
      person.cartesia_voice_id,
    ],
  );
  const deletion: Deletion = inserted[0] ?? (await c.query(`select ${DELETION} from account_deletions where person_id = $1`, [personId])).rows[0];

  const emails = (await c.query(`select email from identities where person_id = $1 and email is not null`, [personId])).rows.map((r) => r.email as string);
  if (person.email) emails.push(person.email);

  // Blank. The check constraint refuses a tombstone that keeps anything personal.
  await c.query(
    `update people set name = 'Deleted', relation = null, avatar_key = null, email = null, tz = null, share_cooking = null, language = null, voice_clone_consented_at = null,
            cartesia_voice_id = null, approx_lat = null, approx_lng = null, campus = null, previous_person_id = null, deleted_at = coalesce(deleted_at, now())
      where id = $1`,
    [personId],
  );

  await c.query(`delete from left_identities where person_id = $1`, [personId]);

  // Every way in ends here.
  await data.signPersonOut(c, personId);
  await c.query(`update devices set person_id = null, label = null, revoked_at = coalesce(revoked_at, now()) where person_id = $1`, [personId]);
  await data.dropIdentitiesOf(c, personId);
  await dropPushTokens(c, personId);
  await c.query(`delete from invites where person_id = $1`, [personId]);
  await data.revokeFamilyInvitesFrom(c, personId);
  await c.query(`delete from move_requests where person_id = $1`, [personId]);
  // The sign-up log's name and email go now too, and this is the one moment their email is still known, for old rows with no person on them.
  await c.query(
    `update signups set email = null, name = 'Deleted', person_id = null where (person_id = $1 or (person_id is null and email = any($2::text[]))) and share_token like 'link:%'`,
    [personId, emails],
  );
  await c.query(`delete from signups where (person_id = $1 or (person_id is null and email = any($2::text[]))) and (share_token is null or share_token not like 'link:%')`, [personId, emails]);

  // Off the map now: dinners they host, and any around their recipes, which is why this comes before the recipes go.
  await cancelDinnersOfPerson(c, personId);
  // Nothing of theirs is worked on again: a worker can't claim or finish these (pipeline/queue_db.py reads cancelled_at), and the glasses can't make a recipe from these.
  await stopPersonsWork(c, personId);
  if (hasRecipes) await requestMossSync(c, person.family_id);

  await enqueue(c, { queue: "scheduled", payload: { task: "accounts.purge", deletionId: deletion.id }, requestId });
  return deletion.id;
}

// ---------------------------------------------------------------------------------------------
// The batches

export type PurgeOptions = {
  batch?: number;
  budgetMs?: number;
  /** Tests only: throws here to act out a crash, before a batch commits or just after. */
  fault?: (point: "before-commit" | "after-commit", step: string, changed: number) => void | Promise<void>;
};

async function lockedDeletion(c: Queryable, id: string): Promise<Deletion | null> {
  const { rows } = await c.query(`select ${DELETION} from account_deletions where id = $1 for update`, [id]);
  return rows[0] ?? null;
}

async function markRun(c: Queryable, id: string): Promise<Deletion | null> {
  const d = await lockedDeletion(c, id);
  if (d) await c.query(`update account_deletions set purge_run_at = now() where id = $1`, [id]);
  return d;
}

class OutOfTime extends Error {}

/**
 * Works through every step, a batch to a transaction, until a full pass finds nothing left, then marks the purge finished and starts the outside purge. That last empty pass is the
 * check: a row a moment late, or a batch lost to a crash, is found before anyone says it's done. Safe to run twice at once: each batch holds the deletion's row, and each step finds only
 * what's left. Out of time, it queues itself.
 */
export async function runPurge(deletionId: string, trace: Pick<Trace, "requestId">, options: PurgeOptions = {}): Promise<"done" | "more" | "held" | "missing"> {
  const started = Date.now();
  const max = options.batch ?? PURGE_BATCH;
  const budget = options.budgetMs ?? PURGE_BUDGET_MS;
  const first = await db().query(`select ${DELETION} from account_deletions where id = $1`, [deletionId]);
  if (!first.rows[0]) return "missing";
  if (first.rows[0].purged_at) return "done";

  const run: PurgeRun = {
    max,
    beforeCommit: async (c, step, changed) => {
      await c.query(`update account_deletions set purge_run_at = now() where id = $1`, [deletionId]);
      await options.fault?.("before-commit", step, changed);
    },
    afterCommit: async (step, changed) => {
      await options.fault?.("after-commit", step, changed);
      if (changed >= max && Date.now() - started > budget) throw new OutOfTime();
    },
  };

  for (;;) {
    let touched = 0;
    try {
      for (const step of STEPS) {
        if ("area" in step) {
          // An area's purge has transactions of its own, so this row's lock is let go first: holding a connection while it waits for more is how purges stop each other (db.ts).
          const d = await tx((c) => markRun(c, deletionId));
          if (!d) return "missing";
          touched += await step.area(d, run);
        } else {
          touched += await inBatches(run, step.name, async (c, batch) => {
            const d = await lockedDeletion(c, deletionId);
            return d ? step.run(c, d, batch) : 0;
          });
        }
      }
    } catch (error) {
      if (!(error instanceof OutOfTime)) throw error;
      await enqueue(db(), { queue: "scheduled", payload: { task: "accounts.purge", deletionId }, requestId: trace.requestId });
      return "more";
    }
    if (touched > 0) continue;
    const finished = await tx(async (c) => {
      const d = await lockedDeletion(c, deletionId);
      if (!d || d.purged_at) return true;
      // With the recipe copy read-only the sync takes them, normally within minutes. It isn't finished while they're here. That's not an error: restartPurges looks again, and
      // someone hears if it keeps stopping.
      const { rows: held } = await c.query(`select 1 from recipes where cook_id = $1 limit 1`, [d.person_id]);
      if (held.length) return false;
      await c.query(`update account_deletions set purged_at = now() where id = $1`, [deletionId]);
      if (d.recipe_ids.length) await requestMossSync(c, d.family_id); // again at the end, for a recipe a worker published after the start
      await enqueue(c, { queue: "scheduled", payload: { task: "accounts.outside", deletionId }, requestId: trace.requestId });
      return true;
    });
    return finished ? "done" : "held";
  }
}

/** The schedule: starts again, from the top, each purge that stopped. It doesn't give up on someone's deletion; past a few restarts someone is told each time. */
export async function restartPurges(requestId?: string): Promise<number> {
  return tx(async (c) => {
    const { rows } = await c.query(
      `select id, purge_restarts from account_deletions
        where purged_at is null and coalesce(purge_run_at, requested_at) < now() - make_interval(secs => $1)
        order by requested_at limit 100 for update skip locked`,
      [PURGE_STUCK_MS / 1000],
    );
    for (const row of rows) {
      await c.query(`update account_deletions set purge_restarts = purge_restarts + 1, purge_run_at = now() where id = $1`, [row.id]);
      if (row.purge_restarts + 1 > ALERT_AFTER_RESTARTS) alert("AccountPurgeKeepsStopping", { deletion_id: row.id });
      await enqueue(c, { queue: "scheduled", payload: { task: "accounts.purge", deletionId: row.id }, requestId });
    }
    return rows.length;
  });
}

// ---------------------------------------------------------------------------------------------
// Outside the database

export interface VoiceClones {
  /** Deleting what's already gone is fine. Throws a short reason without secrets when it can't. */
  remove(voiceId: string): Promise<void>;
}

const VOICE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const CARTESIA_TIMEOUT_MS = 15_000;

/** Cartesia, as account_purge.py calls it. */
export const cartesiaVoices: VoiceClones = {
  async remove(voiceId) {
    if (!VOICE_ID.test(voiceId)) throw new Error("the voice clone id isn't a Cartesia id");
    const key = process.env.CARTESIA_API_KEY?.trim();
    if (!key) throw new Error("CARTESIA_API_KEY isn't set");
    const res = await fetch(`https://api.cartesia.ai/voices/${voiceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key}`, "Cartesia-Version": "2026-08-14" },
      signal: AbortSignal.timeout(CARTESIA_TIMEOUT_MS),
    });
    if (res.status === 404) return;
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
  },
};

let voices: VoiceClones = cartesiaVoices;
export const useVoiceClones = (next: VoiceClones) => {
  voices = next;
};

/**
 * What's still outside: her voice clone, which this deletes, and what it can't reach, which it names. The sweep only reaches the private bucket's anonymous and signed-in uploads today, and nothing here
 * can list a folder in `media` or `uploads` yet (AWS-MIGRATION.md, "Before real data"), so a deletion holding any of those stays open, with the reason on its row, rather than saying it's
 * done. It's tried again later, each wait longer, and someone is told after the last attempt.
 */
export async function purgeOutside(deletionId: string): Promise<"done" | "retry" | "gave_up" | "not_ready" | "missing"> {
  const { rows } = await db().query(`select ${DELETION} from account_deletions where id = $1`, [deletionId]);
  const d: Deletion | undefined = rows[0];
  if (!d) return "missing";
  if (d.external_purged_at) return "done";
  if (!d.purged_at) return "not_ready"; // a late recipe could still add to the lists
  const problems: string[] = [];
  const counts: Record<string, number> = {};

  if (d.voice_clone_id) {
    try {
      await voices.remove(d.voice_clone_id);
      await db().query(`update account_deletions set voice_clone_id = null where id = $1`, [d.id]);
      counts.voiceClones = 1;
    } catch (error) {
      problems.push(`Cartesia: ${(error as Error).message}`.slice(0, 120));
    }
  }

  const left = await db().query(
    `select count(*)::int as n from files where (purge_deletion_id = $1 or owner_person_id = $2) and deleted_at is null`,
    [d.id, d.person_id],
  );
  // A key the sweep has already taken isn't left to report (a plate photo is noted here and also in the ledger). The rest can't be seen yet.
  const media = await db().query(
    `select count(*)::int as n from unnest($1::text[]) as k where not exists (select 1 from files f where f.key = k and f.deleted_at is not null)`,
    [d.media_keys],
  );
  const notReached: [string, number][] = [
    ["files marked and not deleted", left.rows[0].n],
    ["upload folders", d.upload_keys.length],
    ["media files", media.rows[0].n],
    ["recipe folders", d.media_prefixes.length],
    ["GCS links", d.media_urls_legacy.length],
  ];
  for (const [what, n] of notReached) if (n) problems.push(`Not reached yet: ${n} ${what}`);

  return tx(async (c) => {
    const current = await lockedDeletion(c, d.id);
    if (!current || current.external_purged_at) return "done" as const;
    if (!problems.length) {
      await c.query(`update account_deletions set external_purged_at = now(), external_tried_at = now(), external_error = null, external_counts = $2 where id = $1`, [d.id, JSON.stringify(counts)]);
      return "done" as const;
    }
    const attempts = current.external_attempts + 1;
    await c.query(`update account_deletions set external_attempts = $2, external_tried_at = now(), external_error = $3 where id = $1`, [d.id, attempts, problems.join("; ").slice(0, 500)]);
    if (attempts < MAX_OUTSIDE_ATTEMPTS) return "retry" as const;
    alert("AccountOutsidePurgeGaveUp", { deletion_id: d.id });
    return "gave_up" as const;
  });
}

/** After fixing why it failed: tried on the schedule's next pass, with a fresh count. One already finished is left alone. A person runs this. */
export async function retryOutside(deletionId: string): Promise<"queued" | "done" | "missing"> {
  const { rows } = await db().query(`select external_purged_at from account_deletions where id = $1`, [deletionId]);
  if (!rows[0]) return "missing";
  if (rows[0].external_purged_at) return "done";
  await db().query(`update account_deletions set external_attempts = 0, external_tried_at = null where id = $1 and external_purged_at is null`, [deletionId]);
  return "queued";
}

/** The ones due another try. */
export async function dueOutside(limit = 20): Promise<string[]> {
  const { rows } = await db().query(
    `select id, external_attempts, external_tried_at from account_deletions
      where external_purged_at is null and purged_at is not null and external_attempts < $1
      order by requested_at limit 200`,
    [MAX_OUTSIDE_ATTEMPTS],
  );
  const now = Date.now();
  return rows
    .filter((r) => !r.external_tried_at || now - r.external_tried_at.getTime() >= outsideWait(r.external_attempts))
    .slice(0, limit)
    .map((r) => r.id);
}

/** C5: the lists of ids and keys clear 60 days after the outside purge. The row stays as proof. */
export async function clearOldLists(batch = 200): Promise<number> {
  const { rowCount } = await db().query(
    `update account_deletions
        set recipe_ids = '{}', job_ids = '{}', upload_keys = '{}', media_keys = '{}', media_prefixes = '{}', media_urls_legacy = '{}', lists_cleared_at = now()
      where id in (select id from account_deletions
                    where external_purged_at is not null and lists_cleared_at is null and external_purged_at < now() - make_interval(days => $1)
                    order by external_purged_at limit $2)`,
    [LISTS_KEPT_DAYS, batch],
  );
  return rowCount ?? 0;
}

/** The route: `Signed` proved who they are, and nothing else can stop this but the database being down, in which case it refuses and the phone tries again. */
export async function deleteMe(personId: string, requestId?: string): Promise<{ deleted: true }> {
  const id = await startDeletion(personId, "person", requestId);
  if (!id) throw refuse(404, "not_found");
  return { deleted: true };
}

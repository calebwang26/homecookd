// The two runs that write: deletions (about every minute, on their own, so a stuck pass can't delay them) and a pass over each whole table. Both are
// safe to repeat and to stop anywhere: outside calls happen between transactions, and a pass saves its place after each page. Logs and alerts carry
// counts, row ids and rule names. Never a name, an email, a place or a recipe's words.
import { db } from "../../db.js";
import * as data from "./data.js";
import { lowerUuid, mergeFamily, mergePerson, mergeRecipe, RowRule } from "./merge.js";
import { CursorExpired, type ConvexDeletion, type ConvexPerson, type ConvexRecipe, type ConvexFamily, type Rows, type Sources, type Table } from "./sources.js";

export type Log = { info: (fields: object, message: string) => void; error: (fields: object, message: string) => void };
/** Alerts go to Sentry by name and tags, so they say what broke with no row values. */
export type Reporter = { log: Log; alert: (name: string, tags?: Record<string, string>) => void };
export type Run = Sources & { report: Reporter; budgetMs?: number; passEveryMs?: number };

export const TABLES: Table[] = ["families", "people", "recipes"];
// families and people carry one Supabase lookup a page, whose list has to fit a URL. Recipes are big: a page must stay well under Convex's response limit.
export const PAGE: Record<Table, number> = { families: 100, people: 100, recipes: 25 };

// Below SQS's 300 s visibility, and a page's retries fit inside the lease.
const BUDGET_MS = 60_000;
const LEASE_S = 180;
const PASS_EVERY_MS = 15 * 60_000;
const DELETIONS_PAGE = 100;
// _creationTime is set when a mutation runs, not when it commits, so a later-numbered row can appear after we've read past it. Reading back over the last
// few minutes catches that, and repeating a deletion changes nothing.
const OVERLAP_MS = 10 * 60_000;
/** Deletions not reaching the copy for this long is the alarm: "within minutes" is the promise (SCHEMA.md, M1). */
export const DELETIONS_LATE_S = 15 * 60;
// More than this gone in one pass looks like a bad read, not real deletes: hold, and tell someone. People and families are never swept.
const SWEEP_MIN = 20;
const SWEEP_SHARE = 0.1;

export type Stats = { inserted: number; updated: number; unchanged: number; held: number; refused: number; deleted: number };
const noStats = (): Stats => ({ inserted: 0, updated: 0, unchanged: 0, held: 0, refused: 0, deleted: 0 });

/** A problem with this row's values, which must not stop the batch. Anything else (the database down, a timeout) stops it and the place isn't lost. */
function rowRule(error: unknown): string | null {
  if (error instanceof RowRule) return error.rule;
  const { code, constraint } = error as { code?: string; constraint?: string };
  if (typeof code !== "string") return null;
  if (code === "HC002") return "refused_deleted";
  if (code.startsWith("22") || code.startsWith("23")) return constraint ?? `sqlstate_${code}`;
  return null;
}

async function oneRow(run: Run, table: Table, id: string, stats: Stats, work: () => Promise<data.Outcome | "applied">): Promise<void> {
  try {
    const outcome = await work();
    if (outcome === "applied") stats.deleted += 1;
    else stats[outcome] += 1;
  } catch (error) {
    const rule = rowRule(error);
    if (!rule) throw error;
    // A stale row meeting a deletion is the system working, and the reconcile counts any that lasts.
    if (rule === "refused_deleted") {
      stats.refused += 1;
      run.report.log.info({ table, rowId: id, rule }, "sync refused a deleted row");
      return;
    }
    stats.held += 1;
    await data.noteIssue(db(), table, id, rule);
    run.report.log.error({ table, rowId: id, rule }, "sync held a row out");
  }
}

// ---- Deletions ----

const asDeletion = (row: ConvexDeletion): data.Deletion => ({
  personId: row.personId,
  familyId: row.familyId,
  supabaseId: lowerUuid(row.supabaseProfileId),
  at: new Date(row.requestedAt),
  recipeIds: row.recipeIds,
});

const tombstone = (person: ConvexPerson): data.Deletion => ({
  personId: person._id,
  familyId: person.familyId,
  supabaseId: lowerUuid(person.supabaseProfileId),
  at: new Date(person.deletedAt as number),
  recipeIds: [],
  role: person.role,
  createdAt: new Date(person._creationTime),
});

async function warnIfLate(run: Run): Promise<void> {
  const state = await data.readState("deletions");
  // A feed that has never worked fails its own message, which reaches the dead-letter alarm.
  const late = state.last_success_at && Date.now() - state.last_success_at.getTime() > DELETIONS_LATE_S * 1000;
  if (late && (await data.claimAlert("deletions", DELETIONS_LATE_S))) {
    run.report.log.error({ lastSuccess: state.last_success_at }, "account deletions aren't reaching the copy");
    run.report.alert("SyncDeletionsLate");
  }
}

/**
 * Reads accountDeletions after our place and applies each. Convex alone is enough, so a Supabase outage can't delay a deletion. The place doesn't pass a
 * deletion that failed; the run throws at the end, so SQS tries again and repeated failures reach the dead-letter alarm.
 */
export async function runDeletions(run: Run): Promise<{ ran: boolean; applied: number; failed: number }> {
  const lease = await data.takeLease("deletions", LEASE_S);
  if (!lease) return { ran: false, applied: 0, failed: 0 };
  try {
    await data.lockCopies();
    const start = (await data.readState("deletions")).after_ms;
    let after = start;
    let highest = start;
    let firstFailure: number | null = null;
    let applied = 0;
    let failed = 0;
    for (;;) {
      const rows = await run.convex.deletions(after, DELETIONS_PAGE);
      for (const row of rows) {
        highest = Math.max(highest, row.creationTime);
        try {
          if ((await data.applyDeletion(asDeletion(row))) === "applied") applied += 1;
        } catch (error) {
          const rule = rowRule(error);
          if (!rule) throw error;
          failed += 1;
          firstFailure = Math.min(firstFailure ?? row.creationTime, row.creationTime);
          await data.noteIssue(db(), "people", row.personId, rule);
          run.report.log.error({ table: "people", rowId: row.personId, rule }, "a deletion didn't apply");
        }
      }
      if (rows.length < DELETIONS_PAGE) break;
      after = rows[rows.length - 1].creationTime;
    }
    const safe = firstFailure ?? highest;
    await data.saveDeletions(lease, Math.max(start, safe - OVERLAP_MS), failed === 0);
    if (applied > 0) run.report.log.info({ applied }, "deletions reached the copy");
    if (failed > 0) throw Object.assign(new Error("deletions failed"), { name: "SyncDeletionFailed" });
    return { ran: true, applied, failed };
  } catch (error) {
    await warnIfLate(run).catch(() => {}); // the failure below is the one to report
    throw error;
  } finally {
    await data.releaseLease("deletions", lease);
  }
}

// ---- A pass ----

const index = <T extends { id: string }>(rows: T[]) => new Map(rows.map((row) => [row.id.toLowerCase(), row]));

async function applyFamilies(run: Run, rows: ConvexFamily[], stats: Stats): Promise<void> {
  const supabase = index(await run.supabase.families(rows.map((row) => row.supabaseFamilyId)));
  for (const row of rows) {
    await oneRow(run, "families", String(row._id), stats, () =>
      data.upsertFamily(row._id, (blank) => mergeFamily(row, supabase.get(row.supabaseFamilyId.toLowerCase()) ?? null, blank)),
    );
  }
}

/** Supabase's answers for a page of live people, and where each belongs. */
export async function peopleContext(run: Sources, rows: ConvexPerson[]) {
  const live = rows.filter((row) => row.deletedAt === undefined);
  const profiles = index(await run.supabase.profiles(live.map((row) => row.supabaseProfileId)));
  const families = await data.familiesBySupabaseId([...new Set([...profiles.values()].map((p) => p.family_id.toLowerCase()))]);
  return { profiles, families };
}

async function applyPeople(run: Run, rows: ConvexPerson[], stats: Stats): Promise<void> {
  const { profiles, families } = await peopleContext(run, rows);
  for (const row of rows) {
    await oneRow(run, "people", String(row._id), stats, async () => {
      if (row.deletedAt !== undefined) {
        const outcome = await data.applyDeletion(tombstone(row));
        return outcome === "applied" ? "applied" : "unchanged";
      }
      const profile = profiles.get(row.supabaseProfileId.toLowerCase()) ?? null;
      const mapped = profile ? families.get(profile.family_id.toLowerCase()) : undefined;
      return data.upsertRow("people", mergePerson(row, profile, mapped ?? row.familyId));
    });
  }
}

async function applyRecipes(run: Run, rows: ConvexRecipe[], stats: Stats, passNo: number): Promise<void> {
  await data.markSeen(rows.map((row) => String(row._id)), passNo); // before the write, so a row held out still counts as there at the source
  for (const row of rows) {
    await oneRow(run, "recipes", String(row._id), stats, () => data.upsertRow("recipes", mergeRecipe(row)));
  }
}

async function apply<T extends Table>(run: Run, table: T, rows: Rows[T][], stats: Stats, passNo: number): Promise<void> {
  if (table === "families") await applyFamilies(run, rows as ConvexFamily[], stats);
  else if (table === "people") await applyPeople(run, rows as ConvexPerson[], stats);
  else await applyRecipes(run, rows as ConvexRecipe[], stats, passNo);
}

/** Recipes no read of this finished walk saw are gone at Convex. Held if it's suspiciously many. */
async function sweepRecipes(run: Run, passNo: number, stats: Stats): Promise<void> {
  const LIMIT = 500;
  const { ids, total } = await data.unseenRecipes(passNo, LIMIT);
  if (ids.length > Math.max(SWEEP_MIN, Math.floor(total * SWEEP_SHARE))) {
    run.report.log.error({ unseen: ids.length, total }, "too many recipes look gone: holding the sweep");
    run.report.alert("SyncSweepTooLarge", { unseen: String(ids.length), total: String(total) });
    return;
  }
  for (const id of ids) {
    await data.dropUnseenRecipe(id);
    stats.deleted += 1;
  }
}

export type PassResult = { state: "busy" | "waiting_for_deletions" | "idle" | "running" | "finished"; stats: Stats };

/**
 * One message's worth of a pass: it carries on from the saved place until the budget runs out, and the next message carries on from there. The first
 * pass waits for the deletions run, so everyone already deleted is on record before any of their rows can be read.
 */
export async function runPass(run: Run): Promise<PassResult> {
  const stats = noStats();
  const lease = await data.takeLease("pass", LEASE_S);
  if (!lease) return { state: "busy", stats };
  const deadline = Date.now() + (run.budgetMs ?? BUDGET_MS);
  try {
    await data.lockCopies();
    await warnIfLate(run).catch(() => {});
    if (!(await data.readState("deletions")).last_success_at) return { state: "waiting_for_deletions", stats };

    const moved = await data.movedTables();
    const order = TABLES.filter((table) => !moved.has(table));
    let state = await data.readState("pass");
    const saved = async (changes: Parameters<typeof data.savePass>[2]) => {
      const next = await data.savePass(lease, LEASE_S, changes);
      if (!next) throw Object.assign(new Error("lease lost"), { name: "SyncLeaseLost" });
      state = next;
    };

    if (!state.at_table || !order.includes(state.at_table)) {
      const fresh = state.finished_at && Date.now() - state.finished_at.getTime() < (run.passEveryMs ?? PASS_EVERY_MS);
      if (fresh || order.length === 0) return { state: "idle", stats };
      await saved({ at_table: order[0], page_cursor: null, pass_no: state.pass_no + 1, started: true });
    }

    for (;;) {
      const table = state.at_table as Table;
      let page;
      try {
        page = await run.convex.page(table, state.page_cursor, PAGE[table]);
      } catch (error) {
        if (!(error instanceof CursorExpired)) throw error;
        run.report.log.error({ table }, "Convex no longer knows our place: this table starts again");
        await saved({ at_table: table, page_cursor: null });
        continue;
      }
      await apply(run, table, page.rows, stats, state.pass_no);
      if (page.next) {
        await saved({ at_table: table, page_cursor: page.next });
      } else {
        if (table === "people") await data.blankEmptyFamilies();
        if (table === "recipes") await sweepRecipes(run, state.pass_no, stats);
        const nextTable = order[order.indexOf(table) + 1];
        if (!nextTable) {
          await saved({ at_table: null, page_cursor: null, finished: true });
          run.report.log.info({ passNo: state.pass_no, ...stats }, "a sync pass finished");
          return { state: "finished", stats };
        }
        await saved({ at_table: nextTable, page_cursor: null });
      }
      if (Date.now() >= deadline) {
        run.report.log.info({ table: state.at_table, ...stats }, "a sync pass goes on in the next message");
        return { state: "running", stats };
      }
    }
  } finally {
    await data.releaseLease("pass", lease);
  }
}

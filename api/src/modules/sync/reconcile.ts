// Counts the differences between the old stores and the copies, and writes nothing to a copy. It reads every table again on its own, so a sync that's stuck
// or wrong still gets caught. The report holds counts and row ids, and no family content. Duplicates and half-merged rows are counted here and left for a
// person: they're never merged by a guess.
import * as data from "./data.js";
import { mergeFamily, mergePerson, mergeRecipe, RowRule } from "./merge.js";
import { isSupabaseId, type Rows, type Table } from "./sources.js";
import { PAGE, peopleContext, type Run, TABLES } from "./service.js";

export type Kind =
  | "missing_in_copy" // the source has it, the copy doesn't
  | "extra_in_copy" // the copy has it, the source doesn't
  | "differs" // both have it, and a column differs
  | "not_copyable" // a value this schema refuses, so it can't land
  | "deletion_not_applied" // deleted at the source and still in the copy. Always an alert
  | "refused_deleted" // the source says live, and we hold a deletion for it
  | "duplicate_supabase_id" // two Convex rows claim one old id (SCHEMA.md section 5)
  | "family_disagreement" // Convex and Supabase name different families. Supabase's answer is used
  | "family_unmapped" // Supabase names a family with no copy. Convex's answer is used
  | "no_supabase_row" // a uuid that Supabase doesn't have
  | "seed" // a Convex-only demo row, with no Supabase side
  | "supabase_only" // in Supabase with no Convex row: not copied
  | "tombstone"; // a deletion that holds. For scale, not a problem

const MUST_ACT: Kind[] = ["extra_in_copy", "not_copyable", "deletion_not_applied", "refused_deleted", "duplicate_supabase_id"];
// A row that changed since the last pass is normal. Many are not.
const LAG_TOLERATED = 5;
const LAG: Kind[] = ["missing_in_copy", "differs"];
const SAMPLES = 10;
const BUDGET_MS = 240_000; // under SQS's 300 s visibility
const LEASE_S = 300;
const WALK = 500;

export type Report = {
  counts: Partial<Record<Table, Partial<Record<Kind, number>>>>;
  samples: Partial<Record<Table, Partial<Record<Kind, string[]>>>>;
  held: { table_name: string; rule: string; n: number }[];
  /** The time ran out. Counts so far are real, and nothing was counted as extra. */
  incomplete: boolean;
};

export async function runReconcile(run: Run): Promise<Report | null> {
  const lease = await data.takeLease("reconcile", LEASE_S);
  if (!lease) return null;
  try {
    const report: Report = { counts: {}, samples: {}, held: [], incomplete: false };
    const unapplied = new Set<string>();
    const note = (table: Table, kind: Kind, id: string) => {
      if (kind === "deletion_not_applied") {
        if (unapplied.has(id)) return; // the person's row and the deletion's row can both say so
        unapplied.add(id);
      }
      const counts = (report.counts[table] ??= {});
      counts[kind] = (counts[kind] ?? 0) + 1;
      const samples = (report.samples[table] ??= {});
      const list = (samples[kind] ??= []);
      if (list.length < SAMPLES) list.push(id);
    };
    const deadline = Date.now() + (run.budgetMs ?? BUDGET_MS);
    const late = () => {
      if (Date.now() < deadline) return false;
      report.incomplete = true;
      return true;
    };

    /** The merge and the comparison for one row. */
    const compare = async (table: Table, id: string, build: () => Record<string, unknown> & { id: string }) => {
      try {
        const result = await data.compareRow(table, build());
        if (result === "missing") return "missing" as const;
        if (result.length > 0) note(table, "differs", id);
      } catch (error) {
        const code = (error as { code?: string }).code ?? "";
        if (error instanceof RowRule || code.startsWith("22") || code.startsWith("23")) note(table, "not_copyable", id);
        else throw error;
      }
      return "there" as const;
    };

    const walk = async <T extends Table>(table: T, handle: (rows: Rows[T][]) => Promise<void>) => {
      let cursor: string | null = null;
      for (;;) {
        if (late()) return;
        const page: { rows: Rows[T][]; next: string | null } = await run.convex.page(table, cursor, PAGE[table]);
        await handle(page.rows);
        if (!page.next) return;
        cursor = page.next;
      }
    };

    const moved = await data.movedTables();
    const seen: Record<Table, Set<string>> = { families: new Set(), people: new Set(), recipes: new Set() };
    const supabaseFamilies = new Set<string>();
    const supabaseProfiles = new Map<string, string[]>();

    if (!moved.has("families")) {
      await walk("families", async (rows) => {
        const found = new Map((await run.supabase.families(rows.map((row) => row.supabaseFamilyId))).map((row) => [row.id.toLowerCase(), row]));
        const empty = await data.emptyFamilies(rows.map((row) => row._id));
        for (const row of rows) {
          seen.families.add(row._id);
          supabaseFamilies.add(row.supabaseFamilyId.toLowerCase());
          const supabase = found.get(row.supabaseFamilyId.toLowerCase()) ?? null;
          if (!supabase) note("families", isSupabaseId(row.supabaseFamilyId) ? "no_supabase_row" : "seed", row._id);
          const outcome = await compare("families", row._id, () => mergeFamily(row, supabase, empty.has(row._id)));
          if (outcome === "missing") note("families", "missing_in_copy", row._id);
        }
      });
    }

    if (!moved.has("people")) {
      await walk("people", async (rows) => {
        const { profiles, families } = await peopleContext(run, rows);
        for (const row of rows) {
          seen.people.add(row._id);
          const oldId = row.supabaseProfileId.toLowerCase();
          supabaseProfiles.set(oldId, [...(supabaseProfiles.get(oldId) ?? []), row._id]);
          if (row.deletedAt !== undefined) {
            note("people", (await data.deletionHolds(row._id, [])) ? "tombstone" : "deletion_not_applied", row._id);
            continue;
          }
          const profile = profiles.get(oldId) ?? null;
          if (!profile) note("people", isSupabaseId(row.supabaseProfileId) ? "no_supabase_row" : "seed", row._id);
          const mapped = profile ? families.get(profile.family_id.toLowerCase()) : undefined;
          if (profile && !mapped) note("people", "family_unmapped", row._id);
          if (mapped && mapped !== row.familyId) note("people", "family_disagreement", row._id);
          const outcome = await compare("people", row._id, () => mergePerson(row, profile, mapped ?? row.familyId));
          if (outcome === "missing") {
            note("people", (await data.isDeleted("person", row._id, oldId)) ? "refused_deleted" : "missing_in_copy", row._id);
          }
        }
      });
      for (const ids of supabaseProfiles.values()) {
        if (ids.length > 1) for (const id of ids) note("people", "duplicate_supabase_id", id);
      }
    }

    if (!moved.has("recipes")) {
      await walk("recipes", async (rows) => {
        for (const row of rows) {
          seen.recipes.add(row._id);
          const outcome = await compare("recipes", row._id, () => mergeRecipe(row));
          if (outcome === "missing") {
            const refused = (await data.isDeleted("recipe", row._id)) || (await data.recipeCookDeleted(row.cookId));
            note("recipes", refused ? "refused_deleted" : "missing_in_copy", row._id);
          }
        }
      });
    }

    // Every deletion Convex holds, from the start: an old one that stopped holding is the worst thing this can find.
    let after = 0;
    for (;;) {
      if (late()) break;
      const rows = await run.convex.deletions(after, WALK);
      for (const row of rows) {
        if (!(await data.deletionHolds(row.personId, row.recipeIds))) note("people", "deletion_not_applied", row.personId);
      }
      if (rows.length < WALK) break;
      after = rows[rows.length - 1].creationTime;
    }

    // Only a whole walk can say what's missing from it.
    if (!report.incomplete) {
      for (const table of TABLES) {
        if (moved.has(table)) continue;
        for (const id of await data.copyIds(table)) if (!seen[table].has(id)) note(table, "extra_in_copy", id);
      }
      const inSupabaseOnly = async (table: "families" | "people", list: (after: string | null, limit: number) => Promise<string[]>, known: (id: string) => boolean) => {
        let from: string | null = null;
        for (;;) {
          if (late()) return;
          const ids: string[] = await list(from, WALK);
          for (const id of ids) if (!known(id.toLowerCase())) note(table, "supabase_only", id);
          if (ids.length < WALK) return;
          from = ids[ids.length - 1];
        }
      };
      await inSupabaseOnly("families", (from, limit) => run.supabase.familyIds(from, limit), (id) => supabaseFamilies.has(id));
      await inSupabaseOnly("people", (from, limit) => run.supabase.profileIds(from, limit), (id) => supabaseProfiles.has(id));
    }

    report.held = await data.heldCounts();
    await data.saveReport(lease, report);
    run.report.log.info({ counts: report.counts, held: report.held, incomplete: report.incomplete }, "sync reconcile");

    const tags: Record<string, string> = {};
    for (const [table, counts] of Object.entries(report.counts)) {
      for (const [kind, n] of Object.entries(counts ?? {})) {
        if (MUST_ACT.includes(kind as Kind) || (LAG.includes(kind as Kind) && n > LAG_TOLERATED)) tags[`${table}_${kind}`] = String(n);
      }
    }
    if (report.held.length > 0) tags.held = String(report.held.reduce((sum, row) => sum + row.n, 0));
    if (report.incomplete) tags.incomplete = "true";
    if (Object.keys(tags).length > 0) run.report.alert("SyncReconcileFoundDifferences", tags);
    return report;
  } finally {
    await data.releaseLease("reconcile", lease);
  }
}

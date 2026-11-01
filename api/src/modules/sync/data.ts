// The sync's SQL. The only code in the api that writes `families`, `people` or `recipes` (012_sync.sql refuses anyone else once the copies are
// read-only, and a test reads api/src for it). Each row is its own transaction, so one row can't hold another's locks or fail another's write.
import { randomUUID } from "node:crypto";
import { db, tx, type Queryable } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { BLANK_NAME } from "./merge.js";
import type { Table } from "./sources.js";

export type StateName = "pass" | "deletions" | "reconcile";
export type Outcome = "inserted" | "updated" | "unchanged";
type Row = Record<string, unknown> & { id: string };

const JSON_COLUMNS = new Set(["steps", "memories", "added_ingredients"]);
const WRITER = `select set_config('homecookd.sync_writer', 'on', true)`;
const lockPerson = (c: Queryable, personId: string) =>
  c.query(`select pg_advisory_xact_lock(hashtextextended('sync-person:' || $1, 0))`, [personId]);
const lockFamily = (c: Queryable, familyId: string) =>
  c.query(`select pg_advisory_xact_lock(hashtextextended('sync-family:' || $1, 0))`, [familyId]);

export async function noteIssue(q: Queryable, table: string, rowId: string, rule: string): Promise<void> {
  await q.query(
    `insert into sync_issues (table_name, row_id, rule) values ($1, $2, $3)
     on conflict (table_name, row_id, rule) do update set last_seen_at = now(), times = sync_issues.times + 1`,
    [table, rowId, rule.slice(0, 100)],
  );
}

const clearIssues = (q: Queryable, table: string, rowId: string) => q.query(`delete from sync_issues where table_name = $1 and row_id = $2`, [table, rowId]);

async function write(c: Queryable, table: Table, row: Row): Promise<Outcome> {
  const columns = Object.keys(row);
  const changing = columns.filter((column) => column !== "id");
  const values = columns.map((column) => (JSON_COLUMNS.has(column) ? JSON.stringify(row[column]) : row[column]));
  const sql = `insert into ${table} as t (${columns.join(", ")})
    values (${columns.map((_, i) => `$${i + 1}`).join(", ")})
    on conflict (id) do update set ${changing.map((column) => `${column} = excluded.${column}`).join(", ")}
    where (${changing.map((column) => `t.${column}`).join(", ")}) is distinct from (${changing.map((column) => `excluded.${column}`).join(", ")})
    returning (xmax = 0) as inserted`;
  const { rows } = await c.query(sql, values);
  await clearIssues(c, table, row.id);
  if (rows.length === 0) return "unchanged";
  return rows[0].inserted ? "inserted" : "updated";
}

/** Writes only what differs, so running it again changes nothing. A row it can't write throws, and the caller holds that row out. */
export async function upsertRow(table: Table, row: Row): Promise<Outcome> {
  return tx(async (c) => {
    await c.query(WRITER);
    return write(c, table, row);
  });
}

/** A family asks whether it's empty under the lock a deletion takes to blank it, so a stale name can't land just after the blanking. */
export async function upsertFamily(id: string, build: (blank: boolean) => Row): Promise<Outcome> {
  return tx(async (c) => {
    await c.query(WRITER);
    await lockFamily(c, id);
    const { rows } = await c.query(`select ${EMPTY_FAMILY("$1")} as empty`, [id]);
    return write(c, "families", build(rows[0].empty));
  });
}

/** Removes a recipe. A row that still points at it and may not cascade (a question holds a file key) keeps the row, so its contents go instead. */
async function dropRecipe(c: Queryable, id: string): Promise<void> {
  await c.query("savepoint drop_recipe");
  try {
    await c.query("delete from recipes where id = $1", [id]);
    await c.query("release savepoint drop_recipe");
  } catch (error) {
    if ((error as { code?: string }).code !== "23503") throw error;
    await c.query("rollback to savepoint drop_recipe");
    await c.query(
      `update recipes set title = $2, library_id = null, media_prefix = null, recipe_json_key = null, cover_key = null, cover_version = null,
              cover_stock_path = null, steps = '[]', memories = '[]', added_ingredients = '[]', shared_at = null, story_card_text = null,
              story_card_written_at = null, story_card_used_stories = null, story_card_culture = null, story_card_quote = null, moss_indexed_at = null
        where id = $1 and title <> $2`,
      [id, BLANK_NAME],
    );
    await noteIssue(c, "recipes", id, "recipe_blanked_still_referenced");
  }
}

export type Deletion = {
  personId: string;
  familyId: string;
  supabaseId: string | null;
  at: Date;
  recipeIds: string[];
  // Known only when this came from the person's own row. Without it there's no tombstone to write yet, and the record alone keeps them out.
  role?: "cook" | "kid";
  createdAt?: Date;
};

/**
 * An account deletion reaching the copy, all at once. Their recipes go and the row is blanked first, because after the record exists the triggers refuse
 * any further write. A person's lock means a row being written right now commits first and gets blanked here, or waits and is refused. Safe to repeat.
 * This also ends what lets them in: sessions, phones, sign-in links, push tokens. Their rows in areas that have moved go in sync.purge_person.
 */
export async function applyDeletion(d: Deletion): Promise<"applied" | "unchanged"> {
  return tx(async (c) => {
    await c.query(WRITER);
    await lockPerson(c, d.personId);
    const known = (await c.query(`select 1 from sync_deleted where kind = 'person' and id = $1`, [d.personId])).rows.length > 0;
    const person = (await c.query(`select family_id, deleted_at from people where id = $1`, [d.personId])).rows[0] as
      | { family_id: string; deleted_at: Date | null }
      | undefined;
    if (known && person?.deleted_at) return "unchanged";
    const canInsert = !person && !!d.role && (await c.query(`select 1 from families where id = $1`, [d.familyId])).rows.length > 0;
    if (known && !person && !canInsert) return "unchanged";

    const { rows: recipes } = await c.query(`select id from recipes where cook_id = $1 or id = any($2)`, [d.personId, d.recipeIds]);
    for (const recipe of recipes) await dropRecipe(c, recipe.id);
    await c.query(`delete from sync_recipe_seen where recipe_id = any($1)`, [[...recipes.map((recipe) => recipe.id), ...d.recipeIds]]);

    if (person) {
      await c.query(
        `update people set name = $3, relation = null, avatar_key = null, email = null, tz = null, share_cooking = null, memorial = false,
                language = null, voice_clone_consented_at = null, cartesia_voice_id = null, approx_lat = null, approx_lng = null, campus = null,
                deleted_at = coalesce(deleted_at, $2)
          where id = $1`,
        [d.personId, d.at, BLANK_NAME],
      );
      await c.query(`delete from sessions where person_id = $1`, [d.personId]);
      await c.query(`update devices set person_id = null, label = null, revoked_at = coalesce(revoked_at, now()) where person_id = $1`, [d.personId]);
      await c.query(`delete from identities where person_id = $1`, [d.personId]);
      await c.query(`delete from push_tokens where person_id = $1`, [d.personId]);
    } else if (canInsert) {
      // A tombstone only holds a place for rows pointing at it. If its old id is already taken, that's a duplicate to report, not a reason to fail.
      const { rowCount } = await c.query(
        `insert into people (id, family_id, supabase_id, name, role, deleted_at, created_at)
         values ($1, $2, $3, $4, $5, $6, coalesce($7, now())) on conflict do nothing`,
        [d.personId, d.familyId, d.supabaseId, BLANK_NAME, d.role, d.at, d.createdAt ?? null],
      );
      if (rowCount === 0) await noteIssue(c, "people", d.personId, "tombstone_not_written");
    }

    await c.query(
      `insert into sync_deleted (kind, id, supabase_id, deleted_at) values ('person', $1, $2, $3) on conflict (kind, id) do nothing`,
      [d.personId, d.supabaseId, d.at],
    );
    if (d.recipeIds.length > 0) {
      await c.query(
        `insert into sync_deleted (kind, id, deleted_at) select 'recipe', unnest($1::text[]), $2 on conflict (kind, id) do nothing`,
        [d.recipeIds, d.at],
      );
    }
    await clearIssues(c, "people", d.personId);
    if (person || canInsert) await blankFamilyIfEmpty(c, person?.family_id ?? d.familyId);
    if (!known) await enqueue(c, { queue: "scheduled", payload: { task: "sync.purge_person", personId: d.personId } });
    return "applied";
  });
}

/**
 * C2 once a family's last person has deleted. Before the first pass has finished, a family's other people may simply not have landed yet, so this waits for
 * the end of the people walk (blankEmptyFamilies). A family that gets a live person again takes its name back at the next pass.
 */
async function blankFamilyIfEmpty(c: Queryable, familyId: string): Promise<void> {
  const { rows } = await c.query(`select finished_at from sync_state where name = 'pass'`);
  if (!rows[0]?.finished_at) return;
  await lockFamily(c, familyId);
  await c.query(BLANK_EMPTY_FAMILIES + ` and f.id = $2`, [BLANK_NAME, familyId]);
}

const EMPTY_FAMILY = (id: string) => `(exists (select 1 from people p where p.family_id = ${id} and p.deleted_at is not null)
    and not exists (select 1 from people p where p.family_id = ${id} and p.deleted_at is null))`;

const BLANK_EMPTY_FAMILIES = `update families f set name = $1, public_name = null, code_hash = null, code_enc = null
  where f.name <> $1 and ${EMPTY_FAMILY("f.id")}`;

export async function blankEmptyFamilies(): Promise<void> {
  await tx(async (c) => {
    await c.query(WRITER);
    await c.query(BLANK_EMPTY_FAMILIES, [BLANK_NAME]);
  });
}

/** Of these, the families whose people have all deleted. */
export async function emptyFamilies(ids: string[]): Promise<Set<string>> {
  const { rows } = await db().query(
    `select f.id from unnest($1::text[]) f (id) where ${EMPTY_FAMILY("f.id")}`,
    [ids],
  );
  return new Set(rows.map((row) => row.id as string));
}

/** Copied family ids by their Supabase id. */
export async function familiesBySupabaseId(ids: string[]): Promise<Map<string, string>> {
  const { rows } = await db().query(`select id, supabase_id from families where supabase_id = any($1::text[])`, [ids]);
  return new Map(rows.map((row) => [row.supabase_id as string, row.id as string]));
}

// ---- Recipes gone at the source ----

export async function markSeen(ids: string[], passNo: number): Promise<void> {
  await db().query(
    `insert into sync_recipe_seen (recipe_id, pass_no) select unnest($1::text[]), $2
     on conflict (recipe_id) do update set pass_no = excluded.pass_no`,
    [ids, passNo],
  );
}

export async function unseenRecipes(passNo: number, limit: number): Promise<{ ids: string[]; total: number }> {
  const { rows } = await db().query(`select recipe_id from sync_recipe_seen where pass_no < $1 order by pass_no limit $2`, [passNo, limit]);
  const counted = await db().query(`select count(*)::int as n from sync_recipe_seen`);
  return { ids: rows.map((row) => row.recipe_id as string), total: counted.rows[0].n };
}

export async function dropUnseenRecipe(id: string): Promise<void> {
  await tx(async (c) => {
    await c.query(WRITER);
    // Same lock as anyone writing this recipe's cook, so it can't cross a stale write of the same row.
    const { rows } = await c.query(`select cook_id from recipes where id = $1`, [id]);
    if (rows[0]) {
      await lockPerson(c, rows[0].cook_id);
      await dropRecipe(c, id);
    }
    await c.query(`delete from sync_recipe_seen where recipe_id = $1`, [id]);
  });
}

// ---- Run state ----

export type State = {
  name: StateName;
  pass_no: number;
  at_table: Table | null;
  page_cursor: string | null;
  after_ms: number;
  started_at: Date | null;
  finished_at: Date | null;
  last_success_at: Date | null;
  alerted_at: Date | null;
};

const asState = (row: Record<string, unknown>): State => ({ ...row, pass_no: Number(row.pass_no) }) as State;

export async function readState(name: StateName): Promise<State> {
  const { rows } = await db().query(`select * from sync_state where name = $1`, [name]);
  return asState(rows[0]);
}

/** A lease id, or null when another task holds this run. A task that died leaves one that expires. */
export async function takeLease(name: StateName, seconds: number): Promise<string | null> {
  const id = randomUUID();
  const { rowCount } = await db().query(
    `update sync_state set lease_id = $2, lease_until = now() + make_interval(secs => $3)
      where name = $1 and (lease_until is null or lease_until < now())`,
    [name, id, seconds],
  );
  return rowCount === 1 ? id : null;
}

export async function releaseLease(name: StateName, lease: string): Promise<void> {
  await db().query(`update sync_state set lease_id = null, lease_until = null where name = $1 and lease_id = $2`, [name, lease]);
}

/** Moves a pass on. Null means the lease was lost to another task, which now owns the pass. */
export async function savePass(lease: string, seconds: number, changes: { at_table: Table | null; page_cursor: string | null; pass_no?: number; started?: boolean; finished?: boolean }): Promise<State | null> {
  const { rows } = await db().query(
    `update sync_state
        set at_table = $2, page_cursor = $3, pass_no = coalesce($4, pass_no),
            started_at = case when $5 then now() else started_at end,
            finished_at = case when $6 then now() else finished_at end,
            last_success_at = case when $6 then now() else last_success_at end,
            lease_until = now() + make_interval(secs => $7)
      where name = 'pass' and lease_id = $1
      returning *`,
    [lease, changes.at_table, changes.page_cursor, changes.pass_no ?? null, changes.started ?? false, changes.finished ?? false, seconds],
  );
  return rows[0] ? asState(rows[0]) : null;
}

export async function saveDeletions(lease: string, afterMs: number, succeeded: boolean): Promise<void> {
  await db().query(
    `update sync_state set after_ms = $2, last_success_at = case when $3 then now() else last_success_at end
      where name = 'deletions' and lease_id = $1`,
    [lease, afterMs, succeeded],
  );
}

export async function saveReport(lease: string, report: object): Promise<void> {
  await db().query(
    `update sync_state set last_report = $2, finished_at = now(), last_success_at = now() where name = 'reconcile' and lease_id = $1`,
    [lease, JSON.stringify(report)],
  );
}

/** True at most once in this many seconds, across tasks. */
export async function claimAlert(name: StateName, everyS: number): Promise<boolean> {
  const { rowCount } = await db().query(
    `update sync_state set alerted_at = now() where name = $1 and (alerted_at is null or alerted_at < now() - make_interval(secs => $2))`,
    [name, everyS],
  );
  return rowCount === 1;
}

/** Every copy that hasn't moved becomes read-only. Runs on any real run, so a copy can't hold real rows and still be writable. */
export async function lockCopies(): Promise<void> {
  await db().query(`update sync_copies set read_only = true where moved_at is null and not read_only`);
}

export async function movedTables(): Promise<Set<string>> {
  const { rows } = await db().query(`select table_name from sync_copies where moved_at is not null`);
  return new Set(rows.map((row) => row.table_name as string));
}

// ---- What the reconcile reads ----

/** Which columns differ from what the sources say, by name only. Read-only: it builds a row of the table's own types and never writes it. */
export async function compareRow(table: Table, row: Row): Promise<"missing" | string[]> {
  const columns = Object.keys(row).filter((column) => column !== "id");
  const { rows } = await db().query(
    `select t.id is null as missing,
            array_remove(array[${columns.map((column) => `case when t.${column} is distinct from e.${column} then '${column}' end`).join(", ")}], null) as columns
       from jsonb_populate_record(null::${table}, $1::jsonb) e
       left join ${table} t on t.id = e.id`,
    [JSON.stringify(row)],
  );
  return rows[0].missing ? "missing" : (rows[0].columns as string[]);
}

/** A deletion the copy should hold: its record there, the person blank or not there, and no recipe of theirs with anything in it. */
export async function deletionHolds(personId: string, recipeIds: string[]): Promise<boolean> {
  const { rows } = await db().query(
    `select exists (select 1 from sync_deleted where kind = 'person' and id = $1)
        and not exists (select 1 from people where id = $1 and deleted_at is null)
        and not exists (select 1 from recipes where (cook_id = $1 or id = any($2)) and title <> $3) as holds`,
    [personId, recipeIds, BLANK_NAME],
  );
  return rows[0].holds;
}

export async function isDeleted(kind: "person" | "recipe", id: string, supabaseId?: string): Promise<boolean> {
  const { rows } = await db().query(
    `select 1 from sync_deleted where (kind = $1 and id = $2) or ($1 = 'person' and supabase_id = $3) limit 1`,
    [kind, id, supabaseId ?? null],
  );
  return rows.length > 0;
}

export async function recipeCookDeleted(cookId: string): Promise<boolean> {
  return isDeleted("person", cookId);
}

/** Every id in a copy, a page at a time. */
export async function copyIds(table: Table): Promise<string[]> {
  const out: string[] = [];
  let after = "";
  for (;;) {
    const { rows } = await db().query(`select id from ${table} where id > $1 order by id limit 1000`, [after]);
    out.push(...rows.map((row) => row.id as string));
    if (rows.length < 1000) return out;
    after = rows[rows.length - 1].id;
  }
}

export async function heldCounts(): Promise<{ table_name: string; rule: string; n: number }[]> {
  const { rows } = await db().query(`select table_name, rule, count(*)::int as n from sync_issues group by 1, 2 order by 1, 2`);
  return rows;
}

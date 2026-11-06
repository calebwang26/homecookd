// Fakes for the sync's two sources, and a small made-up world. Nothing here reaches Convex or Supabase, and every name is invented.
import assert from "node:assert/strict";
import { db } from "../src/db.js";
import { runDeletions, runPass, type Reporter, type Run } from "../src/modules/sync/service.js";
import type {
  ConvexDeletion,
  ConvexFamily,
  ConvexPerson,
  ConvexRecipe,
  ConvexSource,
  Page,
  Rows,
  SupabaseFamily,
  SupabaseProfile,
  SupabaseSource,
  Table,
} from "../src/modules/sync/sources.js";

export const NAME = "Sunita Madeup";
export const EMAIL = "sunita@example.test";
export const CAMPUS = "Madeup Campus";
export const STORY = "Her madeup story about the mango tree";

const uuid = (n: number) => `${String(n).padStart(8, "0")}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`;

export class FakeConvex implements ConvexSource {
  families: ConvexFamily[] = [];
  people: ConvexPerson[] = [];
  recipes: ConvexRecipe[] = [];
  deletionRows: ConvexDeletion[] = [];
  pageSize = 100;
  pageCalls: { table: Table; cursor: string | null }[] = [];
  deletionCalls = 0;
  /** Runs after a page is read, before the sync applies it: what changes while a stale page is in flight. */
  afterRead: ((table: Table) => Promise<void>) | null = null;
  /** Throws instead of answering, on this page call (1 is the next). */
  failOnCall: number | null = null;
  expireCursors = false;

  async page<T extends Table>(table: T, cursor: string | null, limit: number): Promise<Page<Rows[T]>> {
    this.pageCalls.push({ table, cursor });
    if (this.failOnCall !== null) {
      this.failOnCall -= 1;
      if (this.failOnCall === 0) {
        this.failOnCall = null;
        throw Object.assign(new Error("convex down"), { name: "ConvexReadFailed" });
      }
    }
    const offset = cursor ? Number(cursor) : 0;
    const size = Math.min(limit, this.pageSize);
    const all = this[table] as Rows[T][];
    const rows = structuredClone(all.slice(offset, offset + size));
    const next = offset + size < all.length ? String(offset + size) : null;
    await this.afterRead?.(table);
    return { rows, next };
  }

  async deletions(afterMs: number, limit: number): Promise<ConvexDeletion[]> {
    this.deletionCalls += 1;
    return structuredClone(this.deletionRows.filter((row) => row.creationTime > afterMs).slice(0, limit));
  }
}

export class FakeSupabase implements SupabaseSource {
  familyRows = new Map<string, SupabaseFamily>();
  profileRows = new Map<string, SupabaseProfile>();
  askedProfiles: string[] = [];
  down = false;

  private check() {
    if (this.down) throw Object.assign(new Error("supabase down"), { name: "SupabaseReadFailed" });
  }
  async families(ids: string[]) {
    this.check();
    return ids.flatMap((id) => (this.familyRows.has(id) ? [structuredClone(this.familyRows.get(id)!)] : []));
  }
  async profiles(ids: string[]) {
    this.check();
    this.askedProfiles.push(...ids);
    return ids.flatMap((id) => (this.profileRows.has(id) ? [structuredClone(this.profileRows.get(id)!)] : []));
  }
  async familyIds(after: string | null, limit: number) {
    this.check();
    return [...this.familyRows.keys()].sort().filter((id) => !after || id > after).slice(0, limit);
  }
  async profileIds(after: string | null, limit: number) {
    this.check();
    return [...this.profileRows.keys()].sort().filter((id) => !after || id > after).slice(0, limit);
  }
}

export type Captured = Reporter & { lines: { fields: object; message: string }[]; alerts: { name: string; tags?: Record<string, string> }[]; text(): string };

export function capture(): Captured {
  const lines: Captured["lines"] = [];
  const alerts: Captured["alerts"] = [];
  const add = (fields: object, message: string) => void lines.push({ fields, message });
  return {
    lines,
    alerts,
    log: { info: add, error: add },
    alert: (name, tags) => void alerts.push({ name, tags }),
    text: () => JSON.stringify({ lines, alerts }),
  };
}

export function assertNoContent(text: string): void {
  for (const secret of [NAME, EMAIL, CAMPUS, STORY, "Madeup", "madeup", "@example", "19.07", "72.87"]) {
    assert.ok(!text.includes(secret), `the report holds family content: ${secret}`);
  }
}

/** A made-up family tree in both stores. */
export class World {
  convex = new FakeConvex();
  supabase = new FakeSupabase();
  report = capture();
  private next = 0;
  private time = Date.UTC(2026, 9, 1);

  private tick() {
    this.next += 1;
    this.time += 1000.5; // Convex's _creationTime has fractions
    return { n: this.next, time: this.time };
  }

  run(extra: Partial<Run> = {}): Run {
    return { convex: this.convex, supabase: this.supabase, report: this.report, passEveryMs: 0, ...extra };
  }

  family(name = `Family ${this.next + 1}`, options: { supabase?: boolean; publicName?: string } = {}): ConvexFamily {
    const { n, time } = this.tick();
    const row: ConvexFamily = {
      _id: `family_${n}`,
      _creationTime: time,
      name: `Convex's stale ${name}`,
      supabaseFamilyId: uuid(n),
      ...(options.publicName ? { publicName: options.publicName } : {}),
    };
    this.convex.families.push(row);
    if (options.supabase !== false) this.supabase.familyRows.set(row.supabaseFamilyId, { id: row.supabaseFamilyId, name });
    return row;
  }

  person(family: ConvexFamily, options: Partial<ConvexPerson> & { supabase?: Partial<SupabaseProfile> | false } = {}): ConvexPerson {
    const { n, time } = this.tick();
    const { supabase, ...fields } = options;
    const row: ConvexPerson = {
      _id: `person_${n}`,
      _creationTime: time,
      familyId: family._id,
      supabaseProfileId: uuid(n),
      name: `Convex name ${n}`,
      role: "cook",
      ...fields,
    };
    this.convex.people.push(row);
    if (supabase !== false) {
      this.supabase.profileRows.set(row.supabaseProfileId, {
        id: row.supabaseProfileId,
        family_id: family.supabaseFamilyId,
        name: `Person ${n}`,
        role: row.role === "kid" ? "learner" : "cook",
        relation: null,
        avatar_key: null,
        sort: 0,
        email: null,
        tz: null,
        share_cooking: null,
        memorial: false,
        removed_at: null,
        ...supabase,
      });
    }
    return row;
  }

  recipe(cook: ConvexPerson, options: Partial<ConvexRecipe> = {}): ConvexRecipe {
    const { n, time } = this.tick();
    const row: ConvexRecipe = {
      _id: `recipe_${n}`,
      _creationTime: time,
      familyId: cook.familyId,
      cookId: cook._id,
      title: `Dish ${n}`,
      status: "ready",
      steps: [{ order: 1, title: "Boil", text: "Boil it", moment: { startS: 0, endS: 1 } }],
      memories: [],
      memoriesOptIn: false,
      ...options,
    };
    this.convex.recipes.push(row);
    return row;
  }

  /** What deleteMe does at the source. */
  deleteAtSource(person: ConvexPerson, recipeIds: string[] = this.convex.recipes.filter((r) => r.cookId === person._id).map((r) => r._id)): ConvexDeletion {
    const { time } = this.tick();
    const row = this.convex.people.find((p) => p._id === person._id)!;
    const blank: ConvexPerson = {
      _id: row._id,
      _creationTime: row._creationTime,
      familyId: row.familyId,
      supabaseProfileId: row.supabaseProfileId,
      name: "Deleted",
      role: row.role,
      deletedAt: time,
    };
    this.convex.people[this.convex.people.indexOf(row)] = blank;
    this.convex.recipes = this.convex.recipes.filter((r) => r.cookId !== person._id);
    const deletion: ConvexDeletion = {
      id: `deletion_${time}`,
      creationTime: time,
      personId: person._id,
      familyId: person.familyId,
      supabaseProfileId: person.supabaseProfileId,
      requestedAt: time,
      recipeIds,
    };
    this.convex.deletionRows.push(deletion);
    return deletion;
  }

  /** The deletions run, then a whole pass. */
  async syncAll(extra: Partial<Run> = {}) {
    await runDeletions(this.run(extra));
    return this.passAll(extra);
  }

  async passAll(extra: Partial<Run> = {}) {
    for (let i = 0; i < 100; i += 1) {
      const result = await runPass(this.run(extra));
      if (result.state === "finished") return result;
      assert.equal(result.state, "running");
    }
    throw new Error("a pass never finished");
  }
}

export const person = async (id: string) => (await db().query("select * from people where id = $1", [id])).rows[0];
export const recipe = async (id: string) => (await db().query("select * from recipes where id = $1", [id])).rows[0];
export const familyRow = async (id: string) => (await db().query("select * from families where id = $1", [id])).rows[0];
export const count = async (table: string) => (await db().query(`select count(*)::int as n from ${table}`)).rows[0].n as number;
/** Each row's physical version: it changes on any write, even one that sets the same values. */
export const versions = async (table: string) =>
  (await db().query(`select id, xmin::text as v from ${table} order by id`)).rows.map((row) => `${row.id}:${row.v}`);
export const issues = async () => (await db().query("select table_name, row_id, rule from sync_issues order by 1, 2, 3")).rows;
export const stateOf = async (name: string) => (await db().query("select * from sync_state where name = $1", [name])).rows[0];

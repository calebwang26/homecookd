// The temporary sync's read-only routes (lib/syncRoutes.ts): the secret, paging to the end, what a deletion row gives away, and that nothing changes.
import { defineSchema } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { FAMILY_FIELDS, PERSON_FIELDS, RECIPE_FIELDS } from "./syncRead";
import { type Backend, modules, newBackend } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

const SECRET = "sync-secret-for-tests";
beforeEach(() => {
  process.env.SYNC_READ_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.SYNC_READ_SECRET;
});

const post = (t: Backend, path: string, body: object, secret: string | null = SECRET) =>
  t.fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret === null ? {} : { "x-sync-secret": secret }) },
    body: JSON.stringify(body),
  });

async function world(t: Backend) {
  return t.run(async (ctx) => {
    const familyId = await ctx.db.insert("families", { name: "The Testers", supabaseFamilyId: "11111111-1111-1111-1111-111111111111" });
    const cook: Id<"people"> = await ctx.db.insert("people", { familyId, supabaseProfileId: "22222222-2222-2222-2222-222222222222", name: "A Cook", role: "cook" });
    const people = [cook];
    for (let i = 0; i < 4; i++) {
      people.push(await ctx.db.insert("people", { familyId, supabaseProfileId: `seed:${i}`, name: `Kid ${i}`, role: "kid" }));
    }
    const recipeId = await ctx.db.insert("recipes", { familyId, cookId: cook, title: "Dal", status: "ready", steps: [], memories: [], memoriesOptIn: false });
    return { familyId, people, recipeId };
  });
}

test("the wrong secret, no secret and an unset secret are all refused", async () => {
  const t = newBackend();
  await world(t);
  const body = { table: "people", cursor: null, limit: 10 };
  expect((await post(t, "/sync/page", body, "wrong")).status).toBe(401);
  expect((await post(t, "/sync/page", body, null)).status).toBe(401);
  expect((await post(t, "/sync/deletions", { after: 0, limit: 10 }, "wrong")).status).toBe(401);
  // Another service's secret opens nothing here.
  process.env.WORKER_SECRET = "worker-secret";
  expect((await post(t, "/sync/page", body, "worker-secret")).status).toBe(401);
  delete process.env.SYNC_READ_SECRET;
  expect((await post(t, "/sync/page", body, SECRET)).status).toBe(401);
});

test("only the three copied tables can be read, within a page's limit", async () => {
  const t = newBackend();
  await world(t);
  for (const table of ["sessions", "accountDeletions", "dishAsks", "messages", "pushTokens"]) {
    expect((await post(t, "/sync/page", { table, cursor: null, limit: 10 })).status).toBe(400);
  }
  expect((await post(t, "/sync/page", { table: "people", cursor: null, limit: 1000 })).status).toBe(400);
  expect((await post(t, "/sync/page", { table: "recipes", cursor: null, limit: 26 })).status).toBe(400);
  expect((await post(t, "/sync/page", { table: "people", cursor: null, limit: 0 })).status).toBe(400);
  expect((await post(t, "/sync/page", { table: "people", cursor: 12, limit: 5 })).status).toBe(400);
});

test("pages walk a whole table oldest first, and say when it's over", async () => {
  const t = newBackend();
  const { people } = await world(t);
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res: Response = await post(t, "/sync/page", { table: "people", cursor, limit: 2 });
    expect(res.status).toBe(200);
    const page: { rows: { _id: string; _creationTime: number; supabaseProfileId: string }[]; next: string | null } = await res.json();
    seen.push(...page.rows.map((row) => row._id));
    for (const row of page.rows) expect(row._creationTime).toBeTypeOf("number");
    cursor = page.next;
    pages++;
  } while (cursor);
  expect(seen).toEqual(people);
  expect(pages).toBeGreaterThan(1);
  const families = await (await post(t, "/sync/page", { table: "families", cursor: null, limit: 10 })).json();
  expect(families.rows[0].supabaseFamilyId).toBe("11111111-1111-1111-1111-111111111111");
  expect(families.next).toBeNull();
  const recipes = await (await post(t, "/sync/page", { table: "recipes", cursor: null, limit: 10 })).json();
  expect(recipes.rows[0].title).toBe("Dal");
});

test("a field with no column in Postgres doesn't leave Convex", async () => {
  // The real schema refuses a field it doesn't list, so this stands in for one added to it later.
  const t = convexTest(defineSchema(schema.tables, { schemaValidation: false }), modules) as unknown as Backend;
  await t.run(async (ctx) => {
    const extra = { newField: "NO-COLUMN-FOR-THIS", nested: { deep: "NO-COLUMN-FOR-THIS" } };
    const familyId = await ctx.db.insert("families", { name: "The Testers", supabaseFamilyId: "seed:f", ...extra } as never);
    const cookId = await ctx.db.insert("people", { familyId, supabaseProfileId: "seed:p", name: "A Cook", role: "cook", campus: "A campus", ...extra } as never);
    await ctx.db.insert("recipes", { familyId, cookId, title: "Dal", status: "ready", steps: [], memories: [], memoriesOptIn: false, ...extra } as never);
  });
  for (const [table, kept] of [["families", "The Testers"], ["people", "A campus"], ["recipes", "Dal"]]) {
    const res = await post(t, "/sync/page", { table, cursor: null, limit: 10 });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(kept);
    expect(text).not.toContain("NO-COLUMN-FOR-THIS");
    expect(text).not.toContain("newField");
  }
});

test("a person's page holds exactly the named fields, and a tombstone only what's left of it", async () => {
  const t = newBackend();
  const { familyId } = await world(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("people", {
      familyId,
      supabaseProfileId: "seed:whole",
      name: "All fields",
      role: "kid",
      voiceClone: { consentedAt: 1, cartesiaVoiceId: "CARTESIA-VOICE-ID" },
      language: "mr",
      relation: "Aaji",
      approx: { lat: 1, lng: 2 },
      campus: "A campus",
    });
    await ctx.db.insert("people", { familyId, supabaseProfileId: "seed:gone", name: "Deleted", role: "kid", deletedAt: 5 });
  });
  const res = await post(t, "/sync/page", { table: "people", cursor: null, limit: 100 });
  const text = await res.text();
  expect(text).not.toContain("CARTESIA-VOICE-ID");
  expect(text).not.toContain("cartesiaVoiceId");
  const { rows } = JSON.parse(text);
  const whole = rows.find((row: { supabaseProfileId: string }) => row.supabaseProfileId === "seed:whole");
  expect(Object.keys(whole).sort()).toEqual(PERSON_FIELDS.filter((field) => field !== "deletedAt").sort());
  expect(whole.voiceClone).toEqual({ consentedAt: 1 }); // her yes, without the voice's id
  const gone = rows.find((row: { supabaseProfileId: string }) => row.supabaseProfileId === "seed:gone");
  expect(Object.keys(gone).sort()).toEqual(["_creationTime", "_id", "deletedAt", "familyId", "name", "role", "supabaseProfileId"]);
});

test("a field added to the schema has to be decided: copied or kept here", () => {
  const fieldsOf = (table: "families" | "people" | "recipes") => [...Object.keys(schema.tables[table].validator.fields), "_id", "_creationTime"].sort();
  expect([...FAMILY_FIELDS].sort()).toEqual(fieldsOf("families"));
  expect([...PERSON_FIELDS].sort()).toEqual(fieldsOf("people"));
  expect([...RECIPE_FIELDS].sort()).toEqual(fieldsOf("recipes"));
});

test("deletions come after a time, with ids only", async () => {
  const t = newBackend();
  const { familyId, people, recipeId } = await world(t);
  const first = await t.run((ctx) =>
    ctx.db.insert("accountDeletions", {
      familyId,
      personId: people[0],
      supabaseProfileId: "22222222-2222-2222-2222-222222222222",
      requestedAt: 1000,
      recipeIds: [recipeId],
      jobIds: [],
      uploadPaths: ["private-upload/clip.mp4"],
      mediaUrls: ["https://storage.googleapis.com/edible-media-x/a/poster.jpg"],
      voiceCloneId: "voice-secret-id",
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("accountDeletions", {
      familyId,
      personId: people[1],
      supabaseProfileId: "seed:0",
      requestedAt: 2000,
      recipeIds: [],
      jobIds: [],
      uploadPaths: [],
      mediaUrls: [],
    }),
  );
  const res = await post(t, "/sync/deletions", { after: 0, limit: 10 });
  expect(res.status).toBe(200);
  const text = await res.text();
  // What the sync doesn't need doesn't leave.
  expect(text).not.toContain("voice-secret-id");
  expect(text).not.toContain("clip.mp4");
  expect(text).not.toContain("poster.jpg");
  const { rows } = JSON.parse(text);
  expect(rows.map((row: { id: string }) => row.id)[0]).toBe(first);
  expect(rows[0]).toEqual({
    id: first,
    creationTime: rows[0].creationTime,
    personId: people[0],
    familyId,
    supabaseProfileId: "22222222-2222-2222-2222-222222222222",
    requestedAt: 1000,
    recipeIds: [recipeId],
  });
  const later = await (await post(t, "/sync/deletions", { after: rows[0].creationTime, limit: 10 })).json();
  expect(later.rows.map((row: { personId: string }) => row.personId)).toEqual([people[1]]);
  expect((await post(t, "/sync/deletions", { after: -1, limit: 10 })).status).toBe(400);
  expect((await post(t, "/sync/deletions", { after: 0, limit: 501 })).status).toBe(400);
});

test("a cursor Convex doesn't know says so, for the caller to start the table again", async () => {
  const t = newBackend();
  await world(t);
  const res = await post(t, "/sync/page", { table: "people", cursor: "not-a-real-cursor", limit: 2 });
  // convex-test may simply start over; the real backend refuses. Either way, nothing crashes and nothing is written.
  expect([200, 400]).toContain(res.status);
  if (res.status === 400) expect((await res.json()).error).toBe("bad_cursor");
});

test("reading changes nothing", async () => {
  const t = newBackend();
  const { familyId, people, recipeId } = await world(t);
  const before = await t.run(async (ctx) => [await ctx.db.get("families", familyId), await ctx.db.get("people", people[0]), await ctx.db.get("recipes", recipeId)]);
  await post(t, "/sync/page", { table: "families", cursor: null, limit: 10 });
  await post(t, "/sync/page", { table: "people", cursor: null, limit: 10 });
  await post(t, "/sync/page", { table: "recipes", cursor: null, limit: 10 });
  await post(t, "/sync/deletions", { after: 0, limit: 10 });
  const after = await t.run(async (ctx) => [await ctx.db.get("families", familyId), await ctx.db.get("people", people[0]), await ctx.db.get("recipes", recipeId)]);
  expect(after).toEqual(before);
});

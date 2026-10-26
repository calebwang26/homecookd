import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PURGE_BATCH } from "./account";
import { person, recipe, type Who, world } from "./community.helpers";
import { addRecipe, type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

// A stand-in for Moss that keeps each index's docs, so a test can check nothing of hers stays searchable.
const moss = vi.hoisted(() => ({ indexes: new Map<string, Map<string, { id: string }>>() }));
vi.mock("@moss-js/moss", () => ({
  MossClient: class {
    async getDocs(name: string) {
      const index = moss.indexes.get(name);
      if (!index) throw new Error("not found");
      return [...index.values()];
    }
    async createIndex(name: string, docs: { id: string }[]) {
      moss.indexes.set(name, new Map(docs.map((d) => [d.id, d])));
    }
    async addDocs(name: string, docs: { id: string }[]) {
      for (const d of docs) moss.indexes.get(name)!.set(d.id, d);
    }
    async deleteDocs(name: string, ids: string[]) {
      for (const id of ids) moss.indexes.get(name)!.delete(id);
    }
    async deleteIndex(name: string) {
      return moss.indexes.delete(name);
    }
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  moss.indexes.clear();
  process.env.MOSS_PROJECT_ID = "proj";
  process.env.MOSS_PROJECT_KEY = "key";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.MOSS_PROJECT_ID;
  delete process.env.MOSS_PROJECT_KEY;
});

const file = (t: Backend) => t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "audio/mp4" })));
const fileGone = (t: Backend, id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) === null);
const VIDEO = "https://storage.googleapis.com/edible-media/glasses-1/full.mp4";

/**
 * The Pawars: Grandma Rajani (a cook), Aai (another cook) and Shreya. Rajani has a shared recipe with
 * an upload job, one still processing, a glasses recording with everything homie and the glasses saved,
 * a dinner and a voice answer on Aai's dish. The Zhangs (Mei and Serene) live nearby and ask to swap.
 */
async function kitchen() {
  const w = await world();
  const { t, rajani, shreya, serene, serenesMom } = w;
  const aai = await person(t, rajani.familyId, "Aai", "cook");
  const poha = await recipe(t, rajani, { sharedAt: Date.now() });
  const upma = await recipe(t, rajani, { title: "Upma", status: "processing", steps: [] });
  const thalipeeth = await recipe(t, aai, { title: "Thalipeeth" });
  const mooncakes = await recipe(t, serenesMom, { title: "Mooncakes", sharedAt: Date.now() });
  const files = { voiceNote: await file(t), answer: await file(t), aaiAnswer: await file(t), frame: await file(t), cover: await file(t) };

  const ids = await t.run(async (ctx) => {
    const f = rajani.familyId;
    const job = (recipeId: Id<"recipes">, uploadPath: string) =>
      ctx.db.insert("jobs", { familyId: f, cookId: rajani.personId, recipeId, uploadPath, source: "phone", stage: "done", progress: 1 });
    const jobs = [await job(poha, "up-poha/"), await job(upma, "up-upma/")];
    const recordingId = await ctx.db.insert("recordings", {
      familyId: f, cookId: rajani.personId, language: "mr", source: "glasses", status: "ended",
      startedAt: 1, videoUrl: VIDEO, coverStorageId: files.cover, updatedAt: 1,
    });
    const r = { recordingId, familyId: f };
    const live = { ...r, sessionId: "g1", sessionStartedAt: 1 };
    await ctx.db.insert("homiePrompts", { ...r, kind: "amount", text: "किती?", textEn: "How much?", atS: 5, status: "answered" });
    for (let i = 0; i < PURGE_BATCH + 700; i++) {
      await ctx.db.insert("liveEvents", { ...live, kind: "step", atS: i, title: "Stir", text: "She stirs.", confidence: 0.9 });
    }
    await ctx.db.insert("liveWindows", { ...live, startS: 0, endS: 30, ok: true });
    await ctx.db.insert("liveFrames", { recordingId, storageId: files.frame, at: 1 });

    await ctx.db.insert("messages", { familyId: f, from: rajani.personId, kind: "text", text: "Come home soon", aiDrafted: false });
    await ctx.db.insert("messages", { familyId: f, from: shreya.personId, to: rajani.personId, kind: "voice", fileId: files.voiceNote, aiDrafted: false });
    const answered = (recipeId: Id<"recipes">, audioId: Id<"_storage">) =>
      ctx.db.insert("questions", {
        familyId: f, recipeId, askedBy: shreya.personId, text: "How long?", status: "answered",
        answer: { by: rajani.personId, audioId, transcript: "दोन मिनिटं" },
      });
    const pohaQuestion = await answered(poha, files.answer);
    const aaiQuestion = await answered(thalipeeth, files.aaiAnswer);
    await ctx.db.insert("cookingSessions", { familyId: f, recipeId: poha, kidId: shreya.personId, stepOrder: 2, updatedAt: 1 });

    const dinner = await ctx.db.insert("dinners", {
      hostId: rajani.personId, hostFamilyId: f, recipeId: poha, dish: "Kanda Poha", startsAt: Date.now() + 86_400_000,
      placeKind: "home", placeName: "Pawar kitchen", address: "12 Elm St", approx: { lat: 42.36, lng: -71.09 }, seats: 4, status: "open",
    });
    await ctx.db.insert("dinnerRequests", { dinnerId: dinner, guestId: serene.personId, guestFamilyId: serene.familyId, status: "pending" });
    await ctx.db.insert("dinnerInviteOpens", { dinnerId: dinner, deviceId: "phone-1" });
    await ctx.db.insert("swapRequests", {
      requesterId: serene.personId, requesterFamilyId: serene.familyId, theirRecipeId: poha, myRecipeId: mooncakes,
      otherFamilyId: f, status: "pending",
    });
    await ctx.db.insert("messages", { familyId: serene.familyId, from: serenesMom.personId, kind: "text", text: "Dumplings Sunday", aiDrafted: false });
    await ctx.db.insert("questions", { familyId: serene.familyId, recipeId: mooncakes, askedBy: serene.personId, text: "Which flour?", status: "asked_cook" });
    await ctx.db.patch("people", rajani.personId, { language: "mr", relation: "Aaji", approx: { lat: 42.36, lng: -71.09 }, campus: "MIT" });
    return { jobs, recordingId, dinner, pohaQuestion, aaiQuestion };
  });
  return { ...w, aai, poha, upma, thalipeeth, mooncakes, files, ...ids };
}

/** What's left of a family, table by table. */
const familyCounts = (t: Backend, who: Who) =>
  t.run(async (ctx) => {
    const familyId = who.familyId;
    const count = async (rows: AsyncIterable<unknown>) => {
      let n = 0;
      for await (const _ of rows) n++;
      return n;
    };
    return {
      recipes: await count(ctx.db.query("recipes").withIndex("by_familyId", (q) => q.eq("familyId", familyId))),
      messages: await count(ctx.db.query("messages").withIndex("by_familyId", (q) => q.eq("familyId", familyId))),
      questions: await count(ctx.db.query("questions").withIndex("by_familyId_and_status", (q) => q.eq("familyId", familyId))),
      people: await count(ctx.db.query("people").withIndex("by_familyId", (q) => q.eq("familyId", familyId))),
    };
  });

test("a kid deleting takes only what's theirs", async () => {
  const k = await kitchen();
  const { t, rajani, shreya } = k;
  await t.mutation(api.account.deleteMe, { sessionToken: shreya.sessionToken });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const me = await t.run((ctx) => ctx.db.get("people", shreya.personId));
  expect(me).toMatchObject({ name: "Deleted", role: "kid", supabaseProfileId: "test:Shreya" });
  expect(me?.deletedAt).toBeTypeOf("number");
  const [deletion] = await t.run((ctx) => ctx.db.query("accountDeletions").collect());
  expect(deletion).toMatchObject({ personId: shreya.personId, supabaseProfileId: "test:Shreya", recipeIds: [], uploadPaths: [] });
  expect(deletion.purgedAt).toBeTypeOf("number");

  // Her voice note, her questions (with the answers on them) and her cooking are gone.
  const messages = await t.query(api.messages.list, { sessionToken: rajani.sessionToken });
  expect(messages.map((m) => m.text)).toEqual(["Come home soon"]);
  expect(await fileGone(t, k.files.voiceNote)).toBe(true);
  expect(await t.run((ctx) => ctx.db.get("questions", k.pohaQuestion))).toBeNull();
  expect(await fileGone(t, k.files.answer)).toBe(true);
  expect(await t.query(api.cooking.current, { sessionToken: rajani.sessionToken })).toEqual([]);

  // Grandma's recipes, recording and dinner stay.
  const recipes = await t.query(api.recipes.list, { sessionToken: rajani.sessionToken });
  expect(recipes.map((r) => r.title).sort()).toEqual(["Kanda Poha", "Thalipeeth", "Upma"]);
  expect(await t.run((ctx) => ctx.db.get("recordings", k.recordingId))).not.toBeNull();
  expect(await t.run((ctx) => ctx.db.get("dinners", k.dinner))).not.toBeNull();
});

test("a cook deleting takes her recipes from the family and Community, and everything made with them", async () => {
  const k = await kitchen();
  const { t, rajani, shreya, serene } = k;
  const index = `family-${rajani.familyId}`;
  moss.indexes.set(index, new Map([`${k.poha}:step:1`, `${k.poha}:story:0`, `${k.thalipeeth}:step:1`].map((id) => [id, { id }])));

  await t.mutation(api.account.deleteMe, { sessionToken: rajani.sessionToken });
  // At once: her recipes are gone for everyone, and from the map.
  const left = await t.query(api.recipes.list, { sessionToken: shreya.sessionToken });
  expect(left.map((r) => r.title)).toEqual(["Thalipeeth"]);
  const feed = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(feed.recipes.map((r) => r.dish)).toEqual(["Mooncakes"]); // only the Zhangs' own
  expect(feed.dinners).toEqual([]);

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const me = await t.run((ctx) => ctx.db.get("people", rajani.personId));
  expect(me).toEqual({ _id: rajani.personId, _creationTime: me!._creationTime, familyId: rajani.familyId, supabaseProfileId: "test:Rajani", name: "Deleted", role: "cook", deletedAt: me!.deletedAt });

  const [deletion] = await t.run((ctx) => ctx.db.query("accountDeletions").collect());
  expect(deletion.recipeIds.sort()).toEqual([k.poha, k.upma].sort());
  expect(deletion.jobIds.sort()).toEqual([...k.jobs].sort());
  expect(deletion.uploadPaths.sort()).toEqual(["up-poha/", "up-upma/"]);
  expect(deletion.mediaUrls.sort()).toEqual(
    [VIDEO, "https://storage.googleapis.com/edible-recipes/poha/poster.jpg", "https://storage.googleapis.com/edible-recipes/poha/recipe.json"].sort(),
  );
  expect(deletion.purgedAt).toBeTypeOf("number");

  const rows = await t.run(async (ctx) => ({
    jobs: await ctx.db.query("jobs").collect(),
    recordings: await ctx.db.query("recordings").collect(),
    homiePrompts: await ctx.db.query("homiePrompts").collect(),
    liveEvents: await ctx.db.query("liveEvents").collect(),
    liveWindows: await ctx.db.query("liveWindows").collect(),
    liveFrames: await ctx.db.query("liveFrames").collect(),
    dinners: await ctx.db.query("dinners").collect(),
    dinnerRequests: await ctx.db.query("dinnerRequests").collect(),
    dinnerInviteOpens: await ctx.db.query("dinnerInviteOpens").collect(),
    swapRequests: await ctx.db.query("swapRequests").collect(),
    cookingSessions: await ctx.db.query("cookingSessions").collect(),
    sessions: await ctx.db.query("sessions").withIndex("by_personId", (q) => q.eq("personId", rajani.personId)).collect(),
  }));
  for (const [table, found] of Object.entries(rows)) expect(found, table).toEqual([]);
  for (const id of [k.files.answer, k.files.frame, k.files.cover]) expect(await fileGone(t, id)).toBe(true);

  // Her message goes; Shreya's voice note to her stays (it's Shreya's).
  expect((await t.query(api.messages.list, { sessionToken: shreya.sessionToken })).map((m) => m.kind)).toEqual(["voice"]);
  // Her voice answer on Aai's dish comes off it, so Aai sees the question again.
  expect(await t.run((ctx) => ctx.db.get("questions", k.pohaQuestion))).toBeNull();
  const aaiQuestion = await t.run((ctx) => ctx.db.get("questions", k.aaiQuestion));
  expect(aaiQuestion).toMatchObject({ status: "asked_cook", text: "How long?" });
  expect(aaiQuestion?.answer).toBeUndefined();
  expect(await fileGone(t, k.files.aaiAnswer)).toBe(true);
  expect((await t.query(api.questions.openForCook, { sessionToken: k.aai.sessionToken })).map((q) => q._id)).toEqual([k.aaiQuestion]);

  // Nothing of hers stays searchable; Aai's dish does.
  expect([...moss.indexes.get(index)!.keys()].every((id) => id.startsWith(k.thalipeeth))).toBe(true);
});

test("another family is untouched", async () => {
  const k = await kitchen();
  const { t, rajani, serene, serenesMom } = k;
  const before = await familyCounts(t, serene);
  await t.mutation(api.account.deleteMe, { sessionToken: rajani.sessionToken });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await familyCounts(t, serene)).toEqual(before);
  const mei = await t.run((ctx) => ctx.db.get("people", serenesMom.personId));
  expect(mei?.name).toBe("Mei");
  expect((await t.query(api.recipes.list, { sessionToken: serene.sessionToken })).map((r) => r.title)).toEqual(["Mooncakes"]);
  const feed = await t.query(api.community.feed, { sessionToken: serene.sessionToken, now: Date.now() });
  expect(feed.recipes.map((r) => r.dish)).toEqual(["Mooncakes"]);
  // Their swap ask was for her recipe, so it went with it.
  expect(await t.query(api.community.mySwaps, { sessionToken: serene.sessionToken })).toEqual([]);
});

test("a deleted person's session stops working, and they can't sign back in as themselves", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const dadAgain = await signIn(t, "p-dad"); // a second phone
  const leo = await signIn(t, "p-leo");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const index = `family-${dad.familyId}`;
  moss.indexes.set(index, new Map([[`${recipeId}:step:1`, { id: `${recipeId}:step:1` }]]));

  await t.mutation(api.account.deleteMe, { sessionToken: dad.sessionToken });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  for (const s of [dad, dadAgain]) {
    await expect(t.query(api.people.me, { sessionToken: s.sessionToken })).rejects.toThrow("signed out");
    await expect(t.mutation(api.account.deleteMe, { sessionToken: s.sessionToken })).rejects.toThrow("signed out");
    expect(await t.query(internal.sessions.resolve, { sessionToken: s.sessionToken })).toBeNull();
  }
  // Supabase still lists him (its removal hasn't happened yet): Convex refuses all the same.
  await expect(signIn(t, "p-dad")).rejects.toThrow("This account was deleted.");
  // Someone else signing in doesn't bring him back.
  const leo2 = await signIn(t, "p-leo");
  expect((await t.run((ctx) => ctx.db.get("people", dad.personId)))?.name).toBe("Deleted");
  expect((await t.query(api.people.family, { sessionToken: leo2.sessionToken })).map((p) => p.name).sort()).toEqual(["Amy", "Leo", "Mom"]);
  expect(await t.query(api.recipes.list, { sessionToken: leo.sessionToken })).toEqual([]);
  // His was the family's only recipe: the whole index goes.
  expect(moss.indexes.has(index)).toBe(false);
});

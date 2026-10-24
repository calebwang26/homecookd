// "Who is it for?" with several kids (lib/forKids.ts): live.startRecording and jobs.create take
// `forKidIds` next to the older `forKidId`, the voice service and the worker see every name, and the
// cook's Home card "Leo made your Poha" (messages.madeMyDish), and people.family (the app's id map).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { addRecipe, type Backend, FAMILY, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

beforeEach(() => {
  vi.useFakeTimers();
  process.env.WORKER_SECRET = "worker-secret-for-tests";
  process.env.VOICE_SECRET = "voice-secret-for-tests";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const post = (t: Backend, path: string, body: unknown, secret: Record<string, string>) =>
  t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...secret }, body: JSON.stringify(body) });
const asWorker = { "x-worker-secret": "worker-secret-for-tests" };
const asVoice = { "x-voice-secret": "voice-secret-for-tests" };

const TWO_KIDS = { ...FAMILY, profiles: [...FAMILY.profiles, { id: "p-zoe", name: "Zoe", role: "learner" }] };

async function family() {
  stubFetch(TWO_KIDS);
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  const zoe = await signIn(t, "p-zoe");
  return { t, dad, leo, zoe };
}

type Kids = { forKidId?: Id<"people">; forKidIds?: Id<"people">[] };
const row = (t: Backend, id: Id<"recordings">) => t.run((ctx) => ctx.db.get("recordings", id));

test("a recording for two kids keeps both, and the old single kid still works", async () => {
  const { t, dad, leo, zoe } = await family();
  const start = (args: Kids) => t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", ...args });

  const both = await start({ forKidIds: [leo.personId, zoe.personId, leo.personId] });
  expect(await row(t, both.recordingId)).toMatchObject({ forKidIds: [leo.personId, zoe.personId] });
  expect((await row(t, both.recordingId))?.forKidId).toBeUndefined();

  const one = await start({ forKidIds: [zoe.personId] });
  expect(await row(t, one.recordingId)).toMatchObject({ forKidId: zoe.personId, forKidIds: [zoe.personId] });
  const old = await start({ forKidId: leo.personId });
  expect(await row(t, old.recordingId)).toMatchObject({ forKidId: leo.personId, forKidIds: [leo.personId] });
  const nobody = await start({ forKidIds: [] });
  expect(await row(t, nobody.recordingId)).not.toHaveProperty("forKidIds");

  // Every id must be a kid in her family: a cook, or another family's kid, refuses the whole call.
  await expect(start({ forKidIds: [leo.personId, dad.personId] })).rejects.toThrow("isn't in this family");
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "learner" }] });
  const sam = await signIn(t, "q-1");
  await expect(start({ forKidIds: [zoe.personId, sam.personId] })).rejects.toThrow("isn't in this family");
});

test("the voice service names one kid, and lists several", async () => {
  const { t, dad, leo, zoe } = await family();
  const view = async (forKidIds: Id<"people">[]) => {
    const { recordingId } = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", forKidIds });
    return await (await post(t, "/live/session", { sessionToken: dad.sessionToken, recordingId }, asVoice)).json();
  };
  const two = await view([leo.personId, zoe.personId]);
  expect(two.kids).toEqual([{ name: "Leo" }, { name: "Zoe" }]);
  expect(two.kid).toBeUndefined(); // homie says "your family", never just one of them
  expect(await view([zoe.personId])).toMatchObject({ kid: { name: "Zoe" }, kids: [{ name: "Zoe" }] });
  expect(await view([])).toMatchObject({ kids: [] });

  // A row from before forKidIds (only forKidId) reads the same.
  const recordingId = await t.run((ctx) =>
    ctx.db.insert("recordings", { familyId: dad.familyId, cookId: dad.personId, forKidId: leo.personId, language: "en", source: "phone", status: "intro", updatedAt: 0 }),
  );
  expect(await (await post(t, "/live/session", { sessionToken: dad.sessionToken, recordingId }, asVoice)).json()).toMatchObject({
    kid: { name: "Leo" },
    kids: [{ name: "Leo" }],
  });
});

test("a job takes the kids from Send, else from homie's recording, and the worker sees every name", async () => {
  const { t, dad, leo, zoe } = await family();
  const create = (args: Kids & { recordingId?: Id<"recordings"> }) =>
    t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "u/a.mp4", source: "phone", ...args });
  const claim = async () => (await post(t, "/worker/claim", {}, asWorker)).json();

  await expect(create({ forKidIds: [leo.personId, dad.personId] })).rejects.toThrow("isn't in your family");

  const { recordingId } = await t.mutation(api.live.startRecording, {
    sessionToken: dad.sessionToken,
    source: "phone",
    forKidIds: [leo.personId, zoe.personId],
  });
  const fromRecording = await create({ recordingId });
  expect(await t.run((ctx) => ctx.db.get("jobs", fromRecording.jobId))).toMatchObject({ forKidIds: [leo.personId, zoe.personId] });
  const first = await claim();
  expect(first).toMatchObject({ jobId: fromRecording.jobId, forKidNames: ["Leo", "Zoe"] });
  expect(first.forKidName).toBeUndefined();

  // Send's pick beats the recording's.
  const picked = await create({ recordingId, forKidIds: [zoe.personId] });
  expect(await claim()).toMatchObject({ jobId: picked.jobId, forKidName: "Zoe", forKidNames: ["Zoe"] });

  // The older single field still works, and a job from before forKidIds reads the same.
  const old = await create({ forKidId: leo.personId });
  expect(await claim()).toMatchObject({ jobId: old.jobId, forKidName: "Leo", forKidNames: ["Leo"] });
  const none = await create({});
  expect(await claim()).toMatchObject({ jobId: none.jobId, forKidNames: [] });
});

test("madeMyDish: the newest photo of one of my dishes, from someone else, in the last two weeks", async () => {
  const { t, dad, leo, zoe } = await family();
  const made = () => t.query(api.messages.madeMyDish, { sessionToken: dad.sessionToken });
  expect(await made()).toBeNull();

  const chili = await addRecipe(t, dad.familyId, dad.personId);
  const zoesDish = await t.run((ctx) =>
    ctx.db.insert("recipes", { familyId: dad.familyId, cookId: zoe.personId, title: "Zoe's Toast", status: "ready", steps: [], memories: [], memoriesOptIn: false }),
  );
  const photo = () => t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type: "image/jpeg" })));
  const send = async (who: { sessionToken: string }, recipeId: Id<"recipes">, text?: string) =>
    t.mutation(api.messages.send, { sessionToken: who.sessionToken, kind: "photo", fileId: await photo(), recipeId, to: dad.personId, text });

  // A photo of someone else's dish, or my own photo, isn't mine to see here.
  await send(leo, zoesDish);
  await send(dad, chili);
  expect(await made()).toBeNull();

  await send(leo, chili, "Tasted like home.");
  expect(await made()).toMatchObject({ fromName: "Leo", recipeTitle: "Sunday Chili", text: "Tasted like home." });
  expect((await made())?.photoUrl).toMatch(/^https?:/);
  vi.advanceTimersByTime(60_000);
  await send(zoe, chili);
  expect(await made()).toMatchObject({ fromName: "Zoe" });
  // Leo only sees what was sent to him, not Dad's card.
  expect(await t.query(api.messages.madeMyDish, { sessionToken: leo.sessionToken })).toBeNull();

  vi.advanceTimersByTime(15 * 24 * 3600 * 1000);
  expect(await made()).toBeNull();
});

test("people.family maps the family's profile ids to Convex ids, and only my family's", async () => {
  const { t, dad, leo, zoe } = await family();
  const people = await t.query(api.people.family, { sessionToken: dad.sessionToken });
  expect(people).toEqual(
    expect.arrayContaining([
      { personId: dad.personId, supabaseProfileId: "p-dad", name: "Dad", role: "cook" },
      { personId: leo.personId, supabaseProfileId: "p-leo", name: "Leo", role: "kid" },
      { personId: zoe.personId, supabaseProfileId: "p-zoe", name: "Zoe", role: "kid" },
    ]),
  );
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "learner" }] });
  const sam = await signIn(t, "q-1");
  expect((await t.query(api.people.family, { sessionToken: sam.sessionToken })).map((p) => p.name)).toEqual(["Sam"]);
});

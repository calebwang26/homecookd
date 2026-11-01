// Upload ownership (docs/build/UPLOAD-OWNERSHIP.md): the first person to use a fresh file owns it. Everyone else's
// attempts are refused, whichever function they come through, and nobody can get someone else's file deleted.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CLAIM_WINDOW_MS } from "./lib/fileOwner";
import { addRecipe, type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T16:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.MUSE_API_KEY;
});

const upload = (t: Backend, type = "image/jpeg") =>
  t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(64)], { type })));
const fileGone = (t: Backend, id: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", id)) === null);
const claims = (t: Backend) => t.run((ctx) => ctx.db.query("fileClaims").collect());
const settle = (t: Backend) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function world() {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  stubFetch({ family: { id: "fam-2", name: "The Zhangs" }, profiles: [{ id: "p-mei", name: "Mei", role: "cook" }] });
  const mei = await signIn(t, "p-mei");
  return { t, dad, leo, mei };
}
type Person = Awaited<ReturnType<typeof world>>["mei"];

const sendPhoto = (t: Backend, who: Person, fileId: Id<"_storage">) =>
  t.mutation(api.messages.send, { sessionToken: who.sessionToken, kind: "photo", fileId });

async function askCook(t: Backend, dad: Person, leo: Person) {
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  return await t.run((ctx) =>
    ctx.db.insert("questions", {
      familyId: dad.familyId as never,
      recipeId,
      askedBy: leo.personId as never,
      text: "How long?",
      status: "asked_cook",
    }),
  );
}

async function recording(t: Backend, cook: Person) {
  const { recordingId } = await t.mutation(api.live.startRecording, { sessionToken: cook.sessionToken, source: "phone" });
  return recordingId;
}

test("messages.send: the first person owns a fresh file, and can send it again; nobody else can attach it", async () => {
  const { t, dad, leo, mei } = await world();
  const fileId = await upload(t);
  await sendPhoto(t, leo, fileId);
  expect(await claims(t)).toMatchObject([{ storageId: fileId, personId: leo.personId }]);

  await expect(sendPhoto(t, mei, fileId)).rejects.toThrow("Upload it before sending it.");
  await expect(sendPhoto(t, dad, fileId)).rejects.toThrow("Upload it before sending it.");
  await sendPhoto(t, leo, fileId); // a retry, days later, still works
  vi.advanceTimersByTime(3 * CLAIM_WINDOW_MS);
  await sendPhoto(t, leo, fileId);
  expect(await claims(t)).toHaveLength(1);
  expect(await fileGone(t, fileId)).toBe(false);
});

test("a file nobody claimed in its first day can't be attached: it may be on a row from before claims", async () => {
  const { t, leo } = await world();
  const inTime = await upload(t);
  const old = await upload(t);
  vi.advanceTimersByTime(CLAIM_WINDOW_MS - 1000);
  await sendPhoto(t, leo, inTime);
  vi.advanceTimersByTime(2000);
  await expect(sendPhoto(t, leo, old)).rejects.toThrow("Upload it before sending it.");
  expect(await fileGone(t, old)).toBe(false);
});

test("a refused send claims nothing", async () => {
  const { t, leo, mei } = await world();
  const fileId = await upload(t);
  await expect(
    t.mutation(api.messages.send, { sessionToken: leo.sessionToken, kind: "photo", fileId, to: mei.personId as never }),
  ).rejects.toThrow("aren't in this family");
  expect(await claims(t)).toEqual([]);
  await sendPhoto(t, mei, fileId);
});

test("questions.answer: someone else's file is refused and the question still waits", async () => {
  const { t, dad, leo } = await world();
  const questionId = await askCook(t, dad, leo);
  const hers = await upload(t, "audio/mp4");
  await sendPhoto(t, leo, hers);
  await expect(
    t.mutation(api.questions.answer, { sessionToken: dad.sessionToken, questionId, audioId: hers }),
  ).rejects.toThrow("Upload the voice note before sending it.");
  expect(await t.run((ctx) => ctx.db.get("questions", questionId))).toMatchObject({ status: "asked_cook" });

  const own = await upload(t, "audio/mp4");
  await t.mutation(api.questions.answer, { sessionToken: dad.sessionToken, questionId, audioId: own });
  expect(await claims(t)).toContainEqual(expect.objectContaining({ storageId: own, personId: dad.personId }));
});

test("live.setCover: someone else's file or a non-image is refused, and a retry of her own is fine", async () => {
  const { t, dad, leo } = await world();
  const recordingId = await recording(t, dad);
  const s = { sessionToken: dad.sessionToken, recordingId };
  const leos = await upload(t);
  await sendPhoto(t, leo, leos);
  expect(await t.mutation(api.live.setCover, { ...s, storageId: leos })).toEqual({ ok: false });
  expect(await t.mutation(api.live.setCover, { ...s, storageId: await upload(t, "audio/mp4") })).toEqual({ ok: false });
  expect((await t.run((ctx) => ctx.db.get("recordings", recordingId)))?.coverStorageId).toBeUndefined();

  const own = await upload(t);
  expect(await t.mutation(api.live.setCover, { ...s, storageId: own })).toEqual({ ok: true });
  expect(await t.mutation(api.live.setCover, { ...s, storageId: own })).toEqual({ ok: true });
  expect(await fileGone(t, own)).toBe(false);
});

test("live.setCover: replacing a cover deletes her old file, but never someone else's a row pointed at before claims", async () => {
  const { t, dad, leo } = await world();
  const recordingId = await recording(t, dad);
  const s = { sessionToken: dad.sessionToken, recordingId };
  const first = await upload(t);
  const second = await upload(t);
  await t.mutation(api.live.setCover, { ...s, storageId: first });
  await t.mutation(api.live.setCover, { ...s, storageId: second });
  expect(await fileGone(t, first)).toBe(true);
  expect((await claims(t)).map((c) => c.storageId)).toEqual([second]);

  const leos = await upload(t);
  await sendPhoto(t, leo, leos);
  await t.run((ctx) => ctx.db.patch("recordings", recordingId, { coverStorageId: leos }));
  await t.mutation(api.live.setCover, { ...s, storageId: await upload(t) });
  expect(await fileGone(t, leos)).toBe(false);
});

test("messages.sharePhoto: a model never sees someone else's file, and a draft stays hers past the window", async () => {
  const { t, dad, leo, mei } = await world();
  process.env.MUSE_API_KEY = "muse-key";
  const muse = vi.fn((url: string) =>
    url.includes("api.meta.ai") ? Response.json({ choices: [{ message: { content: "Made it!" } }] }) : undefined,
  );
  stubFetch({}, muse);
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const s = { sessionToken: leo.sessionToken, recipeId };

  const meis = await upload(t);
  await sendPhoto(t, mei, meis);
  await expect(t.action(api.messages.sharePhoto, { ...s, fileId: meis })).rejects.toThrow("Upload the photo before sharing it.");
  const old = await upload(t);
  vi.advanceTimersByTime(CLAIM_WINDOW_MS + 1000);
  await expect(t.action(api.messages.sharePhoto, { ...s, fileId: old })).rejects.toThrow("Upload the photo before sharing it.");
  expect(muse).not.toHaveBeenCalled();

  const own = await upload(t);
  expect((await t.action(api.messages.sharePhoto, { ...s, fileId: own })).draft).toBe("Made it!");
  vi.advanceTimersByTime(3 * CLAIM_WINDOW_MS); // she came back to the note days later
  await sendPhoto(t, leo, own);
});

test("files on a card or a recording can't be attached, even fresh", async () => {
  const { t, dad, leo } = await world();
  const recordingId = await recording(t, dad);
  const frame = await upload(t);
  const dishFile = await upload(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("liveFrames", { recordingId, storageId: frame, at: Date.now() });
    await ctx.db.insert("dishFiles", {
      fileIdHash: "x".repeat(64), storageId: dishFile, kind: "photo", contentType: "image/jpeg", size: 64, ipKey: "k", createdAt: Date.now(),
    });
  });
  for (const fileId of [frame, dishFile]) {
    await expect(sendPhoto(t, leo, fileId)).rejects.toThrow("Upload it before sending it.");
    expect(await t.mutation(api.live.setCover, { sessionToken: dad.sessionToken, recordingId, storageId: fileId })).toEqual({ ok: false });
    expect(await fileGone(t, fileId)).toBe(false);
  }
  expect(await claims(t)).toEqual([]);
});

test("deleting an account takes their files and claims, and leaves a file of someone else's their row pointed at", async () => {
  const { t, dad, leo } = await world();
  const leos = await upload(t);
  await sendPhoto(t, leo, leos);
  const dads = await upload(t);
  await sendPhoto(t, dad, dads);
  const draft = await upload(t);
  await sendPhoto(t, dad, draft);
  // A message from before claims, pointing at Leo's file.
  await t.run((ctx) =>
    ctx.db.insert("messages", { familyId: dad.familyId as never, from: dad.personId as never, kind: "photo", fileId: leos, aiDrafted: false }),
  );
  // A claim with nothing holding it any more: a photo drafted, never sent.
  const orphan = await upload(t);
  await t.run((ctx) => ctx.db.insert("fileClaims", { storageId: orphan, personId: dad.personId as never }));

  await t.mutation(api.account.deleteMe, { sessionToken: dad.sessionToken });
  await settle(t);
  expect(await fileGone(t, dads)).toBe(true);
  expect(await fileGone(t, draft)).toBe(true);
  expect(await fileGone(t, orphan)).toBe(true);
  expect(await fileGone(t, leos)).toBe(false);
  expect(await claims(t)).toMatchObject([{ storageId: leos, personId: leo.personId }]);
});

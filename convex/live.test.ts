// homie while a cook records: live.startRecording / live.recording for the app, and the /live/* routes the
// voice service calls with the cook's own session token (lib/liveRoutes.ts).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { addRecipe, type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));

beforeEach(() => {
  vi.useFakeTimers();
  process.env.VOICE_SECRET = "voice-secret-for-tests";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const asVoice = { "x-voice-secret": "voice-secret-for-tests" };
const post = (t: Backend, path: string, body: unknown, secret: Record<string, string> = asVoice) =>
  t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...secret }, body: JSON.stringify(body) });

async function family() {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  return { t, dad, leo };
}

test("only a cook starts a recording, for a kid in her own family, in a real language code", async () => {
  const { t, dad, leo } = await family();
  await expect(t.mutation(api.live.startRecording, { sessionToken: leo.sessionToken, source: "phone" })).rejects.toThrow("Only the cook");
  await expect(
    t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", forKidId: dad.personId as never }),
  ).rejects.toThrow("isn't in this family");
  await expect(
    t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", language: "Marathi" }),
  ).rejects.toThrow("language must be a code");

  const { recordingId } = await t.mutation(api.live.startRecording, {
    sessionToken: dad.sessionToken,
    source: "glasses",
    dish: "  Masale Bhaat ",
    forKidId: leo.personId as never,
    language: "MR",
  });
  expect(await t.query(api.live.recording, { sessionToken: dad.sessionToken, recordingId })).toMatchObject({
    status: "intro",
    language: "mr",
    dish: "Masale Bhaat",
    source: "glasses",
    forKidId: leo.personId,
  });
  // Unset language falls back to the cook's own, then English.
  const plain = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone" });
  expect(await t.query(api.live.recording, { sessionToken: dad.sessionToken, recordingId: plain.recordingId })).toMatchObject({ language: "en" });

  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const other = await signIn(t, "q-1");
  expect(await t.query(api.live.recording, { sessionToken: other.sessionToken, recordingId })).toBeNull();
});

test("the voice service reads the person and the cook's own recording, behind the secret", async () => {
  const { t, dad, leo } = await family();
  const { recordingId } = await t.mutation(api.live.startRecording, {
    sessionToken: dad.sessionToken,
    source: "phone",
    dish: "Chili",
    forKidId: leo.personId as never,
  });

  expect((await post(t, "/live/person", { sessionToken: dad.sessionToken }, {})).status).toBe(401);
  expect((await post(t, "/live/person", { sessionToken: "x".repeat(43) })).status).toBe(401);
  expect((await post(t, "/live/person", {})).status).toBe(400);
  expect(await (await post(t, "/live/person", { sessionToken: leo.sessionToken })).json()).toEqual({
    personId: leo.personId,
    familyId: leo.familyId,
    name: "Leo",
    role: "kid",
    language: "en",
  });

  expect((await post(t, "/live/session", { sessionToken: dad.sessionToken })).status).toBe(400);
  expect((await post(t, "/live/session", { sessionToken: dad.sessionToken, recordingId: "nope" })).status).toBe(404);
  expect((await post(t, "/live/session", { sessionToken: leo.sessionToken, recordingId })).status).toBe(404); // not hers
  expect((await post(t, "/live/session", { sessionToken: "x".repeat(43), recordingId })).status).toBe(401);
  const view = await (await post(t, "/live/session", { sessionToken: dad.sessionToken, recordingId })).json();
  expect(view).toMatchObject({
    recording: { _id: recordingId, status: "intro", language: "en" },
    cook: { name: "Dad", language: "en" },
    kid: { name: "Leo" },
    dish: "Chili",
  });
});

test("status, prompts, answers and the stories opt-in, on the recording's own clock", async () => {
  const { t, dad } = await family();
  const { recordingId } = await t.mutation(api.live.startRecording, { sessionToken: dad.sessionToken, source: "phone", language: "mr" });
  const s = { sessionToken: dad.sessionToken, recordingId };

  expect((await post(t, "/live/status", { ...s, status: "intro" })).status).toBe(400);
  vi.setSystemTime(new Date("2026-10-25T17:00:00Z"));
  const started = await (await post(t, "/live/status", { ...s, status: "recording" })).json();
  expect(started).toEqual({ ok: true, startedAt: Date.parse("2026-10-25T17:00:00Z") });
  vi.setSystemTime(new Date("2026-10-25T17:05:00Z"));
  // A reconnect moves to recording again without restarting the clock.
  expect(await (await post(t, "/live/status", { ...s, status: "recording" })).json()).toEqual(started);

  expect((await post(t, "/live/prompt", { ...s, kind: "joke", text: "x", textEn: "x", atS: 1 })).status).toBe(400);
  expect((await post(t, "/live/prompt", { ...s, kind: "amount", text: "किती मीठ?", atS: 1 })).status).toBe(400);
  const { promptId } = await (
    await post(t, "/live/prompt", { ...s, kind: "amount", text: "किती मीठ घातलं?", textEn: "How much salt was that?", atS: 300 })
  ).json();
  expect(promptId).toBeTypeOf("string");

  const update = { sessionToken: dad.sessionToken, promptId };
  expect((await post(t, "/live/prompt-update", { ...update, status: "answered", answer: { transcript: "एक चमचा" } })).status).toBe(400);
  expect((await post(t, "/live/prompt-update", { sessionToken: dad.sessionToken, promptId: "nope", status: "ignored" })).status).toBe(404);
  const answer = { transcript: "साधारण एक छोटा चमचा.", transcriptEn: "About one small spoon.", atS: 304, endS: 307.5 };
  expect(await (await post(t, "/live/prompt-update", { ...update, status: "answered", answer })).json()).toEqual({ ok: true });

  expect((await post(t, "/live/optin", { ...s, optIn: "yes" })).status).toBe(400);
  expect(await (await post(t, "/live/optin", { ...s, optIn: true })).json()).toEqual({ ok: true });

  expect((await post(t, "/live/status", { ...s, status: "wrapping_up" })).status).toBe(200);
  expect((await post(t, "/live/status", { ...s, status: "ended" })).status).toBe(200);
  expect((await post(t, "/live/status", { ...s, status: "recording" })).status).toBe(400); // already ended
  // A prompt can still be logged after the end (the goodbye races the status write).
  expect((await post(t, "/live/prompt", { ...s, kind: "closing", text: "x", textEn: "That's a wrap.", atS: 900 })).status).toBe(200);

  const row = await t.query(api.live.recording, s as never);
  expect(row).toMatchObject({ status: "ended", startedAt: started.startedAt, memoriesOptIn: true });
  expect(row!.endedAt! - Date.parse("2026-10-25T17:05:00Z")).toBeLessThan(1000);
  const prompts = await t.run((ctx) => ctx.db.query("homiePrompts").collect());
  expect(prompts.map((p) => [p.kind, p.status, p.answer?.transcriptEn])).toEqual([
    ["amount", "answered", "About one small spoon."],
    ["closing", "spoken", undefined],
  ]);
  expect(prompts[0]).toMatchObject({ familyId: dad.familyId, recordingId, textEn: "How much salt was that?", atS: 300 });

  // Another family's cook can't touch it.
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const other = await signIn(t, "q-1");
  expect((await post(t, "/live/prompt-update", { sessionToken: other.sessionToken, promptId, status: "ignored" })).status).toBe(404);
  expect((await post(t, "/live/optin", { sessionToken: other.sessionToken, recordingId, optIn: false })).status).toBe(404);
});

test("a recording nobody touched for 2 hours is abandoned; the voice service's heartbeat keeps a long cook live", async () => {
  const { t, dad, leo } = await family();
  const sessionToken = dad.sessionToken;
  vi.setSystemTime(new Date("2026-10-25T17:00:00Z"));
  const old = await t.mutation(api.live.startRecording, { sessionToken, source: "phone" });
  const cooking = await t.mutation(api.live.startRecording, { sessionToken, source: "phone" });
  expect((await post(t, "/live/status", { sessionToken, recordingId: cooking.recordingId, status: "recording" })).status).toBe(200);
  vi.setSystemTime(new Date("2026-10-25T18:30:00Z"));
  const fresh = await t.mutation(api.live.startRecording, { sessionToken, source: "phone" });
  // The heartbeat only marks the recording as in use; a bad one, or someone else's, is refused.
  expect(await (await post(t, "/live/status", { sessionToken, recordingId: cooking.recordingId, touch: true })).json()).toEqual({ ok: true });
  expect((await post(t, "/live/status", { sessionToken, recordingId: cooking.recordingId, touch: "yes" })).status).toBe(400);
  expect((await post(t, "/live/status", { sessionToken: leo.sessionToken, recordingId: cooking.recordingId, touch: true })).status).toBe(404);
  vi.setSystemTime(new Date("2026-10-25T19:01:00Z"));
  await t.mutation(internal.live.abandonIdle, {});
  const row = (recordingId: typeof old.recordingId) => t.query(api.live.recording, { sessionToken, recordingId });
  expect((await row(old.recordingId))?.status).toBe("abandoned");
  expect((await row(fresh.recordingId))?.status).toBe("intro");
  const cook = await row(cooking.recordingId);
  expect(cook?.status).toBe("recording");
  expect(cook!.startedAt! - Date.parse("2026-10-25T17:00:00Z")).toBeLessThan(1000);
  // A heartbeat can't bring an abandoned recording back.
  expect((await post(t, "/live/status", { sessionToken, recordingId: old.recordingId, touch: true })).status).toBe(400);
  expect((await row(old.recordingId))?.status).toBe("abandoned");
});

test("the kid's /voice/session carries the cook's language (absent when unknown) and which step each story belongs to", async () => {
  const { t, dad, leo } = await family();
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  const recipe = async () => (await (await post(t, "/voice/session", { sessionToken: leo.sessionToken, recipeId })).json()).recipe;
  // Neither the cook nor the recipe has a language: absent, not "en", so the voice still says her clips in English.
  expect(await recipe()).not.toHaveProperty("cookLanguage");
  await t.run((ctx) => ctx.db.patch("recipes", recipeId, { language: "hi" }));
  expect((await recipe()).cookLanguage).toBe("hi");
  await t.mutation(internal.seed.language, { personId: dad.personId as never, language: "mr" });
  const view = await recipe();
  expect(view).toMatchObject({ cookName: "Dad", cookLanguage: "mr" });
  // The story (130–230 s) was told during step 1 (60–330 s).
  expect(view.memories).toEqual([{ kind: "story", text: "My first apartment had one pot.", moment: { startS: 130, endS: 230 }, stepOrder: 1 }]);
});

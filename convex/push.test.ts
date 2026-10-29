import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { CRAVINGS_PER_DAY, DAILY_MAX, RECEIPTS_AFTER_MS } from "./push";
import { EXPO_PUSH_URL, EXPO_RECEIPTS_URL, quietDelayMs, sendExpoPush, type ExpoMessage } from "./lib/push";
import { pushWords } from "./lib/pushWords";
import { type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

const TOKEN_A = "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]";
const TOKEN_B = "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]";

/** A stand-in for Expo: records what was sent, answers tickets and receipts as the test says. */
function fakeExpo() {
  const sent: ExpoMessage[][] = [];
  const state = { dead: new Set<string>(), deadInReceipts: new Set<string>(), down: false };
  const route = (url: string, init?: RequestInit) => {
    if (url === EXPO_PUSH_URL) {
      if (state.down) return new Response("down", { status: 503 });
      const batch = JSON.parse(String(init?.body)) as ExpoMessage[];
      sent.push(batch);
      return Response.json({
        data: batch.map((m) =>
          state.dead.has(m.to)
            ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
            : { status: "ok", id: `ticket-${m.to}` },
        ),
      });
    }
    if (url === EXPO_RECEIPTS_URL) {
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      const data = Object.fromEntries(
        ids.map((id) => [
          id,
          [...state.deadInReceipts].some((tok) => id === `ticket-${tok}`)
            ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
            : { status: "ok" },
        ]),
      );
      return Response.json({ data });
    }
    return undefined;
  };
  return { sent, state, route };
}

let expo: ReturnType<typeof fakeExpo>;
let t: Backend;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T19:00:00Z")); // noon in Los Angeles
  expo = fakeExpo();
  stubFetch(undefined, expo.route);
  t = newBackend();
});

afterEach(() => {
  vi.clearAllTimers(); // a test's unsent pushes mustn't fire in the next one
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function dadAndLeo() {
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  return { dad, leo };
}

const push = (personId: Id<"people">, over: Partial<{ kind: "answered" | "craving" | "joined" | "filmed"; dedupeKey: string }> = {}) =>
  t.mutation(internal.push.queue, {
    personId,
    kind: over.kind ?? "answered",
    title: "Mom answered",
    body: "Tap to hear how Mom makes tomato egg.",
    url: "/dish/abc",
    dedupeKey: over.dedupeKey ?? `k-${Math.random()}`,
  });

const tokensOf = (personId: Id<"people">) =>
  t.run((ctx) => ctx.db.query("pushTokens").withIndex("by_personId", (q) => q.eq("personId", personId)).collect());
const logOf = (personId: Id<"people">) =>
  t.run((ctx) => ctx.db.query("pushLog").withIndex("by_personId_and_createdAt", (q) => q.eq("personId", personId)).collect());

test("register moves a phone's token to whoever signed in last, and keeps 5 per person", async () => {
  const { dad, leo } = await dadAndLeo();
  await t.mutation(api.push.register, { sessionToken: dad.sessionToken, token: TOKEN_A, platform: "ios", tz: "Asia/Kolkata" });
  expect((await tokensOf(dad.personId)).map((r) => [r.token, r.tz])).toEqual([[TOKEN_A, "Asia/Kolkata"]]);

  await t.mutation(api.push.register, { sessionToken: leo.sessionToken, token: TOKEN_A, platform: "ios", tz: "Not/AZone" });
  expect(await tokensOf(dad.personId)).toHaveLength(0);
  const [moved] = await tokensOf(leo.personId);
  expect(moved.token).toBe(TOKEN_A);
  expect(moved.tz).toBeUndefined();

  for (let i = 0; i < 7; i++) {
    vi.advanceTimersByTime(1000);
    await t.mutation(api.push.register, { sessionToken: dad.sessionToken, token: `ExponentPushToken[dad${i}]`, platform: "ios" });
  }
  expect((await tokensOf(dad.personId)).map((r) => r.token).sort()).toEqual([2, 3, 4, 5, 6].map((i) => `ExponentPushToken[dad${i}]`));

  await expect(t.mutation(api.push.register, { sessionToken: dad.sessionToken, token: "nope", platform: "ios" })).rejects.toThrow(/push token/);
});

test("unregister drops a token only within the caller's family", async () => {
  const { dad, leo } = await dadAndLeo();
  await t.mutation(api.push.register, { sessionToken: dad.sessionToken, token: TOKEN_A, platform: "ios" });
  await t.mutation(api.push.unregister, { sessionToken: "x".repeat(43), token: TOKEN_A }); // signed out: nothing
  expect(await tokensOf(dad.personId)).toHaveLength(1);
  await t.mutation(api.push.unregister, { sessionToken: leo.sessionToken, token: TOKEN_A }); // same family
  expect(await tokensOf(dad.personId)).toHaveLength(0);
});

test("a push goes to every phone with the Supabase profile id, then receipts clean dead tokens", async () => {
  const { leo } = await dadAndLeo();
  await t.mutation(api.push.register, { sessionToken: leo.sessionToken, token: TOKEN_A, platform: "ios" });
  await t.mutation(api.push.register, { sessionToken: leo.sessionToken, token: TOKEN_B, platform: "android" });
  expo.state.deadInReceipts.add(TOKEN_B);

  expect(await push(leo.personId, { dedupeKey: "answered:abc:1" })).toBe("queued");
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(expo.sent).toHaveLength(1);
  expect(expo.sent[0].map((m) => m.to).sort()).toEqual([TOKEN_A, TOKEN_B]);
  expect(expo.sent[0][0]).toMatchObject({
    title: "Mom answered",
    sound: "default",
    priority: "high",
    channelId: "default",
    data: { url: "/dish/abc", kind: "answered", profile_id: "p-leo" },
  });
  const [log] = await logOf(leo.personId);
  expect(log.status).toBe("sent");
  expect(log.tickets).toHaveLength(2);
  // The receipts check ran RECEIPTS_AFTER_MS later and dropped the token Expo reported gone.
  expect(RECEIPTS_AFTER_MS).toBe(15 * 60_000);
  expect((await tokensOf(leo.personId)).map((r) => r.token)).toEqual([TOKEN_A]);
});

test("a ticket that says the device is gone drops that token at once", async () => {
  const { leo } = await dadAndLeo();
  await t.mutation(api.push.register, { sessionToken: leo.sessionToken, token: TOKEN_A, platform: "ios" });
  expo.state.dead.add(TOKEN_A);
  await push(leo.personId);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await tokensOf(leo.personId)).toHaveLength(0);
  expect((await logOf(leo.personId))[0]).toMatchObject({ status: "failed", error: "gone" });
});

test("dedupe, no phone, and Expo down", async () => {
  const { dad, leo } = await dadAndLeo();
  expect(await push(dad.personId, { dedupeKey: "same" })).toBe("none"); // no token yet: logged, not sent
  await t.mutation(api.push.register, { sessionToken: leo.sessionToken, token: TOKEN_A, platform: "ios" });
  expect(await push(leo.personId, { dedupeKey: "same" })).toBe("queued");
  expect(await push(leo.personId, { dedupeKey: "same" })).toBe("dup");
  expo.state.down = true;
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await logOf(leo.personId))[0]).toMatchObject({ status: "failed", error: "HTTP 503" });
  expect(await tokensOf(leo.personId)).toHaveLength(1); // a failed send is never a dead token
});

test("a craving waits out quiet hours on the parent's clock, and at most 3 a day reach her", async () => {
  const { dad } = await dadAndLeo();
  await t.mutation(api.push.register, { sessionToken: dad.sessionToken, token: TOKEN_A, platform: "ios", tz: "America/Los_Angeles" });
  vi.setSystemTime(new Date("2026-10-30T06:30:00Z")); // 23:30 in Los Angeles
  expect(await push(dad.personId, { kind: "craving" })).toBe("queued");
  const [first] = await logOf(dad.personId);
  expect(new Date(first.sendAt).toISOString()).toBe("2026-10-30T15:00:00.000Z"); // 08:00 there
  expect(await push(dad.personId, { kind: "answered" })).toBe("queued"); // other kinds go now
  expect(Math.abs((await logOf(dad.personId))[1].sendAt - Date.now())).toBeLessThan(1000);

  await push(dad.personId, { kind: "craving" });
  await push(dad.personId, { kind: "craving" });
  expect(await push(dad.personId, { kind: "craving" })).toBe("capped");
  expect(CRAVINGS_PER_DAY).toBe(3);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(expo.sent).toHaveLength(4); // 3 cravings + the answer; the capped one never went
});

test("at most 20 pushes a day to one person", async () => {
  const { leo } = await dadAndLeo();
  await t.mutation(api.push.register, { sessionToken: leo.sessionToken, token: TOKEN_A, platform: "ios" });
  for (let i = 0; i < DAILY_MAX; i++) expect(await push(leo.personId)).toBe("queued");
  expect(await push(leo.personId)).toBe("capped");
  vi.advanceTimersByTime(24 * 3600 * 1000 + 1);
  expect(await push(leo.personId)).toBe("queued");
  await t.finishAllScheduledFunctions(vi.runAllTimers); // so none is still sending when the next test starts
});

test("a deleted account gets nothing: deleteMe drops its tokens, and a queued push isn't sent", async () => {
  const { leo } = await dadAndLeo();
  await t.mutation(api.push.register, { sessionToken: leo.sessionToken, token: TOKEN_A, platform: "ios" });
  await push(leo.personId);
  await t.mutation(api.account.deleteMe, { sessionToken: leo.sessionToken });
  expect(await tokensOf(leo.personId)).toHaveLength(0);
  expect(await push(leo.personId)).toBe("gone");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(expo.sent).toHaveLength(0);
  expect(await logOf(leo.personId)).toHaveLength(0); // the purge dropped the log
});

test("the log is pruned after 40 days", async () => {
  const { leo } = await dadAndLeo();
  await push(leo.personId);
  vi.advanceTimersByTime(41 * 24 * 3600 * 1000);
  await push(leo.personId);
  await t.mutation(internal.push.prune, {});
  expect(await logOf(leo.personId)).toHaveLength(1);
});

test("Expo gets batches of 100", async () => {
  const msgs = Array.from({ length: 150 }, (_, i) => ({
    to: `ExponentPushToken[t${i}]`,
    title: "t",
    body: "b",
    sound: "default" as const,
    priority: "high" as const,
    channelId: "default" as const,
    data: { url: "/", kind: "answered", profile_id: "p" },
  }));
  const { tickets } = await sendExpoPush(msgs, { fetch: async (url, init) => expo.route(url, init)! });
  expect(expo.sent.map((b) => b.length)).toEqual([100, 50]);
  expect(tickets).toHaveLength(150);
});

test("quiet hours are 21:00 to 08:00 on the person's clock", () => {
  const at = (iso: string, tz: string) => quietDelayMs(Date.parse(iso), tz) / 60_000;
  expect(at("2026-10-29T19:00:00Z", "America/Los_Angeles")).toBe(0); // noon
  expect(at("2026-10-30T04:00:00Z", "America/Los_Angeles")).toBe(11 * 60); // 21:00
  expect(at("2026-10-30T14:59:00Z", "America/Los_Angeles")).toBe(1); // 07:59
  expect(at("2026-10-29T16:00:00Z", "Asia/Kolkata")).toBe(10.5 * 60); // 21:30 there
  expect(at("2026-10-29T19:00:00Z", "Bogus/Zone")).toBe(0); // unknown zone reads as Los Angeles
});

test("push words follow the recipient's language", () => {
  const vars = { kid: "Caleb", dish: "braised pork", relation: "Mom", name: "Caleb" };
  expect(pushWords("craving", undefined, vars)).toEqual({ title: "Caleb wants your braised pork", body: "Show Caleb how you make it." });
  expect(pushWords("craving", "hi", vars).title).toBe("Caleb को आपका braised pork चाहिए");
  expect(pushWords("craving", "mr", vars).title).toBe("Caleb को आपका braised pork चाहिए"); // Marathi reads as Hindi
  expect(pushWords("craving", "fr", vars).title).toBe("Caleb wants your braised pork"); // no words yet: English
  expect(pushWords("craving", "hi", { dish: "braised pork" }).title).toBe("Your kid wants your braised pork");
  expect(pushWords("joined", "en", vars, "cook").title).toBe("Caleb is on homecookd");
  expect(pushWords("joined", "en", { name: "Mom" }, "kid")).toEqual({ title: "Mom joined your kitchen", body: "You're in the same kitchen now." });
  expect(pushWords("answered", "en", vars)).toEqual({ title: "Mom answered", body: "Tap to hear how Mom makes braised pork." });
});

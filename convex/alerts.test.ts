// Report alerts (alerts.ts): a report pings REPORT_ALERT_URL once, shaped for ntfy, Slack or Discord, with
// nothing personal in it; no URL means no call; the daily reminder fires only for reports open over 12 hours.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { recipe, type Who, world } from "./community.helpers";
import type { Backend } from "./test.helpers";

const calls: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("ok");
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.REPORT_ALERT_URL;
  delete process.env.REPORT_ALERT_EMAIL;
  delete process.env.REPORT_ALERT_TOKEN;
});

const report = (t: Backend, who: Who, targetId: Id<"recipes">, reason?: "not_food" | "rude" | "other") =>
  t.mutation(api.community.report, { sessionToken: who.sessionToken, kind: "recipe", targetId, reason });

test("a report sends one ntfy push with what, why and how many are open", async () => {
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  await report(t, serene, poha, "rude");
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(calls).toHaveLength(1);
  const { url, init } = calls[0];
  expect(url).toBe("https://ntfy.sh/homecookd-test");
  expect((init.headers as Record<string, string>).Title).toBe("homecookd: new Community report");
  expect(init.body).toBe("Someone reported a recipe (rude or hurtful). 1 open. Review: npx convex run reports:open");
  expect(String(init.body)).not.toContain(poha); // no ids or names leave Convex
});

test("with REPORT_ALERT_EMAIL, the ntfy push is also emailed; a bad address is left out", async () => {
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  process.env.REPORT_ALERT_EMAIL = "team@homecookd.app";
  process.env.REPORT_ALERT_TOKEN = "tk_testtoken123456";
  const { t, rajani, serene, caleb } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  await report(t, serene, poha, "rude");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  process.env.REPORT_ALERT_EMAIL = "not an address";
  await report(t, caleb, poha);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const headers = calls.map((c) => c.init.headers as Record<string, string>);
  expect(headers[0].Email).toBe("team@homecookd.app");
  expect(headers[1].Email).toBeUndefined();
});

test("ntfy refusing the email (4xx) still sends the push, once, without the Email header", async () => {
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  process.env.REPORT_ALERT_EMAIL = "team@homecookd.app";
  process.env.REPORT_ALERT_TOKEN = "tk_testtoken123456";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const asksEmail = "Email" in (init.headers as Record<string, string>);
    return asksEmail ? new Response('{"error":"anonymous email sending is not allowed"}', { status: 400 }) : new Response("ok");
  });
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  await report(t, serene, poha, "rude");
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(calls).toHaveLength(2);
  const [first, second] = calls.map((c) => c.init.headers as Record<string, string>);
  expect(first.Email).toBe("team@homecookd.app");
  expect(second.Email).toBeUndefined();
  expect(second.Title).toBe("homecookd: new Community report");
  expect(calls[1].init.body).toBe(calls[0].init.body);
});

test("a 5xx with the Email header isn't retried (the push itself is down)", async () => {
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  process.env.REPORT_ALERT_EMAIL = "team@homecookd.app";
  process.env.REPORT_ALERT_TOKEN = "tk_testtoken123456";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("down", { status: 503 });
  });
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  await report(t, serene, poha);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toHaveLength(1);
});

test("Slack and Discord get JSON", async () => {
  const { t, rajani, serene, caleb } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  process.env.REPORT_ALERT_URL = "https://hooks.slack.com/services/T/B/x";
  await report(t, serene, poha, "not_food");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  process.env.REPORT_ALERT_URL = "https://discord.com/api/webhooks/1/x";
  await report(t, caleb, poha);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(calls.map((c) => Object.keys(JSON.parse(String(c.init.body))))).toEqual([["text"], ["content"]]);
  expect(JSON.parse(String(calls[1].init.body)).content).toContain("2 open");
});

test("no REPORT_ALERT_URL: no call, and the report still counts", async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  await report(t, serene, poha);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(calls).toHaveLength(0);
  expect(await t.query(internal.alerts.openCount, {})).toBe(1);
});

test("the daily reminder fires only for reports open over 12 hours, and a failing hook doesn't throw", async () => {
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  await report(t, serene, poha);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  calls.length = 0;

  await t.action(internal.alerts.remindOpen, {});
  expect(calls).toHaveLength(0); // filed just now

  vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000);
  vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
  await expect(t.action(internal.alerts.remindOpen, {})).resolves.toBeNull();
});

test("email needs an ntfy token: without one the push goes alone, signed out; with one it's signed in and emailed", async () => {
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  process.env.REPORT_ALERT_EMAIL = "team@homecookd.app";
  const { t, rajani, serene } = await world();
  // One report each, on three dishes: two families' reports would hide a dish, and a hidden one sends nothing.
  const [a, b, c] = [await recipe(t, rajani, { sharedAt: 1 }), await recipe(t, rajani, { sharedAt: 2 }), await recipe(t, rajani, { sharedAt: 3 })];

  await report(t, serene, a); // no token: ntfy.sh would refuse anonymous email, so none is asked
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  process.env.REPORT_ALERT_TOKEN = "not-a-token";
  await report(t, serene, b); // a malformed token counts as none
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  process.env.REPORT_ALERT_TOKEN = "tk_testtoken123456";
  await report(t, serene, c);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const headers = calls.map((c) => c.init.headers as Record<string, string>);
  expect(headers).toHaveLength(3);
  expect(headers[0]).not.toHaveProperty("Email");
  expect(headers[0]).not.toHaveProperty("Authorization");
  expect(headers[1]).not.toHaveProperty("Email");
  expect(headers[1]).not.toHaveProperty("Authorization");
  expect(headers[2]).toMatchObject({ Email: "team@homecookd.app", Authorization: "Bearer tk_testtoken123456" });
});

test("a wrong or expired token (401) still sends the plain push", async () => {
  process.env.REPORT_ALERT_URL = "https://ntfy.sh/homecookd-test";
  process.env.REPORT_ALERT_EMAIL = "team@homecookd.app";
  process.env.REPORT_ALERT_TOKEN = "tk_expiredtoken12345";
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const signedIn = "Authorization" in (init.headers as Record<string, string>);
    return signedIn ? new Response('{"code":40101,"error":"unauthorized"}', { status: 401 }) : new Response("ok");
  });
  const { t, rajani, serene } = await world();
  const poha = await recipe(t, rajani, { sharedAt: 1 });
  await report(t, serene, poha);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(calls).toHaveLength(2);
  const retry = calls[1].init.headers as Record<string, string>;
  expect(retry).not.toHaveProperty("Authorization");
  expect(retry).not.toHaveProperty("Email");
  expect(retry.Title).toBe("homecookd: new Community report");
});

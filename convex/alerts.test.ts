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

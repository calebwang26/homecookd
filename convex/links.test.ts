/// <reference types="vite/client" />
// Claim on install (docs/build/V2-LINKING.md §2): /link/open and its join ticket, links.claim, the joined push,
// and pushEvents. Cards are made through the real /dish/cards route with the fake models (DISH_FAKE_AI=1).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { cardRef, verifyTicket } from "./lib/joinTicket";
import { JOIN_WINDOW_DAYS } from "./links";
import { FAMILY, type Backend, newBackend, signIn, stubFetch } from "./test.helpers";

/** A time within a second of `ms` (each call moves the test clock on a millisecond or so). */
const near = (ms: number) => expect.closeTo(ms, -3);
const SECRET = "test-link-secret-0123456789abcdef";
const IP = "203.0.113.9";
const OTHER_FAMILY = { family: { id: "fam-2", name: "The Zeds" }, profiles: [{ id: "p-zed", name: "Zed", role: "learner" }] };

let t: Backend;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T19:00:00Z"));
  process.env.DISH_FAKE_AI = "1";
  process.env.DISH_IP_SALT = "test-salt-for-the-link-limits";
  process.env.LINK_JOIN_SECRET = SECRET;
  // Supabase GET /family answers as the signed-in person's family: Zed is in another one.
  stubFetch(undefined, (url, init) => {
    const who = new Headers(init?.headers).get("x-profile-id");
    return url.endsWith("/family") && who === "p-zed" ? Response.json(OTHER_FAMILY) : undefined;
  });
  t = newBackend();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.LINK_JOIN_SECRET;
});

async function post(path: string, body: unknown, ip = IP) {
  const res = await t.fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}

async function makeCard(body: Record<string, unknown> = { dish: "tomato egg", kidName: "Caleb" }) {
  const r = await post("/dish/cards", body);
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  return { kidToken: r.data.kidToken as string, askToken: new URL(r.data.card.askUrl).searchParams.get("t")! };
}

const open = (token: unknown, ip = IP) => post("/link/open", { token }, ip);
const claim = (sessionToken: string, token: string) => t.mutation(api.links.claim, { sessionToken, token });
const cardRow = (id: Id<"dishAsks">) => t.run((ctx) => ctx.db.get("dishAsks", id));
const pushesTo = (personId: Id<"people">) =>
  t.run((ctx) => ctx.db.query("pushLog").withIndex("by_personId_and_createdAt", (q) => q.eq("personId", personId)).collect());
const registerPhone = (sessionToken: string, n: string) =>
  t.mutation(api.push.register, { sessionToken, token: `ExponentPushToken[${n}]`, platform: "ios" });

test("a dead, malformed or missing token", async () => {
  expect((await open("A".repeat(22))).status).toBe(404);
  expect((await open("short")).status).toBe(404);
  expect((await open(undefined)).status).toBe(400);
});

test("a card nobody has claimed: no family yet, so no ticket (sign in first)", async () => {
  const c = await makeCard();
  const kid = await open(c.kidToken);
  expect(kid.status).toBe(200);
  expect(kid.data).toMatchObject({ side: "kid", dish: "tomato egg", kidName: "Caleb", relation: "mom", familyName: null, taken: false, ticket: null, joinable: "no_family" });
  expect((await open(c.askToken)).data).toMatchObject({ side: "cook", joinable: "no_family", ticket: null });
});

test("the kid claims first; Mom's link then carries a ticket to the kid's family, as a cook", async () => {
  const leo = await signIn(t, "p-leo");
  const c = await makeCard();
  const claimed = await claim(leo.sessionToken, c.kidToken);
  expect(claimed).toMatchObject({ side: "kid", sameFamily: true, taken: false });
  const row = (await cardRow(claimed.dishAskId))!;
  expect(row).toMatchObject({ personId: leo.personId, familyId: leo.familyId });
  expect(row.kidClaimedAt).toEqual(near(Date.now()));
  expect(await claim(leo.sessionToken, c.kidToken)).toEqual(claimed); // again: the same

  const mom = await open(c.askToken);
  expect(mom.data).toMatchObject({ side: "cook", familyName: FAMILY.family.name, joinable: "yes" });
  const ticket = await verifyTicket(SECRET, mom.data.ticket, Date.now());
  expect(ticket).toMatchObject({ v: 1, fam: "fam-1", side: "cook", name: "Mom", card: await cardRef(claimed.dishAskId) });
  expect(ticket!.exp).toEqual(near(Date.now() + 10 * 60_000));
  // The kid's own side brought them in already: no ticket for it, ever.
  expect((await open(c.kidToken)).data).toMatchObject({ joinable: "taken", taken: true, ticket: null });
});

test("Mom claims: she holds the cook side, gets her relation, and the kid hears she joined", async () => {
  const leo = await signIn(t, "p-leo");
  const dad = await signIn(t, "p-dad");
  await registerPhone(leo.sessionToken, "leo");
  const c = await makeCard();
  const { dishAskId } = await claim(leo.sessionToken, c.kidToken);
  expect(await claim(dad.sessionToken, c.askToken)).toMatchObject({ side: "cook", sameFamily: true, taken: false });
  const row = (await cardRow(dishAskId))!;
  expect(row.requestedOf).toBe(dad.personId);
  expect(row.cookClaimedAt).toEqual(near(Date.now()));
  expect((await t.run((ctx) => ctx.db.get("people", dad.personId)))!.relation).toBe("Mom");
  const [joined] = await pushesTo(leo.personId);
  expect(joined).toMatchObject({ kind: "joined", title: "Mom joined your kitchen", url: `/dish/${dishAskId}`, status: "queued" });

  // Someone else with the forwarded link finds it taken; the kid can't take Mom's side of their own card.
  const zed = await signIn(t, "p-zed");
  expect(await claim(zed.sessionToken, c.askToken)).toMatchObject({ taken: true });
  await expect(claim(leo.sessionToken, c.askToken)).rejects.toThrow(/already on this card/);
  expect((await open(c.askToken)).data).toMatchObject({ joinable: "taken", ticket: null });
});

test("a card in another family stays there: the claim puts it in their app, no one moves", async () => {
  const leo = await signIn(t, "p-leo");
  const zed = await signIn(t, "p-zed");
  const c = await makeCard();
  const { dishAskId } = await claim(leo.sessionToken, c.kidToken);
  expect(await claim(zed.sessionToken, c.askToken)).toMatchObject({ sameFamily: false, taken: false });
  const row = (await cardRow(dishAskId))!;
  expect(row.familyId).toBe(leo.familyId);
  expect(row.requestedOf).toBe(zed.personId);
  expect(await pushesTo(leo.personId)).toHaveLength(0); // "joined" is only for the same family
});

test("no ticket without the secret, or after the join window", async () => {
  const leo = await signIn(t, "p-leo");
  const c = await makeCard();
  await claim(leo.sessionToken, c.kidToken);
  delete process.env.LINK_JOIN_SECRET;
  expect((await open(c.askToken)).data).toMatchObject({ joinable: "off", ticket: null });
  process.env.LINK_JOIN_SECRET = SECRET;
  vi.advanceTimersByTime((JOIN_WINDOW_DAYS + 1) * 24 * 3600 * 1000);
  expect((await open(c.askToken)).data).toMatchObject({ joinable: "window", ticket: null });
  expect(JOIN_WINDOW_DAYS).toBe(30);
});

test("tickets are limited per card side (5 an hour), and opens per IP", async () => {
  const leo = await signIn(t, "p-leo");
  const c = await makeCard();
  await claim(leo.sessionToken, c.kidToken);
  for (let i = 0; i < 5; i++) expect((await open(c.askToken, `198.51.100.${i}`)).data.ticket).toBeTruthy();
  expect((await open(c.askToken, "198.51.100.99")).status).toBe(429);
  for (let i = 0; i < 30; i++) await open(c.kidToken, "192.0.2.1");
  expect((await open(c.kidToken, "192.0.2.1")).status).toBe(429);
});

test("pushEvents: Mom answered goes to the kid, a craving to the parent, in their language", async () => {
  const leo = await signIn(t, "p-leo");
  const dad = await signIn(t, "p-dad");
  await registerPhone(leo.sessionToken, "leo");
  await registerPhone(dad.sessionToken, "dad");
  await t.run((ctx) => ctx.db.patch("people", dad.personId, { language: "hi" }));
  const c = await makeCard({ dish: "braised pork", kidName: "Caleb" });
  const { dishAskId } = await claim(leo.sessionToken, c.kidToken);

  await t.mutation(internal.pushEvents.answered, { askId: dishAskId });
  await t.mutation(internal.pushEvents.answered, { askId: dishAskId }); // the same answer: once
  expect((await pushesTo(leo.personId)).map((p) => [p.kind, p.title, p.url])).toEqual([["answered", "Mom answered", `/dish/${dishAskId}`]]);

  await t.run((ctx) => ctx.db.patch("dishAsks", dishAskId, { requestedOf: dad.personId }));
  await t.mutation(internal.pushEvents.requested, { askId: dishAskId });
  const [craving] = await pushesTo(dad.personId);
  expect(craving).toMatchObject({ kind: "craving", title: "Caleb को आपका braised pork चाहिए", url: `/request/${dishAskId}` });

  // A card no kid has claimed in the app: nothing to send.
  const web = await makeCard({ dish: "dal", kidName: "Amy" });
  const row = await t.run((ctx) => ctx.db.query("dishAsks").order("desc").first());
  await t.mutation(internal.pushEvents.answered, { askId: row!._id });
  expect(web.kidToken).toBeTruthy();
  expect(await t.run((ctx) => ctx.db.query("pushLog").collect())).toHaveLength(2);
});

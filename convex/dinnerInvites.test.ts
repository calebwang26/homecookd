// "Invite friends" (dinners.inviteLink) and POST /invite/open (lib/inviteRoutes.ts): one stable link per
// dinner for the host and the guests they said yes to; whoever opens it counts once per phone or browser
// in "X going" and sees only the dish, the host's name and when.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { recipe, type Who, world } from "./community.helpers";
import { MAX_OPENS, OPEN_BURST, OPEN_BURST_MS } from "./dinners";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ADDRESS = "Baker House, 362 Memorial Dr";

async function dinnerWorld() {
  const w = await world();
  const poha = await recipe(w.t, w.rajani, { sharedAt: 1 });
  const create = (who: Who) =>
    w.t.mutation(api.dinners.create, { sessionToken: who.sessionToken, recipeId: poha, startsAt: Date.now() + 86_400_000, placeName: "Baker House kitchen", address: ADDRESS, seats: 4 });
  const dinnerId = await create(w.shreya);
  const link = (who: Who, id = dinnerId) => w.t.action(api.dinners.inviteLink, { sessionToken: who.sessionToken, dinnerId: id });
  const get = async (who: Who) => (await w.t.query(api.dinners.get, { sessionToken: who.sessionToken, dinnerId }))!;
  const open = (body: unknown, origin?: string) =>
    w.t.fetch("/invite/open", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { ...w, poha, create, dinnerId, link, get, open };
}

const device = (n: number) => `phone-${String(n).padStart(12, "0")}`;

test("one stable, unguessable link per dinner, for the host and the guests they said yes to", async () => {
  const { t, shreya, serene, caleb, rajani, create, dinnerId, link } = await dinnerWorld();
  const first = await link(shreya);
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.url).toBe(`https://homecookd.app/d?t=${first.token}`);
  expect(await link(shreya)).toEqual(first);

  await expect(link(serene)).rejects.toThrow("Only the host and their guests can invite friends.");
  const requestId = await t.mutation(api.dinners.requestJoin, { sessionToken: serene.sessionToken, dinnerId });
  await expect(link(serene)).rejects.toThrow("Only the host"); // asked, not in yet
  await t.mutation(api.dinners.respond, { sessionToken: shreya.sessionToken, requestId, accept: true });
  expect(await link(serene)).toEqual(first); // a guest who's in shares the same link
  await expect(link(caleb)).rejects.toThrow("Only the host");
  await expect(link(rajani)).rejects.toThrow("Only the host"); // the host's family isn't the host

  const another = await link(shreya, await create(shreya));
  expect(another.token).not.toBe(first.token);
  await t.run((ctx) => ctx.db.patch("dinners", dinnerId, { status: "cancelled" }));
  await expect(link(shreya)).rejects.toThrow("isn't happening anymore");
});

test("opening the link counts each phone once and tells it only the dish, the host's name and when", async () => {
  const { t, shreya, serene, dinnerId, link, get, open } = await dinnerWorld();
  await t.run((ctx) => ctx.db.patch("people", shreya.personId, { name: "Grandma Rajani" }));
  const { token } = await link(shreya);
  const startsAt = (await get(shreya)).startsAt;
  expect((await get(shreya)).inviteOpens).toBe(0);

  const res = await open({ token, deviceId: device(1) }, "https://homecookd.app");
  expect(res.status).toBe(200);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://homecookd.app");
  const body = await res.json();
  // The same name the invite text and the dinner page's "Hosted by" pill use: never cut to "Grandma".
  expect(body).toEqual({ dish: "Kanda Poha", hostName: "Grandma Rajani", startsAt });
  expect(body.hostName).toBe((await get(shreya)).hostName);
  const said = JSON.stringify(body);
  for (const word of ["Baker", "Memorial", dinnerId, shreya.personId, token]) expect(said).not.toContain(word);
  expect((await get(shreya)).inviteOpens).toBe(1);

  await open({ token, deviceId: device(1) }); // the same phone again (the app's fetch: no Origin)
  expect((await get(shreya)).inviteOpens).toBe(1);
  const second = await open({ token, deviceId: device(2) }, "http://localhost:3000");
  expect(second.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  // The count is live on the dinner page for whoever looks; the address still isn't.
  expect(await get(serene)).toMatchObject({ inviteOpens: 2, address: null });
});

test("links that don't work, bodies that don't parse, other sites, and dinners that are over", async () => {
  const { t, shreya, dinnerId, link, get, open } = await dinnerWorld();
  const { token } = await link(shreya);
  expect((await open({ token: "x".repeat(43), deviceId: device(1) })).status).toBe(404);
  expect((await open({ token, deviceId: "short" })).status).toBe(400);
  expect((await open({ token: 12, deviceId: device(1) })).status).toBe(400);
  expect((await open("not json")).status).toBe(400);
  expect((await open({ token, deviceId: device(1), extra: "x".repeat(2000) })).status).toBe(400);
  const elsewhere = await open({ token, deviceId: device(1) }, "https://homecookd.app.example.com");
  expect(elsewhere.status).toBe(403);
  expect(elsewhere.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect((await get(shreya)).inviteOpens).toBe(0);

  const preflight = await t.fetch("/invite/open", { method: "OPTIONS", headers: { Origin: "https://www.homecookd.app" } });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("https://www.homecookd.app");
  expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  expect((await t.fetch("/invite/open", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status).toBe(403);

  // Once it has started, the page still opens but nobody new counts; a called-off dinner's link stops working.
  vi.setSystemTime((await get(shreya)).startsAt + 1);
  expect((await open({ token, deviceId: device(3) })).status).toBe(200);
  expect((await get(shreya)).inviteOpens).toBe(0);
  await t.run((ctx) => ctx.db.patch("dinners", dinnerId, { status: "cancelled" }));
  expect((await open({ token, deviceId: device(4) })).status).toBe(404);
});

test("a flood of opens can't run the count up: a burst limit and a ceiling, and the page still opens", async () => {
  const { t, shreya, dinnerId, link, get, open } = await dinnerWorld();
  const { token } = await link(shreya);
  for (let i = 0; i < OPEN_BURST; i++) await open({ token, deviceId: device(i) });
  expect((await get(shreya)).inviteOpens).toBe(OPEN_BURST);
  const over = await open({ token, deviceId: device(OPEN_BURST) });
  expect(over.status).toBe(200);
  expect((await get(shreya)).inviteOpens).toBe(OPEN_BURST);
  vi.advanceTimersByTime(OPEN_BURST_MS + 1000);
  await open({ token, deviceId: device(OPEN_BURST) });
  expect((await get(shreya)).inviteOpens).toBe(OPEN_BURST + 1);

  // The ceiling: past MAX_OPENS nothing more counts.
  await t.run(async (ctx) => {
    for (let i = OPEN_BURST + 1; i < MAX_OPENS; i++) await ctx.db.insert("dinnerInviteOpens", { dinnerId, deviceId: device(i) });
  });
  vi.advanceTimersByTime(OPEN_BURST_MS + 1000);
  expect((await get(shreya)).inviteOpens).toBe(MAX_OPENS);
  expect((await open({ token, deviceId: device(MAX_OPENS) })).status).toBe(200);
  expect((await get(shreya)).inviteOpens).toBe(MAX_OPENS);
});

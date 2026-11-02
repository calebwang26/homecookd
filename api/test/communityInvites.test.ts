// convex/dinnerInvites.test.ts on the new api: one stable link per dinner for the host and the guests they said yes to; whoever opens it counts once per phone or browser in "X going"
// and sees only the dish, the host's name and when. POST /invite/open is public: the token is its capability.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { MAX_OPENS, OPEN_BURST, OPEN_BURST_MS } from "../src/modules/community/dinners.js";
import { RATE } from "../src/modules/community/inviteRoutes.js";
import { sha256Hex } from "../src/modules/dish/values.js";
import { DINNER_INVITE_SALT, unseal } from "../src/sealed.js";
import { ADDRESS, call, dinner, host, join, ok, openedEarlier, recipe, refusedWith, report, respond, startIt, type Who, world } from "./communityHelpers.js";
import { clearWindow, hasDatabase, IP, randomIp } from "./dishHelpers.js";

const skip = !hasDatabase;

async function dinnerWorld() {
  const w = await world();
  const poha = await recipe(w.rajani, { sharedAt: 1 });
  const create = (who: Who) => host(w.t, who, poha, { startsAt: Date.now() + 86_400_000 });
  const dinnerId = await create(w.shreya);
  const link = (who: Who, id = dinnerId) => call(w.t, who, "POST", `/v1/dinners/${id}/invite-link`);
  const get = async (who: Who) => (await dinner(w.t, who, dinnerId)).data;
  const open = (body: unknown, origin?: string, ip = IP) =>
    w.t.inject({
      method: "POST",
      url: "/invite/open",
      remoteAddress: ip,
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      payload: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { ...w, poha, create, dinnerId, link, get, open };
}

const device = (n: number) => `phone-${String(n).padStart(12, "0")}`;

test("one stable, unguessable link per dinner, for the host and the guests they said yes to", { skip }, async () => {
  const { t, shreya, serene, caleb, rajani, create, dinnerId, link } = await dinnerWorld();
  const first = await ok(link(shreya));
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.url, `https://homecookd.app/d?t=${first.token}`);
  assert.deepEqual(await ok(link(shreya)), first);

  await refusedWith(link(serene), 403, "Only the host and their guests can invite friends.");
  const { requestId } = await ok(join(t, serene, dinnerId));
  await refusedWith(link(serene), 403, /Only the host/); // asked, not in yet
  await ok(respond(t, shreya, requestId, true));
  assert.deepEqual(await ok(link(serene)), first); // a guest who's in shares the same link
  await refusedWith(link(caleb), 403, /Only the host/);
  await refusedWith(link(rajani), 403, /Only the host/); // the host's family isn't the host

  const another = await ok(link(shreya, await create(shreya)));
  assert.notEqual(another.token, first.token);
  await db().query("update dinners set status = 'cancelled' where id = $1", [dinnerId]);
  await refusedWith(link(shreya), 404, /isn't happening anymore/);
});

test("the token is stored only as its sha256 and sealed: the row alone opens nothing, and the host is shown the same link again", { skip }, async () => {
  const { shreya, dinnerId, link, get, open } = await dinnerWorld();
  const { token } = await ok(link(shreya));
  const row = (await db().query("select * from dinners where id = $1", [dinnerId])).rows[0];
  assert.ok(!JSON.stringify(row).includes(token), "no column holds the token");
  assert.equal(row.invite_token_hash, sha256Hex(token));
  assert.equal(await unseal(DINNER_INVITE_SALT, dinnerId, row.invite_token_enc), token);
  assert.equal(await unseal(DINNER_INVITE_SALT, "another-dinner", row.invite_token_enc), null, "sealed to its own dinner");
  assert.equal((await ok(link(shreya))).token, token);
  assert.equal((await open({ token, deviceId: device(1) })).statusCode, 200);
  assert.equal((await open({ token: sha256Hex(token), deviceId: device(1) })).statusCode, 404, "its hash isn't a way in");

  // Without the key, the link can't be shown, and it still opens: a plain sha256 needs no key.
  const key = process.env.EDIBLE_CODE_KEY;
  delete process.env.EDIBLE_CODE_KEY;
  try {
    assert.equal((await link(shreya)).status, 500);
    assert.equal((await open({ token, deviceId: device(2) })).statusCode, 200);
  } finally {
    process.env.EDIBLE_CODE_KEY = key;
  }

  // One that can't be opened is replaced, and the old link stops working.
  await db().query("update dinners set invite_token_enc = 'v1:AAAA.AAAA' where id = $1", [dinnerId]);
  const fresh = (await ok(link(shreya))).token;
  assert.notEqual(fresh, token);
  assert.equal((await open({ token, deviceId: device(3) })).statusCode, 404);
  assert.equal((await open({ token: fresh, deviceId: device(3) })).statusCode, 200);
  assert.equal((await get(shreya)).inviteOpens, 3);
});

test("opening the link counts each phone once and tells it only the dish, the host's name and when", { skip }, async () => {
  const { shreya, serene, dinnerId, link, get, open } = await dinnerWorld();
  // A name the family unique index still allows, with the shape the host's page shows.
  await db().query("update people set name = 'Grandma Rajani' where id = $1", [shreya.personId]);
  const { token } = await ok(link(shreya));
  const startsAt = (await get(shreya)).startsAt;
  assert.equal((await get(shreya)).inviteOpens, 0);

  const res = await open({ token, deviceId: device(1) }, "https://homecookd.app");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["access-control-allow-origin"], "https://homecookd.app");
  const body = res.json();
  // The same name the invite text and the dinner page's "Hosted by" pill use: never cut to "Grandma".
  assert.deepEqual(body, { dish: "Kanda Poha", hostName: "Grandma Rajani", startsAt });
  assert.equal(body.hostName, (await get(shreya)).hostName);
  for (const word of ["Baker", "Memorial", dinnerId, shreya.personId, token, ADDRESS]) assert.ok(!res.body.includes(word), word);
  assert.equal((await get(shreya)).inviteOpens, 1);

  await open({ token, deviceId: device(1) }); // the same phone again (the app's fetch: no Origin)
  assert.equal((await get(shreya)).inviteOpens, 1);
  const second = await open({ token, deviceId: device(2) }, "http://localhost:3000");
  assert.equal(second.headers["access-control-allow-origin"], "http://localhost:3000");
  // The count is live on the dinner page for whoever looks; the address still isn't.
  const hers = await get(serene);
  assert.equal(hers.inviteOpens, 2);
  assert.equal(hers.address, null);
});

test("links that don't work, bodies that don't parse, other sites, and dinners that are over", { skip }, async () => {
  const { t, shreya, dinnerId, link, get, open } = await dinnerWorld();
  const { token } = await ok(link(shreya));
  assert.equal((await open({ token: "x".repeat(43), deviceId: device(1) })).statusCode, 404);
  assert.equal((await open({ token, deviceId: "short" })).statusCode, 400);
  assert.equal((await open({ token: 12, deviceId: device(1) })).statusCode, 400);
  assert.equal((await open("not json")).statusCode, 400);
  const big = await open({ token, deviceId: device(1), extra: "x".repeat(2000) });
  assert.deepEqual([big.statusCode, big.json().error], [413, "too_large"], "the same status and code as every other route");
  const elsewhere = await open({ token, deviceId: device(1) }, "https://homecookd.app.example.com");
  assert.equal(elsewhere.statusCode, 403);
  assert.equal(elsewhere.headers["access-control-allow-origin"], undefined);
  assert.equal((await get(shreya)).inviteOpens, 0);

  const preflight = await t.inject({ method: "OPTIONS", url: "/invite/open", headers: { origin: "https://www.homecookd.app" } });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "https://www.homecookd.app");
  assert.ok(String(preflight.headers["access-control-allow-methods"]).includes("POST"));
  assert.equal((await t.inject({ method: "OPTIONS", url: "/invite/open", headers: { origin: "https://evil.example" } })).statusCode, 403);

  // Once it has started, the page still opens but nobody new counts; a called-off dinner's link stops working.
  await startIt(dinnerId);
  assert.equal((await open({ token, deviceId: device(3) })).statusCode, 200);
  assert.equal((await get(shreya)).inviteOpens, 0);
  await db().query("update dinners set status = 'cancelled' where id = $1", [dinnerId]);
  assert.equal((await open({ token, deviceId: device(4) })).statusCode, 404);
});

test("a flood of opens can't run the count up: a burst limit and a ceiling, and the page still opens", { skip }, async () => {
  const { shreya, dinnerId, link, get, open } = await dinnerWorld();
  const { token } = await ok(link(shreya));
  for (let i = 0; i < OPEN_BURST; i++) await open({ token, deviceId: device(i) }, undefined, `192.0.2.${i}`);
  assert.equal((await get(shreya)).inviteOpens, OPEN_BURST);
  const over = await open({ token, deviceId: device(OPEN_BURST) });
  assert.equal(over.statusCode, 200);
  assert.equal((await get(shreya)).inviteOpens, OPEN_BURST);
  await openedEarlier(OPEN_BURST_MS + 1000);
  await open({ token, deviceId: device(OPEN_BURST) });
  assert.equal((await get(shreya)).inviteOpens, OPEN_BURST + 1);

  // The ceiling: past MAX_OPENS nothing more counts.
  await db().query(
    `insert into dinner_invite_opens (dinner_id, device_id, created_at)
     select $1, 'filler-' || n, now() - interval '1 hour' from generate_series($2::int, $3::int) n`,
    [dinnerId, OPEN_BURST + 1, MAX_OPENS - 1],
  );
  assert.equal((await get(shreya)).inviteOpens, MAX_OPENS);
  assert.equal((await open({ token, deviceId: device(MAX_OPENS) })).statusCode, 200);
  assert.equal((await get(shreya)).inviteOpens, MAX_OPENS);
});

test("many opens at once stay under the burst limit, and one phone counts once", { skip }, async () => {
  const { shreya, link, get, open } = await dinnerWorld();
  const { token } = await ok(link(shreya));
  await Promise.all(Array.from({ length: 8 }, () => open({ token, deviceId: device(1) }, undefined, randomIp())));
  assert.equal((await get(shreya)).inviteOpens, 1);
  await Promise.all(Array.from({ length: OPEN_BURST + 10 }, (_, i) => open({ token, deviceId: device(i + 2) }, undefined, randomIp())));
  assert.equal((await get(shreya)).inviteOpens, OPEN_BURST);
});

test("an open that changes nothing doesn't wait on the dinner's row; a new phone does, and counts once it gets it", { skip }, async () => {
  const { shreya, dinnerId, link, get, open } = await dinnerWorld();
  const { token } = await ok(link(shreya));
  assert.equal((await open({ token, deviceId: device(1) })).statusCode, 200);
  // Someone else holds the dinner's row, as a host's answer does. If an open waited on it, the 10 s statement limit would make this a 500.
  const holder = await db().connect();
  try {
    await holder.query("begin");
    await holder.query("select id from dinners where id = $1 for update", [dinnerId]);
    assert.equal((await open({ token, deviceId: device(1) })).statusCode, 200); // this phone's been counted

    // A new phone needs the row: it waits, and nothing's counted yet.
    const waiting = open({ token, deviceId: device(2) });
    for (let tries = 0; ; tries += 1) {
      const { rows } = await db().query(`select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%from dinners d where d.id%for update%'`);
      if (rows.length > 0) break;
      assert.ok(tries < 300, "the new phone never reached the lock");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal((await db().query("select count(*)::int as n from dinner_invite_opens")).rows[0].n, 1);
    await holder.query("rollback");
    assert.equal((await waiting).statusCode, 200);
    assert.equal((await get(shreya)).inviteOpens, 2);

    // Past the burst limit, a new phone changes nothing either, so it doesn't wait.
    await db().query(`insert into dinner_invite_opens (dinner_id, device_id) select $1, 'filler-' || n from generate_series(1, $2::int) n`, [dinnerId, OPEN_BURST]);
    await holder.query("begin");
    await holder.query("select id from dinners where id = $1 for update", [dinnerId]);
    assert.equal((await open({ token, deviceId: device(3) })).statusCode, 200);
    await holder.query("rollback");
    assert.equal((await get(shreya)).inviteOpens, OPEN_BURST + 2);
  } finally {
    await holder.query("rollback").catch(() => {});
    holder.release();
  }
});

test("a real link to a dinner that's off answers as a bad token does, but uses up no one's limit", { skip }, async () => {
  const { t, shreya, serene, caleb, poha, create, dinnerId, link, open } = await dinnerWorld();
  const dorm = "192.0.2.210";
  const opens = RATE.badTokens.max + 5;
  const replyTo = async (body: object, ip = dorm) => {
    const res = await open(body, undefined, ip);
    const { requestId, ...rest } = res.json(); // every answer has its own
    assert.ok(requestId);
    return { status: res.statusCode, body: rest };
  };
  const unknown = await replyTo({ token: "u".repeat(43), deviceId: device(1) }, "192.0.2.211");
  assert.equal(unknown.status, 404);
  await clearWindow(RATE.badTokens.bucket);

  const assertNoLimitUsed = async (token: string, what: string) => {
    for (let i = 0; i < opens; i++) assert.deepEqual(await replyTo({ token, deviceId: device(1) }), unknown, `${what} ${i}`);
    const { rows } = await db().query(`select count(*)::int as n from rate_hits where key like $1`, [`${RATE.badTokens.bucket}:%`]);
    assert.equal(rows[0].n, 0, what);
  };

  // Called off.
  const { token: cancelled } = await ok(link(shreya));
  await db().query("update dinners set status = 'cancelled' where id = $1", [dinnerId]);
  await assertNoLimitUsed(cancelled, "cancelled");

  // Hidden by reports.
  const hiddenNight = await create(shreya);
  const { token: hidden } = await ok(link(shreya, hiddenNight));
  await db().query("update dinners set hidden_at = now() where id = $1", [hiddenNight]);
  await assertNoLimitUsed(hidden, "hidden");

  // Its dish hidden by two families' reports.
  const dishNight = await create(shreya);
  const { token: dishHidden } = await ok(link(shreya, dishNight));
  await ok(report(t, serene, "recipe", poha));
  await ok(report(t, caleb, "recipe", poha));
  await assertNoLimitUsed(dishHidden, "its dish hidden");

  // The same address guessing is still limited, and those opens didn't use any of it.
  for (let i = 0; i < RATE.badTokens.max; i++) assert.equal((await replyTo({ token: "g".repeat(43), deviceId: device(1) })).status, 404);
  assert.equal((await replyTo({ token: "g".repeat(43), deviceId: device(1) })).status, 429);
});

test("the public route has its rate limits: opens per address, and fewer for tokens that don't work", { skip }, async (s) => {
  const { t, shreya, link, open } = await dinnerWorld();
  const { token } = await ok(link(shreya));
  await s.test("a guessed token", async () => {
    await clearWindow(RATE.badTokens.bucket);
    for (let i = 0; i < RATE.badTokens.max; i++) assert.equal((await open({ token: "g".repeat(43), deviceId: device(1) }, undefined, "192.0.2.200")).statusCode, 404);
    const res = await open({ token: "g".repeat(43), deviceId: device(1) }, undefined, "192.0.2.200");
    assert.equal(res.statusCode, 429);
    assert.ok(res.headers["retry-after"]);
    assert.equal((await open({ token, deviceId: device(9) }, undefined, "192.0.2.201")).statusCode, 200); // someone else isn't held up
  });
  await s.test("opens from one address", async () => {
    await clearWindow(RATE.opens.bucket);
    for (let i = 0; i < RATE.opens.max; i++) assert.equal((await open({ token, deviceId: device(1) }, undefined, "192.0.2.202")).statusCode, 200);
    assert.equal((await open({ token, deviceId: device(1) }, undefined, "192.0.2.202")).statusCode, 429);
  });
  await s.test("no other method answers", async () => {
    assert.equal((await t.inject({ method: "GET", url: "/invite/open" })).statusCode, 404);
  });
});

after(async () => {
  if (hasDatabase) await db().end();
});

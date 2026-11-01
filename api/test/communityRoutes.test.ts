// What the Community routes owe the system rules, beyond Convex's behavior: a refused case for every route, each wrong-family or blocked case the same as a missing row, paged lists,
// the races Convex's serialized mutations used to stop, retries, and logs with no family content.
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { cravingCard, voiceUpload } from "./cravingHelpers.js";
import {
  ADDRESS, block, call, cookTogether, dinner, family, feed, host, join, MISSING, ok, person, recipe, refusedWith, report, requestSwap, respond, respondSwap, sameAsMissing, setShared, tryHost, view, type Who, world,
} from "./communityHelpers.js";
import { hasDatabase, IP, newBackend } from "./dishHelpers.js";

const skip = !hasDatabase;

function signedInRoutes(): { method: string; url: string }[] {
  const found: { method: string; url: string }[] = [];
  const app = buildApp({
    logger: false,
    routes: (a) => {
      a.addHook("onRoute", (route) => {
        for (const method of [route.method].flat()) {
          if (route.url.startsWith("/v1/") && route.url !== "/v1/me" && method !== "HEAD") found.push({ method, url: route.url });
        }
      });
    },
  });
  return Object.assign(found, { app });
}

test("every signed-in route refuses without a session, before it reads anything", { skip }, async () => {
  const t = await newBackend();
  const routes = signedInRoutes();
  await (routes as unknown as { app: FastifyInstance }).app.ready();
  assert.ok(routes.length >= 25, `only ${routes.length} routes`);
  const expired = await (async () => {
    const f = await family("Old home");
    const who = await person(f, "Old", "cook");
    await db().query("update sessions set expires_at = now() - interval '1 second' where person_id = $1", [who.personId]);
    return who;
  })();
  for (const { method, url } of routes) {
    const path = url.replace(":id", "anything");
    const body = method === "GET" || method === "DELETE" ? undefined : {};
    for (const who of [null, expired, { ...expired, token: "x".repeat(43) }]) {
      const r = await call(t, who, method as "GET", path, body);
      assert.equal(r.status, 401, `${method} ${url}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.error, "signed_out");
    }
  }
});

test("a deleted person's session is refused on Community", { skip }, async () => {
  const { t, serene } = await world();
  await db().query("update people set name = 'Deleted', approx_lat = null, approx_lng = null, deleted_at = now() where id = $1", [serene.personId]);
  assert.equal((await call(t, serene, "GET", "/v1/community/feed")).status, 401);
});

test("each wrong-family or blocked case is refused exactly as a missing row is, route by route", { skip }, async () => {
  const { t, rajani, shreya, serene, serenesMom, caleb } = await world();
  const privateDal = await recipe(rajani, { title: "Private Dal" });
  const poha = await recipe(rajani, { sharedAt: 1 });
  const dumplings = await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
  const night = await host(t, rajani, poha);
  const { requestId: calebsAsk } = await ok(join(t, caleb, night));
  const { swapId: calebsSwap } = await ok(requestSwap(t, caleb, poha));
  // A family that blocked the Pawars, and one the Pawars blocked.
  const ngozi = await person(await family("Okafor home", "Okafor"), "Ngozi", "cook");
  const ngozisDish = await recipe(ngozi, { title: "Jollof", sharedAt: 3 });
  const ngozisNight = await host(t, ngozi, ngozisDish);
  const { requestId: shreyasAsk } = await ok(join(t, shreya, ngozisNight));
  const { swapId: shreyasSwap } = await ok(requestSwap(t, shreya, ngozisDish));
  await ok(block(t, ngozi, "recipe", poha));
  // One the Zhangs reported.
  await ok(report(t, serene, "dinner", night));

  const cases: [string, (id: string) => ReturnType<typeof call>, string][] = [
    ["recipe page, not shared", (id) => view(t, serene, id), privateDal],
    ["recipe page, blocked", (id) => view(t, ngozi, id), poha],
    ["recipe page, blocked the other way", (id) => view(t, rajani, id), ngozisDish],
    ["swap, not shared", (id) => requestSwap(t, serene, id), privateDal],
    ["swap, blocked", (id) => requestSwap(t, shreya, id), ngozisDish],
    ["cook together, not shared", (id) => cookTogether(t, serene, id), privateDal],
    ["cook together, blocked", (id) => cookTogether(t, ngozi, id), poha],
    ["a swap's answer, a third family", (id) => respondSwap(t, serene, id, true), calebsSwap],
    ["a swap's answer, the asker", (id) => respondSwap(t, caleb, id, true), calebsSwap],
    ["a swap's answer, blocked", (id) => respondSwap(t, ngozi, id, true), shreyasSwap],
    ["report, not shared", (id) => report(t, serene, "recipe", id), privateDal],
    ["report, blocked", (id) => report(t, ngozi, "recipe", id), poha],
    ["report a dinner, blocked", (id) => report(t, rajani, "dinner", id), ngozisNight],
    ["block, not shared", (id) => block(t, serene, "recipe", id), privateDal],
    ["block a dinner, reported", (id) => block(t, serene, "dinner", id), night],
    ["unblock, another family's", (id) => call(t, serene, "DELETE", `/v1/community/blocks/${id}`), ""],
    ["host, not shared", (id) => tryHost(t, serene, id), privateDal],
    ["host, blocked", (id) => tryHost(t, shreya, id), ngozisDish],
    ["host, no yes yet", (id) => tryHost(t, caleb, id), dumplings],
    ["dinner page, blocked", (id) => dinner(t, shreya, id), ngozisNight],
    ["dinner page, reported", (id) => dinner(t, serene, id), night],
    ["join, blocked", (id) => join(t, ngozi, id), night],
    ["join, reported", (id) => join(t, serene, id), night],
    ["a host's answer, not the host", (id) => respond(t, shreya, id, true), calebsAsk],
    ["a host's answer, a guest", (id) => respond(t, caleb, id, true), calebsAsk],
    ["a host's answer, blocked", (id) => respond(t, ngozi, id, true), shreyasAsk],
    ["invite link, blocked", (id) => call(t, shreya, "POST", `/v1/dinners/${id}/invite-link`), ngozisNight],
    ["invite link, reported", (id) => call(t, serene, "POST", `/v1/dinners/${id}/invite-link`), night],
    ["put it on the map, another family's", (id) => call(t, serene, "POST", "/v1/share-requests", { recipeId: id }), privateDal],
  ];
  const { rows } = await db().query("select id from blocks limit 1");
  for (const [what, send, id] of cases) sameAsMissing(await send(id || rows[0].id), await send(MISSING), what);
});

test("a craving route refuses another family's card exactly as a missing one", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const { row } = await cravingCard(t, rajani);
  const cases: [string, (id: string) => ReturnType<typeof call>][] = [
    ["get", (id) => call(t, serene, "GET", `/v1/cravings/${id}`)],
    ["filming day", (id) => call(t, serene, "POST", `/v1/cravings/${id}/filming-day`, { day: 0 })],
    ["upload link", (id) => call(t, serene, "POST", `/v1/cravings/${id}/voice-recipe/upload`, { contentType: "audio/mp4", size: 400 })],
  ];
  for (const [what, send] of cases) sameAsMissing(await send(row.id), await send(MISSING), what);
  const key = await voiceUpload(t, rajani, row.id);
  const send = (id: string) => call(t, serene, "POST", `/v1/cravings/${id}/voice-recipe`, { audioKey: key, durationS: 4 });
  sameAsMissing(await send(row.id), await send(MISSING), "voice recipe");
});

test("a list refuses a cursor it didn't make, and a dinner's inputs are checked", { skip }, async () => {
  const { t, rajani, serene } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  for (const path of ["/v1/community/feed", "/v1/community/dinners", "/v1/community/swaps", "/v1/community/blocks", "/v1/dinners/mine", "/v1/share-requests/dishes", "/v1/cravings"]) {
    for (const cursor of ["junk", Buffer.from('["1\'; drop table dinners; --", "x"]').toString("base64url"), Buffer.from('{"a":1}').toString("base64url")]) {
      const r = await call(t, serene, "GET", `${path}?cursor=${cursor}`);
      assert.equal(r.status, 400, `${path} ${cursor}: ${JSON.stringify(r.data)}`);
    }
  }
  await refusedWith(tryHost(t, rajani, poha, { startsAt: Date.now() - 1000 }), 400, "Pick a time that hasn't passed.");
  await refusedWith(tryHost(t, rajani, poha, { seats: 0 }), 400, "Seats go from 1 to 20.");
  await refusedWith(tryHost(t, rajani, poha, { seats: 21 }), 400, "Seats go from 1 to 20.");
  await refusedWith(tryHost(t, rajani, poha, { seats: 1.5 }), 400, "Seats go from 1 to 20.");
  await refusedWith(tryHost(t, rajani, poha, { placeName: "  " }), 400, "Add the place's name.");
  await refusedWith(tryHost(t, rajani, poha, { address: "x".repeat(201) }), 400, "Add the address.");
  assert.equal((await tryHost(t, rajani, poha, { placeKind: "castle" })).status, 400);
  assert.equal((await report(t, serene, "recipe", poha, "because")).status, 400);
  assert.equal((await call(t, serene, "POST", "/v1/community/reports", { kind: "family", targetId: rajani.familyId })).status, 400); // a block files these, nobody else
  assert.equal((await respond(t, rajani, MISSING, "maybe" as unknown as boolean)).status, 400);
});

test("a forged cursor of the right shape is a 400 on every list: a date that can't be one never reaches Postgres", { skip }, async () => {
  const { t, serene } = await world();
  const encode = (parts: (string | number)[]) => Buffer.from(JSON.stringify(parts)).toString("base64url");
  const BAD_TIMES = [
    "2026-13-01 12:00:00+00", // no such month
    "2026-02-31 12:00:00+00", // no such day
    "2026-00-10 12:00:00+00",
    "2026-10-00 12:00:00+00",
    "2026-10-01 25:00:00+00",
    "2026-10-01 12:61:00+00",
    "2026-10-01 12:00:61+00",
    "0000-10-01 12:00:00+00",
    "999999-10-01 12:00:00+00",
    "2026-10-01 12:00:00+99",
    "2026-10-01 12:00:00+05:99",
  ];
  const lists: [string, (at: string) => (string | number)[]][] = [
    ["/v1/community/feed", (at) => [at, "x", 0]],
    ["/v1/community/dinners", (at) => [at, "x"]],
    ["/v1/community/swaps", (at) => [at, "x"]],
    ["/v1/dinners/mine", (at) => [at, "x", "done", "done"]],
    ["/v1/dinners/mine", (at) => ["done", "done", at, "x"]],
    ["/v1/share-requests/dishes", (at) => [at, "x"]],
    ["/v1/cravings", (at) => [at, "x"]],
  ];
  for (const [path, parts] of lists) {
    for (const at of BAD_TIMES) {
      const r = await call(t, serene, "GET", `${path}?cursor=${encode(parts(at))}`);
      assert.equal(r.status, 400, `${path} ${at}: ${JSON.stringify(r.data)}`);
      assert.equal(r.data.error, "bad_request");
    }
    // A real date in that shape is still a page, not a refusal.
    assert.equal((await call(t, serene, "GET", `${path}?cursor=${encode(parts("2026-02-28 23:59:59.123456+05:30"))}`)).status, 200, path);
  }
  // A leap day only when there is one.
  assert.equal((await call(t, serene, "GET", `/v1/community/swaps?cursor=${encode(["2028-02-29 12:00:00+00", "x"])}`)).status, 200);
  assert.equal((await call(t, serene, "GET", `/v1/community/swaps?cursor=${encode(["2026-02-29 12:00:00+00", "x"])}`)).status, 400);
});

test("a cursor holding a NUL byte is a 400 on every list", { skip }, async () => {
  const { t, serene } = await world();
  const encode = (parts: (string | number)[]) => Buffer.from(JSON.stringify(parts)).toString("base64url");
  const AT = "2026-10-01 12:00:00+00";
  const cases: [string, (string | number)[]][] = [
    ["/v1/community/feed", [AT, "a\u0000b", 0]],
    ["/v1/community/dinners", [AT, "a\u0000b"]],
    ["/v1/community/swaps", [AT, "a\u0000b"]],
    ["/v1/community/blocks", ["a\u0000b"]],
    ["/v1/dinners/mine", [AT, "a\u0000b", "done", "done"]],
    ["/v1/share-requests/dishes", [AT, "a\u0000b"]],
    ["/v1/cravings", [AT, "a\u0000b"]],
  ];
  for (const [path, parts] of cases) {
    const r = await call(t, serene, "GET", `${path}?cursor=${encode(parts)}`);
    assert.equal(r.status, 400, `${path}: ${JSON.stringify(r.data)}`);
  }
});

test("a NUL byte in any route's id, query or body is refused, never a 500", { skip }, async () => {
  const { serene } = await world();
  const found: { method: string; url: string; body: string[] }[] = [];
  const t = buildApp({
    logger: false,
    routes: (a) => {
      a.addHook("onRoute", (route) => {
        const schema = route.schema as { body?: { properties?: Record<string, unknown> } } | undefined;
        for (const method of [route.method].flat()) {
          if (method !== "HEAD" && method !== "OPTIONS") found.push({ method, url: route.url, body: Object.keys(schema?.body?.properties ?? {}) });
        }
      });
    },
  });
  await t.ready();
  const reachable = found.filter((r) => r.url !== "/health" && r.url !== "/ready" && !r.url.includes("*"));
  assert.ok(reachable.length >= 35, `only ${reachable.length} routes`);
  const headers = { authorization: `Bearer ${serene.token}`, origin: "https://homecookd.app", "content-type": "application/json" };
  const NUL = "a\u0000b";
  let next = 0;
  for (const { method, url, body } of reachable) {
    const path = url.replace(/:[a-zA-Z]+/g, "a%00b");
    const hasBody = method !== "GET" && method !== "DELETE";
    const requests: { url: string; payload?: string }[] = [{ url: `${path}${path.includes("?") ? "&" : "?"}cursor=a%00b&kind=a%00b&q=a%00b` }];
    if (url !== path) requests.push({ url: path, ...(hasBody ? { payload: "{}" } : {}) });
    if (hasBody) for (const field of body) requests.push({ url: url.replace(/:[a-zA-Z]+/g, "plain-id"), payload: JSON.stringify({ [field]: NUL }) });
    if (hasBody) requests[0].payload = "{}";
    for (const request of requests) {
      // A new address each time, so a public route's rate limit doesn't answer in the check's place.
      next += 1;
      const res = await t.inject({ method: method as "GET", headers, remoteAddress: `198.18.${next >> 8}.${next & 255}`, ...request });
      assert.ok([400, 404].includes(res.statusCode), `${method} ${request.url} ${request.payload ?? ""}: ${res.statusCode} ${res.body}`);
    }
  }
  // Nested, as a list's item and an object's field.
  const nested = await t.inject({ method: "POST", url: "/dish/cards/update", headers, payload: JSON.stringify({ kidToken: "A".repeat(22), edits: [{ kind: "line", text: NUL }] }) });
  assert.ok([400, 404].includes(nested.statusCode), nested.body);
});

test("every list pages: nothing is repeated or lost, and the same rows come back to the microsecond", { skip }, async (s) => {
  const { t, rajani, shreya, serene, serenesMom } = await world();
  const walk = async (who: Who, path: string, list: string, id: string) => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: any = await ok(call(t, who, "GET", `${path}${cursor ? `?cursor=${cursor}` : ""}`));
      seen.push(...page[list].map((row: Record<string, string>) => row[id]));
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 20, "the pages never ended");
    } while (cursor);
    return { seen, pages };
  };
  const shuffleTimes = (table: string) => db().query(`update ${table} set created_at = '2026-10-01 12:00:00.123456+00'::timestamptz + (random() * 5) * interval '1 microsecond'`);

  await s.test("shared recipes", async () => {
    await db().query(
      `insert into recipes (family_id, cook_id, title, status, shared_at)
       select $1, $2, 'Dish ' || n, 'ready', '2026-10-01 12:00:00.123456+00'::timestamptz + n * interval '1 microsecond' from generate_series(1, 230) n`,
      [rajani.familyId, rajani.personId],
    );
    const { seen, pages } = await walk(serene, "/v1/community/feed", "recipes", "recipeId");
    assert.equal(seen.length, 230);
    assert.equal(new Set(seen).size, 230);
    assert.ok(pages >= 5, `${pages} pages`);
    assert.equal((await feed(t, serene)).recipes.length, 50);
  });

  await s.test("my family's dishes", async () => {
    const { seen } = await walk(shreya, "/v1/share-requests/dishes", "dishes", "recipeId");
    assert.equal(new Set(seen).size, 230);
  });

  await s.test("swaps, both ways", async () => {
    const dumplings = await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
    await db().query(
      `insert into swap_requests (requester_id, requester_family_id, their_recipe_id, other_family_id, status)
       select $1, $2, id, $3, 'pending' from recipes where title like 'Dish %' limit 70`,
      [serenesMom.personId, serenesMom.familyId, rajani.familyId],
    );
    await db().query(
      `insert into swap_requests (requester_id, requester_family_id, their_recipe_id, other_family_id, status) values ($1, $2, $3, $4, 'pending')`,
      [rajani.personId, rajani.familyId, dumplings, serenesMom.familyId],
    );
    await shuffleTimes("swap_requests");
    const { seen, pages } = await walk(rajani, "/v1/community/swaps", "swaps", "swapId");
    assert.equal(seen.length, 71);
    assert.equal(new Set(seen).size, 71);
    assert.ok(pages >= 2);
    await db().query("delete from swap_requests");
  });

  await s.test("my dinners, hosted and asked", async () => {
    const dish = (await db().query("select id from recipes where title = 'Dish 1'")).rows[0].id;
    await db().query(
      `insert into dinners (host_id, host_family_id, recipe_id, dish, starts_at, place_kind, place_name, address, approx_lat, approx_lng, seats, status)
       select $1, $2, $3, 'Dish 1', now() + n * interval '1 hour', 'home', 'Kitchen', 'x', 42.36, -71.09, 2, 'open' from generate_series(1, 120) n`,
      [rajani.personId, rajani.familyId, dish],
    );
    await db().query(
      `insert into dinner_requests (dinner_id, guest_id, guest_family_id, status) select id, $1, $2, 'pending' from dinners`,
      [serene.personId, serene.familyId],
    );
    await shuffleTimes("dinner_requests");
    const hostSide = await walk(rajani, "/v1/dinners/mine", "dinners", "dinnerId");
    assert.equal(new Set(hostSide.seen).size, 120);
    const guestSide = await walk(serene, "/v1/dinners/mine", "dinners", "dinnerId");
    assert.equal(new Set(guestSide.seen).size, 120);
    assert.equal(guestSide.seen.length, 120);
  });

  await s.test("the feed's dinners: 20 at a time, past the first window", async () => {
    const first = await feed(t, serene);
    assert.equal(first.dinners.length, 20);
    const seen = new Set<string>(first.dinners.map((d: any) => d.dinnerId));
    let cursor = first.dinnersCursor;
    while (cursor) {
      const page = await ok(call(t, serene, "GET", `/v1/community/dinners?cursor=${cursor}`));
      for (const d of page.dinners) seen.add(d.dinnerId);
      cursor = page.nextCursor;
    }
    assert.equal(seen.size, 120);
  });

  await s.test("a family's blocks", async () => {
    await db().query(`insert into families (id, name) select 'filler-' || n, 'Filler ' || n from generate_series(1, 130) n`);
    await db().query(`insert into blocks (family_id, blocked_family_id, label) select $1, id, 'A family' from families where id like 'filler-%'`, [serene.familyId]);
    const { seen, pages } = await walk(serene, "/v1/community/blocks", "blocked", "blockId");
    assert.equal(new Set(seen).size, 130);
    assert.equal(pages, 2);
  });
});

test("races Convex's mutations used to stop", { skip }, async (s) => {
  const { t, rajani, shreya, serene, serenesMom, caleb } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });

  await s.test("two yeses can't both take the last seat", async () => {
    const night = await host(t, rajani, poha, { seats: 1 });
    const asks = await Promise.all([serene, caleb].map((who) => ok(join(t, who, night))));
    const replies = await Promise.all(asks.map((a) => respond(t, rajani, a.requestId, true)));
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
    const { rows } = await db().query("select count(*)::int as n from dinner_requests where dinner_id = $1 and status = 'accepted'", [night]);
    assert.equal(rows[0].n, 1);
    assert.equal((await dinner(t, rajani, night)).data.status, "full");
  });

  await s.test("two taps to join stay one ask", async () => {
    const night = await host(t, rajani, poha);
    const replies = await Promise.all(Array.from({ length: 4 }, () => join(t, serene, night)));
    assert.equal(replies.filter((r) => r.status === 200).length, 1);
    assert.equal(replies.filter((r) => r.status === 409).length, 3);
  });

  await s.test("two families reporting a dinner at the same moment still hide it", async () => {
    for (let round = 0; round < 5; round += 1) {
      const night = await host(t, rajani, poha);
      await Promise.all([serene, caleb].map((who) => ok(report(t, who, "dinner", night))));
      const { rows } = await db().query("select hidden_at from dinners where id = $1", [night]);
      assert.ok(rows[0].hidden_at, `round ${round}`);
    }
  });

  await s.test("a family asking twice at once is one ask", async () => {
    const dumplings = await recipe(serenesMom, { title: "Dumplings", sharedAt: 2 });
    const replies = await Promise.all([rajani, shreya, rajani, shreya].map((who) => ok(requestSwap(t, who, dumplings))));
    assert.equal(new Set(replies.map((r) => r.swapId)).size, 1);
  });

  await s.test("two answers to one swap: one wins", async () => {
    const dish = await recipe(serenesMom, { title: "Bao", sharedAt: 3 });
    const { swapId } = await ok(requestSwap(t, shreya, dish));
    const replies = await Promise.all([serene, serenesMom].map((who) => respondSwap(t, who, swapId, true)));
    assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
  });

  await s.test("two blocks at once are one block and one report", async () => {
    const before = (await db().query("select count(*)::int as n from reports where kind = 'family'")).rows[0].n;
    await Promise.all([serene, serenesMom].map((who) => ok(block(t, who, "recipe", poha))));
    assert.equal((await db().query("select count(*)::int as n from blocks where family_id = $1", [serene.familyId])).rows[0].n, 1);
    assert.equal((await db().query("select count(*)::int as n from reports where kind = 'family'")).rows[0].n, before + 1);
  });

  await s.test("two invite links at once are one link", async () => {
    const night = await host(t, rajani, poha);
    const links = await Promise.all(Array.from({ length: 5 }, () => ok(call(t, rajani, "POST", `/v1/dinners/${night}/invite-link`))));
    assert.equal(new Set(links.map((l) => l.token)).size, 1);
    const { rows } = await db().query("select invite_token from dinners where id = $1", [night]);
    assert.equal(rows[0].invite_token, links[0].token);
  });
});

test("a phone's retry of a new dinner, with its key, gets the first dinner back", { skip }, async () => {
  const { t, rajani } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const body = { startsAt: Date.now() + 3_600_000 };
  const headers = { "idempotency-key": "retry-key-0001" };
  const first = await ok(tryHost(t, rajani, poha, body, headers));
  assert.deepEqual(await ok(tryHost(t, rajani, poha, body, headers)), first);
  await refusedWith(tryHost(t, rajani, poha, { startsAt: body.startsAt + 1000 }, headers), 409);
  assert.equal((await tryHost(t, rajani, poha, body, { "idempotency-key": "x" })).status, 400);
  // At the same moment, too.
  const many = await Promise.all(Array.from({ length: 5 }, () => ok(tryHost(t, rajani, poha, body, { "idempotency-key": "retry-key-0002" }))));
  assert.equal(new Set(many.map((r) => r.dinnerId)).size, 1);
  const { rows } = await db().query("select count(*)::int as n from dinners");
  assert.equal(rows[0].n, 2);
  // Old builds send none: each is its own dinner, as on Convex.
  await ok(tryHost(t, rajani, poha, body));
  await ok(tryHost(t, rajani, poha, body));
  assert.equal((await db().query("select count(*)::int as n from dinners")).rows[0].n, 4);
});

test("a retry gets its dinner back even when the checks would refuse it now", { skip }, async () => {
  const { t, rajani } = await world();
  const poha = await recipe(rajani, { sharedAt: 1 });
  const body = { startsAt: Date.now() + 3_600_000 };
  const headers = { "idempotency-key": "retry-key-0003" };
  const first = await ok(tryHost(t, rajani, poha, body, headers));

  // The dish has been unshared since: the same key is the first dinner, and a new one is refused.
  await setShared(poha, false);
  assert.deepEqual(await ok(tryHost(t, rajani, poha, body, headers)), first);
  await refusedWith(tryHost(t, rajani, poha, body, { "idempotency-key": "retry-key-0004" }), 409, "Share this recipe first.");
  await setShared(poha, true);

  // Its time has passed since.
  const now = Date.now;
  Date.now = () => now() + 2 * 3_600_000;
  try {
    assert.deepEqual(await ok(tryHost(t, rajani, poha, body, headers)), first);
    await refusedWith(tryHost(t, rajani, poha, body, { "idempotency-key": "retry-key-0005" }), 400, "Pick a time that hasn't passed.");
  } finally {
    Date.now = now;
  }
  // Only the first dinner was ever made.
  const { rows } = await db().query("select count(*)::int as n from dinners");
  assert.equal(rows[0].n, 1);
});

test("logs carry no family content, as production writes them", { skip }, async () => {
  const { rajani, serene, caleb } = await world();
  const lines: string[] = [];
  const stream = new Writable({ write: (chunk, _enc, done) => (lines.push(String(chunk)), done()) });
  // Production's logger and its serializers, with only where it writes changed, at the level that says the most.
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "trace";
  const t = buildApp({ logStream: stream });
  if (level === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = level;
  const poha = await recipe(rajani, { sharedAt: 1 });
  const night = await host(t, rajani, poha);
  const { requestId } = await ok(join(t, serene, night));
  await ok(respond(t, rajani, requestId, true));
  await ok(block(t, caleb, "dinner", night));
  const salik = await person(await family("Mian home"), "Salik", "kid");
  await ok(report(t, salik, "recipe", poha, "rude"));
  await feed(t, serene);
  const secretCursor = Buffer.from(JSON.stringify(["2026-10-01 12:00:00+00", "the-cursor-secret"])).toString("base64url");
  await ok(call(t, serene, "GET", `/v1/community/swaps?cursor=${secretCursor}`));
  const { token } = await ok(call(t, rajani, "POST", `/v1/dinners/${night}/invite-link`));
  await t.inject({ method: "POST", url: "/invite/open", remoteAddress: IP, payload: { token, deviceId: "device-0123456789abcdef" } });
  // A database failure's log line carries its type and code, not its text.
  await db().query("alter table dinner_requests rename to dinner_requests_gone");
  try {
    assert.equal((await t.inject({ method: "GET", url: `/v1/dinners/${night}`, headers: { authorization: `Bearer ${rajani.token}` } })).statusCode, 500);
  } finally {
    await db().query("alter table dinner_requests_gone rename to dinner_requests");
  }
  const all = lines.join("");
  assert.ok(all.length > 0);
  for (const word of ["Kanda", "Poha", "Rajani", "Serene", "Caleb", "Pawar", ADDRESS, "Baker", token, "dinner_requests", rajani.token, serene.token, secretCursor, "the-cursor-secret"]) assert.ok(!all.includes(word), word);
  // It really was production's: a request is its method and path, and never the url with its query.
  assert.ok(all.includes('"path":"/v1/community/swaps"'), "the path serializer");
  assert.ok(!all.includes('"url"'), "a whole url");
  assert.ok(all.includes('"status":200'), "the response serializer");
});

after(async () => {
  if (hasDatabase) await db().end();
});

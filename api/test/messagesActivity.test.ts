// Shares, pending sends, hearts and recipe events: supabase/tests/api_test.ts, hearts_test.ts and the pure helpers from them, on real Postgres.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { deliverPending, HEARTS_RECENT_LIMIT, MAX_JOINS_PER_LINK, parseDishIds, parseSince } from "../src/modules/messages/activity.js";
import { dishesOf, makeLibrary } from "../src/modules/messages/library.js";
import { SHARE_LINK_SALT, shareTokenHash, unseal } from "../src/sealed.js";
import { CHILI, closeAll, DAL, DAY_MS, drain, fileRow, get, newKey, ok, pairOf, phone, post, pushes, refused, RICE, skip, tokenFor, uploaded, type Who, type World, world } from "./messagesHelpers.js";

const event = (w: World, who: Who, body: Record<string, unknown>) => post(w.app, who, "/v1/events", body, { key: null });
const heart = (w: World, who: Who, libraryId: string, on = true) => post(w.app, who, "/v1/favorites", { libraryId, on }, { key: null });

// --- pending sends

test("retention: a recording delivered by the pipeline pushes 'Just in from' once; the worker's retry delivers nothing", { skip }, async () => {
  const w = await world();
  await phone(w, w.leo, "leo");
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-chili", recipientIds: [w.leo.id, w.dad.id] }));
  const pub = () => post(w.app, w.dad, "/v1/pending-sends/job-chili/published", { libraryId: CHILI }, { key: null });
  assert.deepEqual(ok(await pub()), { delivered: 1 });
  await drain();
  assert.deepEqual(pushes(w.expo), [[tokenFor("leo"), "Just in from Dad", "Dad's Sunday Chili", `/recipe/${CHILI}`]]);
  assert.deepEqual(ok(await pub()), { delivered: 0, already: true });
  await drain();
  assert.equal(w.expo.sent.flat().length, 1);
});

test("two deliveries at once: one delivers, and the recipients get one message each", { skip }, async () => {
  const w = await world();
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-race", recipientIds: [w.leo.id, w.nia.id] }));
  const out = await Promise.all([deliverPending(w.family, "job-race", CHILI), deliverPending(w.family, "job-race", CHILI)]);
  assert.deepEqual(out.map((r) => r.delivered).sort(), [0, 2]);
  assert.equal((await db().query(`select count(*)::int as n from messages where kind = 'recipe'`)).rows[0].n, 2);
});

test("a delivery that fails halfway leaves nothing sent and the send still waiting, where Supabase released its claim by hand", { skip }, async () => {
  const w = await world();
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-fail", recipientIds: [w.leo.id, w.nia.id] }));
  await db().query(`alter table messages add constraint test_refuse check (kind <> 'recipe' or library_id <> 'boom-dish')`);
  try {
    await assert.rejects(deliverPending(w.family, "job-fail", "boom-dish"));
  } finally {
    await db().query(`alter table messages drop constraint test_refuse`);
  }
  assert.equal((await db().query(`select count(*)::int as n from messages`)).rows[0].n, 0);
  assert.equal((await db().query(`select delivered_at from pending_sends where upload_id = 'job-fail'`)).rows[0].delivered_at, null);
  assert.deepEqual(await deliverPending(w.family, "job-fail", CHILI), { delivered: 2 });
});

test("pending sends: recipients are people here; a job that's someone else's or already delivered is refused; a re-register replaces the list", { skip }, async () => {
  const w = await world();
  const send = (body: Record<string, unknown>, who: Who = w.dad, key = newKey()) => post(w.app, who, "/v1/pending-sends", body, { key });
  refused(await send({ uploadId: "BAD ID", recipientIds: [w.leo.id] }), 400, "invalid", "uploadId");
  refused(await send({ uploadId: "up-1", recipientIds: [] }), 400, "invalid", "recipientIds");
  refused(await send({ uploadId: "up-1", recipientIds: [w.stranger.id] }), 404);
  refused(await send({ uploadId: "up-1", recipientIds: [w.dad.id] }), 400, "invalid", "recipientIds");
  ok(await send({ uploadId: "up-1", recipientIds: [w.leo.id] }));
  refused(await send({ uploadId: "up-1", recipientIds: [w.strangerKid.id] }, w.stranger), 409, "conflict");
  ok(await send({ uploadId: "up-1", recipientIds: [w.nia.id] }));
  assert.deepEqual((await db().query(`select recipient_ids from pending_sends where upload_id = 'up-1'`)).rows[0].recipient_ids, [w.nia.id]);
  await deliverPending(w.family, "up-1", CHILI);
  refused(await send({ uploadId: "up-1", recipientIds: [w.leo.id] }), 409, "already_delivered");
});

test("a recording published before the phone registered goes out right away, with its hello", { skip }, async () => {
  const w = await world();
  w.lib.published.set("job-fast", CHILI);
  const hello = await uploaded(w, w.dad);
  assert.deepEqual(ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-fast", recipientIds: [w.leo.id], helloKey: hello, helloDurationS: 4 })), { ok: true, delivered: 1 });
  const pair = await pairOf(w, w.dad, w.leo);
  const msgs = ok(await get(w.app, w.leo, `/v1/threads/${pair}/messages`)).messages;
  assert.deepEqual(msgs.map((m: any) => [m.kind, m.libraryId, m.durationS]), [["recipe", CHILI, null], ["voice", CHILI, 4]]);
  assert.notEqual((await fileRow(hello)).attached_at, null);
  // The dish's delivered recording is what GET /table's pool plays.
  assert.deepEqual(ok(await get(w.app, w.leo, "/v1/table")).recordings, [CHILI]);
});

test("re-registering with the same hello isn't a second attach", { skip }, async () => {
  const w = await world();
  const hello = await uploaded(w, w.dad);
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-h", recipientIds: [w.leo.id], helloKey: hello }));
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-h", recipientIds: [w.nia.id], helloKey: hello }));
});

test("re-registering with another hello marks the old one in the same breath, and dropping the hello does too: a private voice note can't outlive its owner", { skip }, async () => {
  const w = await world();
  const first = await uploaded(w, w.dad);
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-swap", recipientIds: [w.leo.id], helloKey: first }));
  assert.equal((await fileRow(first)).delete_requested_at, null);
  const second = await uploaded(w, w.dad);
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-swap", recipientIds: [w.leo.id], helloKey: second }));
  assert.notEqual((await fileRow(first)).delete_requested_at, null, "the replaced hello is on its way out");
  assert.equal((await fileRow(second)).delete_requested_at, null);
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-swap", recipientIds: [w.leo.id] }));
  assert.notEqual((await fileRow(second)).delete_requested_at, null, "a hello taken off goes too");
  // The same hello again changes nothing.
  const third = await uploaded(w, w.dad);
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-swap", recipientIds: [w.leo.id], helloKey: third }));
  ok(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-swap", recipientIds: [w.nia.id], helloKey: third }));
  assert.equal((await fileRow(third)).delete_requested_at, null);
});

test("two registers racing with different hellos leave one, and mark the other", { skip }, async () => {
  const w = await world();
  for (let round = 0; round < 6; round += 1) {
    const [a, b] = [await uploaded(w, w.dad), await uploaded(w, w.dad)];
    const uploadId = `job-race-${round}`;
    const send = (helloKey: string) => post(w.app, w.dad, "/v1/pending-sends", { uploadId, recipientIds: [w.leo.id], helloKey });
    const replies = await Promise.all([send(a), send(b)]);
    assert.deepEqual(replies.map((r) => r.status), [200, 200]);
    const kept = (await db().query(`select hello_key from pending_sends where upload_id = $1`, [uploadId])).rows[0].hello_key;
    const loser = kept === a ? b : a;
    assert.notEqual((await fileRow(loser)).delete_requested_at, null, `round ${round}: the loser survived`);
    assert.equal((await fileRow(kept)).delete_requested_at, null);
  }
});

test("only the sender can change a recording's list, and only the sender can deliver it: not anyone else in the family with the upload id", { skip }, async () => {
  const w = await world();
  ok(await post(w.app, w.mom, "/v1/pending-sends", { uploadId: "job-moms", recipientIds: [w.leo.id] }));
  const hijack = await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-moms", recipientIds: [w.nia.id] });
  assert.deepEqual([hijack.status, hijack.data.error], [409, "conflict"]);
  const row = (await db().query(`select sender_id, recipient_ids from pending_sends where upload_id = 'job-moms'`)).rows[0];
  assert.deepEqual([row.sender_id, row.recipient_ids], [w.mom.id, [w.leo.id]]);

  const fromDad = await post(w.app, w.dad, "/v1/pending-sends/job-moms/published", { libraryId: CHILI }, { key: null });
  assert.deepEqual([fromDad.status, fromDad.data.error, fromDad.data.message], [403, "forbidden", "Only whoever recorded this can send it."]);
  assert.equal((await db().query(`select delivered_at from pending_sends where upload_id = 'job-moms'`)).rows[0].delivered_at, null);
  assert.equal((await db().query(`select count(*)::int as n from messages`)).rows[0].n, 0, "no message went out as Mom");

  assert.deepEqual(ok(await post(w.app, w.mom, "/v1/pending-sends/job-moms/published", { libraryId: CHILI }, { key: null })), { delivered: 1 });
  // The worker has no person: it still delivers.
  ok(await post(w.app, w.mom, "/v1/pending-sends", { uploadId: "job-worker", recipientIds: [w.leo.id] }));
  assert.deepEqual(await deliverPending(w.family, "job-worker", CHILI), { delivered: 1 });
});

test("a recording already published isn't delivered by someone else trying to register it", { skip }, async () => {
  const w = await world();
  ok(await post(w.app, w.mom, "/v1/pending-sends", { uploadId: "job-fast-2", recipientIds: [w.leo.id] }));
  w.lib.published.set("job-fast-2", CHILI);
  refused(await post(w.app, w.dad, "/v1/pending-sends", { uploadId: "job-fast-2", recipientIds: [w.leo.id] }), 409, "conflict");
  assert.equal((await db().query(`select count(*)::int as n from messages`)).rows[0].n, 0);
});

// --- shares

test("a share link is one per family, dish and sender; opening it counts and names who sent it, and a full one gets replaced", { skip }, async () => {
  const w = await world();
  const made = ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null }));
  assert.match(made.token, /^[0-9A-Za-z]{10}$/);
  assert.equal(made.url, `https://homecookd.app/r?s=${made.token}`);
  assert.equal(ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null })).token, made.token);
  assert.notEqual(ok(await post(w.app, w.dad, "/v1/shares", { libraryId: CHILI }, { key: null })).token, made.token);
  refused(await post(w.app, w.mom, "/v1/shares", { libraryId: "no-such-dish" }, { key: null }), 404, "not_found", { message: "That recipe isn't here anymore." });

  process.env.MEDIA_BASE_URL = "https://media.test";
  const opened = ok(await post(w.app, null, "/v1/shares/open", { token: made.token }, { key: null }));
  delete process.env.MEDIA_BASE_URL;
  assert.deepEqual([opened.libraryId, opened.recipeUrl, opened.sender.name], [CHILI, `https://media.test/${CHILI}/recipe.json`, "Mom"]);
  assert.match(opened.familyName, /^The Wangs/);
  const row = (await db().query(`select id, open_count, last_opened_at from shares where token_hash = $1`, [shareTokenHash(made.token)])).rows[0];
  assert.equal(row.open_count, 1);
  assert.notEqual(row.last_opened_at, null);

  for (const token of ["nope", "ABCDEFGHIJ", 12]) refused(await post(w.app, null, "/v1/shares/open", { token }, { key: null }), 404);

  for (let i = 0; i < MAX_JOINS_PER_LINK; i += 1) {
    await db().query(`insert into signups (name, share_token, family_id) values ($1, $2, $3)`, [`Kid ${i}`, `share:${row.id}`, w.family]);
  }
  assert.notEqual(ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null })).token, made.token);
});

test("a share link's token is stored only as a keyed hash and sealed: the row alone opens nothing, and the family is shown the same link again", { skip }, async () => {
  const w = await world();
  const made = ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null }));
  const [row] = (await db().query(`select * from shares`)).rows;
  assert.ok(!JSON.stringify(row).includes(made.token), "no column holds the token");
  assert.equal(row.token_hash, shareTokenHash(made.token));
  assert.notEqual(row.token_hash, createHash("sha256").update(made.token).digest("hex"), "keyed, so a copy of the table can't be searched by plain sha256");
  assert.equal(await unseal(SHARE_LINK_SALT, row.id, row.token_enc), made.token);
  assert.equal(await unseal(SHARE_LINK_SALT, "another-row", row.token_enc), null, "sealed to its own row");
  assert.equal(ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null })).token, made.token);

  // One that can't be opened gets a new link; the old one still opens.
  await db().query(`update shares set token_enc = 'v1:AAAA.AAAA'`);
  const next = ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null }));
  assert.notEqual(next.token, made.token);
  ok(await post(w.app, null, "/v1/shares/open", { token: made.token }, { key: null }));

  // Without the key nothing is made, and nothing opens: the hash needs it too.
  const key = process.env.EDIBLE_CODE_KEY;
  delete process.env.EDIBLE_CODE_KEY;
  try {
    refused(await post(w.app, w.dad, "/v1/shares", { libraryId: CHILI }, { key: null }), 500);
    refused(await post(w.app, null, "/v1/shares/open", { token: next.token }, { key: null }), 500);
  } finally {
    process.env.EDIBLE_CODE_KEY = key;
  }
  assert.equal((await db().query(`select count(*)::int as n from shares`)).rows[0].n, 2);
});

test("the website opens a share from a browser: its answer, a dead link and the limit all carry CORS for SITE_ORIGINS, and another site opens nothing", { skip }, async () => {
  const w = await world();
  const site = "https://homecookd.app";
  process.env.SITE_ORIGINS = `${site},https://www.homecookd.app`;
  try {
    const made = ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null }));
    const cors = (r: Awaited<ReturnType<typeof w.app.inject>>) => [r.headers["access-control-allow-origin"], r.headers["access-control-expose-headers"], r.headers.vary];
    const open = (token: string, origin: string, ip = "192.0.2.210") =>
      w.app.inject({ method: "POST", url: "/v1/shares/open", remoteAddress: ip, headers: { origin, "content-type": "application/json" }, payload: JSON.stringify({ token }) });

    const opened = await open(made.token, site);
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.json().libraryId, CHILI);
    assert.deepEqual(cors(opened), [site, "retry-after, x-request-id", "Origin"]);
    const dead = await open("ABCDEFGHIJ", site);
    assert.deepEqual([dead.statusCode, ...cors(dead)], [404, site, "retry-after, x-request-id", "Origin"], "the page can read that the link is gone");

    const evil = await open(made.token, "https://evil.example");
    assert.deepEqual([evil.statusCode, evil.json().error, evil.headers["access-control-allow-origin"]], [403, "origin", undefined]);
    const row = (await db().query(`select open_count from shares where token_hash = $1`, [shareTokenHash(made.token)])).rows[0];
    assert.equal(row.open_count, 1, "only the site's open counted");

    const ip = "192.0.2.211";
    for (let i = 0; i < 120; i += 1) await open("nope", site, ip);
    const limited = await open("nope", site, ip);
    assert.deepEqual([limited.statusCode, ...cors(limited)], [429, site, "retry-after, x-request-id", "Origin"]);
    assert.ok(Number(limited.headers["retry-after"]) >= 1, "and the page may read when to come back");
  } finally {
    delete process.env.SITE_ORIGINS;
  }
});

test("opening a share link is limited by IP", { skip }, async () => {
  const w = await world();
  const ip = "192.0.2.200";
  for (let i = 0; i < 120; i += 1) await post(w.app, null, "/v1/shares/open", { token: "nope" }, { key: null, ip });
  refused(await post(w.app, null, "/v1/shares/open", { token: "nope" }, { key: null, ip }), 429, "rate_limited");
});

// --- hearts

test("PR 4: Maya hearts & cooks Dad's chili -> Dad's /dish-stats & /hearts/recent show her; Mom sees nothing of Dad's", { skip }, async () => {
  const w = await world();
  const maya = w.nia;
  ok(await heart(w, maya, CHILI));
  assert.equal(ok(await event(w, maya, { libraryId: CHILI, kind: "cooked" })).counted, true);
  // Other kinds: none of them is a cook.
  ok(await event(w, maya, { libraryId: CHILI, kind: "viewed" }));
  ok(await event(w, maya, { libraryId: CHILI, kind: "started" }));
  ok(await event(w, maya, { libraryId: CHILI, kind: "heard", durationS: 5 }));
  // Dad's own heart never counts.
  ok(await heart(w, w.dad, CHILI));

  const stats = ok(await get(w.app, w.dad, `/v1/dish-stats?ids=${CHILI},${RICE},${DAL}`));
  assert.deepEqual(Object.keys(stats).sort(), [RICE, CHILI].sort());
  assert.deepEqual([stats[CHILI].hearts.count, stats[CHILI].hearts.by.map((h: any) => h.personId), stats[CHILI].cooked.count, stats[CHILI].cooked.by.map((c: any) => [c.personId, c.count])], [1, [maya.id], 1, [[maya.id, 1]]]);
  assert.deepEqual(stats[RICE], { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } });

  const recent = ok(await get(w.app, w.dad, "/v1/hearts/recent"));
  assert.deepEqual(recent.map((h: any) => [h.personId, h.libraryId]), [[maya.id, CHILI]]);
  assert.deepEqual(ok(await get(w.app, w.mom, `/v1/dish-stats?ids=${CHILI}`)), {});
  assert.deepEqual(ok(await get(w.app, w.mom, "/v1/hearts/recent")), []);

  // No push for hearts.
  await drain();
  assert.equal(w.expo.sent.flat().length, 0);

  // Un-heart: gone from both.
  ok(await heart(w, maya, CHILI, false));
  assert.equal(ok(await get(w.app, w.dad, `/v1/dish-stats?ids=${CHILI}`))[CHILI].hearts.count, 0);
  assert.deepEqual(ok(await get(w.app, w.dad, "/v1/hearts/recent")), []);
});

test("GET /dish-stats: my family only, me excluded, the removed left out, counted per person, newest first", { skip }, async () => {
  const w = await world();
  const seed = async (who: Who, kind: string, daysAgo: number) =>
    db().query(`insert into recipe_events (family_id, person_id, library_id, kind, created_at) values ($1, $2, $3, $4, now() - make_interval(days => $5))`, [w.family, who.id, CHILI, kind, daysAgo]);
  await seed(w.leo, "cooked", 3);
  await seed(w.leo, "cooked", 1);
  await seed(w.nia, "cooked", 2);
  await seed(w.dad, "cooked", 0); // me
  await db().query(`insert into recipe_events (family_id, person_id, library_id, kind) values ($1, $2, $3, 'cooked')`, [w.otherFamily, w.stranger.id, CHILI]);
  ok(await heart(w, w.stranger, CHILI)); // another family's heart on the same library dish
  const s = ok(await get(w.app, w.dad, `/v1/dish-stats?ids=${CHILI}`))[CHILI];
  assert.deepEqual(s.cooked.by.map((c: any) => [c.personId, c.count]), [[w.leo.id, 2], [w.nia.id, 1]]);
  assert.equal(s.cooked.count, 3);
  assert.equal(s.hearts.count, 0);
  await db().query(`update people set removed_at = now() where id = $1`, [w.leo.id]);
  assert.equal(ok(await get(w.app, w.dad, `/v1/dish-stats?ids=${CHILI}`))[CHILI].cooked.count, 1);
});

test("GET /dish-stats: the cook's name matches the library like cookProfile (case & spaces), samples included", { skip }, async () => {
  const w = await world();
  w.lib.index.set(RICE, { title: "Fried Rice", cook_name: " dad", sample: false });
  assert.deepEqual(Object.keys(ok(await get(w.app, w.dad, `/v1/dish-stats?ids=${RICE},${CHILI}`))).sort(), [RICE, CHILI].sort());
  // A kid has no dishes; unknown ids are simply not mine.
  assert.deepEqual(ok(await get(w.app, w.leo, `/v1/dish-stats?ids=${CHILI},${DAL}`)), {});
  assert.deepEqual(ok(await get(w.app, w.dad, "/v1/dish-stats?ids=nope")), {});
  // The library down: nothing shows.
  w.lib.down = true;
  assert.deepEqual(ok(await get(w.app, w.dad, `/v1/dish-stats?ids=${CHILI}`)), {});
});

test("PR 4: /dish-stats & /hearts/recent 400s", { skip }, async () => {
  const w = await world();
  const many = Array.from({ length: 51 }, (_, i) => `dad-${i}`).join(",");
  refused(await get(w.app, w.dad, `/v1/dish-stats?ids=${many}`), 400, "invalid", "ids");
  refused(await get(w.app, w.dad, "/v1/dish-stats"), 400, "invalid", "ids");
  refused(await get(w.app, w.dad, "/v1/dish-stats?ids=Bad%20Id"), 400, "invalid", "ids");
  refused(await get(w.app, w.dad, "/v1/hearts/recent?since=soon"), 400, "invalid", "since");
});

test("parseDishIds: comma list, deduped, trimmed", () => {
  assert.deepEqual(parseDishIds(" a, b ,,a "), ["a", "b"]);
});

test("parseSince: default 14 days, clamped to 30 days back and to now", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  assert.equal(parseSince(null, now).getTime(), now.getTime() - 14 * DAY_MS);
  assert.equal(parseSince("2026-10-19T00:00:00Z", now).toISOString(), "2026-10-19T00:00:00.000Z");
  assert.equal(parseSince("2020-01-01T00:00:00Z", now).getTime(), now.getTime() - 30 * DAY_MS);
  assert.equal(parseSince("2030-01-01T00:00:00Z", now).getTime(), now.getTime());
});

test("GET /hearts/recent: hearts on my dishes from my family, newest first, since narrows it, at most 20", { skip }, async () => {
  const w = await world();
  const seed = (who: Who, dish: string, daysAgo: number) =>
    db().query(`insert into favorites (person_id, library_id, created_at) values ($1, $2, now() - make_interval(days => $3))`, [who.id, dish, daysAgo]);
  await seed(w.leo, CHILI, 1);
  await seed(w.nia, RICE, 2);
  await seed(w.mom, CHILI, 20); // past the default 14 days
  await seed(w.stranger, CHILI, 1); // another family
  await seed(w.leo, DAL, 1); // Mom's dish
  const list = ok(await get(w.app, w.dad, "/v1/hearts/recent"));
  assert.deepEqual(list.map((h: any) => [h.personId, h.libraryId]), [[w.leo.id, CHILI], [w.nia.id, RICE]]);
  const since = new Date(Date.now() - 1.5 * DAY_MS).toISOString();
  assert.deepEqual(ok(await get(w.app, w.dad, `/v1/hearts/recent?since=${since}`)).map((h: any) => h.personId), [w.leo.id]);
  const wide = new Date(Date.now() - 25 * DAY_MS).toISOString();
  assert.equal(ok(await get(w.app, w.dad, `/v1/hearts/recent?since=${wide}`)).length, 3);

  for (let i = 0; i < HEARTS_RECENT_LIMIT + 5; i += 1) {
    w.lib.index.set(`dad-dish-${i}`, { title: `Dish ${i}`, cook_name: "Dad", sample: false });
    await seed(w.leo, `dad-dish-${i}`, 0);
  }
  assert.equal(ok(await get(w.app, w.dad, "/v1/hearts/recent")).length, HEARTS_RECENT_LIMIT);
});

test("favorites: heart and un-heart are the same however often; the list pages, newest first", { skip }, async () => {
  const w = await world();
  ok(await heart(w, w.leo, CHILI));
  ok(await heart(w, w.leo, CHILI));
  ok(await heart(w, w.leo, DAL));
  const first = ok(await get(w.app, w.leo, "/v1/favorites?limit=1"));
  assert.deepEqual(first.libraryIds, [DAL]);
  assert.deepEqual(ok(await get(w.app, w.leo, `/v1/favorites?limit=1&cursor=${first.nextCursor}`)).libraryIds, [CHILI]);
  ok(await heart(w, w.leo, DAL, false));
  ok(await heart(w, w.leo, DAL, false));
  assert.deepEqual(ok(await get(w.app, w.leo, "/v1/favorites")).libraryIds, [CHILI]);
  refused(await post(w.app, w.leo, "/v1/favorites", { libraryId: CHILI, on: "yes" }, { key: null }), 400, "invalid", "on");
  refused(await heart(w, w.leo, "no-such-dish"), 404, "not_found", { message: "That recipe isn't here anymore." });
});

// --- events

test("retention: POST /events takes started & heard with cook_id; recipe stats still count views & cooks only", { skip }, async () => {
  const w = await world();
  const ev = (body: Record<string, unknown>) => event(w, w.leo, body);
  refused(await ev({ libraryId: DAL, kind: "heard", cookId: w.mom.id, durationS: 2 }), 400, "invalid", "durationS");
  refused(await ev({ libraryId: DAL, kind: "heard", cookId: "nobody", durationS: 5 }), 400, "invalid", "cookId");
  refused(await ev({ libraryId: DAL, kind: "heard", cookId: w.stranger.id, durationS: 5 }), 400, "invalid", "cookId");
  refused(await ev({ libraryId: DAL, kind: "nope" }), 400, "invalid", "kind");
  assert.deepEqual(ok(await ev({ libraryId: DAL, kind: "heard", cookId: w.mom.id, durationS: 5, startS: 12 })), { ok: true, counted: true });
  assert.equal(ok(await ev({ libraryId: DAL, kind: "heard", cookId: w.mom.id, durationS: 5, startS: 12 })).counted, false); // same clip within 5 s
  assert.equal(ok(await ev({ libraryId: DAL, kind: "heard", cookId: w.mom.id, durationS: 7, startS: 40 })).counted, true); // another clip
  assert.equal(ok(await ev({ libraryId: DAL, kind: "started", cookId: w.mom.id })).counted, true);
  assert.equal(ok(await ev({ libraryId: DAL, kind: "cooked", cookId: w.mom.id })).counted, true);
  const heard = (await db().query(`select cook_id, duration_s, clip_start_s from recipe_events where kind = 'heard' order by created_at limit 1`)).rows[0];
  assert.deepEqual([heard.cook_id, heard.duration_s, heard.clip_start_s], [w.mom.id, 5, 12]);
  const stats = ok(await get(w.app, w.leo, "/v1/me/recipe-stats")).stats;
  assert.deepEqual(stats.map((x: any) => [x.libraryId, x.views, x.cooked]), [[DAL, 0, 1]]);
  // Only heard events about a dish: still no row for it in my stats.
  ok(await ev({ libraryId: CHILI, kind: "heard", cookId: w.dad.id, durationS: 9, startS: 0 }));
  assert.equal(ok(await get(w.app, w.leo, "/v1/me/recipe-stats")).stats.length, 1);
  const act = ok(await get(w.app, w.leo, `/v1/dishes/${DAL}/activity`));
  assert.deepEqual([act.cooked.map((c: any) => c.person.name), act.viewed], [["Leo"], []]);
});

test("an event counts once per window, even when two arrive at once", { skip }, async () => {
  const w = await world();
  const ev = () => event(w, w.leo, { libraryId: CHILI, kind: "viewed" });
  const out = await Promise.all([ev(), ev(), ev()]);
  assert.deepEqual(out.map((r) => ok(r).counted).sort(), [false, false, true]);
  // Re-opening within 30 minutes doesn't count; after, it does.
  await db().query(`update recipe_events set created_at = now() - interval '31 minutes'`);
  assert.equal(ok(await ev()).counted, true);
  assert.equal(ok(await event(w, w.leo, { libraryId: CHILI, kind: "cooked" })).counted, true);
  assert.equal(ok(await event(w, w.leo, { libraryId: CHILI, kind: "cooked" })).counted, false);
  await db().query(`update recipe_events set created_at = now() - interval '61 seconds' where kind = 'cooked'`);
  assert.equal(ok(await event(w, w.leo, { libraryId: CHILI, kind: "cooked" })).counted, true);
});

test("PR 4 wiring: /me/recipe-stats and /recipes/:id/activity count views & cooks only", { skip }, async () => {
  const w = await world();
  for (const kind of ["heard", "started"]) {
    await db().query(`insert into recipe_events (family_id, person_id, library_id, kind) values ($1, $2, $3, $4)`, [w.family, w.nia.id, DAL, kind]);
  }
  ok(await event(w, w.nia, { libraryId: CHILI, kind: "cooked" }));
  const stats = ok(await get(w.app, w.nia, "/v1/me/recipe-stats")).stats;
  assert.deepEqual(stats.map((x: any) => [x.libraryId, x.views, x.cooked]), [[CHILI, 0, 1]]);
  const act = ok(await get(w.app, w.mom, `/v1/dishes/${DAL}/activity`));
  assert.deepEqual([act.cooked, act.viewed], [[], []]);
});

test("my stats join views, cooks, hearts and what someone sent me, most recent first, and they page", { skip }, async () => {
  const w = await world();
  ok(await event(w, w.leo, { libraryId: CHILI, kind: "viewed" }));
  await db().query(`update recipe_events set created_at = now() - interval '3 days'`);
  ok(await heart(w, w.leo, DAL));
  await db().query(`update favorites set created_at = now() - interval '2 days'`);
  ok(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: RICE, to: [w.leo.id] }));
  // I sent this one myself: it isn't "sent to me".
  ok(await post(w.app, w.leo, "/v1/send-recipe", { libraryId: "grandma-hand-pulled-noodle-soup", to: [w.mom.id] }));
  const page = ok(await get(w.app, w.leo, "/v1/me/recipe-stats?limit=2"));
  assert.deepEqual(page.stats.map((s: any) => [s.libraryId, s.views, s.favorited, !!s.sentToMeAt]), [[RICE, 0, false, true], [DAL, 0, true, false]]);
  const next = ok(await get(w.app, w.leo, `/v1/me/recipe-stats?limit=2&cursor=${page.nextCursor}`));
  assert.deepEqual(next.stats.map((s: any) => [s.libraryId, s.views]), [[CHILI, 1]]);
  assert.equal(next.nextCursor, null);
});

test("a third person never reads words written in someone else's pair, as a note or a time", { skip }, async () => {
  const w = await world();
  ok(await event(w, w.mom, { libraryId: DAL, kind: "cooked" }));
  const pair = await pairOf(w, w.mom, w.dad);
  ok(await post(w.app, w.mom, `/v1/threads/${pair}/messages`, { kind: "cooked", libraryId: DAL, body: "SECRET words to Dad" }));
  ok(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: DAL, to: [w.dad.id] }));
  const asLeo = await get(w.app, w.leo, `/v1/dishes/${DAL}/activity`);
  assert.equal(asLeo.status, 200);
  assert.ok(!asLeo.body.includes("SECRET"), asLeo.body);
  assert.deepEqual(asLeo.data.cooked.map((c: any) => [c.person.name, c.note]), [["Mom", null]]);
  assert.equal(asLeo.data.lastSentAt, null, "that a recipe went between two others isn't Leo's to know");
  // The two in the pair still read it.
  for (const who of [w.mom, w.dad]) {
    const act = ok(await get(w.app, who, `/v1/dishes/${DAL}/activity`));
    assert.equal(act.cooked[0].note, "SECRET words to Dad");
    assert.equal(typeof act.lastSentAt, "string");
  }
  // Said in the circle, everyone reads it.
  const ring = ok(await get(w.app, w.leo, "/v1/circle")).id;
  ok(await post(w.app, w.mom, `/v1/threads/${ring}/messages`, { kind: "cooked", libraryId: DAL, body: "For everyone" }));
  assert.equal(ok(await get(w.app, w.leo, `/v1/dishes/${DAL}/activity`)).cooked[0].note, "For everyone");
});

test("dish activity: who cooked it with their note, who looked, and when it was last sent; people who left aren't shown", { skip }, async () => {
  const w = await world();
  ok(await event(w, w.leo, { libraryId: DAL, kind: "cooked" }));
  ok(await event(w, w.nia, { libraryId: DAL, kind: "viewed" }));
  const pair = await pairOf(w, w.leo, w.mom);
  ok(await post(w.app, w.leo, `/v1/threads/${pair}/messages`, { kind: "cooked", libraryId: DAL, body: "First try!" }));
  ok(await post(w.app, w.mom, "/v1/send-recipe", { libraryId: DAL, to: [w.nia.id] }));
  const act = ok(await get(w.app, w.mom, `/v1/dishes/${DAL}/activity`));
  assert.deepEqual(act.cooked.map((c: any) => [c.person.name, c.note]), [["Leo", "First try!"]]);
  assert.deepEqual(act.viewed.map((v: any) => [v.person.name, v.count]), [["Nia", 1]]);
  assert.equal(typeof act.lastSentAt, "string");
  await db().query(`update people set removed_at = now() where id = $1`, [w.leo.id]);
  assert.deepEqual(ok(await get(w.app, w.mom, `/v1/dishes/${DAL}/activity`)).cooked, []);
  refused(await get(w.app, w.mom, "/v1/dishes/BAD/activity"), 400, "invalid", "libraryId");
});

// --- the library

test("makeLibrary reads library.json & recipe.json, caches 10 min, and never caches an outage", async () => {
  let clock = 0;
  let down = false;
  const calls: string[] = [];
  const files: Record<string, unknown> = {
    "library.json": [
      { id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", sample: false },
      { id: "mom-sample", title: "Sample Soup", cook_name: "Mom", sample: true },
      { title: "no id" },
    ],
    "mom-dal/recipe.json": {
      id: "mom-dal",
      title: "Mom's Dal",
      cook: { name: "Mom" },
      sample: false,
      steps: [{ order: 2, quote: "A pinch, then taste." }, { order: 1, quote: null }, { order: "x", quote: "dropped" }],
    },
    "jobs/up-done.json": { status: "published", recipe_id: "mom-dal" },
    "jobs/up-wait.json": { status: "processing" },
  };
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (down) throw new TypeError("network is off");
    const path = url.replace("https://media.test/", "");
    return path in files ? Response.json(files[path]) : new Response("nope", { status: 404 });
  }) as unknown as typeof fetch;
  const lib = makeLibrary({ baseUrl: "https://media.test/", fetch: fakeFetch, clock: () => clock });

  const index = await lib.libraryIndex();
  assert.deepEqual(index.get("mom-dal"), { title: "Mom's Dal", cook_name: "Mom", sample: false });
  assert.equal(index.get("mom-sample")?.sample, true);
  assert.deepEqual(dishesOf(index, " MOM"), ["mom-dal", "mom-sample"]); // the app's cookProfile rule
  assert.deepEqual(dishesOf(index, ""), []);
  const dal = await lib.recipeInfo("mom-dal");
  assert.deepEqual(dal, { id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", sample: false, steps: [{ order: 2, quote: "A pinch, then taste." }, { order: 1, quote: null }] });
  assert.equal(await lib.recipeInfo("nope"), null); // 404: cached as missing
  assert.equal(await lib.recipeInfo("../library.json"), null); // never fetched
  assert.equal(await lib.exists("mom-dal"), true);
  assert.equal(await lib.exists("nope"), false);
  assert.equal(await lib.publishedDish("up-done"), "mom-dal");
  assert.equal(await lib.publishedDish("up-wait"), null);
  const fetched = calls.length;

  clock = 9 * 60_000; // still fresh: no fetches
  await lib.libraryIndex();
  await lib.recipeInfo("mom-dal");
  await lib.recipeInfo("nope");
  await lib.exists("mom-dal");
  assert.equal(calls.length, fetched);

  clock = 11 * 60_000;
  down = true; // stale & the host is down: empty Map, null, "can't say", and nothing cached
  assert.equal((await lib.libraryIndex()).size, 0);
  assert.equal(await lib.recipeInfo("mom-dal"), null);
  assert.equal(await lib.exists("mom-dal"), null);
  down = false;
  assert.equal((await lib.libraryIndex()).size, 2);
  assert.equal((await lib.recipeInfo("mom-dal"))?.title, "Mom's Dal");
});

after(closeAll);

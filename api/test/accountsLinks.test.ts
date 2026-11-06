// Claim on install and after a move: the signed tokens, /link/open, the claim and the receipt. Carries over convex/joinTicket.test.ts, supabase/tests/link_test.ts and convex/links.test.ts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { hashToken } from "../src/auth.js";
import { db } from "../src/db.js";
import { cardRef, roleForSide, shareTokenForSide, signMoved, signTicket, verifyMoved, verifyTicket, type JoinPayload } from "../src/modules/accounts/tickets.js";
import { newJti } from "../src/modules/accounts/values.js";
import { Api, appleToken, bearer, clearLimits, count, freshDatabase, hasDatabase, type Keys, makeDevice, makeFamily, makePerson, row, said, SECRET, setup } from "./accountsHelpers.js";
import { session } from "./helpers.js";

const skip = !hasDatabase;
let api: Api;
let keys: Keys;

before(async () => {
  if (skip) return;
  await freshDatabase();
  keys = await setup();
  api = new Api();
});

after(async () => {
  if (!skip) await db().end();
});

// ---- the shared vectors: Convex signed these, and both old systems checked them

const A: JoinPayload = {
  v: 1,
  fam: "11111111-2222-4333-8444-555555555555",
  card: "f25009a97fe921e7818ce826",
  side: "cook",
  name: "Mom",
  exp: 1893456000000,
  jti: "AbCdEfGhIjKlMnOp",
};
const TICKET_A =
  "eyJ2IjoxLCJmYW0iOiIxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJjYXJkIjoiZjI1MDA5YTk3ZmU5MjFlNzgxOGNlODI2Iiwic2lkZSI6ImNvb2siLCJuYW1lIjoiTW9tIiwiZXhwIjoxODkzNDU2MDAwMDAwLCJqdGkiOiJBYkNkRWZHaElqS2xNbk9wIn0.cRuUbmammgS1hFfFT9rg5mTjQMx9lThGlK0qCoOk_X8";
const TICKET_B =
  "eyJ2IjoxLCJmYW0iOiIxMTExMTExMS0yMjIyLTQzMzMtODQ0NC01NTU1NTU1NTU1NTUiLCJjYXJkIjoiZjI1MDA5YTk3ZmU5MjFlNzgxOGNlODI2Iiwic2lkZSI6ImtpZCIsIm5hbWUiOiLgpIbgpJzgpYAiLCJleHAiOjE4OTM0NTYwMDAwMDAsImp0aSI6IlFyU3RVdld4WXowMTIzNDUifQ.m_o_MYGVrGVCzT86G9Fc6EjmlsGYIozj_6EYIZIy-Eg";

test("the shared vectors sign and verify", () => {
  assert.equal(cardRef("j57abc123"), A.card);
  assert.equal(signTicket(SECRET, A), TICKET_A);
  assert.deepEqual(verifyTicket(SECRET, TICKET_A, A.exp - 1), A);
  const b = verifyTicket(SECRET, TICKET_B, 0)!;
  assert.deepEqual([b.side, b.name, b.jti], ["kid", "आजी", "QrStUvWxYz012345"]);
});

test("a forged, tampered, expired or malformed ticket is refused", () => {
  const [body, sig] = TICKET_A.split(".");
  assert.equal(verifyTicket("another-secret", TICKET_A, 0), null);
  const forged = Buffer.from(JSON.stringify({ ...A, side: "kid" })).toString("base64url");
  assert.equal(verifyTicket(SECRET, `${forged}.${sig}`, 0), null);
  assert.equal(verifyTicket(SECRET, `${body}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, 0), null);
  assert.equal(verifyTicket(SECRET, TICKET_A, A.exp), null, "it expires at exp");
  assert.equal(verifyTicket(SECRET, `${TICKET_A}.x`, 0), null);
  assert.equal(verifyTicket(SECRET, "nope", 0), null);
  assert.equal(verifyTicket(SECRET, signTicket(SECRET, { ...A, v: 2 as 1 }), 0), null);
  assert.equal(verifyTicket(SECRET, signTicket(SECRET, { ...A, fam: "seed:demo" }), 0), null, "Supabase's stricter check on the family");
  assert.equal(verifyTicket(SECRET, signTicket(SECRET, { ...A, card: "short" }), 0), null);
  assert.equal(verifyTicket(SECRET, signTicket(SECRET, { ...A, jti: "x" }), 0), null);
  assert.equal(verifyTicket(SECRET, "x".repeat(1001), 0), null);
});

test("a side's role and share token", () => {
  assert.equal(roleForSide("kid"), "kid");
  assert.equal(roleForSide("cook"), "cook");
  assert.equal(shareTokenForSide("abc", "cook"), "link:abc:cook");
  assert.match(newJti(), /^[0-9A-Za-z]{16}$/);
  assert.notEqual(newJti(), newJti());
});

test("a receipt checks out; forged, expired and odd ones don't", () => {
  const r = { v: 1 as const, kind: "moved" as const, fromProfile: "a", fromFamily: "b", toProfile: "c", toFamily: "d", solo: true, faces: ["e"], exp: 2_000_000_000_000 };
  const signed = signMoved(SECRET, r);
  assert.deepEqual(verifyMoved(SECRET, signed, 0), r);
  assert.equal(verifyMoved("other", signed, 0), null);
  assert.equal(verifyMoved(SECRET, signed, r.exp), null);
  assert.equal(verifyMoved(SECRET, signMoved(SECRET, { ...r, faces: Array(51).fill("x") }), 0), null);
  assert.equal(verifyMoved(SECRET, signTicket(SECRET, A), 0), null, "a ticket isn't a receipt");
});

// ---- cards, written straight to the table with made-up content

const token22 = () => randomBytes(32).toString("base64").replace(/[^0-9A-Za-z]/g, "").slice(0, 22);

async function makeCard(extra: Partial<{ family_id: string; person_id: string; requested_of: string; kid_claimed_at: string; cook_claimed_at: string; asked_at: string; finished_at: string }> = {}) {
  const kidToken = token22();
  const askToken = token22();
  const names = Object.keys(extra);
  const { rows } = await db().query(
    `insert into dish_asks (kid_token_hash, ask_token_hash, dish, relation, kid_name, guess, message, status${names.map((n) => `, ${n}`).join("")})
     values ($1, $2, 'tomato egg', 'mom', 'Caleb', '{"dish": "tomato egg"}', 'Made-up message', 'asked'${names.map((_, i) => `, $${i + 3}`).join("")}) returning id`,
    [hashToken(kidToken), hashToken(askToken), ...Object.values(extra)],
  );
  return { id: rows[0].id as string, kidToken, askToken };
}

async function ticketableFamily(name = "The Wangs") {
  const f = await makeFamily(name);
  const { rows } = await db().query(`select gen_random_uuid()::text as id`);
  await db().query(`update families set supabase_id = $2 where id = $1`, [f.id, rows[0].id]);
  return { ...f, ext: rows[0].id as string };
}

const open = (token: unknown, ip?: string, headers: Record<string, string> = {}) => api.post("/link/open", { token }, headers, ip);
const card = (id: string) => row("dish_asks", "id = $1", [id]);

test("a dead, malformed or missing token", { skip }, async () => {
  assert.equal((await open("A".repeat(22))).status, 404);
  const short = await open("short");
  assert.deepEqual([short.status, ...said(short)], [404, "not_found", "This link doesn't work anymore."]);
  assert.equal((await open(undefined)).status, 400);
});

test("a card nobody has claimed: no family yet, so no ticket (sign in first)", { skip }, async () => {
  const c = await makeCard();
  const kid = await open(c.kidToken);
  assert.equal(kid.status, 200);
  assert.equal(kid.headers["cache-control"], "no-store");
  const { requestId: _unused, ...shown } = kid.data;
  void _unused;
  assert.deepEqual(shown, { side: "kid", dish: "tomato egg", kidName: "Caleb", relation: "mom", familyName: null, taken: false, ticket: null, language: null, joinable: "no_family" });
  const cook = await open(c.askToken);
  assert.deepEqual([cook.data.side, cook.data.joinable, cook.data.ticket], ["cook", "no_family", null]);
});

test("the kid claims first; Mom's link then carries a ticket to the kid's family, as a cook", { skip }, async () => {
  const f = await ticketableFamily();
  const leo = await makePerson(f.id, "Leo", "kid");
  const token = await session(f.id, leo);
  const c = await makeCard();
  const claimed = await api.post("/v1/links/claim", { token: c.kidToken }, bearer(token));
  assert.equal(claimed.status, 200);
  assert.deepEqual([claimed.data.dishAskId, claimed.data.side, claimed.data.sameFamily, claimed.data.taken], [c.id, "kid", true, false]);
  const stored = await card(c.id);
  assert.deepEqual([stored.person_id, stored.family_id], [leo, f.id]);
  assert.ok(stored.kid_claimed_at);
  const again = await api.post("/v1/links/claim", { token: c.kidToken }, bearer(token));
  assert.deepEqual([again.data.dishAskId, again.data.side, again.data.taken], [c.id, "kid", false]);

  const mom = await open(c.askToken);
  assert.deepEqual([mom.data.side, mom.data.familyName, mom.data.joinable], ["cook", "The Wangs", "yes"]);
  const ticket = verifyTicket(SECRET, mom.data.ticket, Date.now())!;
  assert.deepEqual([ticket.fam, ticket.side, ticket.name, ticket.card], [f.ext, "cook", "Mom", cardRef(c.id)]);
  assert.ok(Math.abs(ticket.exp - (Date.now() + 600_000)) < 5_000);
  const kid = await open(c.kidToken);
  assert.deepEqual([kid.data.joinable, kid.data.taken, kid.data.ticket], ["taken", true, null], "the kid's own side brought them in already");

  // And the ticket really joins: Sign in with Apple takes it.
  const joined = await api.apple({ id_token: await appleToken(keys, `mom-${c.id}`), link_ticket: mom.data.ticket, name: "Mom" });
  assert.equal(joined.status, 200);
  assert.equal((await row("people", "id = $1", [joined.data.profile_id])).family_id, f.id);
});

test("Mom claims: she holds the cook side and gets her relation; someone else finds it taken; the kid can't take Mom's side", { skip }, async () => {
  const f = await ticketableFamily();
  const leo = await makePerson(f.id, "Leo", "kid");
  const dad = await makePerson(f.id, "Dad");
  const zed = await makePerson((await makeFamily()).id, "Zed", "kid");
  const c = await makeCard();
  const leoS = await session(f.id, leo);
  await api.post("/v1/links/claim", { token: c.kidToken }, bearer(leoS));
  const claimed = await api.post("/v1/links/claim", { token: c.askToken }, bearer(await session(f.id, dad)));
  assert.deepEqual([claimed.data.side, claimed.data.sameFamily, claimed.data.taken], ["cook", true, false]);
  const stored = await card(c.id);
  assert.equal(stored.requested_of, dad);
  assert.ok(stored.cook_claimed_at);
  assert.equal((await row("people", "id = $1", [dad])).relation, "Mom");

  const zedFamily = (await row("people", "id = $1", [zed])).family_id;
  assert.equal((await api.post("/v1/links/claim", { token: c.askToken }, bearer(await session(zedFamily, zed)))).data.taken, true);
  const self = await api.post("/v1/links/claim", { token: c.askToken }, bearer(leoS));
  assert.equal(self.status, 409);
  assert.equal(self.data.error, "already_on_card");
  assert.match(self.data.message, /already on this card/);
  assert.deepEqual([(await open(c.askToken)).data.joinable, (await open(c.askToken)).data.ticket], ["taken", null]);
});

test("a claim tells whoever holds the card's other side in this family, once: Mom reads who's on homecookd, the kid reads Mom joined (convex/links.ts)", { skip }, async () => {
  const f = await ticketableFamily();
  const leo = await makePerson(f.id, "Leo", "kid");
  const dad = await makePerson(f.id, "Dad");
  const nia = await makePerson(f.id, "Nia", "kid");
  for (const [who, n] of [[leo, "leo"], [dad, "dad"], [nia, "nia"]]) {
    await db().query(`insert into push_tokens (token, family_id, person_id, platform) values ($1, $2, $3, 'ios')`, [`ExponentPushToken[${n}]`, f.id, who]);
  }
  const claim = async (token: string, family: string, who: string) => assert.equal((await api.post("/v1/links/claim", { token }, bearer(await session(family, who)))).status, 200);
  const away = await makeFamily();
  const zed = await makePerson(away.id, "Zed");
  const joined = async () =>
    (
      await db().query(`select person_id, title, body, url, dedupe_key, status from push_log where kind = 'joined' and person_id = any($1::text[]) order by created_at, id`, [
        [leo, dad, nia, zed],
      ])
    ).rows.map((r) => [r.person_id, r.title, r.body, r.url, r.dedupe_key, r.status]);

  // Mom's side first: nobody holds the kid's yet, so there's no one to tell.
  const first = await makeCard();
  await claim(first.askToken, f.id, dad);
  assert.deepEqual(await joined(), []);
  await claim(first.kidToken, f.id, leo);
  const toDad = [dad, "Leo is on homecookd", "You're in the same kitchen now.", `/dish/${first.id}`, `joined:${first.id}:kid`, "queued"];
  assert.deepEqual(await joined(), [toDad]);
  await claim(first.kidToken, f.id, leo); // claiming again: once
  assert.deepEqual(await joined(), [toDad]);

  // The kid's side first: Mom's claim tells the kid, by the card's word for her.
  const second = await makeCard();
  await claim(second.kidToken, f.id, nia);
  await claim(second.askToken, f.id, dad);
  assert.deepEqual((await joined())[1], [nia, "Mom joined your kitchen", "You're in the same kitchen now.", `/dish/${second.id}`, `joined:${second.id}:cook`, "queued"]);

  // The other side in another family hears nothing: the card stays where it was, and so do they.
  const third = await makeCard();
  await claim(third.kidToken, f.id, leo);
  await claim(third.askToken, away.id, zed);
  assert.equal((await joined()).length, 2);
});

test("a card in another family stays there: the claim puts it in their app, no one moves", { skip }, async () => {
  const f = await ticketableFamily();
  const other = await makeFamily();
  const leo = await makePerson(f.id, "Leo", "kid");
  const zed = await makePerson(other.id, "Zed");
  const c = await makeCard();
  await api.post("/v1/links/claim", { token: c.kidToken }, bearer(await session(f.id, leo)));
  const claimed = await api.post("/v1/links/claim", { token: c.askToken }, bearer(await session(other.id, zed)));
  assert.deepEqual([claimed.data.sameFamily, claimed.data.taken], [false, false]);
  const stored = await card(c.id);
  assert.deepEqual([stored.family_id, stored.requested_of], [f.id, zed]);
  assert.equal((await row("people", "id = $1", [zed])).family_id, other.id);
});

test("a side someone held who has since deleted is free to claim, but the join it gave stays used", { skip }, async () => {
  const f = await ticketableFamily();
  const dad = await makePerson(f.id, "Dad");
  const c = await makeCard({ family_id: f.id, requested_of: dad, cook_claimed_at: "2026-10-30T00:00:00Z", asked_at: new Date().toISOString() });
  await db().query(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [dad]);
  const seen = await open(c.askToken);
  assert.deepEqual([seen.data.taken, seen.data.joinable, seen.data.ticket], [false, "taken", null], "one join per side, ever: it isn't given back");
  const aunt = await makePerson(f.id, "Aunt");
  assert.equal((await api.post("/v1/links/claim", { token: c.askToken }, bearer(await session(f.id, aunt)))).data.taken, false);
});

test("no ticket without the secret, after the join window, or for a family that's gone", { skip }, async () => {
  const f = await ticketableFamily();
  const leo = await makePerson(f.id, "Leo", "kid");
  const c = await makeCard({ family_id: f.id, person_id: leo, kid_claimed_at: new Date().toISOString(), asked_at: new Date().toISOString() });
  delete process.env.LINK_JOIN_SECRET;
  try {
    assert.deepEqual([(await open(c.askToken)).data.joinable, (await open(c.askToken)).data.ticket], ["off", null]);
  } finally {
    process.env.LINK_JOIN_SECRET = SECRET;
  }
  await db().query(`update dish_asks set asked_at = now() - interval '31 days', created_at = now() - interval '32 days' where id = $1`, [c.id]);
  assert.deepEqual([(await open(c.askToken)).data.joinable, (await open(c.askToken)).data.ticket], ["window", null]);
  await db().query(`update dish_asks set asked_at = now() where id = $1`, [c.id]);
  await db().query(`update families set blanked_at = now(), name = 'Deleted' where id = $1`, [f.id]);
  const gone = await open(c.askToken);
  assert.deepEqual([gone.data.joinable, gone.data.familyName], ["no_family", null]);
});

test("tickets are limited per card side (5 an hour), and opens per IP", { skip }, async () => {
  await clearLimits();
  const f = await ticketableFamily();
  const c = await makeCard({ family_id: f.id, asked_at: new Date().toISOString() });
  for (let i = 0; i < 5; i += 1) assert.ok((await open(c.askToken, `198.18.0.${i + 1}`)).data.ticket);
  const blocked = await open(c.askToken, "198.18.0.99");
  assert.equal(blocked.status, 429);
  assert.deepEqual(said(blocked), ["rate_limited", "Too many tries. Please wait a few minutes and try again."]);
  assert.ok(Number(blocked.headers["retry-after"]) > 0, "a 429 says when to come back");
  await clearLimits();
  for (let i = 0; i < 30; i += 1) await open(c.kidToken, "198.18.1.1");
  assert.equal((await open(c.kidToken, "198.18.1.1")).status, 429);
  await clearLimits();
});

test("only our pages may call /link/open from a browser; the app's fetch sends no Origin", { skip }, async () => {
  const c = await makeCard();
  assert.equal((await open(c.kidToken, undefined, { origin: "https://homecookd.app" })).headers["access-control-allow-origin"], "https://homecookd.app");
  assert.equal((await open(c.kidToken, undefined, { origin: "http://localhost:3000" })).status, 200);
  const other = await open(c.kidToken, undefined, { origin: "https://evil.example" });
  assert.deepEqual([other.status, other.data.error], [403, "origin"]);
  assert.equal((await api.app.inject({ method: "OPTIONS", url: "/link/open", headers: { origin: "https://evil.example" } })).statusCode, 403);
  assert.equal((await api.app.inject({ method: "OPTIONS", url: "/link/open", headers: { origin: "https://homecookd.app" } })).statusCode, 204);
});

test("claiming needs a good-looking token that names a card", { skip }, async () => {
  const f = await makeFamily();
  const token = await session(f.id, await makePerson(f.id));
  assert.equal((await api.post("/v1/links/claim", { token: "short" }, bearer(token))).status, 404);
  assert.equal((await api.post("/v1/links/claim", { token: "A".repeat(22) }, bearer(token))).status, 404);
});

test("claiming writes `people` only under the switch: off, it refuses and changes nothing", { skip }, async () => {
  const f = await makeFamily();
  const dad = await makePerson(f.id, "Dad");
  const c = await makeCard();
  const token = await session(f.id, dad);
  delete process.env.ACCOUNTS_OWNS_PEOPLE;
  try {
    assert.equal((await api.post("/v1/links/claim", { token: c.askToken }, bearer(token))).status, 503);
    assert.equal((await card(c.id)).requested_of, null, "the whole transaction went");
  } finally {
    process.env.ACCOUNTS_OWNS_PEOPLE = "1";
  }
});

// ---- after a move

async function movedFixture() {
  const from = await ticketableFamily("The Zeds");
  const to = await ticketableFamily("The Wangs");
  const zed = await makePerson(from.id, "Zed");
  const moved = await makePerson(to.id, "Zed New");
  await db().query(`update people set removed_at = now() where id = $1`, [zed]);
  const { rows } = await db().query(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'Poha', 'ready') returning id`, [from.id, zed]);
  const recipeId = rows[0].id as string;
  await db().query(`insert into jobs (family_id, cook_id, recipe_id, upload_key, source, stage) values ($1, $2, $3, 'up-1/', 'phone', 'done')`, [from.id, zed, recipeId]);
  await db().query(`insert into recordings (family_id, cook_id, source, status) values ($1, $2, 'phone', 'ended')`, [from.id, zed]);
  const kid = await makePerson(from.id, "Kid", "kid");
  await db().query(`insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, 'How long?', 'asked_cook')`, [from.id, recipeId, kid]);
  const card1 = await makeCard({ family_id: from.id, requested_of: zed });
  const receipt = (over: object = {}) =>
    signMoved(SECRET, { v: 1, kind: "moved", fromProfile: zed, fromFamily: from.ext, toProfile: moved, toFamily: to.ext, solo: true, faces: [], exp: Date.now() + 3_600_000, ...over });
  return { from, to, zed, moved, recipeId, card1, receipt, token: await session(to.id, moved) };
}

test("a solo family's recipes come along when its cook moves; otherwise they stay", { skip }, async () => {
  const m = await movedFixture();
  const notSolo = await api.post("/v1/links/moved", { receipt: m.receipt({ solo: false }) }, bearer(m.token));
  assert.deepEqual([notSolo.data.recipes, notSolo.data.faces], [0, 0]);
  assert.equal((await row("recipes", "id = $1", [m.recipeId])).family_id, m.from.id);

  const solo = await api.post("/v1/links/moved", { receipt: m.receipt() }, bearer(m.token));
  assert.deepEqual([solo.data.recipes, solo.data.faces], [1, 0]);
  const rec = await row("recipes", "id = $1", [m.recipeId]);
  assert.deepEqual([rec.family_id, rec.cook_id], [m.to.id, m.moved]);
  assert.equal((await row("jobs", "recipe_id = $1", [m.recipeId])).cook_id, m.moved);
  assert.equal((await row("recordings", "cook_id = $1", [m.moved])).family_id, m.to.id);
  assert.equal((await row("questions", "recipe_id = $1", [m.recipeId])).family_id, m.to.id);
  const stored = await card(m.card1.id);
  assert.deepEqual([stored.requested_of, stored.family_id], [m.moved, m.to.id]);
  assert.equal((await row("families", "id = $1", [m.from.id])).moss_sync_again, true, "both Moss indexes are due a sync");

  const again = await api.post("/v1/links/moved", { receipt: m.receipt() }, bearer(m.token));
  assert.deepEqual([again.data.recipes, again.data.faces], [0, 0], "nothing left to move");
});

test("a phone-less face who moved with them keeps their recipes, in the new family", { skip }, async () => {
  const m = await movedFixture();
  const face = await makePerson(m.to.id, "Grandma");
  const { rows } = await db().query(`insert into recipes (family_id, cook_id, title, status) values ($1, $2, 'Upma', 'ready') returning id`, [m.from.id, face]);
  const res = await api.post("/v1/links/moved", { receipt: m.receipt({ faces: [face] }) }, bearer(m.token));
  assert.deepEqual([res.data.recipes, res.data.faces], [2, 1]);
  const rec = await row("recipes", "id = $1", [rows[0].id]);
  assert.deepEqual([rec.family_id, rec.cook_id], [m.to.id, face]);
});

test("a receipt that isn't signed, has expired, or names someone else moves nothing", { skip }, async () => {
  const m = await movedFixture();
  const good = m.receipt();
  const words = "That move can't be checked. Your recipes stay where they were.";
  const forged = good.replace(/.$/, (ch) => (ch === "A" ? "B" : "A"));
  for (const receipt of [forged, m.receipt({ exp: Date.now() - 1 })]) {
    const res = await api.post("/v1/links/moved", { receipt }, bearer(m.token));
    assert.deepEqual([res.status, ...said(res)], [403, "forbidden", words]);
  }
  const leo = await makePerson(m.to.id, "Leo", "kid");
  assert.equal((await api.post("/v1/links/moved", { receipt: good }, bearer(await session(m.to.id, leo)))).status, 403);
  delete process.env.LINK_JOIN_SECRET;
  try {
    assert.equal((await api.post("/v1/links/moved", { receipt: good }, bearer(m.token))).status, 403);
  } finally {
    process.env.LINK_JOIN_SECRET = SECRET;
  }
  assert.equal((await row("recipes", "id = $1", [m.recipeId])).family_id, m.from.id);
  assert.equal(await count("recipes", "family_id = $1", [m.to.id]), 0);
});

test("a device has nothing to do with a claim: a claim needs a session", { skip }, async () => {
  const f = await makeFamily();
  const p = await makePerson(f.id);
  const phone = await makeDevice(f.id, p);
  assert.equal((await api.post("/v1/links/claim", { token: "A".repeat(22) }, { "x-device-key": phone.key })).status, 401);
});

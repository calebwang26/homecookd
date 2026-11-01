// Every /v1 route in this area: no session is refused, another family is refused, and on anything pair-shaped, someone outside the pair is refused. The last test fails
// when a route is added without an entry here.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { CHILI, circleOf, closeAll, get, ok, pairOf, post, recipe, refused, type Reply, say, skip, text, uploaded, type Who, type World, world } from "./messagesHelpers.js";

type Case = {
  /** Sends the request as `who`. */
  call: (w: World, s: Setup, who: Who | null) => Promise<Reply>;
  /** What another family's caller gets: 404 for a row they name, or a check that they see none of this family's rows. */
  wrongFamily: number | ((r: Reply, w: World) => void);
  /** The same for someone in the family, outside the pair. Only for what's inside a pair. */
  outsider?: number | ((r: Reply, w: World) => void);
  public?: boolean;
};

type Setup = { pair: string; words: { id: string }; cooked: { id: string }; note: string; questionId: string; recipeId: string; dish: string; shareToken: string };

/** Mom and Dad's pair, with a text, a dish made and a saved note; a question on Dad's recipe. Leo is in the family and outside the pair. */
async function setup(w: World): Promise<Setup> {
  const pair = await pairOf(w, w.mom, w.dad);
  const words = await text(w, w.mom, pair, "Dinner at 6?");
  const cooked = ok(await say(w, w.mom, pair, { kind: "cooked", libraryId: CHILI }));
  const q = ok(await say(w, w.mom, pair, { kind: "question", body: "How long?", libraryId: CHILI, stepOrder: 1 }));
  const answer = ok(await say(w, w.dad, pair, { kind: "text", body: "Ten minutes.", replyTo: q.id }));
  const recipeId = await recipe(w.family, w.dad.id);
  const { rows } = await db().query(`insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, 'Beans?', 'asked_cook') returning id`, [w.family, recipeId, w.leo.id]);
  ok(await post(w.app, w.leo, "/v1/favorites", { libraryId: CHILI, on: true }, { key: null }));
  ok(await post(w.app, w.leo, "/v1/events", { libraryId: CHILI, kind: "cooked" }, { key: null }));
  const share = ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null }));
  return { pair, words, cooked, note: answer.noteId, questionId: rows[0].id, recipeId, dish: CHILI, shareToken: share.token };
}

const nothingOfTheirs = (r: Reply, w: World) => {
  assert.equal(r.status, 200, r.body);
  for (const id of [w.mom.id, w.dad.id, w.leo.id, w.nia.id]) assert.ok(!r.body.includes(id), `leaked ${id}`);
};

const CASES: Record<string, Case> = {
  "GET /v1/threads": { call: (w, _s, who) => get(w.app, who, "/v1/threads"), wrongFamily: nothingOfTheirs, outsider: (r, _w) => assert.ok(!r.body.includes("Dinner at 6?")) },
  "POST /v1/threads": { call: (w, _s, who) => post(w.app, who, "/v1/threads", { otherId: w.mom.id }, { key: null }), wrongFamily: 404 },
  "GET /v1/circle": { call: (w, _s, who) => get(w.app, who, "/v1/circle"), wrongFamily: nothingOfTheirs },
  "GET /v1/unread": { call: (w, _s, who) => get(w.app, who, "/v1/unread"), wrongFamily: (r) => assert.equal(r.data.total, 0), outsider: (r) => assert.equal(r.data.total, 0) },
  "GET /v1/threads/:id/messages": { call: (w, s, who) => get(w.app, who, `/v1/threads/${s.pair}/messages`), wrongFamily: 404, outsider: 404 },
  "POST /v1/threads/:id/messages": { call: (w, s, who) => say(w, who!, s.pair, { kind: "text", body: "Hi" }), wrongFamily: 404, outsider: 404 },
  "POST /v1/threads/:id/read": { call: (w, s, who) => post(w.app, who, `/v1/threads/${s.pair}/read`, undefined, { key: null }), wrongFamily: 404, outsider: 404 },
  "GET /v1/messages": { call: (w, _s, who) => get(w.app, who, "/v1/messages"), wrongFamily: nothingOfTheirs, outsider: (r) => assert.ok(!r.body.includes("Dinner at 6?")) },
  "POST /v1/messages": { call: (w, _s, who) => post(w.app, who, "/v1/messages", { kind: "text", text: "Hi", to: w.mom.id }), wrongFamily: 404 },
  "GET /v1/messages/made-my-dish": { call: (w, _s, who) => get(w.app, who, "/v1/messages/made-my-dish"), wrongFamily: (r) => assert.equal(r.data, null), outsider: (r) => assert.equal(r.data, null) },
  "POST /v1/messages/photo-note": {
    call: async (w, s, who) => post(w.app, who, "/v1/messages/photo-note", { recipeId: s.recipeId, photoKey: who ? await uploaded(w, who, "photo") : "x" }, { key: null }),
    wrongFamily: 404,
  },
  "POST /v1/messages/:id/postcard": { call: async (w, s, who) => post(w.app, who, `/v1/messages/${s.cooked.id}/postcard`, { photoKey: who ? await uploaded(w, who, "photo") : "x" }), wrongFamily: 404, outsider: 404 },
  "POST /v1/send-recipe": { call: (w, _s, who) => post(w.app, who, "/v1/send-recipe", { libraryId: CHILI, to: [w.mom.id] }), wrongFamily: 404 },
  "POST /v1/uploads": { call: (w, _s, who) => post(w.app, who, "/v1/uploads", { kind: "voice", contentType: "audio/m4a", size: 100 }, { key: null }), wrongFamily: (r, w) => assert.ok(!r.data.key?.includes(w.family)) },
  "POST /v1/uploads/confirm": {
    call: async (w, _s, who) => post(w.app, who, "/v1/uploads/confirm", { key: await uploaded(w, w.mom) }, { key: null }),
    wrongFamily: 404,
    outsider: 404,
  },
  "GET /v1/chat-questions/open": { call: (w, _s, who) => get(w.app, who, "/v1/chat-questions/open"), wrongFamily: nothingOfTheirs, outsider: (r) => assert.ok(!r.body.includes("How long?")) },
  "GET /v1/dishes/:libraryId/chat-questions": { call: (w, s, who) => get(w.app, who, `/v1/dishes/${s.dish}/chat-questions`), wrongFamily: nothingOfTheirs, outsider: (r) => assert.ok(!r.body.includes("How long?")) },
  "GET /v1/dishes/:libraryId/notes": { call: (w, s, who) => get(w.app, who, `/v1/dishes/${s.dish}/notes`), wrongFamily: nothingOfTheirs },
  "GET /v1/dishes/:libraryId/activity": { call: (w, s, who) => get(w.app, who, `/v1/dishes/${s.dish}/activity`), wrongFamily: nothingOfTheirs },
  // Leo is a kid, and only cooks save notes. messagesThreads.test.ts has a cook outside the pair.
  "POST /v1/notes": { call: (w, s, who) => post(w.app, who, "/v1/notes", { messageId: s.words.id }, { key: null }), wrongFamily: 404, outsider: 403 },
  "POST /v1/notes/:id/remove": { call: (w, s, who) => post(w.app, who, `/v1/notes/${s.note}/remove`, undefined, { key: null }), wrongFamily: 404, outsider: 403 },
  "POST /v1/questions": { call: (w, s, who) => post(w.app, who, "/v1/questions", { recipeId: s.recipeId, text: "Beans?" }), wrongFamily: 404 },
  "GET /v1/questions/open": { call: (w, _s, who) => get(w.app, who, "/v1/questions/open"), wrongFamily: nothingOfTheirs },
  "GET /v1/recipes/:recipeId/questions": { call: (w, s, who) => get(w.app, who, `/v1/recipes/${s.recipeId}/questions`), wrongFamily: (r) => assert.deepEqual(r.data.questions, []) },
  "POST /v1/questions/:id/answer": { call: (w, s, who) => post(w.app, who, `/v1/questions/${s.questionId}/answer`, { text: "Yes" }), wrongFamily: 404 },
  "POST /v1/shares": { call: (w, _s, who) => post(w.app, who, "/v1/shares", { libraryId: CHILI }, { key: null }), wrongFamily: (r, w) => assert.ok(!r.body.includes(w.family)) },
  "POST /v1/shares/open": { call: (w, s, who) => post(w.app, who, "/v1/shares/open", { token: s.shareToken }, { key: null }), wrongFamily: () => {}, public: true },
  "POST /v1/pending-sends": { call: (w, _s, who) => post(w.app, who, "/v1/pending-sends", { uploadId: "up-wrong-family", recipientIds: [w.mom.id] }), wrongFamily: 404 },
  "POST /v1/pending-sends/:uploadId/published": {
    // A row of this family's: another family's call finds nothing, and delivers nothing.
    call: async (w, _s, who) => post(w.app, who, "/v1/pending-sends/up-theirs/published", { libraryId: CHILI }, { key: null }),
    wrongFamily: (r) => assert.deepEqual(r.data, { delivered: 0 }),
  },
  "POST /v1/events": { call: (w, _s, who) => post(w.app, who, "/v1/events", { libraryId: CHILI, kind: "cooked", cookId: w.mom.id }, { key: null }), wrongFamily: 400 },
  "GET /v1/favorites": { call: (w, _s, who) => get(w.app, who, "/v1/favorites"), wrongFamily: (r) => assert.deepEqual(r.data.libraryIds, []) },
  "POST /v1/favorites": { call: (w, _s, who) => post(w.app, who, "/v1/favorites", { libraryId: CHILI, on: false }, { key: null }), wrongFamily: () => {} },
  "GET /v1/me/recipe-stats": { call: (w, _s, who) => get(w.app, who, "/v1/me/recipe-stats"), wrongFamily: (r) => assert.deepEqual(r.data.stats, []) },
  "GET /v1/dish-stats": { call: (w, s, who) => get(w.app, who, `/v1/dish-stats?ids=${s.dish}`), wrongFamily: (r) => assert.deepEqual(r.data, {}) },
  "GET /v1/hearts/recent": { call: (w, _s, who) => get(w.app, who, "/v1/hearts/recent"), wrongFamily: (r) => assert.deepEqual(r.data, []) },
  "GET /v1/table": { call: (w, _s, who) => get(w.app, who, "/v1/table"), wrongFamily: nothingOfTheirs },
  "GET /v1/recap": { call: (w, _s, who) => get(w.app, who, "/v1/recap?month=2026-11"), wrongFamily: nothingOfTheirs },
  "POST /v1/push-tokens": { call: (w, _s, who) => post(w.app, who, "/v1/push-tokens", { token: "ExponentPushToken[auth-case]", platform: "ios" }, { key: null }), wrongFamily: () => {} },
  "POST /v1/push-tokens/remove": {
    call: (w, _s, who) => post(w.app, who, "/v1/push-tokens/remove", { token: "ExponentPushToken[moms-phone]" }, { key: null }),
    wrongFamily: async () => {
      // Checked below: another family's call leaves Mom's token where it is.
    },
  },
};

for (const [name, c] of Object.entries(CASES)) {
  test(`${name}: no session, another family${c.outsider === undefined ? "" : ", and someone outside the pair"} are refused`, { skip }, async () => {
    const w = await world();
    const s = await setup(w);
    await post(w.app, w.mom, "/v1/push-tokens", { token: "ExponentPushToken[moms-phone]", platform: "ios" }, { key: null });
    await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids) values ('up-theirs', $1, $2, $3)`, [w.family, w.mom.id, [w.leo.id]]);

    if (!c.public) refused(await c.call(w, s, null), 401, "signed_out");

    const asStranger = await c.call(w, s, w.stranger);
    if (typeof c.wrongFamily === "number") refused(asStranger, c.wrongFamily);
    else await c.wrongFamily(asStranger, w);

    if (c.outsider !== undefined) {
      const asOutsider = await c.call(w, s, w.leo);
      if (typeof c.outsider === "number") refused(asOutsider, c.outsider);
      else c.outsider(asOutsider, w);
    }
    // Whatever was tried, nothing landed on the pair from outside it, and Mom's phone is still hers.
    const outsiders = await db().query(`select count(*)::int as n from messages where thread_id = $1 and sender_id <> all($2::text[])`, [s.pair, [w.mom.id, w.dad.id]]);
    assert.equal(outsiders.rows[0].n, 0);
    const phone = await db().query(`select person_id from push_tokens where token = 'ExponentPushToken[moms-phone]'`);
    assert.equal(phone.rows[0]?.person_id, w.mom.id);
    assert.equal((await db().query(`select delivered_at from pending_sends where upload_id = 'up-theirs'`)).rows[0].delivered_at, null);
  });
}

test("an expired session and a deleted person are refused everywhere", { skip }, async () => {
  const w = await world();
  await db().query(`update sessions set expires_at = now() - interval '1 second' where person_id = $1`, [w.dad.id]);
  refused(await get(w.app, w.dad, "/v1/threads"), 401, "signed_out");
  await db().query(`update people set name = 'Deleted', deleted_at = now(), tz = null, language = null where id = $1`, [w.leo.id]);
  refused(await get(w.app, w.leo, "/v1/threads"), 401, "signed_out");
  assert.ok(await circleOf(w));
});

test("every /v1 route in this area has a case above", { skip }, async () => {
  const found = new Set<string>();
  const app = buildApp({
    logger: false,
    routes: (a) => {
      a.addHook("onRoute", (route) => {
        for (const method of [route.method].flat()) {
          if (method !== "HEAD" && route.url.startsWith("/v1/") && route.url !== "/v1/me") found.add(`${method} ${route.url}`);
        }
      });
    },
  });
  await app.ready();
  assert.ok(found.size > 30);
  assert.deepEqual([...found].sort(), Object.keys(CASES).sort());
});

after(closeAll);

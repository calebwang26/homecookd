// SCHEMA.md's required test: for every route that takes a key, attaching another family's key is refused. Plus this area's stricter rules (DISH-MIGRATION.md, open
// question 3): someone else's upload in the same family, one not uploaded, one already held, one on its way out, the wrong kind. Every refusal reads the same.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { sweep } from "../src/modules/dish/tasks.js";
import { daily } from "../src/modules/messages/tasks.js";
import { CHILI, circleOf, closeAll, fileRow, get, ok, pairOf, post, recipe, refused, say, silent, skip, uploaded, type Who, type World, world } from "./messagesHelpers.js";

/** Every route that takes a file: how to send a key to it. Each runs on a fresh thread or question. */
type Attach = (w: World, who: Who, key: string) => Promise<{ status: number; data: any; body: string }>;

const question = async (w: World, cookId: string) => {
  const id = await recipe(w.family, cookId);
  const { rows } = await db().query(
    `insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, 'How long?', 'asked_cook') returning id`,
    [w.family, id, w.leo.id],
  );
  return rows[0].id as string;
};

const ROUTES: Record<string, { kind: "voice" | "photo"; attach: Attach }> = {
  "POST /v1/threads/:id/messages audioKey": {
    kind: "voice",
    attach: async (w, who, key) => say(w, who, await circleOf(w), { kind: "voice", audioKey: key, durationS: 5 }),
  },
  "POST /v1/threads/:id/messages photoKey": {
    kind: "photo",
    attach: async (w, who, key) => say(w, who, await circleOf(w), { kind: "cooked", libraryId: CHILI, photoKey: key }),
  },
  "POST /v1/messages audioKey": { kind: "voice", attach: (w, who, key) => post(w.app, who, "/v1/messages", { kind: "voice", audioKey: key }) },
  "POST /v1/messages photoKey": { kind: "photo", attach: (w, who, key) => post(w.app, who, "/v1/messages", { kind: "photo", photoKey: key }) },
  "POST /v1/messages/:id/postcard photoKey": {
    kind: "photo",
    attach: async (w, who, key) => {
      const made = ok(await say(w, who, await circleOf(w), { kind: "cooked", libraryId: CHILI }));
      return post(w.app, who, `/v1/messages/${made.id}/postcard`, { photoKey: key });
    },
  },
  "POST /v1/questions/:id/answer audioKey": {
    kind: "voice",
    attach: async (w, who, key) => post(w.app, who, `/v1/questions/${await question(w, who.id)}/answer`, { audioKey: key }),
  },
  "POST /v1/pending-sends helloKey": {
    kind: "voice",
    attach: (w, who, key) => post(w.app, who, "/v1/pending-sends", { uploadId: `up-${Math.random().toString(36).slice(2, 10)}`, recipientIds: [w.nia.id], helloKey: key, helloDurationS: 3 }),
  },
};

for (const [name, route] of Object.entries(ROUTES)) {
  test(`${name}: yours attaches once; another family's, someone else's, held, unconfirmed, deleted or the wrong kind is refused`, { skip }, async () => {
    const w = await world();
    const me = w.mom;

    // Another family's file: the route's guard refuses it.
    const theirs = await uploaded(w, w.stranger, route.kind);
    refused(await route.attach(w, me, theirs), 404, "not_found");
    assert.equal((await fileRow(theirs)).attached_at, null);

    // Someone else's upload in my own family: purging them would delete my message's file.
    const sisters = await uploaded(w, w.dad, route.kind);
    refused(await route.attach(w, me, sisters), 404, "not_found");
    assert.equal((await fileRow(sisters)).attached_at, null);

    // A guess.
    refused(await route.attach(w, me, "private/messages/nope.m4a"), 404, "not_found");

    // Asked for a link, never uploaded.
    const link = ok(await post(w.app, me, "/v1/uploads", { kind: route.kind, contentType: route.kind === "voice" ? "audio/m4a" : "image/jpeg", size: 2000 }, { key: null }), 201);
    refused(await route.attach(w, me, link.key), 404, "not_found");

    // On its way out.
    const going = await uploaded(w, me, route.kind);
    await db().query(`update files set delete_requested_at = now() where key = $1`, [going]);
    refused(await route.attach(w, me, going), 404, "not_found");

    // The wrong kind.
    const wrong = await uploaded(w, me, route.kind === "voice" ? "photo" : "voice");
    refused(await route.attach(w, me, wrong), 404, "not_found");

    // Mine, once. Then it's held, even on another row.
    const mine = await uploaded(w, me, route.kind);
    ok(await route.attach(w, me, mine));
    assert.notEqual((await fileRow(mine)).attached_at, null);
    refused(await route.attach(w, me, mine), 404, "not_found");
  });
}

test("every route that declares a file key is on the list above", { skip }, async () => {
  const app = buildApp({ logger: false });
  await app.ready();
  const declared = app.fileKeyRoutes
    .filter((r) => r.url.startsWith("/v1/") && r.url !== "/v1/messages/photo-note" && !r.url.startsWith("/v1/cravings/")) // files.test.ts holds cravings to this
    .flatMap((r) => r.fields.map((f) => `${r.method} ${r.url} ${f}`));
  assert.deepEqual(declared.sort(), Object.keys(ROUTES).sort());
});

test("two rows racing for one file: one wins, the other is refused and writes nothing", { skip }, async () => {
  const w = await world();
  const ring = await circleOf(w);
  const key = await uploaded(w, w.mom);
  const send = () => say(w, w.mom, ring, { kind: "voice", audioKey: key, durationS: 5 });
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 404]);
  assert.equal((await db().query(`select count(*)::int as n from messages where audio_key = $1`, [key])).rows[0].n, 1);
});

test("the photo note reads a file without holding it, and refuses what isn't mine", { skip }, async () => {
  const w = await world();
  const chili = await recipe(w.family, w.dad.id);
  const mine = await uploaded(w, w.leo, "photo");
  ok(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: mine }, { key: null }));
  assert.equal((await fileRow(mine)).attached_at, null);
  refused(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: await uploaded(w, w.stranger, "photo") }, { key: null }), 404, "not_found");
  refused(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: await uploaded(w, w.nia, "photo") }, { key: null }), 404, "not_found");
  refused(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: chili, photoKey: await uploaded(w, w.leo, "voice") }, { key: null }), 404, "not_found");
  const theirs = await recipe(w.otherFamily, w.stranger.id);
  refused(await post(w.app, w.leo, "/v1/messages/photo-note", { recipeId: theirs, photoKey: mine }, { key: null }), 404, "no_such_recipe");
});

test("clipKey names public library media only: a private key is refused, whoever's it is, and it's never signed", { skip }, async () => {
  const w = await world();
  const ring = await circleOf(w);
  const clip = (key: string, who = w.mom) => say(w, who, ring, { kind: "voice", clipKey: key, durationS: 5 });
  for (const key of [await uploaded(w, w.mom), await uploaded(w, w.stranger), "private/anything.m4a", "uploads/x.mp4", `${CHILI}/../../secret`, "not a key"]) {
    refused(await clip(key), 404, "not_found");
  }
  // A key shaped like library media, with a row in `files`, is still someone's file.
  await db().query(`insert into files (key, bucket, kind, family_id, uploaded_at) values ('some-family/voice.m4a', 'private', 'voice', $1, now())`, [w.otherFamily]);
  refused(await clip("some-family/voice.m4a"), 404, "not_found");

  process.env.MEDIA_BASE_URL = "https://media.test";
  const sent = ok(await clip(`${CHILI}/audio-1.m4a`));
  assert.equal(sent.audioUrl, `https://media.test/${CHILI}/audio-1.m4a`);
  delete process.env.MEDIA_BASE_URL;
  // With no media address set, the row keeps its key and the link is null, as with a missing file.
  const quiet = ok(await clip(`${CHILI}/audio-2.m4a`));
  assert.equal(quiet.audioUrl, null);
});

test("uploads: type, size, one owner; a guess or someone else's key can't be confirmed; S3's word is checked", { skip }, async () => {
  const w = await world();
  const ask = (body: Record<string, unknown>) => post(w.app, w.mom, "/v1/uploads", body, { key: null });
  refused(await ask({ kind: "video", contentType: "video/mp4", size: 100 }), 400, "bad_kind");
  refused(await ask({ kind: "voice", contentType: "video/mp4", size: 100 }), 415, "bad_type");
  refused(await ask({ kind: "photo", contentType: "audio/m4a", size: 100 }), 415, "bad_type");
  refused(await ask({ kind: "voice", contentType: "audio/m4a", size: 0 }), 400, "bad_size");
  refused(await ask({ kind: "voice", contentType: "audio/m4a", size: "12" }), 400, "bad_size");
  refused(await ask({ kind: "voice", contentType: "audio/m4a", size: 20 * 1024 * 1024 + 1 }), 413, "too_large");

  const link = ok(await ask({ kind: "voice", contentType: "audio/m4a; x=1", size: 2000 }), 201);
  assert.match(link.key, new RegExp(`^private/messages/${w.family}/[0-9a-f-]{36}\\.m4a$`));
  assert.deepEqual([link.contentType, link.uploadHeaders["Content-Type"]], ["audio/m4a", "audio/m4a"]);

  const confirm = (who: Who, key: unknown) => post(w.app, who, "/v1/uploads/confirm", { key }, { key: null });
  refused(await confirm(w.mom, link.key), 404, "not_found"); // nothing on S3 yet
  w.store.put(link.uploadUrl, new Uint8Array(2000), "audio/m4a");
  refused(await confirm(w.dad, link.key), 404, "not_found"); // same family, not theirs
  refused(await confirm(w.stranger, link.key), 404, "not_found");
  refused(await confirm(w.mom, "private/messages/guess.m4a"), 404, "not_found");
  refused(await confirm(w.mom, 12), 404, "not_found");
  ok(await confirm(w.mom, link.key));
  ok(await confirm(w.mom, link.key)); // repeatable
  assert.notEqual((await fileRow(link.key)).uploaded_at, null);

  // What landed isn't what the link was for: refused and marked.
  const other = ok(await ask({ kind: "voice", contentType: "audio/m4a", size: 2000 }), 201);
  w.store.put(other.uploadUrl, new Uint8Array(2000), "text/html");
  refused(await confirm(w.mom, other.key), 415, "bad_type");
  assert.notEqual((await fileRow(other.key)).delete_requested_at, null);

  w.store.failHeads = true;
  const down = ok(await ask({ kind: "voice", contentType: "audio/m4a", size: 2000 }), 201);
  refused(await confirm(w.mom, down.key), 502, "storage");
});

test("a read link that can't be made is null, and the page still answers", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  ok(await say(w, w.mom, pair, { kind: "voice", audioKey: await uploaded(w, w.mom), durationS: 4 }));
  w.store.failGets = true;
  const [m] = ok(await get(w.app, w.dad, `/v1/threads/${pair}/messages`)).messages;
  assert.equal(m.audioUrl, null);
});

test("a key never leaves the server: a message's answer holds read links only", { skip }, async () => {
  const w = await world();
  const pair = await pairOf(w, w.mom, w.dad);
  const key = await uploaded(w, w.mom);
  const sent = ok(await say(w, w.mom, pair, { kind: "voice", audioKey: key, durationS: 4 }));
  assert.equal(Object.keys(sent).some((k) => /key$/i.test(k)), false);
  assert.match(sent.audioUrl, /^https:\/\/fake-s3\.test\/get\//);
});

test("the sweep deletes a signed-in upload that was marked, and a day-old upload nothing took", { skip }, async () => {
  const w = await world();
  const kept = await uploaded(w, w.mom);
  const marked = await uploaded(w, w.mom);
  const stale = await uploaded(w, w.mom);
  const held = await uploaded(w, w.mom);
  ok(await say(w, w.mom, await circleOf(w), { kind: "voice", audioKey: held, durationS: 4 }));
  await db().query(`update files set delete_requested_at = now() where key = $1`, [marked]);
  await db().query(`update files set created_at = now() - interval '25 hours' where key = any($1::text[])`, [[stale, held]]);
  await db().query(`update files set created_at = now() - interval '23 hours' where key = $1`, [kept]);
  await daily();
  await sweep({ log: silent });
  assert.ok(w.store.objects.has(kept), "an hour isn't enough: a phone can send it later");
  assert.ok(w.store.objects.has(held), "attached: not an orphan");
  assert.ok(!w.store.objects.has(marked));
  assert.ok(!w.store.objects.has(stale));
  assert.notEqual((await fileRow(marked)).deleted_at, null);
});

test("the sweep still leaves what it can't reach: a marked row in another bucket stays marked", { skip }, async () => {
  const w = await world();
  await db().query(
    `insert into files (key, bucket, kind, family_id, owner_person_id, uploaded_at, delete_requested_at) values ('media-key', 'media', 'video', $1, $2, now(), now())`,
    [w.family, w.mom.id],
  );
  await sweep({ log: silent });
  assert.equal((await fileRow("media-key")).deleted_at, null);
});

after(closeAll);

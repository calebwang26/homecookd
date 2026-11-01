// One table, keyed by every `METHOD url` the app registers, with no exclusions by prefix. A route that isn't here fails the last test, so a new one can't pass silently. Each
// signed-in route states a call that works, then runs it with no session, an expired one, a deleted person's, a removed person's, another family's and, where it means
// anything, someone in the family outside the pair: or it says in words why that doesn't apply. An anonymous route says why it has no session, and shows its own capability
// refusing a guess. Area test files hold the behavior; this holds the door.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import { useUploadStore } from "../src/storage.js";
import { fakeStore } from "./dishHelpers.js";
import { cravingCard } from "./cravingHelpers.js";
import { CHILI, closeAll, familyRow, get, newKey, ok, pairOf, person, post, recipe, type Reply, say, skip, text, type Who, type World, world } from "./messagesHelpers.js";

type Scene = World & {
  /** A family that dealt with this one: it asked for a swap and to come to dinner. `stranger` has had nothing to do with it. */
  neighbor: Who;
  /** Each refused on sight. */
  gone: Who;
  tomb: Who;
  expired: Who;
  pair: string;
  words: { id: string };
  cooked: { id: string };
  note: string;
  questionId: string;
  dadsRecipe: string;
  poha: string;
  privateDish: string;
  dinner: string;
  joinRequest: string;
  swap: string;
  block: string;
  ask: string;
  askClip: string;
  shareToken: string;
  /** Mom's upload folder, a job on another folder, and a recording. */
  upload: string;
  job: string;
  recording: string;
};

type Check = { why: string; check: (r: Reply, s: Scene) => void };

type SignedIn = {
  call: (s: Scene, who: Who | null) => Promise<Reply>;
  /** The call that works, when it isn't the same call from Mom: it proves a refusal below isn't only a wrong id. */
  works?: (s: Scene) => Promise<Reply>;
  otherFamily: number | Check;
  outsider: number | Check | { familyWide: string };
  /** A route that can't succeed here yet says so, and what it answers. */
  notYet?: { status: number; why: string };
  /** Someone who left the family may still call this. Only what deleting an account needs (auth.ts, requireSessionEvenIfRemoved). */
  removedMayCall?: string;
};

type Anonymous = {
  anonymous: string;
  capability: (s: Scene) => Promise<void>;
};

const del = async (s: Scene, who: Who | null, url: string): Promise<Reply> => {
  const res = await s.app.inject({ method: "DELETE", url, headers: who ? { authorization: `Bearer ${who.token}` } : {} });
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null, body: res.body };
};

/** A confirmed upload of this person's, written straight to the ledger: the upload routes have their own cases, and this one mustn't depend on them. */
async function fileOf(who: Who | null, kind: "voice" | "photo"): Promise<string> {
  if (!who) return "private/none";
  const key = `private/test/${newKey()}`;
  await db().query(`insert into files (key, bucket, kind, content_type, family_id, owner_person_id, uploaded_at) values ($1, 'private', $2, 'image/jpeg', $3, $4, now())`, [key, kind, who.familyId, who.id]);
  return key;
}

const VIDEO = { contentType: "video/quicktime", size: 5, durationS: 60 };

async function scene(): Promise<Scene> {
  const w = await world();
  process.env.DISH_FAKE_AI = "1";
  const neighborFamily = await familyRow("The Okafors");
  const neighbor = await person(neighborFamily, "Ngozi", "cook");
  const gone = await person(w.family, "Sam", "kid");
  await db().query(`update people set removed_at = now() where id = $1`, [gone.id]);
  const tomb = await person(w.family, "Tomb", "kid");
  await db().query(`update people set name = 'Deleted', deleted_at = now() where id = $1`, [tomb.id]);
  const expired = await person(w.family, "Expired", "kid");
  await db().query(`update sessions set expires_at = now() - interval '1 second' where person_id = $1`, [expired.id]);

  const pair = await pairOf(w, w.mom, w.dad);
  const words = await text(w, w.mom, pair, "Dinner at 6?");
  const cooked = ok(await say(w, w.mom, pair, { kind: "cooked", libraryId: CHILI, body: "Words in the pair" }));
  const q = ok(await say(w, w.mom, pair, { kind: "question", body: "How long?", libraryId: CHILI, stepOrder: 1 }));
  const answer = ok(await say(w, w.dad, pair, { kind: "text", body: "Ten minutes.", replyTo: q.id }));
  const dadsRecipe = await recipe(w.family, w.dad.id);
  const { rows } = await db().query(`insert into questions (family_id, recipe_id, asked_by, text, status) values ($1, $2, $3, 'Beans?', 'asked_cook') returning id`, [w.family, dadsRecipe, w.leo.id]);
  ok(await post(w.app, w.leo, "/v1/favorites", { libraryId: CHILI, on: true }, { key: null }));
  ok(await post(w.app, w.leo, "/v1/events", { libraryId: CHILI, kind: "cooked" }, { key: null }));
  const share = ok(await post(w.app, w.mom, "/v1/shares", { libraryId: CHILI }, { key: null }));
  ok(await post(w.app, w.mom, "/v1/push-tokens", { token: "ExponentPushToken[moms-phone]", platform: "ios" }, { key: null }));
  await db().query(`insert into pending_sends (upload_id, family_id, sender_id, recipient_ids) values ('up-theirs', $1, $2, $3)`, [w.family, w.mom.id, [w.leo.id]]);

  const poha = await recipe(w.family, w.mom.id, { title: "Kanda Poha" });
  const privateDish = await recipe(w.family, w.mom.id, { title: "Private Dal" });
  // A third family, because a block ends what's between two families.
  const blockedFamily = await familyRow("The Blocked");
  const theirs = await recipe(blockedFamily, (await person(blockedFamily, "Ana", "cook")).id, { title: "Jollof" });
  await db().query(`update recipes set shared_at = now() where id = any($1::text[])`, [[poha, theirs]]);
  const dinner = ok(await post(w.app, w.mom, "/v1/dinners", { recipeId: poha, startsAt: Date.now() + 3_600_000, placeName: "Our kitchen", address: "12 Hidden St", seats: 4 }, { key: null }), 201).dinnerId;
  const joinRequest = ok(await post(w.app, neighbor, `/v1/dinners/${dinner}/join`, undefined, { key: null })).requestId;
  const swap = ok(await post(w.app, neighbor, "/v1/community/swaps", { recipeId: poha }, { key: null })).swapId;
  ok(await post(w.app, w.mom, "/v1/community/blocks", { kind: "recipe", targetId: theirs }, { key: null }));
  const block = ok(await get(w.app, w.mom, "/v1/community/blocks")).blocked[0].blockId;
  const card = await cravingCard(w.app, { token: w.mom.token, personId: w.mom.id, familyId: w.family });
  const askClip = `private/test/${newKey()}`;
  useUploadStore(fakeStore());
  const upload = ok(await post(w.app, w.mom, "/v1/video-uploads", { videos: [VIDEO] }), 201).uploadId as string;
  const jobRow = await db().query(
    `insert into jobs (family_id, cook_id, upload_key, source, stage, progress, idempotency_key) values ($1, $2, 'up-a-job/', 'phone', 'queued', 0, 'up-a-job/') returning id`,
    [w.family, w.mom.id],
  );
  const recordingRow = await db().query(`insert into recordings (family_id, cook_id, language, source, status) values ($1, $2, 'mr', 'glasses', 'recording') returning id`, [w.family, w.mom.id]);
  return Object.assign(w, {
    neighbor,
    gone,
    tomb,
    expired,
    pair,
    words,
    cooked,
    note: answer.noteId as string,
    questionId: rows[0].id as string,
    dadsRecipe,
    poha,
    privateDish,
    dinner,
    joinRequest,
    swap,
    block,
    ask: card.row.id as string,
    askClip,
    shareToken: share.token as string,
    upload,
    job: jobRow.rows[0].id as string,
    recording: recordingRow.rows[0].id as string,
  });
}

const nothingOfTheirs: Check = {
  why: "Reads the caller's own family: none of this family's people may appear",
  check: (r, s) => {
    assert.equal(r.status, 200, r.body);
    for (const id of [s.mom.id, s.dad.id, s.leo.id, s.nia.id]) assert.ok(!r.body.includes(id), `leaked ${id}`);
    assert.ok(!r.body.includes("Dinner at 6?"));
  },
};
const ownRows = (read: (r: Reply) => unknown[]): Check => ({
  why: "A list of the caller's own rows: empty for someone who has none",
  check: (r) => {
    assert.equal(r.status, 200, r.body);
    assert.deepEqual(read(r), []);
  },
});
const notThePair = (words = "Dinner at 6?"): Check => ({ why: "A list across my threads: another pair's words don't appear", check: (r) => assert.ok(!r.body.includes(words), r.body) });
const madeAnew = (why: string): Check => ({ why, check: (r) => assert.ok(r.status < 300, r.body) });

const WORDS_IN_THE_PAIR = "Words in the pair";

const preflight: Anonymous = {
  anonymous: "A browser's CORS preflight: it reads nothing and holds nothing",
  capability: async () => {},
};
/** The old routes' proof is a device key or the family code, not a session. A guess at either is refused. accountsProofs.test.ts holds the rest. */
const oldProof = (method: "GET" | "POST", url: string): Anonymous => ({
  anonymous: "Old builds prove themselves with a device key or the family code",
  capability: async (s) => {
    const guess = { "x-device-key": "Q".repeat(43) };
    const res = await s.app.inject({ method, url, headers: { ...guess, ...(method === "POST" ? { "content-type": "application/json" } : {}) }, ...(method === "POST" ? { payload: "{}" } : {}) });
    assert.equal(res.statusCode, 401, res.body);
    const none = await s.app.inject({ method, url, ...(method === "POST" ? { headers: { "content-type": "application/json" }, payload: "{}" } : {}) });
    assert.equal(none.statusCode, 401, none.body);
  },
});
const LEFT = "App Review 5.1.1(v): someone who left must still be able to delete their account";

const ROUTES: Record<string, SignedIn | Anonymous> = {
  // --- accounts
  "OPTIONS /family": preflight,
  "GET /family": oldProof("GET", "/family"),
  "OPTIONS /profiles": preflight,
  "POST /profiles": oldProof("POST", "/profiles"),
  "OPTIONS /profiles/self": preflight,
  "POST /profiles/self": oldProof("POST", "/profiles/self"),
  "OPTIONS /profiles/:id/remove": preflight,
  "POST /profiles/:id/remove": oldProof("POST", "/profiles/x/remove"),
  "OPTIONS /devices": preflight,
  "POST /devices": oldProof("POST", "/devices"),
  "OPTIONS /devices/revoke": preflight,
  "POST /devices/revoke": oldProof("POST", "/devices/revoke"),
  "OPTIONS /invites": preflight,
  "POST /invites": oldProof("POST", "/invites"),
  "OPTIONS /invites/peek": preflight,
  "POST /invites/peek": { anonymous: "The invite's token is the capability", capability: async (s) => assert.ok((await post(s.app, null, "/invites/peek", { token: "Q".repeat(22) }, { key: null })).status >= 400) },
  "OPTIONS /invites/accept": preflight,
  "POST /invites/accept": { anonymous: "The invite's token is the capability", capability: async (s) => assert.ok((await post(s.app, null, "/invites/accept", { token: "Q".repeat(22), deviceId: "a-device-id" }, { key: null })).status >= 400) },
  "OPTIONS /join-links": preflight,
  "POST /join-links": oldProof("POST", "/join-links"),
  "OPTIONS /join-links/revoke": preflight,
  "POST /join-links/revoke": oldProof("POST", "/join-links/revoke"),
  "OPTIONS /move-requests": preflight,
  "POST /move-requests": oldProof("POST", "/move-requests"),
  "OPTIONS /move-requests/mine": preflight,
  "GET /move-requests/mine": oldProof("GET", "/move-requests/mine"),
  "GET /move-requests": oldProof("GET", "/move-requests"),
  "OPTIONS /move-requests/:id/approve": preflight,
  "POST /move-requests/:id/approve": oldProof("POST", "/move-requests/x/approve"),
  "OPTIONS /move-requests/:id/decline": preflight,
  "POST /move-requests/:id/decline": oldProof("POST", "/move-requests/x/decline"),
  "OPTIONS /auth/apple": preflight,
  "POST /auth/apple": { anonymous: "Signing in: Apple's signed token is the proof", capability: async (s) => assert.ok((await post(s.app, null, "/auth/apple", { id_token: "not-a-real-token" }, { key: null })).status >= 400) },
  "OPTIONS /auth/google": preflight,
  "POST /auth/google": { anonymous: "Signing in: Google's signed token is the proof", capability: async (s) => assert.ok((await post(s.app, null, "/auth/google", { id_token: "not-a-real-token" }, { key: null })).status >= 400) },
  "POST /v1/sessions/start": { anonymous: "Makes a session from a device key", capability: async (s) => assert.equal((await post(s.app, null, "/v1/sessions/start", { deviceKey: "Q".repeat(43), profileId: s.mom.id }, { key: null })).status, 401) },
  "POST /v1/sessions/end": { anonymous: "Ends the session it names: a guess ends nothing, and a removed person can always sign out", capability: async (s) => {
    assert.equal((await post(s.app, null, "/v1/sessions/end", {}, { key: null, headers: { authorization: `Bearer ${"Q".repeat(43)}` } })).status, 200);
    assert.equal((await get(s.app, s.mom, "/v1/circle")).status, 200, "nobody else was signed out");
  } },
  "POST /v1/account/delete": {
    call: (s, who) => post(s.app, who, "/v1/account/delete", {}, { key: null }),
    otherFamily: { why: "It only ever deletes the caller", check: (r) => assert.equal(r.status, 503, r.body) },
    outsider: { familyWide: "It only ever deletes the caller" },
    notYet: { status: 503, why: "ACCOUNTS_OWNS_PEOPLE is off here: accountDeletion.test.ts runs it on" },
    removedMayCall: LEFT,
  },
  "GET /v1/apple/revoke-ready": { call: (s, who) => get(s.app, who, "/v1/apple/revoke-ready"), otherFamily: { why: "Says only whether the key is set", check: (r) => assert.equal(r.status, 200, r.body) }, outsider: { familyWide: "Says only whether the key is set" }, removedMayCall: LEFT },
  "POST /v1/apple/revoke": { call: (s, who) => post(s.app, who, "/v1/apple/revoke", { authorizationCode: "abc" }, { key: null }), otherFamily: { why: "Revokes only the code the caller holds", check: (r) => assert.equal(r.status, 503, r.body) }, outsider: { familyWide: "Revokes only the code the caller holds" }, notYet: { status: 503, why: "ACCOUNTS_OWNS_PEOPLE is off here: accountsApple.test.ts runs it on" }, removedMayCall: LEFT },
  "POST /v1/links/claim": { call: (s, who) => post(s.app, who, "/v1/links/claim", { token: "Q".repeat(43) }, { key: null }), otherFamily: 404, outsider: 404, notYet: { status: 404, why: "A real claim is in accountsLinks.test.ts" } },
  "POST /v1/links/moved": { call: (s, who) => post(s.app, who, "/v1/links/moved", { receipt: "x" }, { key: null }), otherFamily: 403, outsider: 403, notYet: { status: 403, why: "A real receipt is in accountsLinks.test.ts" } },
  "POST /link/open": { anonymous: "The link's token is the capability, from our own site only", capability: async (s) => {
    const refused = await s.app.inject({ method: "POST", url: "/link/open", headers: { origin: "https://example.com", "content-type": "application/json" }, payload: JSON.stringify({ token: "Q".repeat(43) }) });
    assert.equal(refused.statusCode, 403, refused.body);
  } },
  "OPTIONS /link/open": preflight,

  // --- jobs, recipes and recordings
  "POST /v1/video-uploads": { call: (s, who) => post(s.app, who, "/v1/video-uploads", { videos: [VIDEO] }), otherFamily: madeAnew("A new folder of the caller's own, in their own family"), outsider: 403 },
  "POST /v1/video-uploads/:uploadId/links": { call: (s, who) => post(s.app, who, `/v1/video-uploads/${s.upload}/links`), otherFamily: 404, outsider: 404 },
  "POST /v1/video-uploads/:uploadId/complete": { call: (s, who) => post(s.app, who, `/v1/video-uploads/${s.upload}/complete`), otherFamily: 404, outsider: 404 },
  "POST /v1/video-uploads/:uploadId/cancel": { call: (s, who) => post(s.app, who, `/v1/video-uploads/${s.upload}/cancel`), otherFamily: { why: "Looks only in the caller's family, and stops nothing there", check: (r) => assert.equal(r.data.stopped, false, r.body) }, outsider: 403 },
  "POST /v1/jobs": { call: (s, who) => post(s.app, who, "/v1/jobs", { uploadId: s.upload, source: "phone" }), otherFamily: 400, outsider: 403 },
  "GET /v1/jobs": { call: (s, who) => get(s.app, who, "/v1/jobs"), otherFamily: { why: "The caller's own family's jobs", check: (r, s) => assert.ok(r.status === 200 && !r.body.includes(s.job), r.body) }, outsider: { familyWide: "jobs.forFamily: everyone in the family sees its jobs" } },
  "GET /v1/jobs/:id": { call: (s, who) => get(s.app, who, `/v1/jobs/${s.job}`), otherFamily: 404, outsider: { familyWide: "A job belongs to the family" } },
  "POST /v1/jobs/:id/cancel": { call: (s, who) => post(s.app, who, `/v1/jobs/${s.job}/cancel`), otherFamily: 404, outsider: 403 },
  "GET /v1/recipes": { call: (s, who) => get(s.app, who, "/v1/recipes"), otherFamily: { why: "The caller's own family's recipes", check: (r) => assert.ok(r.status === 200 && !r.body.includes("Kanda Poha"), r.body) }, outsider: { familyWide: "A family's recipes are the whole family's" } },
  "GET /v1/recipes/:id": { call: (s, who) => get(s.app, who, `/v1/recipes/${s.poha}`), otherFamily: 404, outsider: { familyWide: "A family's recipes are the whole family's" } },
  "POST /v1/recipes/:id/memories-opt-in": {
    call: (s, who) => post(s.app, who, `/v1/recipes/${s.poha}/memories-opt-in`, { optIn: true }),
    otherFamily: 404,
    outsider: 403,
    notYet: { status: 501, why: "Recipe writes stay shut until the recipes switch: recipes.test.ts holds who may once it's open" },
  },
  "GET /v1/recordings/glasses-videos": { call: (s, who) => get(s.app, who, "/v1/recordings/glasses-videos"), otherFamily: ownRows((r) => r.data.videos), outsider: { familyWide: "glasses.videos: the family's recordings" } },
  "GET /v1/recordings/:id": { call: (s, who) => get(s.app, who, `/v1/recordings/${s.recording}`), otherFamily: 404, outsider: { familyWide: "live.recording: the family's recordings" } },
  "GET /v1/recordings/:id/log": { call: (s, who) => get(s.app, who, `/v1/recordings/${s.recording}/log`), otherFamily: 404, outsider: { familyWide: "liveEvents.forRecording: the family's recordings" } },
  "GET /v1/recordings/:id/frame": { call: (s, who) => get(s.app, who, `/v1/recordings/${s.recording}/frame`), otherFamily: 404, outsider: { familyWide: "liveEvents.frame: the family's recordings" } },
  "GET /v1/cooking": { call: (s, who) => get(s.app, who, "/v1/cooking"), otherFamily: ownRows((r) => r.data.cooking), outsider: { familyWide: "cooking.current: who's cooking in the family" } },

  // --- messages
  "GET /v1/threads": { call: (s, who) => get(s.app, who, "/v1/threads"), otherFamily: nothingOfTheirs, outsider: notThePair() },
  "POST /v1/threads": { call: (s, who) => post(s.app, who, "/v1/threads", { otherId: s.mom.id }, { key: null }), works: (s) => post(s.app, s.dad, "/v1/threads", { otherId: s.mom.id }, { key: null }), otherFamily: 404, outsider: { familyWide: "Anyone in a family may start a pair with anyone in it" } },
  "GET /v1/circle": { call: (s, who) => get(s.app, who, "/v1/circle"), otherFamily: nothingOfTheirs, outsider: { familyWide: "The circle is everyone in the family" } },
  "GET /v1/unread": { call: (s, who) => get(s.app, who, "/v1/unread"), works: (s) => get(s.app, s.dad, "/v1/unread"), otherFamily: { why: "Counts my own threads", check: (r) => assert.equal(r.data.total, 0) }, outsider: { why: "Counts my own threads", check: (r) => assert.equal(r.data.total, 0) } },
  "GET /v1/threads/:id/messages": { call: (s, who) => get(s.app, who, `/v1/threads/${s.pair}/messages`), otherFamily: 404, outsider: 404 },
  "POST /v1/threads/:id/messages": { call: (s, who) => say(s, who as Who, s.pair, { kind: "text", body: "Hi" }), otherFamily: 404, outsider: 404 },
  "POST /v1/threads/:id/read": { call: (s, who) => post(s.app, who, `/v1/threads/${s.pair}/read`, undefined, { key: null }), otherFamily: 404, outsider: 404 },
  "GET /v1/messages": { call: (s, who) => get(s.app, who, "/v1/messages"), otherFamily: nothingOfTheirs, outsider: notThePair() },
  "POST /v1/messages": { call: (s, who) => post(s.app, who, "/v1/messages", { kind: "text", text: "Hi", to: s.mom.id }), works: (s) => post(s.app, s.dad, "/v1/messages", { kind: "text", text: "Hi", to: s.mom.id }), otherFamily: 404, outsider: { familyWide: "Anyone in a family may write to anyone in it" } },
  "GET /v1/messages/made-my-dish": { call: (s, who) => get(s.app, who, "/v1/messages/made-my-dish"), otherFamily: { why: "My own dishes", check: (r) => assert.equal(r.data, null) }, outsider: { why: "My own dishes", check: (r) => assert.equal(r.data, null) } },
  "POST /v1/messages/photo-note": { call: async (s, who) => post(s.app, who, "/v1/messages/photo-note", { recipeId: s.dadsRecipe, photoKey: await fileOf(who, "photo") }, { key: null }), otherFamily: 404, outsider: { familyWide: "A family's recipes are the family's, and the photo is the caller's own" } },
  "POST /v1/messages/:id/postcard": { call: async (s, who) => post(s.app, who, `/v1/messages/${s.cooked.id}/postcard`, { photoKey: await fileOf(who, "photo") }), otherFamily: 404, outsider: 404 },
  "POST /v1/send-recipe": { call: (s, who) => post(s.app, who, "/v1/send-recipe", { libraryId: CHILI, to: [s.dad.id] }), otherFamily: 404, outsider: { familyWide: "Anyone in a family may send a dish to anyone in it" } },
  "POST /v1/uploads": { call: (s, who) => post(s.app, who, "/v1/uploads", { kind: "voice", contentType: "audio/m4a", size: 100 }, { key: null }), otherFamily: { why: "A link for the caller's own family's folder", check: (r, s) => assert.ok(!r.data.key?.includes(s.family)) }, outsider: { familyWide: "A link for the caller's own file; nothing else is named" } },
  "POST /v1/uploads/confirm": {
    call: async (s, who) => {
      const link = ok(await post(s.app, s.mom, "/v1/uploads", { kind: "voice", contentType: "audio/m4a", size: 100 }, { key: null }), 201);
      s.store.put(link.uploadUrl, new Uint8Array(100), "audio/m4a");
      return await post(s.app, who, "/v1/uploads/confirm", { key: link.key }, { key: null });
    },
    otherFamily: 404,
    outsider: 404,
  },
  "GET /v1/chat-questions/open": { call: (s, who) => get(s.app, who, "/v1/chat-questions/open"), otherFamily: nothingOfTheirs, outsider: notThePair("How long?") },
  "GET /v1/dishes/:libraryId/chat-questions": { call: (s, who) => get(s.app, who, `/v1/dishes/${CHILI}/chat-questions`), otherFamily: nothingOfTheirs, outsider: notThePair("How long?") },
  "GET /v1/dishes/:libraryId/notes": { call: (s, who) => get(s.app, who, `/v1/dishes/${CHILI}/notes`), otherFamily: nothingOfTheirs, outsider: { familyWide: "A note is saved into the shared family recipe. Whether a pair's answer should be is open for Caleb" } },
  "GET /v1/dishes/:libraryId/activity": { call: (s, who) => get(s.app, who, `/v1/dishes/${CHILI}/activity`), otherFamily: nothingOfTheirs, outsider: notThePair(WORDS_IN_THE_PAIR) },
  // Leo is a kid, and only cooks save notes. messagesThreads.test.ts has a cook outside the pair.
  "POST /v1/notes": { call: (s, who) => post(s.app, who, "/v1/notes", { messageId: s.cooked.id }, { key: null }), otherFamily: 404, outsider: 403 },
  "POST /v1/notes/:id/remove": { call: (s, who) => post(s.app, who, `/v1/notes/${s.note}/remove`, undefined, { key: null }), otherFamily: 404, outsider: 403 },
  "POST /v1/questions": { call: (s, who) => post(s.app, who, "/v1/questions", { recipeId: s.dadsRecipe, text: "Beans?" }), works: (s) => post(s.app, s.leo, "/v1/questions", { recipeId: s.dadsRecipe, text: "Beans?" }), otherFamily: 404, outsider: { familyWide: "Anyone in a family may ask about its recipes" } },
  "GET /v1/questions/open": { call: (s, who) => get(s.app, who, "/v1/questions/open"), otherFamily: nothingOfTheirs, outsider: { why: "Questions about recipes I cooked", check: (r) => assert.ok(!r.body.includes("Beans?")) } },
  "GET /v1/recipes/:recipeId/questions": { call: (s, who) => get(s.app, who, `/v1/recipes/${s.dadsRecipe}/questions`), otherFamily: ownRows((r) => r.data.questions), outsider: { familyWide: "A recipe's questions are the family's" } },
  "POST /v1/questions/:id/answer": { call: (s, who) => post(s.app, who, `/v1/questions/${s.questionId}/answer`, { text: "Yes" }), otherFamily: 404, outsider: 403 },
  "POST /v1/shares": { call: (s, who) => post(s.app, who, "/v1/shares", { libraryId: CHILI }, { key: null }), otherFamily: { why: "A link of the caller's own", check: (r, s) => assert.ok(!r.body.includes(s.shareToken)) }, outsider: { why: "A link of the caller's own", check: (r, s) => assert.ok(!r.body.includes(s.shareToken)) } },
  "POST /v1/pending-sends": { call: (s, who) => post(s.app, who, "/v1/pending-sends", { uploadId: "up-theirs", recipientIds: [s.dad.id] }), otherFamily: 404, outsider: 409 },
  "POST /v1/pending-sends/:uploadId/published": {
    call: (s, who) => post(s.app, who, "/v1/pending-sends/up-theirs/published", { libraryId: CHILI }, { key: null }),
    otherFamily: { why: "Another family's upload reads as none, and delivers nothing", check: (r) => assert.deepEqual(r.data, { delivered: 0 }) },
    outsider: 403,
  },
  "POST /v1/events": { call: (s, who) => post(s.app, who, "/v1/events", { libraryId: CHILI, kind: "viewed", cookId: s.mom.id }, { key: null }), otherFamily: 400, outsider: { familyWide: "A person's own activity, naming a cook in the family" } },
  "GET /v1/favorites": { call: (s, who) => get(s.app, who, "/v1/favorites"), works: (s) => get(s.app, s.leo, "/v1/favorites"), otherFamily: ownRows((r) => r.data.libraryIds), outsider: { familyWide: "A person's own hearts" } },
  "POST /v1/favorites": { call: (s, who) => post(s.app, who, "/v1/favorites", { libraryId: CHILI, on: false }, { key: null }), otherFamily: madeAnew("A person's own heart, on a public library dish"), outsider: { familyWide: "A person's own hearts" } },
  "GET /v1/me/recipe-stats": { call: (s, who) => get(s.app, who, "/v1/me/recipe-stats"), otherFamily: ownRows((r) => r.data.stats), outsider: { familyWide: "A person's own history" } },
  "GET /v1/dish-stats": { call: (s, who) => get(s.app, who, `/v1/dish-stats?ids=${CHILI}`), otherFamily: { why: "Only my dishes, by my name", check: (r) => assert.deepEqual(r.data, {}) }, outsider: { familyWide: "Counts go to a dish's cook, from the family" } },
  "GET /v1/hearts/recent": { call: (s, who) => get(s.app, who, "/v1/hearts/recent"), otherFamily: ownRows((r) => r.data), outsider: { familyWide: "Hearts on my dishes, from the family" } },
  "GET /v1/table": { call: (s, who) => get(s.app, who, "/v1/table"), otherFamily: nothingOfTheirs, outsider: { why: "Only the pairs that include me", check: (r, s) => assert.ok(!(r.data.pairs as { kid_id: string; cook_id: string }[]).some((p) => p.kid_id === s.nia.id)) } },
  "GET /v1/recap": { call: (s, who) => get(s.app, who, "/v1/recap?month=2026-11"), otherFamily: nothingOfTheirs, outsider: { familyWide: "A person's own month" } },
  "POST /v1/push-tokens": { call: (s, who) => post(s.app, who, "/v1/push-tokens", { token: "ExponentPushToken[auth-case]", platform: "ios" }, { key: null }), otherFamily: madeAnew("The caller's own phone"), outsider: { familyWide: "The caller's own phone" } },
  "POST /v1/push-tokens/remove": { call: (s, who) => post(s.app, who, "/v1/push-tokens/remove", { token: "ExponentPushToken[moms-phone]" }, { key: null }), works: (s) => post(s.app, s.mom, "/v1/push-tokens/remove", { token: "ExponentPushToken[not-a-phone]" }, { key: null }), otherFamily: { why: "Answers the same and leaves another family's token: checked after every case", check: (r) => assert.equal(r.status, 200) }, outsider: { familyWide: "Only within the caller's family, as both old systems had it: a shared phone signs out" } },

  // --- people
  "GET /v1/me": { call: (s, who) => get(s.app, who, "/v1/me"), otherFamily: { why: "Only ever the caller", check: (r, s) => assert.notEqual(r.data.family.id, s.family) }, outsider: { familyWide: "Only ever the caller" } },

  // --- live
  "GET /v1/live/jobs": { call: (s, who) => get(s.app, who, "/v1/live/jobs"), otherFamily: nothingOfTheirs, outsider: { familyWide: "A family's jobs are the family's" } },

  // --- Community. Between families on purpose: a shared dish and an open dinner are for neighbors, and each stays hidden by the safety rules (communityRoutes.test.ts).
  "GET /v1/community/feed": { call: (s, who) => get(s.app, who, "/v1/community/feed"), otherFamily: { why: "Between families: shared dishes only, never a private one", check: (r) => assert.ok(!r.body.includes("Private Dal"), r.body) }, outsider: { familyWide: "Community isn't about a pair" } },
  "GET /v1/community/dinners": { call: (s, who) => get(s.app, who, "/v1/community/dinners"), otherFamily: { why: "Between families: an open dinner, never its address", check: (r) => assert.ok(!r.body.includes("12 Hidden St"), r.body) }, outsider: { familyWide: "Community isn't about a pair" } },
  "GET /v1/community/recipes/:id": { call: (s, who) => get(s.app, who, `/v1/community/recipes/${s.privateDish}`), otherFamily: 404, outsider: { familyWide: "A family's own recipe" } },
  "GET /v1/community/swaps": { call: (s, who) => get(s.app, who, "/v1/community/swaps"), otherFamily: ownRows((r) => r.data.swaps), outsider: { familyWide: "A swap is between families" } },
  "POST /v1/community/swaps": { call: (s, who) => post(s.app, who, "/v1/community/swaps", { recipeId: s.privateDish }, { key: null }), works: (s) => post(s.app, s.stranger, "/v1/community/swaps", { recipeId: s.poha }, { key: null }), otherFamily: 404, outsider: { familyWide: "A swap is between families" } },
  "POST /v1/community/cook-together": { call: (s, who) => post(s.app, who, "/v1/community/cook-together", { recipeId: s.privateDish }, { key: null }), works: (s) => post(s.app, s.stranger, "/v1/community/cook-together", { recipeId: s.poha }, { key: null }), otherFamily: 404, outsider: { familyWide: "A swap is between families" } },
  "POST /v1/community/swaps/:id/respond": { call: (s, who) => post(s.app, who, `/v1/community/swaps/${s.swap}/respond`, { accept: true }, { key: null }), otherFamily: 404, outsider: { familyWide: "Anyone in the family that was asked says yes or no" } },
  "POST /v1/community/reports": { call: (s, who) => post(s.app, who, "/v1/community/reports", { kind: "recipe", targetId: s.privateDish }, { key: null }), works: (s) => post(s.app, s.stranger, "/v1/community/reports", { kind: "recipe", targetId: s.poha }, { key: null }), otherFamily: 404, outsider: { familyWide: "A report is a family's" } },
  "POST /v1/community/blocks": { call: (s, who) => post(s.app, who, "/v1/community/blocks", { kind: "recipe", targetId: s.privateDish }, { key: null }), works: (s) => post(s.app, s.stranger, "/v1/community/blocks", { kind: "recipe", targetId: s.poha }, { key: null }), otherFamily: 404, outsider: { familyWide: "A block is a family's" } },
  "GET /v1/community/blocks": { call: (s, who) => get(s.app, who, "/v1/community/blocks"), otherFamily: ownRows((r) => r.data.blocked), outsider: { familyWide: "A block is a family's" } },
  "DELETE /v1/community/blocks/:id": { call: (s, who) => del(s, who, `/v1/community/blocks/${s.block}`), otherFamily: 404, outsider: { familyWide: "A block is a family's" } },
  "POST /v1/dinners": { call: (s, who) => post(s.app, who, "/v1/dinners", { recipeId: s.privateDish, startsAt: Date.now() + 3_600_000, placeName: "Kitchen", address: "1 St", seats: 2 }, { key: null }), works: (s) => post(s.app, s.mom, "/v1/dinners", { recipeId: s.poha, startsAt: Date.now() + 7_200_000, placeName: "Kitchen", address: "1 St", seats: 2 }, { key: null }), otherFamily: 404, outsider: { familyWide: "A family's own recipe" } },
  "GET /v1/dinners/mine": { call: (s, who) => get(s.app, who, "/v1/dinners/mine"), otherFamily: { why: "My own dinners and asks", check: (r, s) => assert.ok(!r.body.includes(s.dinner), r.body) }, outsider: { familyWide: "A host's or a guest's own" } },
  "GET /v1/dinners/:id": { call: (s, who) => get(s.app, who, `/v1/dinners/${s.dinner}`), otherFamily: { why: "Between families: the dinner, never its address before being let in", check: (r) => assert.ok(!r.body.includes("12 Hidden St"), r.body) }, outsider: { familyWide: "Community isn't about a pair" } },
  "POST /v1/dinners/:id/join": { call: (s, who) => post(s.app, who, `/v1/dinners/${s.dinner}/join`, undefined, { key: null }), works: async (s) => post(s.app, await person(await familyRow("The Newcomers"), "New", "kid"), `/v1/dinners/${s.dinner}/join`, undefined, { key: null }), otherFamily: { why: "Between families: asking to come is the point. It's pending until the host says yes", check: (r) => assert.equal(r.data.status ?? "pending", "pending") }, outsider: { familyWide: "Community isn't about a pair" } },
  "POST /v1/dinner-requests/:id/respond": { call: (s, who) => post(s.app, who, `/v1/dinner-requests/${s.joinRequest}/respond`, { accept: true }, { key: null }), otherFamily: 404, outsider: 404 },
  "POST /v1/dinners/:id/invite-link": { call: (s, who) => post(s.app, who, `/v1/dinners/${s.dinner}/invite-link`, undefined, { key: null }), otherFamily: 403, outsider: 403 },
  "POST /v1/share-requests": { call: (s, who) => post(s.app, who, "/v1/share-requests", { recipeId: s.privateDish }, { key: null }), works: (s) => post(s.app, s.mom, "/v1/share-requests", { recipeId: s.privateDish }, { key: null }), otherFamily: 404, outsider: { familyWide: "Anyone in a family may ask its cook" }, notYet: { status: 501, why: "A cook's own tap writes recipes.shared_at, which moves later (COMMUNITY-MIGRATION.md)" } },
  "GET /v1/share-requests/dishes": { call: (s, who) => get(s.app, who, "/v1/share-requests/dishes"), otherFamily: nothingOfTheirs, outsider: { familyWide: "A family's dishes" } },

  // --- cravings: asked of one person
  "POST /v1/cravings/link": { call: (s, who) => post(s.app, who, "/v1/cravings/link", {}, { key: null }), otherFamily: madeAnew("The caller's own link"), outsider: { familyWide: "The caller's own link" } },
  "POST /v1/cravings/link/revoke": { call: (s, who) => post(s.app, who, "/v1/cravings/link/revoke", undefined, { key: null }), otherFamily: madeAnew("The caller's own link"), outsider: { familyWide: "The caller's own link" } },
  "GET /v1/cravings": { call: (s, who) => get(s.app, who, "/v1/cravings"), otherFamily: nothingOfTheirs, outsider: { why: "Only what was asked of me", check: (r, s) => assert.ok(!r.body.includes(s.ask), r.body) } },
  "GET /v1/cravings/:id": { call: (s, who) => get(s.app, who, `/v1/cravings/${s.ask}`), otherFamily: 404, outsider: 404 },
  "POST /v1/cravings/:id/filming-day": { call: (s, who) => post(s.app, who, `/v1/cravings/${s.ask}/filming-day`, { day: 2 }, { key: null }), otherFamily: 404, outsider: 403 },
  "POST /v1/cravings/:id/voice-recipe/upload": { call: (s, who) => post(s.app, who, `/v1/cravings/${s.ask}/voice-recipe/upload`, { contentType: "audio/mp4", size: 400 }, { key: null }), otherFamily: 404, outsider: 403 },
  "POST /v1/cravings/:id/voice-recipe": {
    call: (s, who) => post(s.app, who, `/v1/cravings/${s.ask}/voice-recipe`, { audioKey: s.askClip, durationS: 5 }, { key: null }),
    works: async (s) => {
      const link = ok(await post(s.app, s.mom, `/v1/cravings/${s.ask}/voice-recipe/upload`, { contentType: "audio/mp4", size: 400 }, { key: null }), 201);
      s.store.put(link.uploadUrl, new Uint8Array(400).fill(1), link.contentType);
      return await post(s.app, s.mom, `/v1/cravings/${s.ask}/voice-recipe`, { audioKey: link.audioKey, durationS: 5 }, { key: null });
    },
    otherFamily: 404,
    outsider: 404,
  },

  // --- no session, each for its own reason
  "GET /health": {
    anonymous: "For the load balancer: is this process up? It reads nothing",
    capability: async (s) => assert.equal((await s.app.inject({ method: "GET", url: "/health" })).body, "ok"),
  },
  "GET /ready": {
    anonymous: "For deploys: can it reach the database? It says only that",
    capability: async (s) => assert.deepEqual((await get(s.app, null, "/ready")).data, { database: "ok" }),
  },
  "POST /v1/shares/open": {
    anonymous: "A recipe link someone sent: the token is the capability, and it's rate limited by IP",
    capability: async (s) => {
      assert.equal((await post(s.app, null, "/v1/shares/open", { token: "ABCDEFGHIJ" }, { key: null })).status, 404);
      ok(await post(s.app, null, "/v1/shares/open", { token: s.shareToken }, { key: null }));
    },
  },
  "OPTIONS /invite/open": {
    anonymous: "A browser's preflight for the dinner invite page. It reads nothing, and another site is refused",
    capability: async (s) => {
      const res = await s.app.inject({ method: "OPTIONS", url: "/invite/open", headers: { origin: "https://evil.example" } });
      assert.equal(res.statusCode, 403);
    },
  },
  "POST /invite/open": {
    anonymous: "A dinner's invite link: the token is the capability, and it's rate limited by IP",
    capability: async (s) => assert.equal((await post(s.app, null, "/invite/open", { token: "Q".repeat(22), deviceId: "D".repeat(16) }, { key: null })).status, 404),
  },
  "OPTIONS /dish/*": {
    anonymous: "A browser's preflight for the kid's and Mom's pages. It reads nothing, and another site is refused",
    capability: async (s) => {
      const res = await s.app.inject({ method: "OPTIONS", url: "/dish/cards", headers: { origin: "https://evil.example" } });
      assert.equal(res.statusCode, 403);
    },
  },
  "POST /dish/files": {
    anonymous: "A kid with no account: the fileId it returns is the capability, and only its sha256 is stored. No S3 key leaves here",
    capability: async (s) => {
      const r = await post(s.app, null, "/dish/files?kind=photo", { contentType: "image/jpeg", size: 100 }, { key: null, headers: { origin: "https://evil.example" } });
      assert.equal(r.status, 403);
    },
  },
  "POST /dish/files/confirm": { anonymous: "fileId is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/files/confirm", { fileId: "Q".repeat(22) }, { key: null })).status, 404) },
  "POST /dish/cards": { anonymous: "A kid with no account makes a card: rate limited by IP, and a file it names must be its own capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/cards", { dish: "dal", photos: ["Q".repeat(22)] }, { key: null })).status, 404) },
  "POST /dish/cards/get": { anonymous: "kidToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/cards/get", { kidToken: "Q".repeat(22) }, { key: null })).status, 404) },
  "POST /dish/cards/update": { anonymous: "kidToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/cards/update", { kidToken: "Q".repeat(22), message: "x" }, { key: null })).status, 404) },
  "POST /dish/cards/ask": { anonymous: "kidToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/cards/ask", { kidToken: "Q".repeat(22), questions: [{ text: "?" }] }, { key: null })).status, 404) },
  "POST /dish/cards/sent": { anonymous: "kidToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/cards/sent", { kidToken: "Q".repeat(22), via: "copy" }, { key: null })).status, 404) },
  "POST /dish/ask/peek": { anonymous: "askToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/ask/peek", { askToken: "Q".repeat(22) }, { key: null })).status, 404) },
  "POST /dish/ask/answer/upload": { anonymous: "askToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/ask/answer/upload?q=q1&lang=en&durationS=3", { askToken: "Q".repeat(22), contentType: "audio/mp4", size: 100 }, { key: null })).status, 404) },
  "POST /dish/ask/answer": { anonymous: "askToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/ask/answer?q=q1&lang=en&durationS=3", { askToken: "Q".repeat(22), fileId: "Q".repeat(22) }, { key: null })).status, 404) },
  "POST /dish/ask/finish": { anonymous: "askToken is the capability", capability: async (s) => assert.equal((await post(s.app, null, "/dish/ask/finish", { askToken: "Q".repeat(22) }, { key: null })).status, 404) },
};

const isAnonymous = (c: SignedIn | Anonymous): c is Anonymous => "anonymous" in c;

function expectStatus(r: Reply, status: number, label: string): void {
  assert.equal(r.status, status, `${label}: ${r.body}`);
}

for (const [route, c] of Object.entries(ROUTES)) {
  if (isAnonymous(c)) {
    test(`${route}: no session, because: ${c.anonymous}`, { skip }, async () => {
      await c.capability(await scene());
    });
    continue;
  }
  test(`${route}: no session, expired, deleted, removed, another family, outside the pair`, { skip }, async () => {
    const s = await scene();
    expectStatus(await c.call(s, null), 401, "no session");
    expectStatus(await c.call(s, s.expired), 401, "expired");
    expectStatus(await c.call(s, s.tomb), 401, "a deleted person");
    if (c.removedMayCall) assert.notEqual((await c.call(s, s.gone)).status, 403, c.removedMayCall);
    else expectStatus(await c.call(s, s.gone), 403, "someone removed from the family");

    const stranger = await c.call(s, s.stranger);
    if (typeof c.otherFamily === "number") expectStatus(stranger, c.otherFamily, "another family");
    else c.otherFamily.check(stranger, s);

    if (typeof c.outsider === "number") expectStatus(await c.call(s, s.leo), c.outsider, "outside the pair");
    else if ("check" in c.outsider) c.outsider.check(await c.call(s, s.leo), s);
    else assert.ok(c.outsider.familyWide.length > 0);

    // Whatever was tried, nothing landed on the pair from outside it, and Mom's phone and recording are still hers.
    const outsiders = await db().query(`select count(*)::int as n from messages where thread_id = $1 and sender_id <> all($2::text[])`, [s.pair, [s.mom.id, s.dad.id]]);
    assert.equal(outsiders.rows[0].n, 0);
    assert.equal((await db().query(`select person_id from push_tokens where token = 'ExponentPushToken[moms-phone]'`)).rows[0]?.person_id, s.mom.id);
    const send = (await db().query(`select sender_id, delivered_at from pending_sends where upload_id = 'up-theirs'`)).rows[0];
    assert.deepEqual([send.sender_id, send.delivered_at], [s.mom.id, null]);

    // And the same request works from who it's for: a refusal above isn't only a wrong id.
    const worked = await (c.works ? c.works(s) : c.call(s, s.mom));
    if (c.notYet) assert.equal(worked.status, c.notYet.status, worked.body);
    else assert.ok(worked.status < 300, `${route} from who it's for: ${worked.status} ${worked.body}`);
  });
}

// --- the table itself

/** Every route the app registers, however it was registered: app.ts records them from its first line, before any route exists. */
async function registeredRoutes(extra?: (app: FastifyInstance) => void): Promise<string[]> {
  const app = buildApp({ logger: false, routes: extra });
  await app.ready();
  const found = app.allRoutes.map((r) => `${r.method} ${r.url}`);
  await app.close();
  return found;
}

/** What's wrong with the table against what the app registers. Fastify adds a HEAD beside every GET, with the same hooks: only those are left out. */
function coverageProblems(found: string[], table: Record<string, SignedIn | Anonymous>): string[] {
  const routes = found.filter((r) => !(r.startsWith("HEAD ") && found.includes(r.replace("HEAD ", "GET "))));
  const problems: string[] = [];
  for (const r of routes) {
    const c = table[r];
    if (!c) {
      problems.push(`${r}: not in the table`);
    } else if (isAnonymous(c)) {
      if (!c.anonymous.trim() || !c.capability) problems.push(`${r}: an anonymous route must say why, and show its capability refusing`);
    } else {
      if (!c.call) problems.push(`${r}: no call`);
      if (c.otherFamily === undefined) problems.push(`${r}: no another-family case`);
      if (c.outsider === undefined) problems.push(`${r}: no outsider case or family-wide reason`);
      if (c.outsider !== undefined && typeof c.outsider === "object" && "familyWide" in c.outsider && !c.outsider.familyWide.trim()) problems.push(`${r}: family-wide needs a reason`);
    }
  }
  for (const r of Object.keys(table)) if (!routes.includes(r)) problems.push(`${r}: in the table, but the app has no such route`);
  return problems;
}

test("every route the app registers has its cases", { skip }, async () => {
  assert.deepEqual(coverageProblems(await registeredRoutes(), ROUTES), []);
});

test("an unlisted route fails the check, whatever its prefix, and so does a case with no reason or a stale one", { skip }, async () => {
  const found = await registeredRoutes((a) => {
    a.get("/v1/brand-new", async () => ({}));
    a.post("/anywhere/else", { config: { noBody: true } }, async () => ({}));
  });
  assert.deepEqual(coverageProblems(found, ROUTES), ["GET /v1/brand-new: not in the table", "POST /anywhere/else: not in the table"]);

  const call = async () => ({ status: 200, data: null, body: "" });
  assert.deepEqual(
    coverageProblems(["GET /a", "GET /b", "GET /c"], {
      "GET /a": { call, otherFamily: 404 } as unknown as SignedIn,
      "GET /b": { call, otherFamily: 404, outsider: { familyWide: " " } },
      "GET /c": { anonymous: "", capability: async () => {} },
      "GET /gone": { anonymous: "why", capability: async () => {} },
    }),
    [
      "GET /a: no outsider case or family-wide reason",
      "GET /b: family-wide needs a reason",
      "GET /c: an anonymous route must say why, and show its capability refusing",
      "GET /gone: in the table, but the app has no such route",
    ],
  );
});

test("the HEAD Fastify adds beside a GET has the same door", { skip }, async () => {
  const s = await scene();
  const res = await s.app.inject({ method: "HEAD", url: "/v1/threads" });
  assert.equal(res.statusCode, 401);
  const removed = await s.app.inject({ method: "HEAD", url: "/v1/threads", headers: { authorization: `Bearer ${s.gone.token}` } });
  assert.equal(removed.statusCode, 403);
});

after(closeAll);

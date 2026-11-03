// What the messages tests share: the routes through app.inject on real Postgres, a fake S3, a fake library, a fake Expo and fake models. Nothing here reaches a network,
// and all data is made up. Postgres's clock can't be faked, so tests that need time to pass move stored times back.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import type { ExpoMessage, ExpoTicket } from "../src/modules/messages/expo.js";
import { usePushSender } from "../src/modules/messages/expo.js";
import { type Library, makeLibrary, useLibrary } from "../src/modules/messages/library.js";
import { models } from "../src/modules/messages/models.js";
import { recipeEffects } from "../src/modules/messages/questions.js";
import type { RecipeInfo } from "../src/modules/messages/recap.js";
import { sendDue } from "../src/outbox.js";
import { handleMessage } from "../src/scheduled.js";
import { useObjectStore } from "../src/storage.js";
import { fakeStore, type FakeStore, silent } from "./dishHelpers.js";
import { freshDatabase, hasDatabase, session } from "./helpers.js";

export { hasDatabase, silent };
export const skip = !hasDatabase;
export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// The library: Dad's two dishes and Mom's dal, as Supabase's api_test has them

export const CHILI = "dad-sunday-chili";
export const RICE = "dad-fried-rice";
export const DAL = "mom-dal";
export const NOODLES = "grandma-hand-pulled-noodle-soup";

export type FakeLibrary = Library & {
  index: Map<string, RecipeInfo>;
  recipes: Map<string, { title: string; cook_name: string | null; sample: boolean; steps: { order: number; quote: string | null }[] }>;
  down: boolean;
};

export function fakeLibrary(): FakeLibrary {
  const lib: FakeLibrary = {
    index: new Map<string, RecipeInfo>([
      [CHILI, { title: "Sunday Chili", cook_name: "Dad", sample: true }],
      [RICE, { title: "Fried Rice", cook_name: "Dad", sample: false }],
      [DAL, { title: "Mom's Dal", cook_name: "Mom", sample: false }],
      [NOODLES, { title: "Noodle Soup", cook_name: "Grandma", sample: true }],
    ]),
    recipes: new Map([
      [CHILI, { title: "Dad's Sunday Chili", cook_name: "Dad", sample: true, steps: [] }],
      [RICE, { title: "Dad's Fried Rice", cook_name: "Dad", sample: false, steps: [{ order: 1, quote: "Day-old rice, always." }] }],
      [DAL, { title: "Mom's Dal", cook_name: "Mom", sample: false, steps: [] }],
      [NOODLES, { title: "Noodle Soup", cook_name: "Grandma", sample: true, steps: [] }],
    ]),
    down: false,
    libraryIndex: async () => (lib.down ? new Map() : lib.index),
    recipeInfo: async (id) => {
      const r = lib.down ? undefined : lib.recipes.get(id);
      return r ? { id, ...r } : null;
    },
    exists: async (id) => (lib.down ? null : lib.recipes.has(id)),
  };
  return lib;
}

// ---------------------------------------------------------------------------------------------
// Expo

export type FakeExpo = {
  sent: ExpoMessage[][];
  dead: Set<string>;
  deadInReceipts: Set<string>;
  down: boolean;
};

export function fakeExpo(): FakeExpo {
  const state: FakeExpo = { sent: [], dead: new Set(), deadInReceipts: new Set(), down: false };
  usePushSender({
    async send(messages) {
      if (state.down) return { tickets: messages.map((): ExpoTicket => ({ status: "error", message: "HTTP 503" })), dead: [] };
      state.sent.push(messages);
      const tickets = messages.map((m): ExpoTicket => (state.dead.has(m.to) ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `ticket-${m.to}` }));
      return { tickets, dead: messages.filter((m) => state.dead.has(m.to)).map((m) => m.to) };
    },
    async deadReceipts(ids) {
      return ids.filter((id) => [...state.deadInReceipts].some((token) => id === `ticket-${token}`));
    },
  });
  return state;
}

/** What reached Expo, as [to, title, body, url]. */
export const pushes = (expo: FakeExpo) => expo.sent.flat().map((m) => [m.to, m.title, m.body, m.data.url]);

// ---------------------------------------------------------------------------------------------
// Models

const FAKE_CARD = JSON.stringify({ story: "A family dish, shared with the neighbors.", culture: "", quote: 0 });

export const fakeModels = {
  translate: (text: string, language: string): Promise<string> => Promise.resolve(`(${language}) ${text}`),
  yesNo: (_q: string, _a: string): Promise<"yes" | "no" | "unclear"> => Promise.resolve("unclear"),
  transcript: (): Promise<string> => Promise.resolve("Yes, rinse them first."),
  english: (w: string): Promise<string | null> => Promise.resolve(`(English) ${w}`),
  note: (_fact: string, _url: string): Promise<string> => Promise.resolve('"Made your chili, Dad. Not as good as yours yet!"'),
  card: (_facts: string): Promise<string> => Promise.resolve(FAKE_CARD),
  calls: { translate: [] as [string, string][], yesNo: [] as [string, string][], transcribe: [] as string[], english: [] as string[], note: [] as [string, string][], card: [] as string[] },
};

const realModels = { ...models };
export const useRealModels = () => Object.assign(models, realModels);

function standInModels(): void {
  fakeModels.calls = { translate: [], yesNo: [], transcribe: [], english: [], note: [], card: [] };
  fakeModels.translate = (text, language) => Promise.resolve(`(${language}) ${text}`);
  fakeModels.yesNo = () => Promise.resolve("unclear");
  fakeModels.transcript = () => Promise.resolve("Yes, rinse them first.");
  fakeModels.english = (w) => Promise.resolve(`(English) ${w}`);
  fakeModels.note = () => Promise.resolve('"Made your chili, Dad. Not as good as yours yet!"');
  models.translateForCook = (text, language) => {
    fakeModels.calls.translate.push([text, language]);
    return fakeModels.translate(text, language);
  };
  models.yesNo = (q, a) => {
    fakeModels.calls.yesNo.push([q, a]);
    return fakeModels.yesNo(q, a);
  };
  models.transcribe = (_bytes, _type, language) => {
    fakeModels.calls.transcribe.push(language);
    return fakeModels.transcript();
  };
  models.toEnglish = (w) => {
    fakeModels.calls.english.push(w);
    return fakeModels.english(w);
  };
  models.photoNote = (fact, url) => {
    fakeModels.calls.note.push([fact, url]);
    return fakeModels.note(fact, url);
  };
  fakeModels.card = () => Promise.resolve(FAKE_CARD);
  models.storyCard = (facts) => {
    fakeModels.calls.card.push(facts);
    return fakeModels.card(facts);
  };
}

/** What a clear yes would have written to `recipes` (the blocker in MESSAGES-MIGRATION.md). */
export const effects = { ingredients: [] as unknown[], shares: [] as unknown[] };

// ---------------------------------------------------------------------------------------------
// Setting up

export type Who = { id: string; token: string; name: string; familyId: string };

export type World = {
  app: FastifyInstance;
  store: FakeStore;
  lib: FakeLibrary;
  expo: FakeExpo;
  family: string;
  mom: Who;
  dad: Who;
  leo: Who;
  nia: Who;
  /** Another family, and a parent and a kid in it. */
  otherFamily: string;
  stranger: Who;
  strangerKid: Who;
};

let migrated = false;

export async function person(familyId: string, name: string, role: "cook" | "kid", o: { tz?: string; language?: string; memorial?: boolean; supabaseId?: string } = {}): Promise<Who> {
  const { rows } = await db().query(
    `insert into people (family_id, name, role, tz, language, memorial, supabase_id) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [familyId, name, role, o.tz ?? null, o.language ?? null, o.memorial ?? false, o.supabaseId ?? null],
  );
  return { id: rows[0].id, token: await session(familyId, rows[0].id), name, familyId };
}

export async function familyRow(name: string): Promise<string> {
  const { rows } = await db().query(`insert into families (name) values ($1) returning id`, [`${name} ${randomUUID().slice(0, 8)}`]);
  return rows[0].id;
}

export async function world(): Promise<World> {
  process.env.RATE_LIMIT_SALT = "test-salt-for-the-messages-limits";
  process.env.EDIBLE_CODE_KEY = "test-code-key";
  delete process.env.MEDIA_BASE_URL;
  if (!migrated) {
    await freshDatabase();
    migrated = true;
  }
  await db().query(`truncate messages, threads, thread_reads, recipe_notes, questions, shares, favorites, recipe_events, push_tokens, push_log, pending_sends, files, recipes,
    sessions, signups, devices, rate_hits, outbox, idempotency_keys, model_calls, dish_asks, people, families cascade`);
  const store = fakeStore();
  useObjectStore(store);
  const lib = fakeLibrary();
  useLibrary(lib);
  const expo = fakeExpo();
  standInModels();
  effects.ingredients = [];
  effects.shares = [];
  recipeEffects.ingredientYes = async (_c, yes) => void effects.ingredients.push(yes);
  recipeEffects.shareYes = async (_c, yes) => void effects.shares.push(yes);
  const family = await familyRow("The Wangs");
  const otherFamily = await familyRow("The Zhangs");
  const app = buildApp({ logger: false });
  return {
    app,
    store,
    lib,
    expo,
    family,
    mom: await person(family, "Mom", "cook"),
    dad: await person(family, "Dad", "cook"),
    leo: await person(family, "Leo", "kid"),
    nia: await person(family, "Nia", "kid"),
    otherFamily,
    stranger: await person(otherFamily, "Mei", "cook"),
    strangerKid: await person(otherFamily, "Serene", "kid"),
  };
}

// ---------------------------------------------------------------------------------------------
// Calling the routes

export type Reply = { status: number; data: any; body: string };
export type CallOpts = { key?: string | null; ip?: string; headers?: Record<string, string> };

const read = (res: { statusCode: number; body: string }): Reply => ({ status: res.statusCode, data: res.body ? JSON.parse(res.body) : null, body: res.body });

export const newKey = () => randomBytes(12).toString("hex");

export async function get(app: FastifyInstance, who: Who | null, url: string, o: CallOpts = {}): Promise<Reply> {
  return read(await app.inject({ method: "GET", url, headers: { ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...o.headers } }));
}

/** Sends a fresh Idempotency-Key unless told otherwise: `key: null` leaves it out. */
export async function post(app: FastifyInstance, who: Who | null, url: string, body?: unknown, o: CallOpts = {}): Promise<Reply> {
  const key = o.key === undefined ? newKey() : o.key;
  return read(
    await app.inject({
      method: "POST",
      url,
      remoteAddress: o.ip ?? "203.0.113.7",
      headers: {
        ...(who ? { authorization: `Bearer ${who.token}` } : {}),
        ...(key ? { "idempotency-key": key } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...o.headers,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    }),
  );
}

export const ok = (r: Reply, status = 200) => {
  assert.equal(r.status, status, r.body);
  return r.data;
};

/** `also`: the field an `invalid` names, or more of the body, such as `{ message }`, where the code alone doesn't say which case it was. */
export const refused = (r: Reply, status: number, code?: string, also?: string | Record<string, unknown>) => {
  assert.equal(r.status, status, r.body);
  if (code) assert.equal(r.data.error, code);
  for (const [name, value] of Object.entries(typeof also === "string" ? { field: also } : also ?? {})) assert.equal(r.data[name], value, `${name}: ${r.body}`);
};

export const circleOf = async (w: World, who: Who = w.mom): Promise<string> => ok(await get(w.app, who, "/v1/circle")).id;
export const pairOf = async (w: World, who: Who, other: Who): Promise<string> => ok(await post(w.app, who, "/v1/threads", { otherId: other.id }, { key: null })).id;
export const say = (w: World, who: Who, thread: string, body: Record<string, unknown>, o: CallOpts = {}) => post(w.app, who, `/v1/threads/${thread}/messages`, body, o);
export const text = (w: World, who: Who, thread: string, words: string) => say(w, who, thread, { kind: "text", body: words }).then((r) => ok(r));

/** An upload through the real routes: asks for the link, puts the bytes on the fake S3, confirms. */
export async function uploaded(w: World, who: Who, kind: "voice" | "photo" = "voice"): Promise<string> {
  const type = kind === "voice" ? "audio/m4a" : "image/jpeg";
  const link = ok(await post(w.app, who, "/v1/uploads", { kind, contentType: type, size: 2000 }, { key: null }), 201);
  w.store.put(link.uploadUrl, new Uint8Array(2000).fill(7), type);
  ok(await post(w.app, who, "/v1/uploads/confirm", { key: link.key }, { key: null }));
  return link.key;
}

export const fileRow = async (key: string) => (await db().query(`select * from files where key = $1`, [key])).rows[0];

export const MEDIA = "https://media.test";

/** Runs `call` with the media host set, as the api always has it: a link recipes build (recipes/media.ts) fails loudly without it. */
export async function withMedia<T>(call: () => Promise<T>): Promise<T> {
  process.env.MEDIA_BASE_URL = MEDIA;
  try {
    return await call();
  } finally {
    delete process.env.MEDIA_BASE_URL;
  }
}

/** POST /v1/shares/open, with no session. */
export const openShare = (app: FastifyInstance, token: unknown) => withMedia(() => post(app, null, "/v1/shares/open", { token }, { key: null }));

/**
 * A ready recipe as the AWS worker leaves it (pipeline/queue_db.py _save_recipe; POST /v1/test/recipe does the same): its files in the attempt's own folder,
 * recipe-<id>/<job>-a1/, so nothing is at recipe-<id>/recipe.json. Made-up data only.
 */
export async function awsRecipe(cook: Who, o: { title?: string; status?: string } = {}): Promise<{ id: string; libraryId: string; jsonKey: string; json: object }> {
  const libraryId = `recipe-${randomBytes(6).toString("hex")}`;
  const jsonKey = `${libraryId}/${randomBytes(6).toString("hex")}-a1/recipe.json`;
  const title = o.title ?? `${cook.name}'s Kanda Poha`;
  const { rows } = await db().query(
    `insert into recipes (family_id, cook_id, title, status, library_id, media_prefix, recipe_json_key, cover_key, cover_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'v1') returning id`,
    [cook.familyId, cook.id, title, o.status ?? "ready", libraryId, `${libraryId}/`, jsonKey, jsonKey.replace("recipe.json", "poster.jpg")],
  );
  return { id: rows[0].id, libraryId, jsonKey, json: { id: libraryId, title, cook: { name: cook.name }, family: true, steps: [] } };
}

/** The media CDN as storage.tf builds it, holding only these files: S3 answers 403 for any other key. */
export function cdnLibrary(files: Record<string, object>): Library {
  const cdn = (async (url: string) => {
    const key = url.startsWith(`${MEDIA}/`) ? decodeURIComponent(url.slice(MEDIA.length + 1)) : "";
    return key in files ? Response.json(files[key]) : new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
  }) as unknown as typeof fetch;
  return makeLibrary({ baseUrl: MEDIA, fetch: cdn });
}

export async function recipe(familyId: string, cookId: string, o: { title?: string; status?: string; libraryId?: string } = {}): Promise<string> {
  const { rows } = await db().query(`insert into recipes (family_id, cook_id, title, status, library_id) values ($1, $2, $3, $4, $5) returning id`, [
    familyId,
    cookId,
    o.title ?? "Sunday Chili",
    o.status ?? "ready",
    o.libraryId ?? null,
  ]);
  return rows[0].id;
}

// ---------------------------------------------------------------------------------------------
// The queue

/** Runs what's due through the real consumer, repeating until nothing is left: Convex's finishAllScheduledFunctions. */
export async function drain(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const bodies: string[] = [];
    const sent = await sendDue(db(), async (_queue, body) => void bodies.push(body), undefined, 200);
    for (const body of bodies) await handleMessage(body, silent);
    if (sent === 0) return;
  }
  throw new Error("The queue never emptied");
}

/** Runs each due message twice, as SQS may. */
export async function drainTwice(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const bodies: string[] = [];
    const sent = await sendDue(db(), async (_queue, body) => void bodies.push(body), undefined, 200);
    for (const body of bodies) {
      await handleMessage(body, silent);
      await handleMessage(body, silent);
    }
    if (sent === 0) return;
  }
  throw new Error("The queue never emptied");
}

/** Moves delayed work and the receipts check to now. */
export const dueNow = () => db().query(`update outbox set send_after = now() where sent_at is null`);

export const logOf = async (personId: string) => (await db().query(`select * from push_log where person_id = $1 order by created_at, id`, [personId])).rows;
export const tokensOf = async (personId: string) => (await db().query(`select * from push_tokens where person_id = $1 order by updated_at`, [personId])).rows;
export const phone = (w: World, who: Who, n: string, tz?: string) => post(w.app, who, "/v1/push-tokens", { token: `ExponentPushToken[${n}]`, platform: "ios", tz }, { key: null }).then((r) => ok(r));
export const tokenFor = (n: string) => `ExponentPushToken[${n}]`;

export const closeAll = async () => {
  usePushSender(undefined);
  useLibrary(undefined);
  useObjectStore(undefined);
  if (hasDatabase) await db().end();
};

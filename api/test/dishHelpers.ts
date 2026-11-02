// What the dish tests share: the routes through app.inject on real Postgres, a fake S3, fake models (DISH_FAKE_AI=1) that a test can make
// fail, and a way to move time on, since Postgres's clock can't be faked: `advance` moves every stored time back instead.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";
import * as data from "../src/modules/dish/data.js";
import { models } from "../src/modules/dish/model.js";
import { dayOf, MERGE_STALE_MS, sha256Hex } from "../src/modules/dish/values.js";
import { sendDue } from "../src/outbox.js";
import { handleMessage } from "../src/scheduled.js";
import { type ObjectStore, UPLOAD_LINK_S, useObjectStore } from "../src/storage.js";
import { freshDatabase, hasDatabase } from "./helpers.js";

export { hasDatabase };
export const IP = "203.0.113.7";
export const ORIGIN = "https://homecookd.app";
export const TOKEN22 = /^[0-9A-Za-z]{22}$/;
export const MOM_ASKED = [{ id: "q1", text: "How much ketchup do you squeeze in?" }];
export const silent = { info: () => {}, warn: () => {}, error: () => {} };
export const MIN = 60_000;

// ---------------------------------------------------------------------------------------------
// S3

export type FakeStore = ObjectStore & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
  put(url: string, bytes: Uint8Array, contentType: string): void;
  removed: string[];
  failRemoves: boolean;
  failHeads: boolean;
  failGets: boolean;
  partsStarted: string[];
  partsFinished: { key: string; multipartId: string; parts: { partNumber: number; etag: string }[] }[];
  failLists: boolean;
  /** A finish lands the object, at this size. */
  landWhenFinished?: number;
};

export function fakeStore(): FakeStore {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const store: FakeStore = {
    objects,
    removed: [],
    failRemoves: false,
    failHeads: false,
    failGets: false,
    failLists: false,
    partsStarted: [],
    partsFinished: [],
    put(url, bytes, contentType) {
      objects.set(new URL(url).pathname.slice(1), { bytes, contentType });
    },
    async presignPut(key, contentType) {
      return { url: `https://fake-s3.test/${key}`, headers: { "Content-Type": contentType }, expiresInS: UPLOAD_LINK_S };
    },
    async startParts(key) {
      store.partsStarted.push(key);
      return `multipart-${store.partsStarted.length}`;
    },
    async presignPart(key, multipartId, partNumber, size) {
      return { url: `https://fake-s3.test/part/${key}?id=${multipartId}&n=${partNumber}&size=${size}`, headers: {}, expiresInS: UPLOAD_LINK_S };
    },
    async finishParts(key, multipartId, parts) {
      store.partsFinished.push({ key, multipartId, parts });
      if (store.landWhenFinished !== undefined) objects.set(key, { bytes: new Uint8Array(0), contentType: "video/mp4", size: store.landWhenFinished } as never);
    },
    async presignGet(key) {
      if (store.failGets) throw new Error("no credentials");
      return `https://fake-s3.test/get/${key}`;
    },
    async head(key) {
      if (store.failHeads) throw new Error("S3 is down");
      const o = objects.get(key);
      return o ? { size: (o as { size?: number }).size ?? o.bytes.length, contentType: o.contentType } : null;
    },
    async read(key) {
      const o = objects.get(key);
      return o ? { bytes: o.bytes, contentType: o.contentType } : null;
    },
    async remove(key) {
      if (store.failRemoves) throw new Error("S3 is down");
      objects.delete(key);
      store.removed.push(key);
    },
    async list(prefix, max) {
      if (store.failLists) throw new Error("S3 is down");
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, max);
    },
    async removeMany(keys) {
      for (const key of keys) await store.remove(key);
    },
  };
  return store;
}

export let store = fakeStore();

// ---------------------------------------------------------------------------------------------
// Models

const real = { ...models };
type Real = (r: () => Promise<unknown>) => Promise<unknown>;
export const model = {
  calls: { guess: 0, version: 0, transcribe: 0, toEnglish: 0, forMom: 0 },
  /** Replaces writeGuess / writeVersion / translateForMom for a test: gets the real one, returns what the service sees. */
  guess: null as null | Real,
  version: null as null | Real,
  forMom: null as null | Real,
  /** Runs in place of Ink for a test: to hold a clip open, or to hear other words. */
  transcribe: null as null | ((real: () => Promise<string>) => Promise<string>),
  /** The same for the English. */
  english: null as null | ((real: () => Promise<string | null>) => Promise<string | null>),
};

models.writeGuess = (async (...a: Parameters<typeof real.writeGuess>) => {
  model.calls.guess += 1;
  return model.guess ? model.guess(() => real.writeGuess(...a)) : real.writeGuess(...a);
}) as typeof real.writeGuess;
models.writeVersion = (async (...a: Parameters<typeof real.writeVersion>) => {
  model.calls.version += 1;
  return model.version ? model.version(() => real.writeVersion(...a)) : real.writeVersion(...a);
}) as typeof real.writeVersion;
models.transcribe = async (...a: Parameters<typeof real.transcribe>) => {
  model.calls.transcribe += 1;
  return model.transcribe ? model.transcribe(() => real.transcribe(...a)) : real.transcribe(...a);
};
models.toEnglish = async (...a: Parameters<typeof real.toEnglish>) => {
  model.calls.toEnglish += 1;
  return model.english ? model.english(() => real.toEnglish(...a)) : real.toEnglish(...a);
};
models.translateForMom = (async (...a: Parameters<typeof real.translateForMom>) => {
  model.calls.forMom += 1;
  return model.forMom ? model.forMom(() => real.translateForMom(...a)) : real.translateForMom(...a);
}) as typeof real.translateForMom;

// ---------------------------------------------------------------------------------------------
// Setting up

let migrated = false;

/** One test's clean slate: Convex's newBackend(). */
export async function newBackend(): Promise<FastifyInstance> {
  process.env.DISH_FAKE_AI = "1";
  process.env.RATE_LIMIT_SALT = "test-salt-for-the-dish-limits";
  delete process.env.REPORT_ALERT_URL;
  if (!migrated) {
    await freshDatabase();
    migrated = true;
  }
  await db().query(
    `truncate dish_answers, dish_ask_translations, dish_asks, files, model_calls, daily_spend, rate_hits, outbox, idempotency_keys, craving_links, people, families cascade`,
  );
  store = fakeStore();
  useObjectStore(store);
  model.calls = { guess: 0, version: 0, transcribe: 0, toEnglish: 0, forMom: 0 };
  model.guess = null;
  model.version = null;
  model.forMom = null;
  model.transcribe = null;
  model.english = null;
  return buildApp({ logger: false });
}

// ---------------------------------------------------------------------------------------------
// Calling the routes

export type Reply = { status: number; data: any; headers: Record<string, unknown>; body: string };
export type Opts = { ip?: string; origin?: string | null; headers?: Record<string, string> };

export async function call(app: FastifyInstance, method: "POST" | "OPTIONS", url: string, payload: string | Buffer | undefined, o: Opts = {}): Promise<Reply> {
  const res = await app.inject({
    method,
    url,
    remoteAddress: o.ip ?? IP,
    headers: { ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }), ...o.headers },
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null, headers: res.headers, body: res.body };
}

export const post = (app: FastifyInstance, path: string, body: unknown = {}, o: Opts = {}) =>
  call(app, "POST", path, typeof body === "string" ? body : JSON.stringify(body), { ...o, headers: { "content-type": "application/json", ...o.headers } });

/** Asks for the link, puts the bytes on S3, confirms: what a page does. Refused at any step, returns that reply. */
export async function upload(app: FastifyInstance, kind: string, type: string, bytes: number, o: Opts = {}): Promise<Reply> {
  const link = await post(app, `/dish/files?kind=${kind}`, { contentType: type, size: bytes }, o);
  if (link.status !== 201) return link;
  store.put(link.data.uploadUrl, new Uint8Array(bytes).fill(7), link.data.contentType);
  return await post(app, "/dish/files/confirm", { fileId: link.data.fileId }, o);
}

export async function fileId(app: FastifyInstance, kind: "photo" | "voice", o: Opts = {}): Promise<string> {
  const r = await upload(app, kind, kind === "photo" ? "image/jpeg" : "audio/webm;codecs=opus", 2000, o);
  assert.equal(r.status, 201, r.body);
  return r.data.fileId;
}

export type AnswerOpts = { bytes?: number; type?: string; lang?: string; durationS?: number | string; token?: string | null; ip?: string };

const answerQuery = (q: string, o: AnswerOpts) => new URLSearchParams({ q, durationS: String(o.durationS ?? 4.2), ...(o.lang ? { lang: o.lang } : {}) });

/** The first half of an answer: the link, and the bytes on S3. Returns the fileId, or the refusal. */
export async function answerClip(app: FastifyInstance, askToken: string, q: string, o: AnswerOpts = {}): Promise<Reply> {
  const headers = o.token === null ? undefined : { "x-dish-token": o.token ?? askToken };
  // 400 bytes: the fake Ink hears FAKE_WORDS; under 100 it hears nothing.
  const size = o.bytes ?? 400;
  const link = await post(app, `/dish/ask/answer/upload?${answerQuery(q, o)}`, { contentType: o.type ?? "audio/mp4", size }, { ip: o.ip, headers });
  if (link.status === 201) store.put(link.data.uploadUrl, new Uint8Array(size).fill(1), link.data.contentType);
  return link;
}

export const attachAnswer = (app: FastifyInstance, askToken: string, q: string, id: string, o: AnswerOpts = {}) =>
  post(app, `/dish/ask/answer?${answerQuery(q, o)}`, { fileId: id }, { ip: o.ip, headers: { "x-dish-token": askToken } });

/** One answer, as her page sends it: the link, the bytes, the answer. */
export async function answer(app: FastifyInstance, askToken: string, q: string, o: AnswerOpts = {}): Promise<Reply> {
  const link = await answerClip(app, askToken, q, o);
  if (link.status !== 201) return link;
  return await attachAnswer(app, o.token ?? askToken, q, link.data.fileId, o);
}

export async function makeCard(app: FastifyInstance, body: Record<string, unknown> = { dish: "tomato egg", kidName: "Caleb" }, ip = IP) {
  const r = await post(app, "/dish/cards", body, { ip });
  assert.equal(r.status, 201, r.body);
  const { kidToken, card } = r.data;
  const askToken = new URL(card.askUrl).searchParams.get("t")!;
  return { kidToken: kidToken as string, askToken, card };
}

export const getCard = async (app: FastifyInstance, kidToken: string) => (await post(app, "/dish/cards/get", { kidToken })).data.card;
export const peek = async (app: FastifyInstance, askToken: string, lang?: unknown) => (await post(app, "/dish/ask/peek", { askToken, lang })).data.ask;
export const askMom = (app: FastifyInstance, kidToken: string, questions: unknown, o: Opts = {}) => post(app, "/dish/cards/ask", { kidToken, questions }, o);
export const finish = (app: FastifyInstance, askToken: string) => post(app, "/dish/ask/finish", { askToken });

/** A card with q1 asked of Mom (and sent). */
export async function askedCard(app: FastifyInstance, ip = IP) {
  const c = await makeCard(app, { dish: "tomato egg", kidName: "Caleb" }, ip);
  assert.equal((await askMom(app, c.kidToken, MOM_ASKED, { ip })).status, 200);
  assert.equal((await post(app, "/dish/cards/sent", { kidToken: c.kidToken, via: "sms" }, { ip })).status, 200);
  return c;
}

// ---------------------------------------------------------------------------------------------
// The clock and the queue

const CARD_TIMES = ["created_at", "merge_started_at", "merge_queued_at", "merged_at", "asked_at", "opened_at", "finished_at", "questions_at"];
const FILE_TIMES = ["created_at", "uploaded_at", "attached_at", "delete_requested_at", "deleted_at"];

/** Time passes: everything stored happened `ms` earlier. Rate windows don't move: clear them with `clearWindow`. */
export async function advance(ms: number): Promise<void> {
  const shift = (cols: string[]) => cols.map((c) => `${c} = ${c} - make_interval(secs => $1)`).join(", ");
  await db().query(`update dish_asks set ${shift(CARD_TIMES)}`, [ms / 1000]);
  await db().query(`update dish_answers set ${shift(["created_at", "hearing_at"])}`, [ms / 1000]);
  await db().query(`update files set ${shift(FILE_TIMES)}`, [ms / 1000]);
  await db().query(`update outbox set ${shift(["send_after"])} where sent_at is null`, [ms / 1000]);
}

/** A new window for one bucket. */
export const clearWindow = (bucket: string) => db().query(`delete from rate_hits where key like $1`, [`${bucket}:%`]);

/** A new UTC day. */
export const nextDay = () => db().query(`update daily_spend set day = day - 1`);

/** Runs what's due now on the queue, to the end: not the retries 3 minutes on. */
export async function runNow(): Promise<void> {
  while ((await sendDue(db(), async (_queue, body) => handleMessage(body, silent))) > 0);
}

/** Runs everything on the queue, moving time on for each retry: Convex's finishAllScheduledFunctions. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await runNow();
    const { rows } = await db().query("select count(*)::int as n from outbox where sent_at is null");
    if (rows[0].n === 0) return;
    await advance(MERGE_STALE_MS + 1000);
  }
  assert.fail("the queue never emptied");
}

// ---------------------------------------------------------------------------------------------
// Reading what's stored

export const rowOf = async (kidToken: string) => (await data.cardByKidHash(db(), sha256Hex(kidToken)))!;
export const answersOf = (askId: string) => data.answersOf(db(), askId);
export const spent = () => data.spentOn(db(), dayOf(Date.now()));

/** Sets today's total. */
export async function seedSpend(usd: number): Promise<void> {
  await db().query(
    `insert into daily_spend (scope, day, usd) values ('dish_ask', $1, $2) on conflict (scope, day) do update set usd = excluded.usd`,
    [dayOf(Date.now()), usd],
  );
}

export const randomIp = () => `198.51.100.${randomBytes(1)[0]}`;

// ---------------------------------------------------------------------------------------------
// Checking

type Matcher = (v: unknown) => boolean;
export const anyString: Matcher = (v) => typeof v === "string" && v.length > 0;
export const anyNumber: Matcher = (v) => typeof v === "number";
/** A time within a few seconds of `ms`. */
export const near = (ms: number): Matcher => (v) => typeof v === "number" && Math.abs(v - ms) < 10_000;

/** expect().toMatchObject(): each named field matches; a list must match in full. */
export function like(actual: unknown, expected: unknown, path = "reply"): void {
  if (typeof expected === "function") {
    assert.ok((expected as Matcher)(actual), `${path}: ${JSON.stringify(actual)}`);
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} isn't a list: ${JSON.stringify(actual)}`);
    assert.equal(actual.length, expected.length, `${path}: ${JSON.stringify(actual)}`);
    expected.forEach((e, i) => like((actual as unknown[])[i], e, `${path}[${i}]`));
  } else if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `${path} isn't an object: ${JSON.stringify(actual)}`);
    for (const [k, e] of Object.entries(expected)) like((actual as Record<string, unknown>)[k], e, `${path}.${k}`);
  } else {
    assert.strictEqual(actual, expected, path);
  }
}

export const close = (a: number, b: number, digits = 5) => assert.ok(Math.abs(a - b) < 10 ** -digits, `${a} is not about ${b}`);

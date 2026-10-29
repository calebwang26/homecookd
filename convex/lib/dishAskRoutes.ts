// The dish ask's public routes (docs/build/DISH-ASK-SPEC.md §4): POST /dish/*, with no account. The kid's page and
// Mom's page call them from homecookd.app (CORS as POST /invite/open). Tokens travel in JSON bodies (kidToken,
// askToken) or, on the raw-audio route, in the X-Dish-Token header; never in a query string. Only their sha256 is
// stored, and no route takes or returns a Convex id. Errors are `{error, code}` (lib/dishAskValues.ts).
//
//   POST /dish/files?kind=photo|voice   raw file              -> 201 {fileId, kind, contentType, size}
//   POST /dish/cards                    {dish, relation?, kidName?, photos?, voiceNote?} -> 201 {kidToken, card}
//   POST /dish/cards/get                {kidToken}            -> {card}
//   POST /dish/cards/update             {kidToken, relation?, kidName?, message?, voiceNote?} -> {card}
//   POST /dish/cards/ask                {kidToken, questions} -> {card}
//   POST /dish/cards/sent               {kidToken, via}       -> {card}
//   POST /dish/ask/peek                 {askToken, lang?}     -> {ask}  (lang: her page, translated and cached)
//   POST /dish/ask/answer?q=&lang=&durationS=   X-Dish-Token, raw audio -> {ask}
//   POST /dish/ask/finish               {askToken, lang?}     -> {ask}
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { type ActionCtx, httpAction } from "../_generated/server";
import { DishModelError, type GuessResult, type Photo, type Spend, transcribe, translateForMom, writeGuess } from "../dishAskModel";
import { recordSpend } from "../dishAsks";
import type { QuestionId, Relation } from "./dishAsk/types";
import { baseType, isQuestionId, isRelation, LIMITS } from "./dishAsk/validate";
import {
  badRequest,
  CLIP_BYTES,
  CLIP_SLACK_S,
  DAILY_BUDGET_USD,
  fail,
  type FailData,
  failOf,
  JSON_BYTES,
  LANGS,
  MAX_CLIP_S,
  MAX_PHOTOS,
  MESSAGE_CHARS,
  missRecipe,
  MOM_OVERAGE_USD,
  notFound,
  PHOTO_BYTES,
  PHOTO_TYPES,
  recipeTexts,
  storedRecipe,
  VIAS,
  VOICE_BYTES,
  VOICE_TYPES,
  WORDS,
} from "./dishAskValues";
import { flagged } from "./moderation";
import { allowed, clientIp, ipKeyOf, type Limit, LIMITS as RATE } from "./rateLimit";

// ---------------------------------------------------------------------------------------------
// Tokens

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN = /^[0-9A-Za-z]{22}$/;

/** 22 random base62 characters (rejection sampling, so no modulo bias): a kid token or a file id. */
export function randomBase62(length = 22): string {
  const limit = 256 - (256 % BASE62.length);
  let out = "";
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += BASE62[b % BASE62.length];
    }
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The ask token: the first 22 base62 digits of sha256("ask:" + kidToken), so the kid's link can always rebuild it. */
export async function askTokenFor(kidToken: string): Promise<string> {
  let n = BigInt(`0x${await sha256Hex(`ask:${kidToken}`)}`);
  let digits = "";
  while (n > 0n) {
    digits = BASE62[Number(n % 62n)] + digits;
    n /= 62n;
  }
  return digits.padStart(43, "0").slice(0, 22);
}

// ---------------------------------------------------------------------------------------------
// Requests and replies

const ORIGINS = [/^https:\/\/(www\.)?homecookd\.app$/, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/];
const SORRY = "Something went wrong on our side. Please try again.";
const TOO_MANY = "Too many tries. Please wait a few minutes and try again.";
const BUDGET = "homecookd has made all the recipes it can today. Try again tomorrow.";

/** The CORS headers for an allowed origin (none needed without one); false for another site. */
function corsFor(origin: string | null): Record<string, string> | false {
  if (!origin) return { Vary: "Origin" };
  if (!ORIGINS.some((o) => o.test(origin))) return false;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dish-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const reply = (headers: Record<string, string>, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

/** The body's bytes, refused past `max` (by Content-Length, then as read) without buffering the rest. */
async function readCapped(req: Request, max: number, tooBig: string): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("Content-Length") ?? 0);
  if (declared > max) throw fail(413, "too_large", tooBig);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw fail(413, "too_large", tooBig);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

type Body = Record<string, unknown>;

/** A JSON object whatever the Content-Type: the web may send text/plain with keepalive (no preflight). */
async function readJson(req: Request): Promise<Body> {
  const text = new TextDecoder().decode(await readCapped(req, JSON_BYTES, "That's too much to send at once."));
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("The body must be JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw badRequest("The body must be a JSON object.");
  return parsed as Body;
}

/** A trimmed string of at most `max` characters, or null when missing or blank. */
function str(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return null;
  if (typeof v !== "string") throw badRequest(`${field} must be a string`);
  const s = v.trim();
  if (s.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return s;
}

function relationOf(v: unknown): Relation {
  if (!isRelation(v)) throw badRequest("relation must be one of mom, dad, grandma, grandpa, auntie, uncle");
  return v;
}

/** A file id's hash; a malformed id is a 400, an unknown one a 404 later. */
async function fileHash(v: unknown, field: string): Promise<string> {
  if (typeof v !== "string" || !TOKEN.test(v)) throw badRequest(`${field} must be a file id from /dish/files`);
  return await sha256Hex(v);
}

type Kid = { kidTokenHash: string; askToken: string };

async function kidOf(b: Body): Promise<Kid> {
  if (typeof b.kidToken !== "string" || !b.kidToken) throw badRequest("kidToken is required");
  if (!TOKEN.test(b.kidToken)) throw notFound();
  return { kidTokenHash: await sha256Hex(b.kidToken), askToken: await askTokenFor(b.kidToken) };
}

async function askOf(token: unknown, field = "askToken"): Promise<string> {
  if (typeof token !== "string" || !token) throw badRequest(`${field} is required`);
  if (!TOKEN.test(token)) throw notFound();
  return await sha256Hex(token);
}

async function limit(ctx: ActionCtx, ipKey: string, ...limits: Limit[]) {
  if (!(await allowed(ctx, ipKey, limits))) throw fail(429, "rate", TOO_MANY);
}

async function spentToday(ctx: ActionCtx): Promise<number> {
  return await ctx.runQuery(internal.dishAsks.spentToday, { now: Date.now() });
}

function modelFail(e: unknown): FailData | null {
  if (!(e instanceof DishModelError)) return null;
  console.error(`dish model: ${e.message}`);
  return e.kind === "not_set_up"
    ? { status: 503, code: "not_set_up", error: "Not set up yet." }
    : { status: 502, code: "model", error: "That didn't work. Try again." };
}

type Call = { ctx: ActionCtx; req: Request; url: URL; ipKey: string };
type Out = { status?: number; body: unknown };
type Route = (c: Call) => Promise<Out>;

/** CORS, the IP's key, and errors as `{error, code}`. An unknown token or file counts against the IP (20 in 10 min). */
function dishRoute(route: Route) {
  return httpAction(async (ctx, req) => {
    const cors = corsFor(req.headers.get("Origin"));
    if (!cors) return reply({ Vary: "Origin" }, 403, { error: "This site can't use these routes.", code: "origin" });
    const ipKey = await ipKeyOf(clientIp(req));
    try {
      const out = await route({ ctx, req, url: new URL(req.url), ipKey });
      return reply(cors, out.status ?? 200, out.body);
    } catch (e) {
      const f = failOf(e) ?? modelFail(e);
      if (!f) {
        console.error(`dish ${new URL(req.url).pathname}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        return reply(cors, 500, { error: SORRY, code: "server" });
      }
      if (f.code === "not_found" && !(await allowed(ctx, ipKey, [RATE.badTokens]))) {
        return reply(cors, 429, { error: TOO_MANY, code: "rate" });
      }
      return reply(cors, f.status, { error: f.error, code: f.code });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Files

const upload: Route = async ({ ctx, req, url, ipKey }) => {
  const kind = url.searchParams.get("kind");
  if (kind !== "photo" && kind !== "voice") throw badRequest("kind must be photo or voice");
  await limit(ctx, ipKey, RATE.files);
  const type = baseType(req.headers.get("Content-Type") ?? "");
  if (!(kind === "photo" ? PHOTO_TYPES : VOICE_TYPES).includes(type)) {
    throw fail(415, "bad_type", kind === "photo" ? "That picture type isn't supported." : "That recording type isn't supported.");
  }
  const bytes = await readCapped(
    req,
    kind === "photo" ? PHOTO_BYTES : VOICE_BYTES,
    kind === "photo" ? "That picture is too big." : "That voice note is too long.",
  );
  if (!bytes.length) throw badRequest("The file is empty.");
  const storageId = await ctx.storage.store(new Blob([bytes], { type }));
  const fileId = randomBase62();
  await ctx.runMutation(internal.dishAsks.addFile, {
    fileIdHash: await sha256Hex(fileId),
    storageId,
    kind,
    contentType: type,
    size: bytes.length,
    ipKey,
  });
  return { status: 201, body: { fileId, kind, contentType: type, size: bytes.length } };
};

// ---------------------------------------------------------------------------------------------
// The kid

/** Makes a card: the word filter, Ink on the voice note, Claude's guess, the filter on the guess. */
const createCard: Route = async ({ ctx, req, ipKey }) => {
  await limit(ctx, ipKey, RATE.cards, RATE.cardsDay);
  const b = await readJson(req);
  const dish = str(b.dish, "dish", LIMITS.dish) ?? "";
  const relation = b.relation === undefined || b.relation === null ? "mom" : relationOf(b.relation);
  const kidName = str(b.kidName, "kidName", LIMITS.kidName);
  if (b.photos !== undefined && b.photos !== null && !Array.isArray(b.photos)) throw badRequest("photos must be a list of file ids");
  const photoIds = (b.photos as unknown[] | null | undefined) ?? [];
  if (photoIds.length > MAX_PHOTOS) throw badRequest(`At most ${MAX_PHOTOS} photos`);
  if (new Set(photoIds).size !== photoIds.length) throw badRequest("The same photo is in the list twice");
  const photos = await Promise.all(photoIds.map((id, i) => fileHash(id, `photos[${i}]`)));
  const voiceNote = b.voiceNote === undefined || b.voiceNote === null ? null : await fileHash(b.voiceNote, "voiceNote");
  if (dish.length < 2 && !photos.length && !voiceNote) throw badRequest("dish must be 2 to 200 characters");
  if (flagged(dish, kidName)) throw fail(422, "words", WORDS);
  if ((await spentToday(ctx)) >= DAILY_BUDGET_USD) throw fail(429, "rate", BUDGET);

  const files = await ctx.runQuery(internal.dishAsks.filesToUse, { photos, voiceNote });
  const started = Date.now();
  const spend: Spend = { usd: 0 };
  let made: GuessResult;
  try {
    let voiceWords: string | null = null;
    if (files.voiceNote) {
      const blob = await ctx.storage.get(files.voiceNote.storageId);
      if (!blob) throw notFound("That file doesn't work anymore. Add it again.");
      voiceWords = (await transcribe(blob, "en", undefined, spend)).trim();
      if ((await spentToday(ctx)) >= DAILY_BUDGET_USD) throw fail(429, "rate", BUDGET);
    }
    const images: Photo[] = [];
    for (const p of files.photos) {
      const blob = await ctx.storage.get(p.storageId);
      if (!blob) throw notFound("That file doesn't work anymore. Add it again.");
      images.push({ mime: p.contentType, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    made = await writeGuess({ dish, relation, kidName, photos: images, voiceWords }, spend);
  } finally {
    await recordSpend(ctx, spend);
  }
  if (made.notADish) throw fail(422, "not_a_dish", "Tell us a dish.");
  const guess = storedRecipe(made.recipe);
  if (flagged(...recipeTexts(guess))) throw fail(422, "words", WORDS);

  const kidToken = randomBase62();
  const askToken = await askTokenFor(kidToken);
  const card = await ctx.runMutation(internal.dishAsks.create, {
    kidTokenHash: await sha256Hex(kidToken),
    askTokenHash: await sha256Hex(askToken),
    askToken,
    dish,
    relation,
    kidName,
    photos,
    voiceNote,
    guess,
    genMs: Date.now() - started,
    ipKey,
  });
  return { status: 201, body: { kidToken, card } };
};

const getCard: Route = async ({ ctx, req }) => ({
  body: { card: await ctx.runMutation(internal.dishAsks.kidGet, await kidOf(await readJson(req))) },
});

const updateCard: Route = async ({ ctx, req }) => {
  const b = await readJson(req);
  const kid = await kidOf(b);
  const relation = b.relation === undefined ? undefined : relationOf(b.relation);
  const kidName = b.kidName === undefined ? undefined : str(b.kidName, "kidName", LIMITS.kidName);
  let message: string | undefined;
  if (b.message !== undefined) {
    if (typeof b.message !== "string") throw badRequest("message must be a string");
    message = b.message.trim();
    if (!message || message.length > MESSAGE_CHARS) throw badRequest(`message must be 1 to ${MESSAGE_CHARS} characters`);
  }
  const voiceNote = b.voiceNote === undefined ? undefined : b.voiceNote === null ? null : await fileHash(b.voiceNote, "voiceNote");
  if (flagged(kidName, message)) throw fail(422, "words", WORDS);
  const card = await ctx.runMutation(internal.dishAsks.kidUpdate, { ...kid, relation, kidName, message, voiceNote });
  return { body: { card } };
};

const askMom: Route = async ({ ctx, req, ipKey }) => {
  await limit(ctx, ipKey, RATE.ask);
  const b = await readJson(req);
  const kid = await kidOf(b);
  if (!Array.isArray(b.questions)) throw badRequest("questions must be a list of 1 to 3 questions");
  const questions = b.questions.map((x: unknown, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Body;
    if (typeof o.text !== "string") throw badRequest(`questions[${i}].text must be a string`);
    if (o.id !== undefined && o.id !== null && typeof o.id !== "string") {
      throw badRequest(`questions[${i}].id must be q1, q2 or q3, or left out for the kid's own question`);
    }
    return { id: (o.id ?? null) as string | null, text: o.text };
  });
  return { body: { card: await ctx.runMutation(internal.dishAsks.kidAsk, { ...kid, questions }) } };
};

const sent: Route = async ({ ctx, req }) => {
  const b = await readJson(req);
  const kid = await kidOf(b);
  const via = b.via;
  if (typeof via !== "string" || !(VIAS as readonly string[]).includes(via)) throw badRequest(`via must be one of ${VIAS.join(", ")}`);
  return { body: { card: await ctx.runMutation(internal.dishAsks.kidSent, { ...kid, via: via as (typeof VIAS)[number] }) } };
};

// ---------------------------------------------------------------------------------------------
// Mom

/** Mom's page language: a known code other than English, else undefined (the page stays in English). */
function pageLang(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw badRequest("lang must be a language code");
  return v !== "en" && LANGS.includes(v) ? v : undefined;
}

/**
 * The card in Mom's page language, translated once (Claude) and cached until the asked questions or the message
 * change. Mom-side, so it runs to the budget's overage. Never fails the peek: without it, the page shows English.
 */
async function translateForPage(ctx: ActionCtx, askTokenHash: string, lang: string): Promise<void> {
  const src = await ctx.runQuery(internal.dishAsks.momLangSource, { askTokenHash, lang });
  if (!src || (await spentToday(ctx)) >= DAILY_BUDGET_USD + MOM_OVERAGE_USD) return;
  if (!(await allowed(ctx, `${src.askId}:${lang}`, [RATE.momLang]))) return;
  const spend: Spend = { usd: 0 };
  try {
    const out = await translateForMom({ ...src.english, guess: missRecipe(src.english.guess) }, lang, spend);
    if (!out) return;
    const translated = {
      guess: storedRecipe(out.guess),
      questions: out.questions.map((q) => ({ id: q.id, text: q.text })),
      message: out.message,
    };
    if (flagged(...recipeTexts(translated.guess), ...translated.questions.map((q) => q.text), translated.message)) {
      console.warn(`dish ask: the ${lang} translation has a filtered word; her page stays in English`);
      return;
    }
    await ctx.runMutation(internal.dishAsks.saveMomLang, { askId: src.askId, lang, key: src.key, translated });
  } catch (e) {
    console.error(`dish ask: translating Mom's page into ${lang} failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await recordSpend(ctx, spend);
  }
}

const peek: Route = async ({ ctx, req }) => {
  const b = await readJson(req);
  const askTokenHash = await askOf(b.askToken);
  const lang = pageLang(b.lang);
  if (lang) await translateForPage(ctx, askTokenHash, lang);
  return { body: { ask: await ctx.runMutation(internal.dishAsks.momPeek, { askTokenHash, lang }) } };
};

/** One answer: the raw audio, checked before it's stored; Ink and the translation run after the reply. */
const answer: Route = async ({ ctx, req, url, ipKey }) => {
  await limit(ctx, ipKey, RATE.answer);
  const askTokenHash = await askOf(req.headers.get("X-Dish-Token"), "The X-Dish-Token header");
  const q = url.searchParams.get("q");
  if (!isQuestionId(q)) throw badRequest("q must be one of q1 to q6");
  const lang = url.searchParams.get("lang") || "en";
  if (!LANGS.includes(lang)) throw badRequest(`lang must be one of ${LANGS.join(" ")}`);
  const d = Number(url.searchParams.get("durationS"));
  if (!Number.isFinite(d) || d <= 0 || d > MAX_CLIP_S + CLIP_SLACK_S) {
    throw badRequest(`durationS must be more than 0 and at most ${MAX_CLIP_S}`);
  }
  const type = baseType(req.headers.get("Content-Type") ?? "");
  if (!VOICE_TYPES.includes(type)) throw fail(415, "bad_type", "That recording type isn't supported.");
  if (Number(req.headers.get("Content-Length") ?? 0) > CLIP_BYTES) throw fail(413, "too_large", "That answer is too long.");
  const questionId: QuestionId = q;
  await ctx.runQuery(internal.dishAsks.answerable, { askTokenHash, questionId });
  const bytes = await readCapped(req, CLIP_BYTES, "That answer is too long.");
  if (!bytes.length) throw badRequest("The recording is empty.");
  const audio = await ctx.storage.store(new Blob([bytes], { type }));
  try {
    const ask = await ctx.runMutation(internal.dishAsks.momAnswer, {
      askTokenHash,
      questionId,
      audio,
      durationS: Math.min(MAX_CLIP_S, Math.round(d * 100) / 100),
      language: lang,
    });
    return { body: { ask } };
  } catch (e) {
    await ctx.storage.delete(audio);
    throw e;
  }
};

/** Send. An optional `lang` returns the cached translation of her page (finish never translates). */
const finish: Route = async ({ ctx, req }) => {
  const b = await readJson(req);
  const askTokenHash = await askOf(b.askToken);
  return { body: { ask: await ctx.runMutation(internal.dishAsks.momFinish, { askTokenHash, lang: pageLang(b.lang) }) } };
};

const ROUTES: Record<string, Route> = {
  "/dish/files": upload,
  "/dish/cards": createCard,
  "/dish/cards/get": getCard,
  "/dish/cards/update": updateCard,
  "/dish/cards/ask": askMom,
  "/dish/cards/sent": sent,
  "/dish/ask/peek": peek,
  "/dish/ask/answer": answer,
  "/dish/ask/finish": finish,
};

export function registerDishAskRoutes(http: HttpRouter): void {
  for (const [path, route] of Object.entries(ROUTES)) http.route({ path, method: "POST", handler: dishRoute(route) });
  // Anything else under /dish/: a JSON 404 with CORS (not counted as a bad token).
  http.route({
    pathPrefix: "/dish/",
    method: "POST",
    handler: dishRoute(async () => ({ status: 404, body: { error: "No such route.", code: "not_found" } })),
  });
  http.route({
    pathPrefix: "/dish/",
    method: "OPTIONS",
    handler: httpAction(async (_ctx, req) => {
      const cors = corsFor(req.headers.get("Origin"));
      return new Response(null, { status: cors ? 204 : 403, headers: cors || { Vary: "Origin" } });
    }),
  });
}

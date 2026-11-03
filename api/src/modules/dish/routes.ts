// The dish ask's public routes (docs/build/DISH-ASK-SPEC.md §4): POST /dish/*, with no account. The kid's page and Mom's page call them from
// homecookd.app. Tokens travel in JSON bodies (kidToken, askToken) or the X-Dish-Token header, never in a query string, and only their sha256 is
// stored. No route takes or returns a row's id. Errors are app.ts's one shape: the site reads the code in `error` and shows `message`.
//
//   POST /dish/files?kind=photo|voice   {contentType, size}   -> 201 {fileId, kind, contentType, size, uploadUrl, uploadHeaders, expiresInS}  NEW SHAPE
//   POST /dish/files/confirm            {fileId}              -> 201 {fileId, kind, contentType, size}  NEW
//   POST /dish/craving/peek             {cravingToken}        -> {parentName, relation, message}
//   POST /dish/cards                    {dish, relation?, kidName?, photos?, voiceNote?, cravingToken?} -> 201 {kidToken, card}
//   POST /dish/cards/get                {kidToken}            -> {card}
//   POST /dish/cards/update             {kidToken, relation?, kidName?, message?, voiceNote?, voiceNoteS?, edits?} -> {card}
//   POST /dish/cards/ask                {kidToken, questions} -> {card}
//   POST /dish/cards/sent               {kidToken, via}       -> {card}
//   POST /dish/ask/peek                 {askToken, lang?}     -> {ask}
//   POST /dish/ask/answer/upload?q=&lang=&durationS=  {askToken, contentType, size} -> 201 {fileId, ..., uploadUrl, ...}  NEW
//   POST /dish/ask/answer?q=&lang=&durationS=         {askToken, fileId}            -> {ask}  NEW BODY
//   POST /dish/ask/finish               {askToken, lang?}     -> {ask}
//
// Files go straight to S3 (SYSTEM-DESIGN.md), so the two routes that took raw bytes now give out a link: docs/build/DISH-MIGRATION.md.
import * as Sentry from "@sentry/node";
import { EXPOSE, siteOrigins } from "../../cors.js";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import { ApiError, invalid, noRoute, notSetUp, providerDown, refused, sendError } from "../../errors.js";
import { hit, subjectKey, type Limit } from "../../rateLimit.js";
import type { Trace } from "./budget.js";
import { linkForCard, peekLink } from "./cravingLinks.js";
import { DishModelError } from "./model.js";
import { flagged } from "./moderation.js";
import type { QuestionId, Relation } from "./recipe/types.js";
import { cleanBold, isQuestionId, isRelation, LIMITS, plain } from "./recipe/validate.js";
import * as service from "./service.js";
import {
  askTokenFor,
  badRequest,
  CLIP_SLACK_S,
  DishFail,
  fail,
  JSON_BYTES,
  KID_VOICE_S,
  LANGS,
  MAX_CLIP_S,
  MAX_EDITS,
  MAX_PHOTOS,
  MESSAGE_CHARS,
  notFound,
  RATE,
  sha256Hex,
  TOKEN,
  TOO_MANY,
  VIAS,
  webOrigin,
  WORDS,
} from "./values.js";

type Body = Record<string, unknown>;

// ---------------------------------------------------------------------------------------------
// Who may call

const ORIGINS = [/^https:\/\/(www\.)?homecookd\.app$/, /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/];

/** The CORS headers for an allowed origin (ours, DISH_WEB_ORIGIN, or SITE_ORIGINS in cors.ts; none needed without one); false for another site. */
function corsFor(origin: string | undefined): Record<string, string> | false {
  if (!origin) return { Vary: "Origin" };
  if (!ORIGINS.some((o) => o.test(origin)) && origin !== webOrigin() && !siteOrigins().has(origin)) return false;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Dish-Token, X-Request-Id, Idempotency-Key",
    "Access-Control-Expose-Headers": EXPOSE,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const ipKeyOf = (req: FastifyRequest) => subjectKey(req.ip);
const traceOf = (req: FastifyRequest): Trace => ({ requestId: String(req.id), log: req.log as unknown as Trace["log"] });

/** Before the body is read, as the old routes did it: a refused call costs nothing. */
const limited = (...limits: Limit[]) => async (req: FastifyRequest) => {
  await hit(ipKeyOf(req), limits);
};

// ---------------------------------------------------------------------------------------------
// Reading a request

/** Parsed by the content-type parser below, and known to be an object by the route's schema. */
const bodyOf = (req: FastifyRequest) => req.body as Body;

/** A trimmed string of at most `max` characters, or null when missing or blank. */
function str(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) return null;
  if (typeof v !== "string") throw badRequest(`${field} must be a string`, field);
  const s = v.trim();
  if (s.length > max) throw badRequest(`${field} must be at most ${max} characters`, field);
  return s;
}

function relationOf(v: unknown): Relation {
  if (!isRelation(v)) throw badRequest("relation must be one of mom, dad, grandma, grandpa, auntie, uncle", "relation");
  return v;
}

/** A file id's hash. A malformed id says nothing about any file, so it stays a 400; anything else about a file is one 404 (uploads.ts). */
function fileHash(v: unknown, field: string): string {
  if (typeof v !== "string" || !TOKEN.test(v)) throw badRequest(`${field} must be a file id from /dish/files`, field);
  return sha256Hex(v);
}

function kidOf(b: Body): service.Kid {
  if (typeof b.kidToken !== "string" || !b.kidToken) throw badRequest("kidToken is required", "kidToken");
  if (!TOKEN.test(b.kidToken)) throw notFound();
  return { kidTokenHash: sha256Hex(b.kidToken), askToken: askTokenFor(b.kidToken) };
}

function askOf(token: unknown, field = "askToken", named = field): string {
  if (typeof token !== "string" || !token) throw badRequest(`${named} is required`, field);
  if (!TOKEN.test(token)) throw notFound();
  return sha256Hex(token);
}

/** In the body like every other route, so the site's text/plain call needs no preflight; the header still works. */
const askFrom = (req: FastifyRequest) => askOf(bodyOf(req).askToken ?? req.headers["x-dish-token"], "X-Dish-Token", "The X-Dish-Token header");

/** Mom's page language: a known code other than English, else undefined (the page stays in English). */
function pageLang(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw badRequest("lang must be a language code", "lang");
  return v !== "en" && LANGS.includes(v) ? v : undefined;
}

const index = (v: unknown, field: string) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw badRequest(`${field} must be a whole number from 0`, field);
  return v;
};
const editText = (v: unknown, field: string, max: number) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || !v.trim()) throw badRequest(`${field} must be 1 to ${max} characters`, field);
  return v.replace(/\s+/g, " ").trim();
};

/** The kid's fixes to the guess (§10): sizes and shapes here; indexes against the guess in the service. */
function editsOf(raw: unknown): service.Edit[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EDITS) throw badRequest(`edits must be a list of at most ${MAX_EDITS}`, "edits");
  return raw.map((x: unknown, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Body;
    if (o.kind === "ingredient") {
      const name = editText(o.name, `edits[${i}].name`, LIMITS.name);
      const amount = editText(o.amount, `edits[${i}].amount`, LIMITS.amount);
      if (name && (name.includes("**") || name.length > LIMITS.name)) throw badRequest(`edits[${i}].name must be 1 to ${LIMITS.name} characters`, `edits[${i}].name`);
      if (amount && (amount.includes("**") || amount.length > LIMITS.amount)) {
        throw badRequest(`edits[${i}].amount must be 1 to ${LIMITS.amount} characters`, `edits[${i}].amount`);
      }
      if (!name && !amount) throw badRequest(`edits[${i}] needs a name or an amount`, `edits[${i}]`);
      return { kind: "ingredient" as const, index: index(o.index, `edits[${i}].index`), name, amount };
    }
    if (o.kind === "line") {
      const rawText = editText(o.text, `edits[${i}].text`, LIMITS.lineText);
      const text = rawText === undefined ? undefined : cleanBold(rawText);
      if (text !== undefined && (!plain(text) || plain(text).length > LIMITS.lineText)) {
        throw badRequest(`edits[${i}].text must be 1 to ${LIMITS.lineText} characters`, `edits[${i}].text`);
      }
      return { kind: "line" as const, step: index(o.step, `edits[${i}].step`), line: index(o.line, `edits[${i}].line`), text };
    }
    throw badRequest(`edits[${i}].kind must be ingredient or line`, `edits[${i}].kind`);
  });
}

/** A question about a part of the guess (§10): `{kind: "ingredient", index}` or `{kind: "line", step, line}`. */
function aboutOf(raw: unknown, field: string): service.About | undefined {
  if (raw === undefined || raw === null) return undefined;
  const o = (typeof raw === "object" ? raw : {}) as Body;
  if (o.kind === "ingredient") return { kind: "ingredient", index: index(o.index, `${field}.index`) };
  if (o.kind === "line") return { kind: "line", step: index(o.step, `${field}.step`), line: index(o.line, `${field}.line`) };
  throw badRequest(`${field}.kind must be ingredient or line`, `${field}.kind`);
}

/** The query every answer call carries. */
function answerQuery(req: FastifyRequest): { questionId: QuestionId; language: string; durationS: number } {
  const query = req.query as Record<string, unknown>;
  const q = query.q;
  if (!isQuestionId(q)) throw badRequest("q must be one of q1 to q6", "q");
  const language = (query.lang as string) || "en";
  if (!LANGS.includes(language)) throw badRequest(`lang must be one of ${LANGS.join(" ")}`, "lang");
  const d = Number(query.durationS);
  if (!Number.isFinite(d) || d <= 0 || d > MAX_CLIP_S + CLIP_SLACK_S) throw badRequest(`durationS must be more than 0 and at most ${MAX_CLIP_S}`, "durationS");
  return { questionId: q, language, durationS: Math.min(MAX_CLIP_S, Math.round(d * 100) / 100) };
}

// ---------------------------------------------------------------------------------------------
// The routes

/**
 * Bodies keep their hand-written checks, because the site shows their sentences. These schemas name the fields, untyped so Fastify coerces
 * nothing, and because app.ts won't register a route with a field that looks like a file unless it says what it is. `fileId`, `photos` and
 * `voiceNote` are capabilities, not S3 keys: uploads.ts is their guard, tested for each in dishFiles.test.ts.
 */
const fields = (...names: string[]) => ({ type: "object", properties: Object.fromEntries(names.map((name) => [name, {}])) });

/** A craving link's token: missing is a 400, malformed the one not-found, as an unknown one is. */
function cravingOf(v: unknown): string {
  if (typeof v !== "string" || !v) throw badRequest("cravingToken is required", "cravingToken");
  if (!TOKEN.test(v)) throw notFound();
  return v;
}

/** From her craving link, the card is a request to her: the kid's name and the link's checks come before any model runs (cravingLinks.ts). */
async function createCard(req: FastifyRequest) {
  const b = bodyOf(req);
  const dish = str(b.dish, "dish", LIMITS.dish) ?? "";
  const kidName = str(b.kidName, "kidName", LIMITS.kidName);
  const cravingToken = b.cravingToken === undefined || b.cravingToken === null ? null : cravingOf(b.cravingToken);
  if (cravingToken && !kidName) throw badRequest("kidName is required", "kidName");
  const craving = cravingToken ? await linkForCard(cravingToken) : null;
  const relation = b.relation === undefined || b.relation === null ? (craving?.relation ?? "mom") : relationOf(b.relation);
  if (b.photos !== undefined && b.photos !== null && !Array.isArray(b.photos)) throw badRequest("photos must be a list of file ids", "photos");
  const photoIds = (b.photos as unknown[] | null | undefined) ?? [];
  if (photoIds.length > MAX_PHOTOS) throw badRequest(`At most ${MAX_PHOTOS} photos`, "photos");
  if (new Set(photoIds).size !== photoIds.length) throw badRequest("The same photo is in the list twice", "photos");
  const photos = photoIds.map((id, i) => fileHash(id, `photos[${i}]`));
  const voiceNote = b.voiceNote === undefined || b.voiceNote === null ? null : fileHash(b.voiceNote, "voiceNote");
  if (dish.length < 2 && !photos.length && !voiceNote) throw badRequest("dish must be 2 to 200 characters", "dish");
  if (flagged(dish, kidName)) throw fail(422, "words", WORDS);
  return await service.createCard({ dish, relation, kidName, photos, voiceNote, ipKey: ipKeyOf(req), cravingToken }, traceOf(req));
}

async function updateCard(req: FastifyRequest) {
  const b = bodyOf(req);
  const kid = kidOf(b);
  const relation = b.relation === undefined ? undefined : relationOf(b.relation);
  const kidName = b.kidName === undefined ? undefined : str(b.kidName, "kidName", LIMITS.kidName);
  let message: string | undefined;
  if (b.message !== undefined) {
    if (typeof b.message !== "string") throw badRequest("message must be a string", "message");
    message = b.message.trim();
    if (!message || message.length > MESSAGE_CHARS) throw badRequest(`message must be 1 to ${MESSAGE_CHARS} characters`, "message");
  }
  const voiceNote = b.voiceNote === undefined ? undefined : b.voiceNote === null ? null : fileHash(b.voiceNote, "voiceNote");
  // The page measures its own recording: Chrome's webm often carries no duration for anyone to read.
  let voiceNoteS: number | undefined;
  if (b.voiceNoteS !== undefined && b.voiceNoteS !== null) {
    const s = Number(b.voiceNoteS);
    if (typeof b.voiceNoteS !== "number" || !Number.isFinite(s) || s <= 0 || s > KID_VOICE_S + 5) {
      throw badRequest(`voiceNoteS must be more than 0 and at most ${KID_VOICE_S}`, "voiceNoteS");
    }
    voiceNoteS = Math.min(KID_VOICE_S, Math.round(s * 100) / 100);
  }
  const edits = editsOf(b.edits);
  if (flagged(kidName, message, ...edits.flatMap((e) => (e.kind === "ingredient" ? [e.name, e.amount] : [e.text])))) {
    throw fail(422, "words", WORDS);
  }
  return { card: await service.kidUpdate({ ...kid, relation, kidName, message, voiceNote, voiceNoteS, ...(edits.length ? { edits } : {}) }) };
}

async function askMom(req: FastifyRequest) {
  const b = bodyOf(req);
  const kid = kidOf(b);
  if (!Array.isArray(b.questions)) throw badRequest("questions must be a list of 1 to 3 questions", "questions");
  const questions = b.questions.map((x: unknown, i) => {
    const o = (x && typeof x === "object" ? x : {}) as Body;
    const about = aboutOf(o.about, `questions[${i}].about`);
    if (typeof o.text !== "string" && !(about && (o.text === undefined || o.text === null))) {
      throw badRequest(`questions[${i}].text must be a string`, `questions[${i}].text`);
    }
    if (o.id !== undefined && o.id !== null && typeof o.id !== "string") {
      throw badRequest(`questions[${i}].id must be q1, q2 or q3, or left out for the kid's own question`, `questions[${i}].id`);
    }
    return { id: (o.id ?? null) as string | null, text: typeof o.text === "string" ? o.text : null, ...(about ? { about } : {}) };
  });
  return { card: await service.kidAsk({ ...kid, questions }) };
}

async function sent(req: FastifyRequest) {
  const b = bodyOf(req);
  const kid = kidOf(b);
  const via = b.via;
  if (typeof via !== "string" || !(VIAS as readonly string[]).includes(via)) throw badRequest(`via must be one of ${VIAS.join(", ")}`, "via");
  return { card: await service.kidSent({ ...kid, via }) };
}

async function fileLink(req: FastifyRequest) {
  const kind = (req.query as Record<string, unknown>).kind;
  if (kind !== "photo" && kind !== "voice") throw badRequest("kind must be photo or voice", "kind");
  await hit(ipKeyOf(req), [RATE.files]);
  const b = bodyOf(req);
  return await service.requestUpload(kind, b.contentType, b.size, ipKeyOf(req));
}

async function fileConfirm(req: FastifyRequest) {
  const fileId = bodyOf(req).fileId;
  const hash = fileHash(fileId, "fileId");
  return await service.confirmFileUpload(hash, fileId as string);
}

async function answerLink(req: FastifyRequest) {
  const askTokenHash = askFrom(req);
  const { questionId } = answerQuery(req);
  const b = bodyOf(req);
  return await service.requestAnswerUpload({ askTokenHash, questionId, contentType: b.contentType, size: b.size, ipKey: ipKeyOf(req) });
}

async function answer(req: FastifyRequest) {
  const askTokenHash = askFrom(req);
  const { questionId, language, durationS } = answerQuery(req);
  const fileIdHash = fileHash(bodyOf(req).fileId, "fileId");
  return { ask: await service.momAnswer({ askTokenHash, questionId, fileIdHash, durationS, language }, traceOf(req)) };
}

// ---------------------------------------------------------------------------------------------
// Errors

/** A limit's 429 in the words the site shows. */
const tooManyTries = (e: unknown) => (e instanceof ApiError && e.statusCode === 429 && !e.sentence ? new ApiError(429, e.code, e.headers, TOO_MANY, e.extra) : e);

/**
 * Notes what's dish's own, then throws on: app.ts answers every error in the one shape. An unknown token or file counts against the IP (20 in 10 minutes),
 * and a model's failure, a limit or a body that isn't an object gets the sentence the site shows.
 */
async function onError(error: FastifyError, req: FastifyRequest): Promise<never> {
  if (error instanceof DishFail && error.code === "not_found") {
    try {
      await hit(ipKeyOf(req), [RATE.badTokens]);
    } catch (limit) {
      throw tooManyTries(limit);
    }
  }
  if (error instanceof DishFail && error.code === "provider_down") {
    const cause = (error as { cause?: Error }).cause ?? error;
    req.log.error({ err: { type: cause.name } }, "dish storage failed");
    Sentry.captureException(cause, { tags: { request_id: String(req.id) } });
  }
  if (error instanceof DishModelError) {
    req.log.error({ kind: error.kind, reason: error.message }, "dish model failed"); // a fixed label, never a model's words
    throw error.kind === "not_set_up" ? notSetUp("Not set up yet.") : providerDown(502, "That didn't work. Try again.");
  }
  if (error.validation) throw invalid(undefined, "The body must be a JSON object.");
  throw tooManyTries(error);
}

export async function dishRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req, reply) => {
    const cors = corsFor(req.headers.origin);
    if (!cors) {
      reply.header("Vary", "Origin");
      return sendError(reply, req, refused(403, "origin", "This site can't use these routes.")); // a preflight too: the browser refuses it either way
    }
    reply.headers(cors);
    reply.header("Cache-Control", "no-store");
  });

  // A JSON body is read as JSON whatever its Content-Type: the site sends text/plain with keepalive, so no preflight has to come back first.
  // A raw file is refused without reading it. Bytes don't pass through the api.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(/^(image|audio|video)\//, (_req, _payload, done) => {
    done(fail(415, "bad_type", "Files go straight to storage. Ask for an upload link first."));
  });
  app.addContentTypeParser("*", { parseAs: "string", bodyLimit: JSON_BYTES }, (_req, body, done) => {
    const text = String(body);
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(badRequest("The body must be JSON."));
    }
  });

  // No body at all reads as an empty one, so a missing token is its own 400, as before.
  app.addHook("preValidation", async (req) => {
    req.body ??= {};
  });

  app.setErrorHandler(onError);
  app.setNotFoundHandler((req, reply) => sendError(reply, req, noRoute()));
  app.options("/*", async (_req, reply) => reply.code(204).send());

  type Handler = (req: FastifyRequest) => Promise<unknown>;
  const post = (url: string, schema: object, handler: Handler, options: { status?: number; onRequest?: (req: FastifyRequest) => Promise<void>; notFileKeys?: string[] } = {}) => {
    app.post(
      url,
      {
        schema: { body: schema },
        bodyLimit: JSON_BYTES,
        ...(options.onRequest ? { onRequest: options.onRequest } : {}),
        config: { notFileKeys: options.notFileKeys ?? [] },
      },
      async (req, reply) => reply.code(options.status ?? 200).send(await handler(req)),
    );
  };

  post("/files", fields("contentType", "size"), fileLink, { status: 201 });
  post("/files/confirm", fields("fileId"), fileConfirm, { status: 201, notFileKeys: ["fileId"] });
  // The kid's page from a craving link: who's asking, and her line. An unknown token counts against the IP like any other.
  post("/craving/peek", fields("cravingToken"), async (req) => await peekLink(cravingOf(bodyOf(req).cravingToken)));
  post("/cards", fields("dish", "relation", "kidName", "photos", "voiceNote", "cravingToken"), createCard, {
    status: 201,
    onRequest: limited(RATE.cards, RATE.cardsDay),
    notFileKeys: ["photos", "voiceNote"],
  });
  post("/cards/get", fields("kidToken"), async (req) => ({ card: await service.kidGet(kidOf(bodyOf(req)), traceOf(req)) }));
  post("/cards/update", fields("kidToken", "relation", "kidName", "message", "voiceNote", "voiceNoteS", "edits"), updateCard, {
    notFileKeys: ["voiceNote", "voiceNoteS"],
  });
  post("/cards/ask", fields("kidToken", "questions"), askMom, { onRequest: limited(RATE.ask) });
  post("/cards/sent", fields("kidToken", "via"), sent);
  post("/ask/peek", fields("askToken", "lang"), async (req) => {
    const b = bodyOf(req);
    const hash = askOf(b.askToken);
    return { ask: await service.momPeek(hash, pageLang(b.lang), traceOf(req)) };
  });
  post("/ask/answer/upload", fields("askToken", "contentType", "size"), answerLink, { status: 201, onRequest: limited(RATE.answer) });
  post("/ask/answer", fields("askToken", "fileId"), answer, { notFileKeys: ["fileId"] });
  post("/ask/finish", fields("askToken", "lang"), async (req) => {
    const b = bodyOf(req);
    const hash = askOf(b.askToken);
    return { ask: await service.momFinish(hash, pageLang(b.lang), traceOf(req)) };
  });
}

// What the Community tests share (convex/community.helpers.ts): families, signed-in people and recipes written straight to the tables, as the one-way sync will, and the routes
// through app.inject on real Postgres. `families`, `people` and `recipes` are read-only to the api here, so a test changes them with SQL, standing in for that sync.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { hashToken } from "../src/auth.js";
import { db } from "../src/db.js";
import { DEMO_LOCATION } from "../src/modules/community/geo.js";
import { newBackend } from "./dishHelpers.js";

export type Who = { token: string; personId: string; familyId: string };
export type Res = { status: number; data: any };

export async function family(name: string, publicName?: string): Promise<string> {
  const { rows } = await db().query("insert into families (name, public_name) values ($1, $2) returning id", [name, publicName ?? null]);
  return rows[0].id;
}

export async function person(familyId: string, name: string, role: "cook" | "kid", approx?: { lat: number; lng: number }, language?: string): Promise<Who> {
  const { rows } = await db().query(
    "insert into people (family_id, name, role, approx_lat, approx_lng, language) values ($1, $2, $3, $4, $5, $6) returning id",
    [familyId, name, role, approx?.lat ?? null, approx?.lng ?? null, language ?? null],
  );
  const token = randomBytes(32).toString("base64url");
  await db().query("insert into sessions (token_hash, family_id, person_id, expires_at) values ($1, $2, $3, now() + interval '30 days')", [hashToken(token), familyId, rows[0].id]);
  return { token, personId: rows[0].id, familyId };
}

const POHA_STEPS = [
  { order: 1, title: "Rinse the poha", text: "Rinse it twice.", quote: "Not too long, beta.", quoteOriginal: "जास्त वेळ नको", moment: { startS: 10, endS: 40 } },
  { order: 2, title: "Temper", text: "Mustard seeds in hot oil.", moment: { startS: 50, endS: 90 } },
];

export type RecipeExtra = {
  title?: string;
  status?: string;
  steps?: unknown[];
  memoriesOptIn?: boolean;
  sharedAt?: number; // a small number, as Convex's tests give: a later one is newer
  coverStock?: string;
  coverKey?: string;
  card?: { text: string; usedStories?: boolean; culture?: string; quote?: string };
};

const SHARED_BASE = Date.now() - 86_400_000;

/** A Kanda Poha with her Marathi quote and a private story. */
export async function recipe(who: Who, extra: RecipeExtra = {}): Promise<string> {
  const { rows } = await db().query(
    `insert into recipes (family_id, cook_id, title, status, library_id, recipe_json_key, cover_key, cover_stock_path, steps, memories, memories_opt_in, shared_at,
                          story_card_text, story_card_written_at, story_card_used_stories, story_card_culture, story_card_quote)
     values ($1, $2, $3, $4, 'lib-poha-secret', 'edible-recipes/poha/recipe.json', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [
      who.familyId,
      who.personId,
      extra.title ?? "Kanda Poha",
      extra.status ?? "ready",
      extra.coverKey ?? null,
      extra.coverStock ?? null,
      JSON.stringify(extra.steps ?? POHA_STEPS),
      JSON.stringify([{ kind: "story", text: "Her mother made this every Sunday in Pune.", moment: { startS: 60, endS: 80 } }]),
      extra.memoriesOptIn ?? false,
      extra.sharedAt === undefined ? null : new Date(SHARED_BASE + extra.sharedAt),
      extra.card?.text ?? null,
      extra.card ? new Date() : null,
      extra.card?.usedStories ?? null,
      extra.card?.culture ?? null,
      extra.card?.quote ?? null,
    ],
  );
  return rows[0].id;
}

/** The sync bringing over her share switch. */
export const setShared = (recipeId: string, on: boolean) => db().query("update recipes set shared_at = $2 where id = $1", [recipeId, on ? new Date() : null]);

/** Two families: the Pawars (Grandma Rajani + Shreya) and a neighbor, plus Caleb in his own family. */
export async function world() {
  const t = await newBackend();
  const pawar = await family("Pawar home", "Pawar");
  const rajani = await person(pawar, "Rajani", "cook");
  const shreya = await person(pawar, "Shreya", "kid");
  const zhang = await family("Zhang home");
  const serene = await person(zhang, "Serene", "kid");
  const serenesMom = await person(zhang, "Mei", "cook", { lat: DEMO_LOCATION.lat + 0.02, lng: DEMO_LOCATION.lng });
  const wang = await family("Wang home");
  const caleb = await person(wang, "Caleb", "kid");
  return { t, rajani, shreya, serene, serenesMom, caleb };
}

export async function call(t: FastifyInstance, who: Who | null, method: "GET" | "POST" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const res = await t.inject({
    method,
    url,
    headers: { ...(who ? { authorization: `Bearer ${who.token}` } : {}), ...headers },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: res.statusCode, data: res.body ? JSON.parse(res.body) : null };
}

/** A successful call's reply. */
export async function ok(p: Promise<Res>): Promise<any> {
  const r = await p;
  assert.ok(r.status < 300, `${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}

/** A refusal with this status, and these words if given. */
export async function refusedWith(p: Promise<Res>, status: number, message?: string | RegExp): Promise<Res> {
  const r = await p;
  assert.equal(r.status, status, JSON.stringify(r.data));
  if (typeof message === "string") assert.equal(r.data.message, message);
  else if (message) assert.match(r.data.message, message);
  return r;
}

const bytes = (r: Res) => {
  const { requestId: _requestId, ...rest } = r.data ?? {};
  return JSON.stringify({ status: r.status, ...rest });
};

/** Refused the same as a row that isn't there: nothing but the request id may differ. */
export function sameAsMissing(refused: Res, missing: Res, what = ""): void {
  assert.equal(refused.status, 404, `${what}: ${JSON.stringify(refused.data)}`);
  assert.equal(bytes(refused), bytes(missing), what);
}

export const MISSING = "no-such-row-at-all";

export const feed = (t: FastifyInstance, who: Who, query = "") => ok(call(t, who, "GET", `/v1/community/feed${query}`));
export const dishes = async (t: FastifyInstance, who: Who) => (await feed(t, who)).recipes.map((r: { dish: string }) => r.dish).sort();
export const view = (t: FastifyInstance, who: Who, recipeId: string) => call(t, who, "GET", `/v1/community/recipes/${recipeId}`);
export const dinner = (t: FastifyInstance, who: Who, dinnerId: string) => call(t, who, "GET", `/v1/dinners/${dinnerId}`);
export const report = (t: FastifyInstance, who: Who, kind: "recipe" | "dinner", targetId: string, reason?: string) => call(t, who, "POST", "/v1/community/reports", { kind, targetId, reason });
export const block = (t: FastifyInstance, who: Who, kind: "recipe" | "dinner", targetId: string) => call(t, who, "POST", "/v1/community/blocks", { kind, targetId });
export const join = (t: FastifyInstance, who: Who, dinnerId: string) => call(t, who, "POST", `/v1/dinners/${dinnerId}/join`);
export const respond = (t: FastifyInstance, who: Who, requestId: string, accept: boolean) => call(t, who, "POST", `/v1/dinner-requests/${requestId}/respond`, { accept });
export const requestSwap = (t: FastifyInstance, who: Who, recipeId: string, myRecipeId?: string) => call(t, who, "POST", "/v1/community/swaps", { recipeId, myRecipeId });
export const cookTogether = (t: FastifyInstance, who: Who, recipeId: string) => call(t, who, "POST", "/v1/community/cook-together", { recipeId });
export const respondSwap = (t: FastifyInstance, who: Who, swapId: string, accept: boolean) => call(t, who, "POST", `/v1/community/swaps/${swapId}/respond`, { accept });
export const mySwaps = async (t: FastifyInstance, who: Who) => (await ok(call(t, who, "GET", "/v1/community/swaps"))).swaps;

export const ADDRESS = "Baker House, 362 Memorial Dr";

export const hostBody = (recipeId: string, extra: Record<string, unknown> = {}) => ({
  recipeId,
  startsAt: Date.now() + 3_600_000,
  placeName: "Baker House kitchen",
  address: ADDRESS,
  seats: 4,
  ...extra,
});

export const tryHost = (t: FastifyInstance, who: Who, recipeId: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  call(t, who, "POST", "/v1/dinners", hostBody(recipeId, extra), headers);

export async function host(t: FastifyInstance, who: Who, recipeId: string, extra: Record<string, unknown> = {}): Promise<string> {
  return (await ok(tryHost(t, who, recipeId, extra))).dinnerId;
}

/** The dinner's start has passed. */
export const startIt = (dinnerId: string) => db().query("update dinners set starts_at = now() - interval '1 second' where id = $1", [dinnerId]);
/** Every invite open happened `ms` earlier. */
export const openedEarlier = (ms: number) => db().query("update dinner_invite_opens set created_at = created_at - make_interval(secs => $1)", [ms / 1000]);
export const reportRows = async () => (await db().query("select * from reports order by created_at")).rows;
export const sorted = (ids: string[]) => [...ids].sort();

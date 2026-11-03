// The public library: library.json and each recipe.json on the media host, read only for what a dish is called and whose it is. Supabase's plumbing.ts
// makeLibrary and assertRecipe, behind an interface so tests never touch the network. Every call has a timeout, and none of them can fail a request: an
// unreachable host reads as "unknown". A family's own recipe has a row in `recipes`, but most library ids don't, so this stays until media moves.
import { db } from "../../db.js";
import { familyHasDish } from "../recipes/read.js";
import type { RecipeInfo } from "./recap.js";
import { noSuchRecipe } from "./values.js";

export type RecipeDetails = {
  id: string;
  title: string;
  cook_name: string | null;
  sample: boolean;
  steps: { order: number; quote: string | null }[];
};

export interface Library {
  /** library.json as id -> {title, cook_name, sample}. Empty when the host can't be reached. */
  libraryIndex(): Promise<Map<string, RecipeInfo>>;
  /** One recipe.json, or null when it's missing or the host can't be reached. */
  recipeInfo(id: string): Promise<RecipeDetails | null>;
  /** False only when the host says it isn't there (a 404, or S3's 403). Null when it can't say (unreachable, a 5xx): Supabase doesn't block a send on that. */
  exists(id: string): Promise<boolean | null>;
  /** The old pipeline's job file, for a phone registering a send after its recording was published. */
  publishedDish(uploadId: string): Promise<string | null>;
}

const MINUTE = 60_000;
const TTL_MS = 10 * MINUTE;
const RECIPE_CACHE_MAX = 500;
const CALL_MS = 5_000;
const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const str = (v: unknown) => (typeof v === "string" ? v : null);
/** The media CDN reads its bucket with s3:GetObject alone (infra/modules/env/storage.tf), so S3 answers 403, not 404, for a key that isn't there. */
const isMissing = (status: number) => status === 404 || status === 403;

export function makeLibrary(o: { baseUrl: string; fetch?: typeof fetch; ttlMs?: number; clock?: () => number }): Library {
  const base = o.baseUrl.replace(/\/+$/, "");
  const doFetch = o.fetch ?? fetch;
  const ttl = o.ttlMs ?? TTL_MS;
  const clock = o.clock ?? Date.now;
  let index: { at: number; map: Map<string, RecipeInfo> } | null = null;
  const recipes = new Map<string, { at: number; value: RecipeDetails | null }>();
  const seen = new Map<string, { at: number; ok: boolean }>();

  const getJson = async (url: string): Promise<{ ok: true; body: unknown } | { ok: false; missing: boolean }> => {
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(CALL_MS) });
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, missing: isMissing(res.status) };
      }
      return { ok: true, body: await res.json() };
    } catch {
      return { ok: false, missing: false };
    }
  };

  return {
    async libraryIndex() {
      if (index && clock() - index.at < ttl) return index.map;
      const got = await getJson(`${base}/library.json`);
      if (!got.ok || !Array.isArray(got.body)) return new Map();
      const map = new Map<string, RecipeInfo>();
      for (const e of got.body as Record<string, unknown>[]) {
        const id = str(e?.id);
        if (id) map.set(id, { title: str(e.title) ?? "", cook_name: str(e.cook_name), sample: e.sample === true });
      }
      index = { at: clock(), map };
      return map;
    },
    async recipeInfo(id) {
      if (!ID.test(id)) return null;
      const hit = recipes.get(id);
      if (hit && clock() - hit.at < ttl) return hit.value;
      const got = await getJson(`${base}/${id}/recipe.json`);
      if (!got.ok && !got.missing) return null; // unreachable: try again next time
      let value: RecipeDetails | null = null;
      if (got.ok && got.body && typeof got.body === "object") {
        const r = got.body as Record<string, unknown>;
        const cook = (r.cook ?? {}) as Record<string, unknown>;
        const steps = Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : [];
        value = {
          id,
          title: str(r.title) ?? "",
          cook_name: str(cook.name),
          sample: r.sample === true,
          steps: steps.filter((st) => Number.isFinite(Number(st?.order))).map((st) => ({ order: Number(st.order), quote: str(st.quote) })),
        };
      }
      if (recipes.size >= RECIPE_CACHE_MAX) recipes.clear();
      recipes.set(id, { at: clock(), value });
      return value;
    },
    async exists(id) {
      const hit = seen.get(id);
      if (hit && clock() - hit.at < ttl) return hit.ok;
      try {
        const res = await doFetch(`${base}/${id}/recipe.json`, { method: "HEAD", signal: AbortSignal.timeout(CALL_MS) });
        await res.body?.cancel();
        if (!res.ok && !isMissing(res.status)) return null; // a 5xx or a 429 can't say, and isn't kept
        const ok = res.ok;
        if (seen.size >= RECIPE_CACHE_MAX) seen.clear();
        seen.set(id, { at: clock(), ok });
        return ok;
      } catch {
        return null;
      }
    },
    async publishedDish(uploadId) {
      const got = await getJson(`${base}/jobs/${uploadId}.json`);
      if (!got.ok || !got.body || typeof got.body !== "object") return null;
      const job = got.body as Record<string, unknown>;
      return job.status === "published" && typeof job.recipe_id === "string" && ID.test(job.recipe_id) ? job.recipe_id : null;
    },
  };
}

const unreachable: Library = {
  libraryIndex: async () => new Map(),
  recipeInfo: async () => null,
  exists: async () => null,
  publishedDish: async () => null,
};

let current: Library | undefined;

export function library(): Library {
  if (!current) {
    const baseUrl = process.env.MEDIA_BASE_URL?.trim();
    current = baseUrl ? makeLibrary({ baseUrl }) : unreachable;
  }
  return current;
}

/** For tests. */
export function useLibrary(next: Library | undefined): void {
  current = next;
}

/**
 * A dish someone names: this family's own ready recipe, by its row, or else what the library host says. Checked before a send's transaction: a call that can wait 5 s
 * on the library mustn't hold a row lock. False is a 404; null means it can't say, and a send isn't held up for that.
 */
export async function checkDish(familyId: string, id: string | null | undefined): Promise<void> {
  if (!id || (await familyHasDish(db(), familyId, id))) return;
  if ((await library().exists(id)) === false) throw noSuchRecipe();
}

/** The ids of one person's dishes: entries whose cook_name is their name, case-insensitively (the app's cookProfile rule). Samples included. */
export function dishesOf(index: ReadonlyMap<string, RecipeInfo>, name: string | null | undefined): string[] {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return [];
  return [...index].filter(([, d]) => (d.cook_name ?? "").trim().toLowerCase() === n).map(([id]) => id);
}

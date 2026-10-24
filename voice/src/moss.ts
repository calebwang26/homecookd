// Moss semantic search over the family's index (family-<familyId>, named by /voice/session). Moss only
// finds the moment; it never answers. Convex (convex/moss.ts) fills it with one doc per step, story and
// tip; metadata (all strings) includes recipeId, kind, stepOrder, startS, endS and quote.
// Docs: https://docs.moss.dev/docs/reference/js/api.md
import { MossClient } from "@moss-js/moss";
import { env } from "./env.js";

/** `text` is what Moss indexed; `quote` is the cook's own words for that moment (or the text). */
export type Hit = { text: string; quote: string; kind: string; startS: number; endS: number; stepOrder?: number; score: number };

let client: MossClient | null = null;
const loaded = new Map<string, Promise<boolean>>();
/** Indexes Moss said don't exist, and when. Not asked again for a minute: each ask is a round trip on the kid's turn. */
const missing = new Map<string, number>();
const MISSING_RETRY_MS = 60_000;

function moss(): MossClient | null {
  if (!env.mossProjectId || !env.mossProjectKey) return null;
  return (client ??= new MossClient(env.mossProjectId, env.mossProjectKey));
}

/** Load the family's index into memory once (queries then run in-process, ~10 ms). false = no index ("" = none: the stub). */
export function warm(name: string): Promise<boolean> {
  const c = moss();
  if (!c || !name) return Promise.resolve(false);
  if (Date.now() - (missing.get(name) ?? -Infinity) < MISSING_RETRY_MS) return Promise.resolve(false);
  let p = loaded.get(name);
  if (!p) {
    const t0 = Date.now();
    p = c
      .loadIndex(name, { autoRefresh: true, pollingIntervalInSeconds: 60 })
      .then(() => {
        missing.delete(name);
        console.log(`moss: loaded ${name} in ${Date.now() - t0}ms`);
        return true;
      })
      .catch((err) => {
        const code = err?.code ?? err?.message;
        console.warn(`moss: no index ${name} (${code})`);
        loaded.delete(name); // try again later; the cook may have just recorded
        if (code === "NOT_FOUND") missing.set(name, Date.now());
        return false;
      });
    loaded.set(name, p);
  }
  return p;
}

/**
 * The best moments in this recipe for `query`. Empty when nothing is indexed, or when the search (loading the index
 * included) takes longer than `waitMs`: a slow Moss never holds up the kid's turn.
 */
export async function findMoments(index: string, recipeId: string, query: string, waitMs: number, topK = 3): Promise<Hit[]> {
  const c = moss();
  if (!c || !index) return [];
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Hit[]>((r) => (timer = setTimeout(() => r([]), waitMs)));
  try {
    return await Promise.race([search(c, index, recipeId, query, topK), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function search(c: MossClient, index: string, recipeId: string, query: string, topK: number): Promise<Hit[]> {
  if (!(await warm(index))) return [];
  const res = await c.query(index, query, {
    topK,
    filter: { field: "recipeId", condition: { $eq: recipeId } },
  });
  return [...res.docs]
    .sort((a, b) => b.score - a.score)
    .map((d) => {
      const m = d.metadata ?? {};
      return {
        text: d.text,
        quote: m.quote || d.text,
        kind: m.kind ?? "said",
        startS: Number(m.startS),
        endS: Number(m.endS),
        stepOrder: m.stepOrder ? Number(m.stepOrder) : undefined,
        score: Math.round(d.score * 100) / 100,
      };
    })
    .filter((m) => Number.isFinite(m.startS) && Number.isFinite(m.endS) && m.endS > m.startS);
}

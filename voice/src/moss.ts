// Moss semantic search over the family's index (family-<familyId>). Moss only finds the moment;
// it never answers. The index is filled by Convex (Track A/C) with one doc per moment, metadata
// { recipeId, kind, startS, endS, stepOrder? } as strings.
// Docs: https://docs.moss.dev/docs/reference/js/api.md
import { MossClient } from "@moss-js/moss";
import { env } from "./env.js";

export type Hit = { text: string; kind: string; startS: number; endS: number; stepOrder?: number; score: number };

let client: MossClient | null = null;
const loaded = new Map<string, Promise<boolean>>();

function moss(): MossClient | null {
  if (!env.mossProjectId || !env.mossProjectKey) return null;
  return (client ??= new MossClient(env.mossProjectId, env.mossProjectKey));
}

export const indexFor = (familyId: string) => `family-${familyId}`;

/** Load the family's index into memory once (queries then run in-process, ~10 ms). false = no index. */
export function warm(familyId: string): Promise<boolean> {
  const c = moss();
  if (!c) return Promise.resolve(false);
  const name = indexFor(familyId);
  let p = loaded.get(name);
  if (!p) {
    const t0 = Date.now();
    p = c
      .loadIndex(name, { autoRefresh: true, pollingIntervalInSeconds: 60 })
      .then(() => {
        console.log(`moss: loaded ${name} in ${Date.now() - t0}ms`);
        return true;
      })
      .catch((err) => {
        console.warn(`moss: no index ${name} (${err?.code ?? err?.message})`);
        loaded.delete(name); // try again next session; the cook may have just recorded
        return false;
      });
    loaded.set(name, p);
  }
  return p;
}

/** The best moments in this recipe for `query`. Empty when nothing is indexed, or the index is still loading after `waitMs`. */
export async function findMoments(familyId: string, recipeId: string, query: string, waitMs: number, topK = 3): Promise<Hit[]> {
  const c = moss();
  const timeout = new Promise<false>((r) => setTimeout(() => r(false), waitMs));
  if (!c || !(await Promise.race([warm(familyId), timeout]))) return [];
  const res = await c.query(indexFor(familyId), query, {
    topK,
    filter: { field: "recipeId", condition: { $eq: recipeId } },
  });
  return [...res.docs]
    .sort((a, b) => b.score - a.score)
    .map((d) => {
      const m = d.metadata ?? {};
      return {
        text: d.text,
        kind: m.kind ?? "said",
        startS: Number(m.startS),
        endS: Number(m.endS),
        stepOrder: m.stepOrder ? Number(m.stepOrder) : undefined,
        score: Math.round(d.score * 100) / 100,
      };
    })
    .filter((m) => Number.isFinite(m.startS) && Number.isFinite(m.endS) && m.endS > m.startS);
}

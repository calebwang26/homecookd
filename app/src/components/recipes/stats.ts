// My history with each dish (GET /me/recipe-stats): views, times cooked, hearted, last sent to me.
//
//   const { byId, ready, loaded, refresh } = useRecipeStats();
//   byId[recipeId]?.cooked
//
// `ready`: the first try is over (rows may be empty because it failed offline). `loaded`: the server
// has answered at least once, so the rows are real (what a count or a milestone needs).
//
// One module store per profile, shared by every screen. Refetched when a screen using it comes
// into focus (at most every 10 s, so a dish just opened or cooked shows on the way back).
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { api, type RecipeStat } from '@/lib/api';
import { useSession } from '@/lib/session';

const MIN_GAP_MS = 10_000;

type Entry = { rows: RecipeStat[]; at: number; ready: boolean };
let snap: ReadonlyMap<string, Entry> = new Map();
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<void>>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnap = () => snap;

function load(owner: string, force = false): Promise<void> {
  const hit = snap.get(owner);
  if (!force && hit && Date.now() - hit.at < MIN_GAP_MS) return Promise.resolve();
  const running = inflight.get(owner);
  if (running) return running;
  const p = (async () => {
    let next: Entry;
    try {
      const rows = await api.recipeStats({ profileId: owner });
      next = { rows: Array.isArray(rows) ? rows : [], at: Date.now(), ready: true };
    } catch {
      // Offline: keep the last answer; rows just show the dish's own facts meanwhile.
      next = { rows: snap.get(owner)?.rows ?? [], at: snap.get(owner)?.at ?? 0, ready: true };
    }
    const m = new Map(snap);
    m.set(owner, next);
    snap = m;
    for (const l of listeners) l();
  })().finally(() => {
    if (inflight.get(owner) === p) inflight.delete(owner);
  });
  inflight.set(owner, p);
  return p;
}

/** Pull to refresh. */
export function refreshRecipeStats(owner: string | null | undefined): Promise<void> {
  return owner ? load(owner, true) : Promise.resolve();
}

export function useRecipeStats(): { byId: Record<string, RecipeStat>; rows: RecipeStat[]; ready: boolean; loaded: boolean; refresh: () => Promise<void> } {
  const { me, status } = useSession();
  const owner = me?.id ?? null;
  const focused = useIsFocused();
  const s = useSyncExternalStore(subscribe, getSnap, getSnap);
  useEffect(() => {
    if (owner && focused && status === 'ready') void load(owner);
  }, [owner, focused, status]);
  const e = owner ? s.get(owner) : undefined;
  const rows = useMemo(() => e?.rows ?? [], [e]);
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.recipe_id, r])), [rows]);
  const refresh = useCallback(() => refreshRecipeStats(owner), [owner]);
  return { byId, rows, ready: !!e?.ready, loaded: !!e && e.at > 0, refresh };
}

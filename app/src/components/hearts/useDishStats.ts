// Fresh Hearts & kitchen data for the cook's screens (RETENTION-HANDOFF 3.5 + 3.6, PR 4).
//
//   const { stats } = useDishStats(myIds);   // parent/recipes.tsx, my-recipe/[id].tsx (ids: recipesByCook(entries, me))
//   const { hearts } = useHeartsRecent({ enabled: isCook });   // the updates card on the cook's Home
//
// One small module store per (person, ids), shared by every screen, like components/recipes/stats.ts,
// at most one fetch every 10 s per key. Dish stats refetch when a screen using them comes into focus
// and when the app comes back to the foreground on it, so a heart left a minute ago shows on the way
// back. Hearts (the cook's Home) also poll with the inbox while Home is focused and the app is in the
// foreground, like the card's "made" rows and questions: hearts send no push, so this is the only
// way they arrive. Offline or a server error keeps the last answer; a server without the PR 4
// routes yet answers nothing (lib/dishStatsApi), so the lines simply stay hidden.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { fetchDishStats, fetchHeartsRecent, type DishStats, type HeartRecent } from '@/lib/dishStatsApi';
import { INBOX_POLL_MS, usePolling } from '@/lib/messaging';
import { useSession } from '@/lib/session';

const MIN_GAP_MS = 10_000;

type Entry<T> = { value: T; at: number; ready: boolean };

/** A keyed store with one request in flight per key. */
function makeStore<T>(empty: T) {
  let snap: ReadonlyMap<string, Entry<T>> = new Map();
  const listeners = new Set<() => void>();
  const inflight = new Map<string, Promise<void>>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  const getSnap = () => snap;
  function load(key: string, run: () => Promise<T>, force = false): Promise<void> {
    const hit = snap.get(key);
    if (!force && hit && Date.now() - hit.at < MIN_GAP_MS) return Promise.resolve();
    const running = inflight.get(key);
    if (running) return running;
    const p = (async () => {
      let next: Entry<T>;
      try {
        next = { value: await run(), at: Date.now(), ready: true };
      } catch {
        next = { value: snap.get(key)?.value ?? empty, at: snap.get(key)?.at ?? 0, ready: true };
      }
      const m = new Map(snap);
      m.set(key, next);
      snap = m;
      for (const l of listeners) l();
    })().finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
  }
  return { subscribe, getSnap, load };
}

const statsStore = makeStore<DishStats>({});
const heartsStore = makeStore<HeartRecent[]>([]);

/**
 * GET /dish-stats for these dishes of mine. `stats` is null until the first answer; ids that aren't
 * my dishes never come back (the server answers only the dish's cook).
 */
export function useDishStats(ids: readonly string[]): { stats: DishStats | null; ready: boolean; refresh: () => Promise<void> } {
  const { me, status } = useSession();
  const owner = me?.id ?? null;
  const focused = useIsFocused();
  const idsKey = useMemo(() => [...new Set(ids)].sort().join(','), [ids]);
  const key = owner && idsKey ? `${owner}|${idsKey}` : null;
  const s = useSyncExternalStore(statsStore.subscribe, statsStore.getSnap, statsStore.getSnap);
  const run = useCallback(() => fetchDishStats(idsKey.split(','), { profileId: owner }), [idsKey, owner]);
  useEffect(() => {
    if (!key || !focused || status !== 'ready') return;
    void statsStore.load(key, run);
    // Back from the background on this screen: a fresh answer (the 10 s gap keeps it cheap).
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void statsStore.load(key, run);
    });
    return () => sub.remove();
  }, [key, focused, status, run]);
  const e = key ? s.get(key) : undefined;
  const refresh = useCallback(() => (key ? statsStore.load(key, run, true) : Promise.resolve()), [key, run]);
  return { stats: e?.value ?? null, ready: !!e?.ready, refresh };
}

/**
 * GET /hearts/recent (the last 14 days) for the acting person. Pass enabled: false for kids. Polls
 * with the inbox (INBOX_POLL_MS) while focused and in the foreground, and again on coming back from
 * the background; the 10 s gap per person means at most one request every ~16 s.
 */
export function useHeartsRecent({ enabled = true }: { enabled?: boolean } = {}): { hearts: HeartRecent[]; ready: boolean; refresh: () => Promise<void> } {
  const { me, status } = useSession();
  const owner = enabled ? (me?.id ?? null) : null;
  const focused = useIsFocused();
  const s = useSyncExternalStore(heartsStore.subscribe, heartsStore.getSnap, heartsStore.getSnap);
  const run = useCallback(() => fetchHeartsRecent(null, { profileId: owner }), [owner]);
  usePolling(() => (owner ? heartsStore.load(owner, run) : undefined), INBOX_POLL_MS, !!owner && focused && status === 'ready');
  const e = owner ? s.get(owner) : undefined;
  const hearts = useMemo(() => e?.value ?? [], [e]);
  const refresh = useCallback(() => (owner ? heartsStore.load(owner, run, true) : Promise.resolve()), [owner, run]);
  return { hearts, ready: !!e?.ready, refresh };
}

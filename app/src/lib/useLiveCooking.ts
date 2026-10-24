// The cook Home's side of "Leo is cooking your chili" (RETENTION-HANDOFF 3.1): who is cooking one of
// my dishes right now, for the live row on top of the updates card (components/cooking/LiveCookingRow).
//
//   const { rows } = useLiveCooking({ forId: isCook ? me.id : null });
//   rows.map((r) => <LiveCookingRow key={liveKey(r)} kid={r.profile} dish={dishName(entry.title, entry.cook_name)}
//     step={r.step} total={r.total} onHeart={() => cookingApi.sendHeart(r.profile.id, r.recipe_id)} />)
//
// GET /cooking now and every 15 s while the screen is focused and the app is in the foreground. The
// server sends only fresh rows (45 min) for kids who said yes; a row also drops here once it is 45 min
// old, so a lost connection never leaves a stale "is making" on screen. When the session ends the row
// goes on the next poll. A failed poll keeps what was there (minus stale rows); a server without the
// route yet shows nothing.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { cookingApi, CookingError } from './cookingApi';
import { freshLive, LIVE_POLL_MS, type LiveCooking } from './cookingLogic';

export type LiveCookingOptions = {
  /** Whose Home this is (a cook's profile id); null turns polling off and clears the rows. */
  forId: string | null | undefined;
  /** GET /cooking (default lib/cookingApi). */
  fetch?: () => Promise<readonly LiveCooking[]>;
  intervalMs?: number;
};

export type LiveCookingState = {
  rows: LiveCooking[];
  /** The first answer arrived (or failed) for this person. */
  ready: boolean;
  /** Ask now (e.g. right after sending a heart, or on pull-to-refresh). */
  refresh: () => Promise<void>;
};

type Snap = { forId: string | null; rows: LiveCooking[]; ready: boolean };

export function useLiveCooking(o: LiveCookingOptions): LiveCookingState {
  const forId = o.forId ?? null;
  const ms = o.intervalMs ?? LIVE_POLL_MS;
  const [snap, setSnap] = useState<Snap>({ forId: null, rows: [], ready: false });
  const fetchRef = useRef(o.fetch);
  useEffect(() => {
    fetchRef.current = o.fetch;
  });

  const load = useCallback(async () => {
    if (!forId) return;
    try {
      const list = await (fetchRef.current ?? cookingApi.live)();
      const rows = freshLive(Array.isArray(list) ? list : [], Date.now());
      setSnap({ forId, rows, ready: true });
    } catch (e) {
      // No route yet (an older server) or not allowed: nothing to show. Otherwise keep the rows.
      const gone = e instanceof CookingError && (e.status === 404 || e.status === 403);
      setSnap((s) => ({
        forId,
        rows: gone || s.forId !== forId ? [] : freshLive(s.rows, Date.now()),
        ready: true,
      }));
    }
  }, [forId]);

  const focused = useFocusedSafe();
  const [active, setActive] = useState(AppState.currentState !== 'background');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!forId || !focused || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      await load();
      if (!stopped) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [forId, focused, active, ms, load]);

  const mine = snap.forId === forId && !!forId;
  return { rows: mine ? snap.rows : [], ready: mine && snap.ready, refresh: load };
}

/** useIsFocused, but true outside a navigator. */
function useFocusedSafe(): boolean {
  try {
    return useIsFocused();
  } catch {
    return true;
  }
}

// Moving someone to a new phone (Dad lost his phone, joined again with a family link, and taps his
// own face): the new phone asks, anyone settled in the family (a day in, or the one who started it)
// lets him in from their own phone.
//
//   moveApi                  the five calls (lib/moveApi.ts: ask, mine, list, approve, decline), to the
//                            Supabase api off the switch and the AWS api under AWS_ON (1.1)
//   useMoveRequests()        the requests this person may answer, shared by the Home pop-up and the
//                            parent updates card; refreshed on open, on return to the app, every 3 s
//                            while a request waits (an answer anywhere closes it everywhere) and every
//                            30 s otherwise. Empty when this phone isn't its own person's
//                            (lent or shared), before their first day (session `canManage`), and
//                            when the server doesn't have the routes yet.
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { moveApi, type MoveRequest } from './moveApi';
import { useSession } from './session';

export { MoveError, moveApi, type MoveRequest, type MoveStatus, type MyMoveRequest } from './moveApi';

// --- The requests to answer: one small shared store -----------------------------------------
type Store = { forId: string | null; requests: MoveRequest[] };
let store: Store = { forId: null, requests: [] };
const listeners = new Set<() => void>();
const emit = (next: Store) => {
  store = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

let loading: Promise<void> | null = null;
async function load(forId: string) {
  if (loading) return loading;
  loading = moveApi
    .list()
    .then((list) => emit({ forId, requests: Array.isArray(list) ? list : [] }))
    // A server without the routes yet (404), offline, or not allowed: nothing to show.
    .catch(() => emit({ forId, requests: store.forId === forId ? store.requests : [] }))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Ask the server again (after a 409/410: answered elsewhere, or just a clash worth retrying). */
export function reloadMoveRequests(): Promise<void> {
  return store.forId ? load(store.forId) : Promise.resolve();
}

/** Drop a request once it's answered here (or someone else answered it). */
export function forgetMoveRequest(id: string) {
  emit({ ...store, requests: store.requests.filter((r) => r.id !== id) });
}

/** How often to ask: quickly while a request waits (so an answer anywhere closes it everywhere). */
const POLL_IDLE_MS = 30_000;
const POLL_PENDING_MS = 3_000;

/** The move requests this person may answer: only on their own phone, as themselves, once settled. */
export function useMoveRequests(): MoveRequest[] {
  const { me, owner, canManage } = useSession();
  const forId = canManage && me && owner && me.id === owner.id ? me.id : null;
  const snap = useSyncExternalStore(subscribe, () => store, () => store);
  const pending = forId && snap.forId === forId ? snap.requests.length > 0 : false;
  useEffect(() => {
    if (!forId) return;
    void load(forId);
    const t = setInterval(() => void load(forId), pending ? POLL_PENDING_MS : POLL_IDLE_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void load(forId);
    });
    return () => {
      clearInterval(t);
      sub.remove();
    };
  }, [forId, pending]);
  return forId && snap.forId === forId ? snap.requests : [];
}

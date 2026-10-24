// Moving someone to a new phone (Dad lost his phone, joined again with a family link, and taps his
// own face): the new phone asks, anyone settled in the family (a day in, or the one who started it)
// lets him in from their own phone.
//
//   moveApi.ask(profileId)   POST /move-requests            (the new phone; no person yet)
//   moveApi.mine()           GET  /move-requests/mine       (the new phone, while it waits)
//   moveApi.approve(id)      POST /move-requests/:id/approve (someone on their own phone)
//   moveApi.decline(id)      POST /move-requests/:id/decline
//   useMoveRequests()        the requests this person may answer, shared by the Home pop-up and the
//                            parent updates card; refreshed on open, on return to the app, every 3 s
//                            while a request waits (an answer anywhere closes it everywhere) and every
//                            30 s otherwise. Empty when this phone isn't its own person's
//                            (lent or shared), before their first day (session `canManage`), and
//                            when the server doesn't have the routes yet.
// The calls go through their own small fetch so lib/api.ts stays as it is; the headers are the
// same ones the api client sends (getApiAuth).
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { API_URL, getApiAuth, type Profile } from './api';
import { useSession } from './session';

export type MoveStatus = 'pending' | 'approved' | 'declined' | 'expired';
/**
 * `asked`: while pending, up to 3 names who can let this phone in ("Waiting for Mom or Dad");
 * `let_in_by`: who did, once approved. Both missing on older servers.
 */
export type MyMoveRequest = { id: string; profile_id: string; status: MoveStatus; asked?: string[]; let_in_by?: string | null };
export type MoveRequest = { id: string; profile: Profile; created_at: string };

export class MoveError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; asPerson?: boolean } = {}): Promise<T> {
  const auth = getApiAuth();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (auth.key) headers['x-device-key'] = auth.key;
  else if (auth.code) headers['x-family-code'] = auth.code;
  if (opts.asPerson && auth.profileId) headers['x-profile-id'] = auth.profileId;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new MoveError(0, 'Can’t reach your family right now. Try again.');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new MoveError(res.status, data?.error || 'Something went wrong. Try again.');
  return data as T;
}

export const moveApi = {
  ask: (profileId: string) => call<MyMoveRequest>('/move-requests', { method: 'POST', body: { profile_id: profileId } }),
  mine: () => call<MyMoveRequest | null>('/move-requests/mine'),
  approve: (id: string) => call<{ ok: true }>(`/move-requests/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {}, asPerson: true }),
  decline: (id: string) => call<{ ok: true }>(`/move-requests/${encodeURIComponent(id)}/decline`, { method: 'POST', body: {}, asPerson: true }),
};

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
  loading = call<MoveRequest[]>('/move-requests', { asPerson: true })
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

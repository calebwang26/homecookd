// GET /table for the Sunday table (RETENTION-HANDOFF 3.2): whose face is lit this week and the weeks
// in a row each kid & cook have kept. One small shared store, so the Home row, the chat header and the
// profile tiles read the same table without asking three times.
//
//   const { table, failed, refresh } = useTable();  // table: null until it loads, or when the server
//                                                    // can't say; failed: it answered with nothing usable
//   tableApi.get(personId)                       // one call, no store (null: faces only)
//   invalidateTable()                            // after something that can light a face (a send, "I made
//                                                // it", a listen): the next mount or focus asks again
//
// Asked on first use, when the person changes, when the screen comes back into focus or the app to
// the foreground (at most every 10 s unless forced), and after invalidateTable(). Never polled: a week
// changes slowly. A server without the route yet (404), offline, or junk: the last table stays (null
// at first), so the row stays hidden rather than showing made-up flames; with no table at all,
// `failed` says so (the kid Home stops holding room for a row that isn't coming). With no one picked (the
// Profiles screen) the call goes without x-profile-id and the table has faces only, no pairs.
//
// The call goes through its own small fetch so lib/api.ts stays as it is; the headers are the ones
// the api client sends (getApiAuth), plus x-tz so the server frames the week in this phone's zone
// (getApiTimeZone, like lib/cookingApi.ts: none while the web `?as=` dev aid borrows the build's
// code, so a screenshot never stores a zone on that family's profile).
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { API_URL, getApiAuth, getApiTimeZone } from './api';
import { useSession } from './session';
import { asTable, type Table } from './sundayTable';

export type { Table, TablePair, TablePerson } from './sundayTable';

const TIMEOUT_MS = 10_000;
const FRESH_MS = 10_000;

// A plain field, not a parameter property, so scripts/test-table.mjs can load this file under Node.
export class TableError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** GET /table as `personId` (pairs included), or faces only when null. */
async function getTable(personId: string | null): Promise<Table | null> {
  const auth = getApiAuth();
  const headers: Record<string, string> = { accept: 'application/json' };
  const tz = getApiTimeZone();
  if (tz) headers['x-tz'] = tz;
  if (auth.key) headers['x-device-key'] = auth.key;
  else if (auth.code) headers['x-family-code'] = auth.code;
  else throw new TableError(0, 'Not signed in');
  // The person the store files this answer under, never whoever the api client points at right now.
  if (personId) headers['x-profile-id'] = personId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/table`, { headers, signal: ctrl.signal });
  } catch {
    throw new TableError(0, 'Can’t reach your family right now.');
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as (Table & { error?: string }) | null;
  if (!res.ok) throw new TableError(res.status, data?.error || 'Something went wrong.');
  return asTable(data);
}

export const tableApi = {
  /** GET /table as `personId` (default: the api client's picked person), pairs included; null: faces only. */
  get: (personId: string | null = getApiAuth().profileId) => getTable(personId),
};

// --- One shared table -----------------------------------------------------------------------------

/** `failed`: the last ask for `key` ended with no table on hand (an error, a 404, junk). */
type Store = { key: string | null; table: Table | null; at: number; stale: boolean; failed: boolean };
let store: Store = { key: null, table: null, at: 0, stale: true, failed: false };
const listeners = new Set<() => void>();
const emit = (next: Store) => {
  store = next;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A short one-way fingerprint, so the store can tell families apart without holding the credential. */
function fingerprint(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Whose table: the family credential & the picked person (a shared phone switches people). */
function currentKey(personId: string | null): string | null {
  const a = getApiAuth();
  const cred = a.key ?? a.code;
  return cred ? `${fingerprint(cred)}:${personId ?? '-'}` : null;
}

let inflight: { key: string; p: Promise<Table | null> } | null = null;
/**
 * Whose table was asked for last. A shared phone that switches people can have two answers in the
 * air; only the latest person's may land in the store, so a late answer for the one before never
 * overwrites it (and never blanks the row, which would wait for the next focus to ask again).
 */
let wanted: string | null = null;

/** Ask the server now (or reuse a fresh answer). Never throws; resolves to the table on hand. */
export async function refreshTable(personId: string | null, opts: { force?: boolean } = {}): Promise<Table | null> {
  const key = currentKey(personId);
  if (!key) return null;
  wanted = key;
  const same = store.key === key;
  if (same && !opts.force && !store.stale && Date.now() - store.at < FRESH_MS) return store.table;
  if (inflight?.key === key) return inflight.p;
  const p = getTable(personId)
    .then((table) => {
      if (wanted === key) emit({ key, table, at: Date.now(), stale: false, failed: !table });
      return table;
    })
    .catch(() => {
      // Keep what we had for this person (offline, or no route yet); a new person starts empty.
      if (wanted === key) {
        if (store.key !== key) emit({ key, table: null, at: 0, stale: true, failed: true });
        else if (!store.table && !store.failed) emit({ ...store, failed: true });
      }
      return store.key === key ? store.table : null;
    })
    .finally(() => {
      if (inflight?.p === p) inflight = null;
    });
  inflight = { key, p };
  return p;
}

/** Something that can light a face just happened: the next mount, focus or refresh asks again. */
export function invalidateTable() {
  if (!store.stale) emit({ ...store, stale: true });
}

/** useIsFocused, but true outside a navigator (a sheet rendered at the root). */
function useFocusedSafe(): boolean {
  try {
    return useIsFocused();
  } catch {
    return true;
  }
}

/**
 * The family's table for whoever is picked (faces only when no one is). `enabled: false` reads the
 * store without asking. `failed`: no table, and the last ask ended without one (offline, an older
 * server's 404, junk); false while the first answer is on its way. `refresh()` forces a fresh answer
 * (pull to refresh, after a send).
 */
export function useTable(opts: { enabled?: boolean } = {}): { table: Table | null; failed: boolean; refresh: () => Promise<Table | null> } {
  const enabled = opts.enabled ?? true;
  const { me } = useSession();
  const personId = me?.id ?? null;
  const focused = useFocusedSafe();
  const snap = useSyncExternalStore(subscribe, () => store, () => store);
  const key = currentKey(personId);
  const stale = snap.stale;

  useEffect(() => {
    if (!enabled || !focused) return;
    void refreshTable(personId);
  }, [enabled, focused, personId, stale]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshTable(personId);
    });
    return () => sub.remove();
  }, [enabled, personId]);

  const refresh = useCallback(() => refreshTable(personId, { force: true }), [personId]);
  const mine = !!key && snap.key === key;
  return { table: mine ? snap.table : null, failed: mine && !snap.table && snap.failed, refresh };
}

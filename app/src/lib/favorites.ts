// Hearted dishes, stored on the server per profile (GET/POST /favorites) and shared by every screen.
//
//   const fav = useFavorites();
//   fav.isFav(recipeId); fav.toggle(recipeId); fav.ids (newest first); fav.ready
//
// One module store: a heart tapped anywhere shows everywhere at once. Taps are optimistic; each
// dish's requests run one after another, only the latest wish is sent, and a failed one rolls that
// dish back to what the server last said. The list is cached per profile on the device, so hearts
// show instantly (and offline) before the server answers.
//
// Hearts saved on the device before favorites lived on the server (`saved.<profileId>`) are sent up
// once, then the old key is cleared (a dish the server no longer has is dropped, not retried).
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { api, ApiError } from './api';
import { useSession } from './session';
import { kvGetJson, kvSet, kvSetJson } from './storage';

/** Refetch on mount at most this often (pull to refresh forces it). */
const TTL_MS = 60_000;

type Pending = { on: boolean; seq: number };
type Owner = {
  /** What the server last said, newest first. */
  confirmed: string[];
  /** Taps not yet confirmed, by recipe. */
  pending: Map<string, Pending>;
  /** Server list or device cache loaded. */
  ready: boolean;
  fetchedAt: number;
  /** Bumped by every confirmed POST, so a GET that started earlier can't undo it. */
  writes: number;
};
type Snap = { owners: ReadonlyMap<string, Owner> };

let snap: Snap = { owners: new Map() };
const listeners = new Set<() => void>();
const inflight = new Map<string, Promise<void>>();
const chains = new Map<string, Promise<void>>(); // `${owner}:${recipe}` -> request chain
let seq = 0;

function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnap = () => snap;

function ownerState(owner: string): Owner {
  return snap.owners.get(owner) ?? { confirmed: [], pending: new Map(), ready: false, fetchedAt: 0, writes: 0 };
}
function writeOwner(owner: string, next: Partial<Owner>) {
  const owners = new Map(snap.owners);
  owners.set(owner, { ...ownerState(owner), ...next });
  snap = { owners };
  emit();
}

/** The hearts as shown: the server's list with pending taps applied (a new heart goes first). */
function visibleIds(o: Owner): string[] {
  if (!o.pending.size) return o.confirmed;
  const on = [...o.pending].filter(([, p]) => p.on).map(([id]) => id);
  const off = new Set([...o.pending].filter(([, p]) => !p.on).map(([id]) => id));
  const rest = o.confirmed.filter((id) => !off.has(id) && !on.includes(id));
  return [...on.reverse(), ...rest];
}

const cacheKey = (owner: string) => `favorites.${owner}`;
const legacyKey = (owner: string) => `saved.${owner}`;

function persist(owner: string) {
  void kvSetJson(cacheKey(owner), ownerState(owner).confirmed);
}

/** Load (or refresh) one profile's hearts: device cache first, then the server. */
function load(owner: string, force = false): Promise<void> {
  const cur = ownerState(owner);
  if (!force && cur.fetchedAt && Date.now() - cur.fetchedAt < TTL_MS) return Promise.resolve();
  const running = inflight.get(owner);
  if (running) return running;
  const p = (async () => {
    if (!ownerState(owner).ready) {
      const cached = await kvGetJson<string[]>(cacheKey(owner));
      if (Array.isArray(cached) && !ownerState(owner).ready) {
        writeOwner(owner, { confirmed: cached.filter((x) => typeof x === 'string'), ready: true });
      }
    }
    const writes = ownerState(owner).writes;
    try {
      const res = await api.favorites({ profileId: owner });
      const ids = Array.isArray(res.recipe_ids) ? res.recipe_ids.filter((x) => typeof x === 'string') : [];
      // A heart was saved while this was loading: this list may predate it. Ask again next time.
      if (ownerState(owner).writes !== writes) {
        writeOwner(owner, { ready: true, fetchedAt: 0 });
        return;
      }
      writeOwner(owner, { confirmed: ids, ready: true, fetchedAt: Date.now() });
      persist(owner);
      void migrateLegacy(owner, ids);
    } catch {
      // Offline or the server said no: keep the cached hearts and try again on the next load.
      if (!ownerState(owner).ready) writeOwner(owner, { ready: true });
    }
  })().finally(() => {
    if (inflight.get(owner) === p) inflight.delete(owner);
  });
  inflight.set(owner, p);
  return p;
}

const migrated = new Set<string>();
/** Hearts from the old device-only list go up once (only the ones the server doesn't have). */
async function migrateLegacy(owner: string, server: string[]) {
  if (migrated.has(owner)) return;
  migrated.add(owner);
  const old = await kvGetJson<string[]>(legacyKey(owner));
  if (!Array.isArray(old) || !old.length) return;
  const have = new Set(server);
  const todo = old.filter((id) => typeof id === 'string' && !have.has(id));
  // Oldest first, so the server keeps the same newest-first order.
  const results = await Promise.all([...todo].reverse().map((id) => send(owner, id, true)));
  // A dish that is gone (404) or an id the server can't read (400) will never succeed: count it done.
  const done = results.every((r) => r === null || (r instanceof ApiError && (r.status === 404 || r.status === 400)));
  if (done) void kvSet(legacyKey(owner), null);
  else migrated.delete(owner);
}

/** Heart or un-heart `recipeId` for `owner`. Resolves false if the server didn't take it. */
export function setFavorite(owner: string, recipeId: string, on: boolean): Promise<boolean> {
  return send(owner, recipeId, on).then((err) => err === null);
}

/** setFavorite's work: resolves null on success, else the error the server (or network) gave. */
function send(owner: string, recipeId: string, on: boolean): Promise<Error | null> {
  const mine = ++seq;
  const o = ownerState(owner);
  const pending = new Map(o.pending);
  pending.set(recipeId, { on, seq: mine });
  writeOwner(owner, { pending });

  const key = `${owner}:${recipeId}`;
  let failure: Error | null = null;
  const run = async () => {
    // A newer tap on this dish replaced this one; that one will be sent instead.
    if (ownerState(owner).pending.get(recipeId)?.seq !== mine) return;
    // Tapped back to what the server already has (on, off, on...): nothing to send.
    const before = ownerState(owner);
    if (before.ready && before.fetchedAt && before.confirmed.includes(recipeId) === on) {
      const next = new Map(before.pending);
      next.delete(recipeId);
      writeOwner(owner, { pending: next });
      return;
    }
    try {
      await api.setFavorite(recipeId, on, { profileId: owner });
      const now = ownerState(owner);
      const confirmed = on ? [recipeId, ...now.confirmed.filter((x) => x !== recipeId)] : now.confirmed.filter((x) => x !== recipeId);
      const next = new Map(now.pending);
      if (next.get(recipeId)?.seq === mine) next.delete(recipeId);
      writeOwner(owner, { confirmed, pending: next, writes: now.writes + 1 });
      persist(owner);
    } catch (e) {
      failure = e instanceof Error ? e : new Error('favorite failed');
      const now = ownerState(owner);
      if (now.pending.get(recipeId)?.seq === mine) {
        const next = new Map(now.pending);
        next.delete(recipeId); // back to what the server last said
        writeOwner(owner, { pending: next });
      }
    }
  };
  const chained = (chains.get(key) ?? Promise.resolve()).then(run);
  chains.set(key, chained);
  void chained.finally(() => {
    if (chains.get(key) === chained) chains.delete(key);
  });
  return chained.then(() => failure);
}

/** Pull to refresh: refetch this profile's hearts now. */
export function refreshFavorites(owner: string | null | undefined): Promise<void> {
  return owner ? load(owner, true) : Promise.resolve();
}

export type Favorites = {
  /** Hearted dishes, newest first. */
  ids: string[];
  isFav: (recipeId: string) => boolean;
  /** Flip the heart. Resolves to false if the server didn't take it (the heart is already rolled back). */
  toggle: (recipeId: string) => Promise<boolean>;
  /** The list for this profile is known (from the server or the device cache). */
  ready: boolean;
  refresh: () => Promise<void>;
};

export function useFavorites(): Favorites {
  const { me, status } = useSession();
  const owner = me?.id ?? null;
  const s = useSyncExternalStore(subscribe, getSnap, getSnap);

  useEffect(() => {
    if (owner && (status === 'ready' || status === 'offline')) void load(owner);
  }, [owner, status]);

  const o = owner ? s.owners.get(owner) : undefined;
  const ids = useMemo(() => (o ? visibleIds(o) : []), [o]);
  const set = useMemo(() => new Set(ids), [ids]);
  const isFav = useCallback((id: string) => set.has(id), [set]);
  const toggle = useCallback(
    (id: string) => (owner ? setFavorite(owner, id, !visibleIds(ownerState(owner)).includes(id)) : Promise.resolve(false)),
    [owner],
  );
  const refresh = useCallback(() => refreshFavorites(owner), [owner]);
  return { ids, isFav, toggle, ready: !!o?.ready, refresh };
}

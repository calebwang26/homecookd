// The two doors' gate for parent/_layout (the decision itself: lib/doorsGate.ts).
//   const doors = useDoorsGate();
//   doors.show      the doors are up
//   doors.seen()    she tapped a door: never again for her on this phone (the doors stay up, e.g. under the sheet)
//   doors.done()    the same, and Home takes their place
// Dev aid (web screenshots only): `?preview=doors` shows them, seen or not, until a tap.
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { doorsDecision, doorsSeenKey } from '@/lib/doorsGate';
import { useLive } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { kvGet, kvSet } from '@/lib/storage';

const PREVIEW = __DEV__ && Platform.OS === 'web' && /[?&]preview=doors\b/.test(globalThis.location?.search ?? '');

// The stub has no family rows: the lists never come, so nothing is decided (no doors).
const never = () => () => {};

/**
 * useLive keeps its last value through a change of person or family: only a value that arrives after `key`
 * last changed is this person's (the same rule as lib/recipes useFamilyLibrary). Null until then.
 */
function useFresh<T>(value: T | null, key: string | null): T | null {
  const [since, setSince] = useState({ key, value });
  if (since.key !== key) setSince({ key, value });
  return since.key === key && value !== since.value ? value : null;
}

export function useDoorsGate(): { show: boolean; seen: () => void; done: () => void } {
  const { me, family } = useSession();
  const id = me?.id ?? null;
  const cook = me?.role === 'cook';
  const [seen, setSeen] = useState<{ profileId: string; seen: boolean } | null>(null);

  useEffect(() => {
    if (!id || !cook) return;
    let live = true;
    void kvGet(doorsSeenKey(id)).then((v) => {
      if (live) setSeen({ profileId: id, seen: !PREVIEW && v === '1' });
    });
    return () => {
      live = false;
    };
  }, [id, cook]);

  // Ask Convex only while the doors could still show for her.
  const open = cook && !!id && seen?.profileId === id && !seen.seen;
  const key = id && family ? `${family.id}:${id}` : null;
  const recipes = useFresh(useLive<unknown[] | null>('recipes:list', null, never, open), key);
  const jobs = useFresh(useLive<unknown[] | null>('jobs:mine', null, never, open, {}, true), key);

  const decision = doorsDecision({
    me,
    seen,
    recipes: PREVIEW ? [] : recipes,
    jobs: PREVIEW ? [] : jobs,
  });

  const seenNow = useCallback(() => {
    if (id) void kvSet(doorsSeenKey(id), '1');
  }, [id]);
  const done = useCallback(() => {
    if (!id) return;
    void kvSet(doorsSeenKey(id), '1');
    setSeen({ profileId: id, seen: true });
  }, [id]);

  return { show: decision === 'show', seen: seenNow, done };
}

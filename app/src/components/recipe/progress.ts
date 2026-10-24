// Per-profile, per-recipe cooking progress kept on the device:
//   useChecklist(recipeId)  - which ingredients are set out (Kid-Ingredients), as ingredient keys
//   useLastStep(recipeId)   - the furthest step cook mode reached (looking back never lowers it), so
//                             "Start cooking" can become "Back to step 4" and the step screen resumes there
// Stored with kv (AsyncStorage / localStorage) under `checklist.<profile>.<recipe>` and
// `step.<profile>.<recipe>`. Reads never block a render: state starts empty and fills in.
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useSession } from '@/lib/session';
import { kvGetJson, kvSetJson } from '@/lib/storage';
import type { Ingredient } from '@/lib/types';

type Entry<T> = { value: T; loaded: boolean };

const store = new Map<string, Entry<unknown>>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function useKv<T>(key: string | null, fallback: T): [T, boolean, (next: T) => void] {
  useSyncExternalStore(subscribe, () => version, () => version);
  useEffect(() => {
    if (!key || store.has(key)) return;
    store.set(key, { value: fallback, loaded: false });
    kvGetJson<T>(key).then((v) => {
      const cur = store.get(key);
      // A write that happened while loading wins.
      if (cur && !cur.loaded) store.set(key, { value: v ?? fallback, loaded: true });
      emit();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const entry = key ? (store.get(key) as Entry<T> | undefined) : undefined;
  const write = useCallback(
    (next: T) => {
      if (!key) return;
      store.set(key, { value: next, loaded: true });
      emit();
      void kvSetJson(key, next);
    },
    [key],
  );
  return [entry ? entry.value : fallback, !!entry?.loaded, write];
}

/** Stable key for an ingredient row (its place + name, so a renamed list never mixes up ticks). */
export function ingredientKey(ing: Ingredient, index: number): string {
  return `${index}:${(ing.name ?? '').trim().toLowerCase()}`;
}

const EMPTY: string[] = [];

export function useChecklist(recipeId: string | null | undefined) {
  const { me } = useSession();
  const key = me && recipeId ? `checklist.${me.id}.${recipeId}` : null;
  const [done, loaded, write] = useKv<string[]>(key, EMPTY);
  const toggle = useCallback(
    (k: string) => {
      const on = !done.includes(k);
      write(on ? [...done, k] : done.filter((x) => x !== k));
      return on;
    },
    [done, write],
  );
  const has = useCallback((k: string) => done.includes(k), [done]);
  return { done, has, toggle, loaded, clear: () => write(EMPTY) };
}

/** The furthest step (1-based) this profile reached in a recipe; 0 when none. */
export function useLastStep(recipeId: string | null | undefined) {
  const { me } = useSession();
  const key = me && recipeId ? `step.${me.id}.${recipeId}` : null;
  const [step, loaded, write] = useKv<number>(key, 0);
  return { step: typeof step === 'number' && step > 0 ? step : 0, loaded, setStep: write };
}

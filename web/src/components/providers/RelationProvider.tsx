'use client';
// "Cooking with" personalization (brief 4.4).
//   const { relation, label, explicit, setRelation } = useRelation();
//   const h2 = explicit ? fill(copy.finalCta.h2Explicit, relation) : copy.finalCta.h2Default;
//   const r = useFill();  r('Send this to {R}')  → 'Send this to Grandma'
//
// SSR renders the default (Grandma, explicit = false). On mount: ?for=<relation>, then
// localStorage['homecookd.relation'], then the default. setRelation() writes both and marks explicit.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Relation } from '@/content/types';
import type { Audience } from '@/content/audience';
import {
  DEFAULT_RELATION,
  STORAGE_KEY,
  STORAGE_KEY_PARENT,
  fill,
  labelOf,
  readStoredRelation,
  writeStoredRelation,
} from '@/lib/relation';

export interface RelationCtx {
  relation: Relation;
  label: string;
  explicit: boolean;
  setRelation: (r: Relation) => void;
}

const Ctx = createContext<RelationCtx>({
  relation: DEFAULT_RELATION,
  label: labelOf(DEFAULT_RELATION),
  explicit: false,
  setRelation: () => {},
});

export function RelationProvider({ audience = 'kid', children }: { audience?: Audience; children: ReactNode }) {
  // /learn: who the visitor cooks with; /teach: the visitor's own role (lib/relation STORAGE_KEY*)
  const key = audience === 'parent' ? STORAGE_KEY_PARENT : STORAGE_KEY;
  const [state, setState] = useState<{ relation: Relation; explicit: boolean }>({
    relation: DEFAULT_RELATION,
    explicit: false,
  });

  useEffect(() => {
    const stored = readStoredRelation(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only read after SSR (static export)
    if (stored) setState({ relation: stored, explicit: true });
  }, [key]);

  const setRelation = useCallback(
    (r: Relation) => {
      writeStoredRelation(r, key);
      setState({ relation: r, explicit: true });
    },
    [key],
  );

  const value = useMemo(
    () => ({ relation: state.relation, label: labelOf(state.relation), explicit: state.explicit, setRelation }),
    [state, setRelation],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRelation(): RelationCtx {
  return useContext(Ctx);
}

/** Returns a fill() bound to the current relation. */
export function useFill(): (s: string, extra?: Record<string, string>) => string {
  const { relation } = useRelation();
  return useCallback((s: string, extra?: Record<string, string>) => fill(s, relation, extra), [relation]);
}

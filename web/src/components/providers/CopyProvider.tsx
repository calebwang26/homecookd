'use client';
// Which version of the lander this page is, and its words (src/content/audience.ts).
//   const copy = useCopy();          // copy.ts on /learn, copy.parent.ts on /teach
//   const audience = useAudience();  // 'kid' | 'parent'
// Outside a provider (e.g. a stray test render) it falls back to the kid version.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Audience } from '@/content/audience';
import { getCopy } from '@/content/copies';
import type { Copy } from '@/content/copy';

interface CopyCtx {
  audience: Audience;
  copy: Copy;
}

const Ctx = createContext<CopyCtx>({ audience: 'kid', copy: getCopy('kid') });

export function CopyProvider({ audience, children }: { audience: Audience; children: ReactNode }) {
  const value = useMemo(() => ({ audience, copy: getCopy(audience) }), [audience]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopy(): Copy {
  return useContext(Ctx).copy;
}

export function useAudience(): Audience {
  return useContext(Ctx).audience;
}

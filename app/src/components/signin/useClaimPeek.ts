// "Are you Leo?" on a family join link's card (docs/build/JOIN-SIMPLE.md): while `on`, once the typed name
// settles (400 ms), peek at the link again with it. The server answers the one person of exactly that name
// who has no phone yet, or null; it never lists names. `settle` is the same question on the sign-in tap,
// for a name typed faster than the debounce. A failed peek just asks nothing (the sign-in still works).
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { nameKey, type ClaimFound } from '@/lib/auth/join';

const SETTLE_MS = 400;

export function useClaimPeek(token: string | null, name: string, on: boolean) {
  const [found, setFound] = useState<ClaimFound | null>(null);
  const key = nameKey(name);

  const peek = useCallback(
    async (k: string, signal?: AbortSignal): Promise<ClaimFound | null> => {
      if (!token || !k) return null;
      try {
        const res = await api.invitePeek(token, { name: k, signal });
        return { name: k, claimable: res.claimable ?? null };
      } catch {
        return null;
      }
    },
    [token],
  );

  useEffect(() => {
    if (!on || !key) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void peek(key, ctrl.signal).then((f) => {
        if (f && !ctrl.signal.aborted) setFound(f);
      });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [on, key, peek]);

  /** On the sign-in tap: the answer for this name, asking now when the settled one isn't back. */
  const settle = useCallback(
    async (typed: string): Promise<ClaimFound | null> => {
      const k = nameKey(typed);
      if (!on || !k) return null;
      if (found?.name === k) return found;
      const f = await peek(k);
      if (f) setFound(f);
      return f;
    },
    [on, found, peek],
  );

  return { found: on ? found : null, settle };
}

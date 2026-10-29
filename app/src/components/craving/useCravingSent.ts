// Whether this person has shared the craving link once on this phone (lib/cravings cravingSent), live: Home swaps
// "Ask what they're craving" (CravingAskCard) for "Sent!" (CravingSentCard) the moment she taps an app.
//   const sent = useCravingSent(me?.id);   null while it's read, then true / false
//   markCravingSent(profileId)            noteCravingSent, and every useCravingSent hears it at once
import { useEffect, useSyncExternalStore } from 'react';

import { cravingSent, noteCravingSent } from '@/lib/cravings';

const known = new Map<string, boolean>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
function set(profileId: string, sent: boolean) {
  known.set(profileId, sent);
  listeners.forEach((l) => l());
}

/** She tapped an app in the craving share row. */
export function markCravingSent(profileId: string): Promise<void> {
  set(profileId, true);
  return noteCravingSent(profileId);
}

export function useCravingSent(profileId: string | null | undefined): boolean | null {
  const value = useSyncExternalStore(
    subscribe,
    () => (profileId ? (known.get(profileId) ?? null) : null),
    () => null,
  );
  useEffect(() => {
    if (!profileId || known.has(profileId)) return;
    void cravingSent(profileId).then((sent) => {
      if (!known.has(profileId)) set(profileId, sent);
    });
  }, [profileId]);
  return value;
}

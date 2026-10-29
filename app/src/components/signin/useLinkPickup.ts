// The first screen's invisible pickup (docs/build/JOIN-SIMPLE.md §2): while `on` (signed out, on the
// first screen's start, nothing else going on), when the screen opens and whenever the app comes back to
// the front, a join link on the clipboard opens its screen (/i?t=…, /miss?k=… or /a?t=…). iOS only:
// hasUrlAsync asks without reading. lib/auth/pickup reads at most once per launch and leaves anything
// else alone, silently. No button anywhere.
import * as Clipboard from 'expo-clipboard';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { pickUpLink, type PickupClipboard } from '@/lib/auth';

const CLIPBOARD: PickupClipboard = {
  hasUrl: () => Clipboard.hasUrlAsync(),
  readUrl: () => Clipboard.getUrlAsync(),
  readText: () => Clipboard.getStringAsync(),
};

export function useLinkPickup(on: boolean): void {
  useEffect(() => {
    if (!on || Platform.OS !== 'ios') return;
    let alive = true;
    const look = () =>
      void pickUpLink(CLIPBOARD).then((href) => {
        if (alive && href) router.push(href as Href);
      });
    look();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') look();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [on]);
}

// Dev-only breadcrumbs on the share path, so a crash log (Metro terminal) shows how far it got:
//   WARN  [share] 3 +41ms sheet: modal shown
// Numbered per open; the time is since that open. Hidden from the phone's LogBox (they are a
// trail, not a problem) but still printed to Metro. Nothing runs in production builds.
import { LogBox, Platform } from 'react-native';

if (__DEV__ && Platform.OS !== 'web') {
  try {
    LogBox.ignoreLogs(['[share]']);
  } catch {}
}

let step = 0;
let t0 = 0;

/** Start a fresh trail (one per open). */
export function trailStart(what: string) {
  if (!__DEV__) return;
  step = 0;
  t0 = Date.now();
  trail(what);
}

export function trail(what: string, extra?: unknown) {
  if (!__DEV__) return;
  step += 1;
  const msg = `[share] ${step} +${t0 ? Date.now() - t0 : 0}ms ${what}`;
  if (extra === undefined) console.warn(msg);
  else console.warn(msg, extra);
}

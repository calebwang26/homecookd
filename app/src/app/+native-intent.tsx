// Every link that opens the app passes through here first (expo-router). A store build changes nothing.
//
// CI simulator journeys only (EXPO_PUBLIC_E2E=1): `homecookd://e2e/sign-in?key=<device key>` signs this
// simulator in as a staging test person. The harness calls staging's /v1/test/sign-in itself (it holds
// TEST_SIGNIN_KEY; this app never does) and hands over only the device key it got back; the session adopts
// it as it would a Sign in with Apple. The check is written inline, not as an imported constant, so a store
// build folds it to false and drops the branch, string and all (scripts/check-e2e-stripped.mjs proves it).
import { adoptDeviceKeyForE2E } from '@/lib/session';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (process.env.EXPO_PUBLIC_E2E === '1' && path.includes('e2e/sign-in')) {
    const key = /[?&]key=([^&#]+)/.exec(path)?.[1];
    if (key) adoptDeviceKeyForE2E(decodeURIComponent(key));
    return '/';
  }
  return path;
}

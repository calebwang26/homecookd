// Sign in with Apple (expo-apple-authentication). iOS only: it works in Expo Go and in real builds;
// on Android and the web it is unavailable and the button stays hidden.
//
//   if (await apple.isAvailable()) {
//     const r = await apple.signIn(); // null = they closed the sheet; throws SignInError otherwise
//   }
//
// Asks for the full name only. Apple shares it on the very first sign-in and never again, so it is
// only a suggestion for "What does your family call you?". The id token goes straight to
// POST /auth/apple; it is never stored or logged.
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { nativeCode, SignInError, type ProviderSignIn } from './types';

const DIDNT_FINISH = 'Apple sign-in didn’t finish. Try again.';

/** True on an iPhone or iPad that can show the Apple sheet. */
export async function isAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** The name a family would use: a nickname, else the given name, else whatever Apple formats. */
function preferredName(n: AppleAuthentication.AppleAuthenticationFullName | null): string | null {
  if (!n) return null;
  const pick = (n.nickname || n.givenName || '').trim();
  if (pick) return pick;
  try {
    return AppleAuthentication.formatFullName(n, 'short').trim() || null;
  } catch {
    return null;
  }
}

/** Shows the Apple sheet. Resolves null when they cancel it. */
export async function signIn(): Promise<ProviderSignIn | null> {
  if (!(await isAvailable())) throw new SignInError('Sign in with Apple isn’t available on this phone.');
  let cred: AppleAuthentication.AppleAuthenticationCredential;
  try {
    cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
    });
  } catch (e) {
    if (nativeCode(e) === 'ERR_REQUEST_CANCELED') return null;
    throw new SignInError(DIDNT_FINISH);
  }
  if (!cred.identityToken) throw new SignInError(DIDNT_FINISH);
  return { idToken: cred.identityToken, name: preferredName(cred.fullName) };
}

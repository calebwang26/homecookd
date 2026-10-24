// Sign in with Google (@react-native-google-signin/google-signin), for Android and anyone without an
// Apple ID. The native module is in dev and store builds but not in Expo Go or on the web, so it is
// required lazily, only once TurboModuleRegistry says it exists, inside try/catch: Expo Go never
// crashes, the button just stays hidden.
//
//   if (google.isAvailable()) {
//     const r = await google.signIn(); // null = they cancelled; throws SignInError otherwise
//   }
//
// Needs EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID on Android, and on iOS EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID plus
// the URL scheme app.config.ts adds to the build (`extra.googleSignIn`). The server checks the id
// token's audience against GOOGLE_CLIENT_IDS.
// TODO(caleb): create the Google OAuth clients (web, iOS, Android) and set those values.
// After each sign-in the Google session is dropped again: homecookd keeps only its own device key,
// and the next sign-in asks which account to use. The id token is never stored or logged.
import Constants from 'expo-constants';
import { Platform, TurboModuleRegistry } from 'react-native';

import { nativeCode, SignInError, type ProviderSignIn } from './types';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

const WEB_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
const IOS_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim();
const DIDNT_FINISH = 'Google sign-in didn’t finish. Try again.';

let loaded: GoogleModule | null | undefined;
let configured = false;

/** The JS module, or null when this build has no native Google sign-in (Expo Go, web). */
function load(): GoogleModule | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  try {
    if (Platform.OS !== 'web' && TurboModuleRegistry.get('RNGoogleSignin')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose (see the top)
      loaded = require('@react-native-google-signin/google-signin') as GoogleModule;
    }
  } catch {
    loaded = null;
  }
  return loaded;
}

/** The client ids (and, on iOS, the URL scheme) this platform needs are in the build. */
function configuredHere(): boolean {
  if (Platform.OS === 'android') return !!WEB_CLIENT_ID;
  if (Platform.OS === 'ios') return !!IOS_CLIENT_ID && Constants.expoConfig?.extra?.googleSignIn === true;
  return false;
}

/** True when the Google button can work on this phone. Synchronous, so it can decide a first render. */
export function isAvailable(): boolean {
  return configuredHere() && !!load();
}

/** Shows Google's account picker. Resolves null when they cancel it. */
export async function signIn(): Promise<ProviderSignIn | null> {
  const mod = isAvailable() ? load() : null;
  if (!mod) throw new SignInError('Google sign-in isn’t set up on this phone yet. Try Apple or a family code.');
  const { GoogleSignin, statusCodes } = mod;
  try {
    if (!configured) {
      GoogleSignin.configure({ webClientId: WEB_CLIENT_ID || undefined, iosClientId: IOS_CLIENT_ID || undefined });
      configured = true;
    }
    if (Platform.OS === 'android' && !(await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true }))) {
      throw new SignInError('This phone needs Google Play to sign in with Google. Try a family code instead.');
    }
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') return null;
    if (!res.data.idToken) throw new SignInError(DIDNT_FINISH);
    const { givenName, name } = res.data.user;
    return { idToken: res.data.idToken, name: (givenName || name || '').trim() || null };
  } catch (e) {
    if (e instanceof SignInError) throw e;
    const code = nativeCode(e);
    // A second tap while the picker is already up counts as nothing happening.
    if (code === statusCodes.SIGN_IN_CANCELLED || code === statusCodes.IN_PROGRESS) return null;
    if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new SignInError('This phone needs Google Play to sign in with Google. Try a family code instead.');
    }
    throw new SignInError(DIDNT_FINISH);
  } finally {
    GoogleSignin.signOut().catch(() => {});
  }
}

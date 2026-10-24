// Expo config: everything in app.json, plus what two-sided sign-in needs (docs/build/FEEDBACK-OCT16c.md
// B1) and what depends on the build's environment. Plain settings stay in app.json.
//   - Sign in with Apple: the capability and its plugin.
//   - Universal links: https://homecookd.app/i and /r open the app (the AASA file lives in
//     web/public/.well-known).
//   - Google sign-in: its plugin only registers the iOS URL scheme, and prebuild fails without one,
//     so it is added only when GOOGLE_IOS_URL_SCHEME is set (or EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
//     which the scheme is derived from). `extra.googleSignIn` tells lib/auth/google.ts the scheme is
//     in this build: tapping Google without it would crash the app.
//   - Contacts: the "+ Add family" picker needs no prompt on iOS, but the purpose string still ships,
//     so it is in plain words.
//   - LSApplicationQueriesSchemes: canOpenURL answers for WhatsApp and Instagram in store builds
//     (the share sheets' app row; Expo Go still says false, so WhatsApp stays hidden there).
//   - Push (docs/build/RETENTION-HANDOFF.md 2.3): the expo-notifications plugin adds the push
//     entitlement and the Android channel to native builds. Plugins do nothing in Expo Go, and
//     lib/push.ts never loads the module on web or in Expo Go on Android, so neither can crash. It is
//     added only when the package is installed, so a checkout that hasn't run `npm install` since
//     still starts. Real pushes also need the EAS projectId and Apple push credentials
//     (TODO(caleb): `npx eas-cli init`, docs/build/LAUNCH-LINKS.md); until then the app never asks.
//
// The iOS bundle id: set it once with `node scripts/set-apple-ids.mjs --team <TEAM_ID> --bundle <ID>`
// (docs/build/LAUNCH-LINKS.md), which also fills the website's apple-app-site-association and the
// api's APP_BUNDLE_ID. Empty until then: Expo Go doesn't need it, and a store build must not ship
// without it (Apple sign-in and links that open the app both depend on it).
// TODO(caleb): android.package, when there is an Android build.
import type { ConfigContext, ExpoConfig } from 'expo/config';

/** The App ID's bundle identifier (e.g. "app.homecookd"). Filled by scripts/set-apple-ids.mjs. */
const IOS_BUNDLE_ID = '';

const GOOGLE_SCHEME_PREFIX = 'com.googleusercontent.apps.';
const GOOGLE_CLIENT_SUFFIX = '.apps.googleusercontent.com';

/** True when `name` is installed here (a config plugin that can't be resolved fails the whole config). */
function installed(name: string): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- config time, Node only
    require(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/** The iOS URL scheme Google sign-in calls back on: "123-abc.apps.googleusercontent.com" -> "com.googleusercontent.apps.123-abc". */
function googleIosUrlScheme(): string | null {
  const explicit = (process.env.GOOGLE_IOS_URL_SCHEME ?? '').trim();
  if (explicit) return explicit;
  const clientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim();
  if (!clientId.endsWith(GOOGLE_CLIENT_SUFFIX)) return null;
  return GOOGLE_SCHEME_PREFIX + clientId.slice(0, -GOOGLE_CLIENT_SUFFIX.length);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const googleScheme = googleIosUrlScheme();
  const plugins: NonNullable<ExpoConfig['plugins']> = [
    ...(config.plugins ?? []),
    'expo-apple-authentication',
    ['expo-contacts', { contactsPermission: 'homecookd opens your contacts so you can invite family with a text.' }],
  ];
  if (googleScheme) plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme: googleScheme }]);
  // Android's notification accent is the Hearth green (theme/tokens colors.green); its channel id
  // matches the one the api sends (channelId 'default') and lib/push.ts creates.
  if (installed('expo-notifications')) {
    plugins.push(['expo-notifications', { color: '#5B6F00', defaultChannel: 'default', enableBackgroundRemoteNotifications: false }]);
  }

  return {
    ...config,
    name: config.name ?? 'homecookd',
    slug: config.slug ?? 'app',
    ios: {
      ...config.ios,
      ...(IOS_BUNDLE_ID ? { bundleIdentifier: IOS_BUNDLE_ID } : null),
      usesAppleSignIn: true,
      associatedDomains: ['applinks:homecookd.app', 'applinks:www.homecookd.app'],
      // The share sheets ask canOpenURL before showing WhatsApp; iOS only answers for these.
      infoPlist: {
        ...config.ios?.infoPlist,
        LSApplicationQueriesSchemes: ['whatsapp', 'instagram', 'instagram-stories'],
      },
    },
    plugins,
    extra: { ...config.extra, googleSignIn: !!googleScheme },
  };
};

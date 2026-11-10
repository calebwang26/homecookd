// Push notifications on this phone (RETENTION-HANDOFF 2.3): ask the OS, get the Expo push token, hand
// it to the api and to Convex, drop it on sign-out, and open the screen a tapped notification points at.
//
//   initPush(isHere)                                   // once, from the root layout
//   const off = addTapListener(router)                 // once navigation is ready (cold-start tap too)
//   if (await shouldAskPush('kid-first-made', me.id))  // then our own explainer sheet first:
//     Yes     -> await requestAndRegister({ register: (token, platform) => api.pushToken({ token, platform }), profileId: me.id })
//     Not now -> await snoozePushAsk(me.id)                       // no ask for 30 days
//   await syncRegistration({ register, key: `${credentialVersion}|${profileId}`, profileId })  // person or key change; never prompts
//   await unregister({ remove: (token) => api.removePushToken({ token }, { deviceKey }) })  // sign-out; never waits
//   setConvexPush(convexPush)                          // once, root layout (lib/live/pushTokens)
//
// The api calls are injected: this module knows nothing about the api or the session. Convex keeps a
// copy of the token too (docs/build/V2-LINKING.md 1.2: v2's pushes come from Convex, today's from the
// api): every registration above also goes to Convex's push.register with the phone's zone, and
// sign-out to push.unregister, in the background (never awaited, errors swallowed). That sink is set
// from outside, since lib/live imports the session, which imports this module.
//
// expo-notifications is required lazily inside try/catch, and only on iOS or on Android outside Expo
// Go, so web and Expo Go never load it (importing it crashed Expo Go on Android before 57.0.23, and
// its token calls throw there since SDK 55). Without an EAS projectId, or on the iOS Simulator or an
// Android emulator (expo-device isDevice), there is no token to get, so everything is a quiet no-op
// and the explainer never shows. Same guarded pattern as lib/auth/google.ts; only its types are
// imported statically (erased at build time).
// TODO(caleb): `npx eas-cli init` (writes the projectId) and Apple push credentials
// (docs/build/LAUNCH-LINKS.md); until then pushSupported() is false everywhere.
//
// When to ask (one explainer sheet, then the OS prompt; most moments never on the first launch):
//   kid-first-made      right after "I made it"        "Want a note when Mom answers?"
//   kid-first-question  after sending a question       "Want a note when Mom answers?"
//   cook-first-send     right after a Send, or a recipe "Want a note when Leo writes back?"
//                       sent from the share sheet's family row
//                       ("cooks it" once a cooking push exists: PushAskSheet COOK_ASK_COOKS_IT)
//   kid-card-saved      a dish card claimed in the app  "Want a note when Mom answers?"
//                       (v2: components/signin/ClaimLink)
//   cook-craving-sent   right after she shares the      "Want a note when they pick a dish?"
//                       "what are you craving?" link
// The two v2 moments and cook-first-send ask even on the first launch: they happen right after
// installing (a new cook films and sends on her first day, so waiting for a later launch never asked her).
// "First" means the first of these moments while asking is allowed: a moment skipped (first launch,
// a "Not now" still inside its 30 days) asks again the next time it happens. Every moment shares one
// 30-day snooze per profile (kv `push.askedAt.<profileId>`, ms since epoch), set by "Not now" and by
// a "Yes" that doesn't end registered. Once the OS has answered (granted or denied, even an Android
// "deny" that could be asked again) we never ask.
// The rules are tested in scripts/test-retention.mjs (with stubs for the native modules).
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import type * as Notifications from 'expo-notifications';
import type { Href } from 'expo-router';
import { Platform } from 'react-native';

import { kvGet, kvSet } from './storage';
import { deviceTimeZone } from './tz';

// The real module's types; the module itself is only ever required lazily (load()).
type NotificationsModule = typeof Notifications;
type PermissionLike = Notifications.NotificationPermissionsStatus;
type ResponseLike = Notifications.NotificationResponse;

export type PushPlatform = 'ios' | 'android';
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export type PushAskKind = 'kid-first-made' | 'kid-first-question' | 'cook-first-send' | 'kid-card-saved' | 'cook-craving-sent';
/** What the server gets: POST /push-tokens {token, platform}. Throwing is fine (sync retries later). */
export type RegisterPush = (token: string, platform: PushPlatform) => Promise<unknown>;
/** POST /push-tokens/remove {token}, sent with the key that is about to go. */
export type RemovePush = (token: string) => Promise<unknown>;
/**
 * Convex's copy of the token: push.register as `profileId` (null: whoever is in) with the phone's IANA
 * zone, and push.unregister on sign-out, with the session that registered it (lib/live/pushTokens).
 */
export type ConvexPush = {
  register: (token: string, platform: PushPlatform, tz: string, profileId: string | null) => Promise<unknown>;
  unregister: (token: string) => Promise<unknown>;
};
/** The payload the api puts on every push (supabase/functions/api notify()). */
export type PushData = { url?: unknown; kind?: unknown; profile_id?: unknown; thread_id?: unknown; [k: string]: unknown };
/** Anything with expo-router's push, e.g. useRouter(). */
export type PushRouter = { push: (href: Href) => void };

// Server-side channelId is 'default' too; Android 13+ shows no prompt until a channel exists.
const CHANNEL_ID = 'default';
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_KEY = 'push.token'; // this phone's token, so sign-out can remove it
const LAUNCH_KEY = 'push.firstLaunchAt';
const askKey = (profileId: string) => `push.askedAt.${profileId}`;
/** Moments that happen right after installing, so they may ask on the very first launch. */
const FIRST_LAUNCH_ASKS: ReadonlySet<PushAskKind> = new Set(['kid-card-saved', 'cook-craving-sent', 'cook-first-send']);

let loaded: NotificationsModule | null | undefined;

/** The JS module, or null on web, in Expo Go on Android, or when it isn't installed. */
function load(): NotificationsModule | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  try {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return loaded;
    if (Platform.OS === 'android' && isRunningInExpoGo()) return loaded;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose (see the top)
    loaded = require('expo-notifications') as NotificationsModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** The EAS project id in this build (`eas init` writes it), or null. */
function projectId(): string | null {
  const eas = Constants.easConfig as { projectId?: unknown } | null | undefined;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = eas?.projectId ?? extra?.eas?.projectId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function platform(): PushPlatform | null {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
}

let device: boolean | undefined;

/** False on the iOS Simulator and Android emulators (no push token there), or if expo-device won't load. */
function onRealDevice(): boolean {
  if (device !== undefined) return device;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy, like expo-notifications
    device = (require('expo-device') as { isDevice?: boolean }).isDevice !== false;
  } catch {
    device = false;
  }
  return device;
}

/** The module when this build can really get a push token; null otherwise. */
function ready(): NotificationsModule | null {
  return projectId() && platform() && onRealDevice() ? load() : null;
}

/** True when this phone can receive pushes from us. Synchronous, so it can decide a first render. */
export function pushSupported(): boolean {
  return !!ready();
}

/** iOS IosAuthorizationStatus: AUTHORIZED 2, PROVISIONAL 3 and EPHEMERAL 4 all deliver. */
const IOS_DELIVERS = new Set([2, 3, 4]);
const isGranted = (p: PermissionLike) => p.granted || IOS_DELIVERS.has(Number(p.ios?.status));

/**
 * What the OS says right now. 'undetermined' = it has never been asked. A 'denied' stays 'denied'
 * even when Android could show its prompt once more (canAskAgain): one answer is enough.
 */
export async function getPushPermission(): Promise<PushPermission> {
  const N = ready();
  if (!N) return 'unsupported';
  try {
    const p = await N.getPermissionsAsync();
    if (isGranted(p)) return 'granted';
    return p.status === 'undetermined' ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

let channelMade = false;
async function ensureChannel(N: NotificationsModule) {
  if (Platform.OS !== 'android' || channelMade) return;
  try {
    await N.setNotificationChannelAsync(CHANNEL_ID, { name: 'Family', importance: N.AndroidImportance.HIGH });
    channelMade = true;
  } catch {
    // ignore: the prompt may not show, nothing breaks
  }
}

let inited = false;
let messagePushAt: number | null = null;
// The push kinds that come with a message the unread badge counts (the api's PUSH_KINDS; reactions,
// nudges and the recap never count as unread).
const MESSAGE_PUSH_KINDS = new Set(['message', 'question', 'recipe', 'postcard']);

/**
 * When a push for a new message last arrived with the app open, shown or kept quiet because its chat
 * was on screen; null if none since launch. The new-message double tap reads it (lib/touches
 * tapStillDue), so one message gets one signal.
 */
export function lastMessagePushAt(): number | null {
  return messagePushAt;
}

/**
 * Once at startup: notes this launch (no ask on the first one), shows pushes that arrive while the
 * app is open unless `isHere(url)` says that screen is already showing, and makes the Android channel.
 */
export async function initPush(isHere?: (url: string) => boolean): Promise<void> {
  await noteLaunch();
  const N = ready();
  if (!N || inited) return;
  inited = true;
  try {
    N.setNotificationHandler({
      handleNotification: async (n) => {
        const url = n.request.content.data?.url;
        if (MESSAGE_PUSH_KINDS.has(String(n.request.content.data?.kind))) messagePushAt = Date.now();
        let here = false;
        try {
          here = typeof url === 'string' && !!isHere?.(url);
        } catch {
          here = false;
        }
        return { shouldShowBanner: !here, shouldShowList: true, shouldPlaySound: !here, shouldSetBadge: false };
      },
    });
  } catch {
    // ignore: foreground pushes just won't show a banner
  }
  await ensureChannel(N);
}

let lastToken: string | null = null;
let lastSynced: string | null = null;
let convex: ConvexPush | null = null;

/** Where Convex's copy of the token goes (null: nowhere). Set once at startup. */
export function setConvexPush(sink: ConvexPush | null): void {
  convex = sink;
}

/** A Convex call in the background: it never holds anything up and never throws. */
function toConvex(run: (sink: ConvexPush) => Promise<unknown>): void {
  const sink = convex;
  if (!sink) return;
  void Promise.resolve()
    .then(() => run(sink))
    .catch(() => {});
}

/** Gets this phone's Expo push token and hands it to `register` (and Convex). Assumes permission is granted. */
async function registerToken(N: NotificationsModule, register: RegisterPush, key: string, profileId: string | null): Promise<boolean> {
  const pid = projectId();
  const os = platform();
  if (!pid || !os) return false;
  const token = (await N.getExpoPushTokenAsync({ projectId: pid })).data;
  if (!token) return false;
  lastToken = token;
  await kvSet(TOKEN_KEY, token);
  if (lastSynced === `${token}|${key}`) return true;
  toConvex((sink) => sink.register(token, os, deviceTimeZone(), profileId));
  await register(token, os);
  lastSynced = `${token}|${key}`;
  return true;
}

export type PushAskResult = 'registered' | 'denied' | 'failed' | 'unsupported';

/**
 * After a "Yes" in our explainer: shows the OS prompt (only if it can still be shown), gets the
 * token and calls `register`. With `profileId`, anything but 'registered' also starts that
 * profile's 30-day snooze, so the explainer never comes straight back. Never throws.
 *   'registered'   the server has the token
 *   'denied'       the OS said no (or had said no before)
 *   'failed'       allowed, but the token or the server call failed (syncRegistration retries)
 *   'unsupported'  web, Expo Go on Android, a simulator, no projectId
 */
export async function requestAndRegister({ register, profileId }: { register: RegisterPush; profileId?: string | null }): Promise<PushAskResult> {
  const result = await askOsAndRegister(register, profileId ?? null);
  if (result !== 'registered' && profileId) {
    try {
      await snoozePushAsk(profileId);
    } catch {
      // ignore: the worst case is one more explainer
    }
  }
  return result;
}

async function askOsAndRegister(register: RegisterPush, profileId: string | null): Promise<PushAskResult> {
  const N = ready();
  if (!N) return 'unsupported';
  let p: PermissionLike;
  try {
    await ensureChannel(N);
    p = await N.getPermissionsAsync();
    if (!isGranted(p) && p.canAskAgain) {
      p = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
  } catch {
    return 'failed';
  }
  if (!isGranted(p)) return 'denied';
  try {
    return (await registerToken(N, register, 'ask', profileId)) ? 'registered' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Re-sends the token when permission is already granted (startup, and whenever the person on this
 * phone changes: the server moves the token to them). Never prompts, never throws. `key` skips a
 * repeat of the same token for the same key in this run, so it must change with the phone's
 * credential as well as the person (session `credentialVersion` + profile id): the server's row
 * points at the device key it came with, and a new key for the same person must register again.
 * `profileId`: who the token follows (Convex registers it as them; the api goes by the acting person).
 */
export async function syncRegistration({
  register,
  key = '',
  profileId = null,
}: {
  register: RegisterPush;
  key?: string;
  profileId?: string | null;
}): Promise<boolean> {
  const N = ready();
  if (!N) return false;
  try {
    if (!isGranted(await N.getPermissionsAsync())) return false;
    return await registerToken(N, register, key, profileId);
  } catch {
    return false;
  }
}

/**
 * Sign-out: forgets this phone's token here, then asks the server to forget it too, in the
 * background. Resolves as soon as the local copy is gone (never waits on the network, never throws),
 * so signing out is never held up by a slow or captive connection. `remove` must carry its own auth
 * (the device key it captured), because the caller drops the key right after; the server also skips
 * tokens of revoked phones, so a removal that arrives late or never is harmless. Convex is told too,
 * with the session that registered the token (still good after the key goes), in the background.
 */
export async function unregister({ remove }: { remove: RemovePush }): Promise<void> {
  const token = lastToken ?? (await kvGet(TOKEN_KEY));
  lastToken = null;
  lastSynced = null;
  if (!token) return;
  await kvSet(TOKEN_KEY, null);
  // Not awaited: offline or refused is fine (the server drops it with the device).
  void Promise.resolve()
    .then(() => remove(token))
    .catch(() => {});
  toConvex((sink) => sink.unregister(token));
}

/**
 * The in-app path a push opens: only our own routes ('/chat/…', '/recipe/…'), never a full URL.
 * No backslashes either: a URL parser reads '/\evil' as '//evil'.
 */
export function pushUrl(data: PushData | null | undefined): string | null {
  const url = data?.url;
  if (typeof url !== 'string' || url.length > 300 || url.includes('\\')) return null;
  return url.startsWith('/') && !url.startsWith('//') ? url : null;
}

let lastTap: string | null = null;

/**
 * Opens the screen a tapped push points at: the tap that launched the app (cold start) right away,
 * then every later tap. `route` can redirect (e.g. to '/' when the push was for someone else on a
 * shared phone); return null to stay put. Returns the unsubscribe.
 */
export function addTapListener(router: PushRouter, route: (data: PushData) => string | null = pushUrl): () => void {
  const N = ready();
  if (!N) return () => {};
  const go = (r: ResponseLike | null) => {
    if (!r || r.actionIdentifier !== N.DEFAULT_ACTION_IDENTIFIER) return;
    const id = r.notification.request.identifier;
    if (id === lastTap) return; // the cold-start tap also arrives through the listener
    lastTap = id;
    try {
      N.clearLastNotificationResponse();
    } catch {
      // ignore
    }
    let url: string | null = null;
    try {
      url = route((r.notification.request.content.data ?? {}) as PushData);
    } catch {
      url = null;
    }
    if (url) router.push(url as Href);
  };
  try {
    go(N.getLastNotificationResponse());
  } catch {
    // ignore
  }
  let sub: { remove(): void } | null = null;
  try {
    sub = N.addNotificationResponseReceivedListener(go);
  } catch {
    sub = null;
  }
  return () => sub?.remove();
}

// ---------------------------------------------------------------------------------------------
// When to ask

let firstLaunch: Promise<boolean> | null = null;

/** Records this launch on this phone. Resolves true during the very first launch (no asks then). */
export function noteLaunch(): Promise<boolean> {
  firstLaunch ??= (async () => {
    if (await kvGet(LAUNCH_KEY)) return false;
    await kvSet(LAUNCH_KEY, String(Date.now()));
    return true;
  })();
  return firstLaunch;
}

/** Whose copy the explainer uses for a moment. */
export function pushAskWho(kind: PushAskKind): 'kid' | 'cook' {
  return kind === 'cook-first-send' || kind === 'cook-craving-sent' ? 'cook' : 'kid';
}

/**
 * True when a moment should show our explainer sheet: pushes work in this build, it isn't the first
 * launch (the two v2 moments may ask on it: FIRST_LAUNCH_ASKS), the OS has never been asked, and this
 * profile had no ask in the last 30 days.
 */
export async function shouldAskPush(kind: PushAskKind, profileId: string | null | undefined, now = Date.now()): Promise<boolean> {
  if (!profileId || !pushSupported()) return false;
  if ((await noteLaunch()) && !FIRST_LAUNCH_ASKS.has(kind)) return false;
  if ((await getPushPermission()) !== 'undetermined') return false;
  const askedAt = Number(await kvGet(askKey(profileId)));
  return !(askedAt > 0 && now - askedAt < SNOOZE_MS);
}

/** "Not now" (or the sheet closed without a yes): no ask for this profile for 30 days. */
export function snoozePushAsk(profileId: string, now = Date.now()): Promise<void> {
  return kvSet(askKey(profileId), String(now));
}

/**
 * A push ask that ended without a yes. "Not now" (its button, the close or the backdrop) snoozes it for 30
 * days. A sheet that never showed ('dropped': held behind another sheet until it gave up, BottomSheet
 * onDropped) stores nothing, so the next moment asks as if for the first time.
 */
export async function endPushAsk(profileId: string, how: 'notNow' | 'dropped', now = Date.now()): Promise<void> {
  if (how === 'notNow') await snoozePushAsk(profileId, now);
}

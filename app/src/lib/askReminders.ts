// The weekly "film it" reminder on this phone (Phase 5 screen 7): a local expo-notifications weekly
// notification, no server. One per ask, kept in kv `reminder.<askId>` as { notificationId, day, part }. The
// trigger, words and link are lib/reminders.ts (Node-tested). A tap on it opens Record with the dish filled in
// through lib/push.ts addTapListener (data.url + data.profile_id, like a server push).
//
//   const r = useAskReminder(askId);                     StoredReminder | null (live)
//   await reminderPermission()                           'granted' | 'undetermined' | 'denied' | 'unsupported'
//   await askReminderPermission()                        the OS prompt when it can still show; the answer
//   await setAskReminder({ ask, day, part, profileId, t })   replaces the ask's reminder; true when scheduled
//   await cancelAskReminder(askId)
//   noteFilmingAsk(askId | null)  Record's start, from the reminder;  then sendKept's success: askFilmed()
//
// expo-notifications is required lazily, the way lib/push.ts does it: only on iOS, or on Android outside Expo
// Go, so the web and Expo Go on Android never load it. Local notifications need no push token, so unlike push
// this works without an EAS projectId and on a simulator.
import { isRunningInExpoGo } from 'expo';
import type * as Notifications from 'expo-notifications';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { markAskFilmed } from './cravings';
import { reminderContent, reminderKey, parseReminder, weeklyTrigger, type ReminderPart, type StoredReminder } from './reminders';
import { kvGetJson, kvSetJson } from './storage';
import { english, type T } from './words/words';

type NotificationsModule = typeof Notifications;
export type ReminderPermission = 'granted' | 'undetermined' | 'denied' | 'unsupported';

// lib/push.ts makes the same channel (id and name) for server pushes; Android shows nothing without one.
const CHANNEL_ID = 'default';

let loaded: NotificationsModule | null | undefined;
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

/** iOS AUTHORIZED 2, PROVISIONAL 3 and EPHEMERAL 4 all deliver (as in lib/push.ts). */
const IOS_DELIVERS = new Set([2, 3, 4]);
const granted = (p: Notifications.NotificationPermissionsStatus) => p.granted || IOS_DELIVERS.has(Number(p.ios?.status));

/** What the OS says now. 'undetermined' = the prompt can still show. */
export async function reminderPermission(): Promise<ReminderPermission> {
  const N = load();
  if (!N) return 'unsupported';
  try {
    const p = await N.getPermissionsAsync();
    if (granted(p)) return 'granted';
    return p.status === 'undetermined' || p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

/** Shows the OS prompt when it still can; the answer. */
export async function askReminderPermission(): Promise<ReminderPermission> {
  const N = load();
  if (!N) return 'unsupported';
  try {
    await ensureChannel(N);
    let p = await N.getPermissionsAsync();
    if (!granted(p) && p.canAskAgain) p = await N.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    return granted(p) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

async function ensureChannel(N: NotificationsModule) {
  if (Platform.OS !== 'android') return;
  try {
    await N.setNotificationChannelAsync(CHANNEL_ID, { name: 'Family', importance: N.AndroidImportance.HIGH });
  } catch {
    // ignore: the reminder may not show, nothing breaks
  }
}

// The reminders this run has read or written, so every screen showing one updates together.
const known = new Map<string, StoredReminder | null>();
const listeners = new Set<() => void>();
function put(askId: string, r: StoredReminder | null) {
  known.set(askId, r);
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

async function stored(askId: string): Promise<StoredReminder | null> {
  if (known.has(askId)) return known.get(askId) ?? null;
  const r = parseReminder(await kvGetJson<unknown>(reminderKey(askId)));
  if (!known.has(askId)) put(askId, r);
  return known.get(askId) ?? null;
}

/** This ask's reminder on this phone, live (null: none, or not read yet). */
export function useAskReminder(askId: string | null | undefined): StoredReminder | null {
  useEffect(() => {
    if (askId) void stored(askId);
  }, [askId]);
  return useSyncExternalStore(
    subscribe,
    () => (askId ? (known.get(askId) ?? null) : null),
    () => null,
  );
}

/**
 * Every `day` at `part`'s time: replaces the ask's reminder. Permission must already be granted (the sheet
 * asks first). True when it's scheduled and kept.
 */
export async function setAskReminder({
  ask,
  day,
  part,
  profileId,
  t = english,
}: {
  ask: { id: string; dish: string; kidName: string };
  day: number;
  part: ReminderPart;
  profileId: string;
  t?: T;
}): Promise<boolean> {
  const N = load();
  if (!N) return false;
  try {
    await ensureChannel(N);
    const notificationId = await N.scheduleNotificationAsync({
      content: reminderContent({ askId: ask.id, dish: ask.dish, kidName: ask.kidName, profileId }, t),
      trigger: weeklyTrigger(day, part, Platform.OS === 'android' ? CHANNEL_ID : undefined) as unknown as Notifications.WeeklyTriggerInput,
    });
    const before = await stored(ask.id);
    if (before && before.notificationId !== notificationId) await cancel(N, before.notificationId);
    const next: StoredReminder = { notificationId, day, part };
    await kvSetJson(reminderKey(ask.id), next);
    put(ask.id, next);
    return true;
  } catch {
    return false;
  }
}

async function cancel(N: NotificationsModule, id: string) {
  try {
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    // ignore: already gone
  }
}

/** Stops the ask's reminder and forgets it. Never throws. */
export async function cancelAskReminder(askId: string): Promise<void> {
  const r = await stored(askId);
  if (!r) return;
  const N = load();
  if (N) await cancel(N, r.notificationId);
  await kvSetJson(reminderKey(askId), null);
  put(askId, null);
}

// The ask Record is filming for (it came with `ask`), until a send says it's filmed.
let filming: string | null = null;

/** Record's start: the ask this recording answers, or null for any other recording. */
export function noteFilmingAsk(askId: string | null): void {
  filming = askId;
}

/** A recording was sent: the ask it answers is filmed, and its reminder stops. */
export async function askFilmed(): Promise<void> {
  const askId = filming;
  filming = null;
  if (!askId) return;
  markAskFilmed(askId);
  await cancelAskReminder(askId);
}

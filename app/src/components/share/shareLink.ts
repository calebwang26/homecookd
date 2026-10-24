// The public link behind the share sheet, and the ways out of the app (the app row both share
// sheets use, ExternalRow, runs on these; so does lib/invites.ts).
//
//   getShareLink(recipeId, profileId)  POST /shares once per sheet open; the server hands the same
//                                      link back for the same family + recipe + sender, so this
//                                      only dedupes concurrent taps while one request is in flight.
//   shareText(title, cook, url)        "<Dish> from <cook>'s kitchen, on homecookd: <url>"
//   copyLink(text)                     the clipboard; true when it worked
//   openMessages(text, to?)            the Messages composer (expo-sms) with the text filled in
//   openSms(text)                      Messages through an sms: link (openMessages' fallback)
//   openInstagram()                    the Instagram app (or instagram.com); the caller copies first
//   canOpenWhatsApp() / openWhatsApp   WhatsApp, only shown when the phone says it can open it
//   openMore(text, title)              the system share sheet
//
// Expo Go must never crash: expo-sms is required lazily, only once its native module is known to
// exist, inside try/catch. Never log a link.
import { requireOptionalNativeModule } from 'expo';
import * as Clipboard from 'expo-clipboard';
import { Linking, Platform, Share } from 'react-native';

import { api } from '@/lib/api';
import { possessive } from '@/lib/format';

export type ShareLink = { token: string; url: string };

const inflight = new Map<string, Promise<ShareLink>>();

/** One POST /shares per key while it is in flight. Pass `fresh` on each sheet open. */
export function getShareLink(recipeId: string, profileId: string | null, fresh = false): Promise<ShareLink> {
  const key = `${recipeId}|${profileId ?? ''}`;
  const pending = inflight.get(key);
  if (pending && !fresh) return pending;
  const p = api.createShare(recipeId).catch((e) => {
    inflight.delete(key);
    throw e;
  });
  inflight.set(key, p);
  return p;
}

/** The sentence every external option sends. Drops the kitchen when we don't know the cook. */
export function shareText(title: string, cook: string | null | undefined, url: string): string {
  const dish = title.trim() || 'A family recipe';
  const who = (cook ?? '').trim();
  return who ? `${dish} from ${possessive(who)} kitchen, on homecookd: ${url}` : `${dish}, on homecookd: ${url}`;
}

export async function copyLink(url: string): Promise<boolean> {
  if (Platform.OS === 'web') return copyOnWeb(url);
  try {
    return await Clipboard.setStringAsync(url);
  } catch {
    return false;
  }
}

// On the web expo-clipboard's fallback reports success even when execCommand copied nothing, so
// check each route ourselves: the async clipboard API, then a hidden textarea + execCommand.
async function copyOnWeb(url: string): Promise<boolean> {
  const cb = globalThis.navigator?.clipboard;
  if (cb?.writeText) {
    try {
      await cb.writeText(url);
      return true;
    } catch {}
  }
  const doc = globalThis.document;
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const field = doc.createElement('textarea');
  field.value = url;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  doc.body.appendChild(field);
  field.select();
  try {
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    doc.body.removeChild(field);
  }
}

type SmsModule = typeof import('expo-sms');

let sms: SmsModule | null | undefined;
function smsModule(): SmsModule | null {
  if (sms !== undefined) return sms;
  sms = null;
  if (Platform.OS === 'web') return sms;
  try {
    if (requireOptionalNativeModule('ExpoSMS')) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose (see the top)
      sms = require('expo-sms') as SmsModule;
    }
  } catch {
    sms = null;
  }
  return sms;
}

/**
 * 'sent'        Messages says it went (Android can't tell, so it counts as sent)
 * 'cancelled'   they backed out of the composer
 * 'opened'      handed to Messages through an sms: link (we can't know what happened next)
 * 'unavailable' no Messages here (an iPad without texting, a browser): copy the link instead
 */
export type MessagesResult = 'sent' | 'cancelled' | 'opened' | 'unavailable';

/** The Messages composer over the app with the text filled in (and `to` when we have a number). */
export async function openMessages(text: string, to?: string | null): Promise<MessagesResult> {
  const mod = smsModule();
  if (mod) {
    let available = false;
    try {
      available = await mod.isAvailableAsync();
    } catch {
      available = false;
    }
    if (!available) return 'unavailable';
    try {
      const { result } = await mod.sendSMSAsync(to ? [to] : [], text);
      return result === 'cancelled' ? 'cancelled' : 'sent';
    } catch {
      // The composer refused (one already up, a restricted phone): try the plain link below.
    }
  }
  if (Platform.OS === 'web') return 'unavailable';
  return (await openSms(text)) ? 'opened' : 'unavailable';
}

/** Messages with the text filled in. iOS wants `sms:&body=`, Android `sms:?body=`. */
export async function openSms(text: string): Promise<boolean> {
  const body = encodeURIComponent(text);
  const url = Platform.OS === 'ios' ? `sms:&body=${body}` : `sms:?body=${body}`;
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Instagram has no "send this text" link, so the caller copies the link first and this opens the
 * app (instagram://app, which needs no LSApplicationQueriesSchemes entry), else instagram.com.
 */
export async function openInstagram(): Promise<boolean> {
  const web = 'https://www.instagram.com/direct/inbox/';
  if (Platform.OS === 'web') {
    globalThis.open?.(web, '_blank', 'noopener');
    return true;
  }
  try {
    await Linking.openURL('instagram://app');
    return true;
  } catch {
    try {
      await Linking.openURL(web);
      return true;
    } catch {
      return false;
    }
  }
}

// The last answer, so a sheet opened again lays its row out right away.
let whatsApp: boolean | null = null;

/** The answer from the last check (null before the first), for the first render of a row. */
export function knownWhatsApp(): boolean | null {
  return whatsApp;
}

/**
 * True when WhatsApp can open here. iOS answers only for schemes in LSApplicationQueriesSchemes
 * (app.config.ts), so Expo Go says false and the button stays hidden there.
 */
export async function canOpenWhatsApp(): Promise<boolean> {
  try {
    whatsApp = await Linking.canOpenURL('whatsapp://send?text=homecookd');
  } catch {
    whatsApp = false;
  }
  return whatsApp;
}

/** WhatsApp's own scheme on a phone, wa.me on the web or when the app isn't there. */
export async function openWhatsApp(text: string): Promise<boolean> {
  const q = encodeURIComponent(text);
  const web = `https://wa.me/?text=${q}`;
  if (Platform.OS === 'web') {
    globalThis.open?.(web, '_blank', 'noopener');
    return true;
  }
  try {
    await Linking.openURL(`whatsapp://send?text=${q}`);
    return true;
  } catch {
    try {
      await Linking.openURL(web);
      return true;
    } catch {
      return false;
    }
  }
}

/** The system share sheet. 'unavailable' on browsers without navigator.share. */
export async function openMore(text: string, title: string): Promise<'shared' | 'dismissed' | 'unavailable'> {
  if (Platform.OS === 'web' && typeof globalThis.navigator?.share !== 'function') return 'unavailable';
  try {
    // The message already carries the url; passing `url` too would paste it twice on iOS.
    const res = await Share.share({ message: text, title }, { subject: title, dialogTitle: title });
    return res.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return Platform.OS === 'web' ? 'dismissed' : 'unavailable';
  }
}

// The phone's own language, one of ours or English: what the cook's screens read in before she picks hers
// (sign-in, an invite, "Before we start", "Who's in the kitchen?"). No native module: iOS's settings, Android's
// locale, the browser's, else Intl. Web dev aid: `?lang=ta` stands in for the phone's language (screenshots).
import { I18nManager, NativeModules, Platform } from 'react-native';

import { uiLanguageOf, type UiLanguage } from './words';

function phoneTags(): (string | undefined)[] {
  if (Platform.OS === 'web') {
    const aid = __DEV__ ? new URLSearchParams(globalThis.location?.search ?? '').get('lang') : null;
    if (aid) return [aid];
    return typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language];
  }
  const tags: (string | undefined)[] = [];
  try {
    if (Platform.OS === 'ios') {
      const s = NativeModules.SettingsManager?.settings;
      tags.push(...((s?.AppleLanguages as string[] | undefined) ?? []), s?.AppleLocale);
    } else {
      tags.push((I18nManager.getConstants?.() as { localeIdentifier?: string } | undefined)?.localeIdentifier);
    }
  } catch {
    // An older runtime without these: Intl below.
  }
  tags.push(Intl.DateTimeFormat().resolvedOptions().locale);
  return tags;
}

/** The first of the phone's languages we have, else English. */
export function deviceUiLanguage(): UiLanguage {
  for (const tag of phoneTags()) {
    const code = uiLanguageOf(tag);
    if (code) return code;
  }
  return 'en';
}

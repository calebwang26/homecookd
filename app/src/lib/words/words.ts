// The cook's app in her language (Oct 26): one English table (en/), each language's drafted words (tr/), and
// t(key, vars) to read them. A key missing in her language reads in English. The kid side stays English.
// Pure TS (node scripts/test-words.mjs).
//
//   const t = wordsFor('ta');
//   t('parent.tab.home')                        -> 'முகப்பு'
//   t('messages.asked', { name: 'Shreya' })     -> '{name}' filled in
import { activeLanguage, LANGUAGES } from '../languages';

import { EN, type WordKey } from './en/index';
import { TRANSLATIONS } from './tr/index';

export type { WordKey };
export type Vars = Record<string, string | number | null | undefined>;
export type T = (key: WordKey, vars?: Vars) => string;

/** The languages the cook's app is written in: English and 12 more (memories cook-languages, marathi-dropped). */
export const UI_LANGUAGES = ['en', 'hi', 'gu', 'ta', 'te', 'pa', 'ur', 'zh', 'ko', 'tl', 'es', 'pt', 'ar'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

const RTL = new Set(['ur', 'ar']);
/** Urdu and Arabic read right to left. */
export const isRtl = (lang: string | null | undefined) => RTL.has(lang ?? '');

/** `{name}` and the like filled in; a missing value reads as nothing. */
export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
}

/** t() for one language (unknown or unset: English; Marathi, dropped: Hindi). */
export function wordsFor(lang?: string | null): T {
  const code = activeLanguage(lang)?.toLowerCase();
  const own = code && code !== 'en' ? TRANSLATIONS[code] : undefined;
  return (key, vars) => fill(own?.[key] ?? EN[key], vars);
}

/** The English t(): pure helpers default to it, so their tests read English. */
export const english: T = wordsFor('en');

/** One of ours for a language tag from the phone ("ta-IN" → ta, "fil-PH" → tl, "mr-IN" → hi), else null. */
export function uiLanguageOf(tag: string | null | undefined): UiLanguage | null {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  const code = activeLanguage(base === 'fil' ? 'tl' : base);
  return code && (UI_LANGUAGES as readonly string[]).includes(code) ? (code as UiLanguage) : null;
}

/** The language screen's tiles: the phone's language, then English, then the rest as the picker lists them. */
export function tileOrder(first: string): UiLanguage[] {
  const ours = LANGUAGES.map((l) => l.code).filter((c): c is UiLanguage => (UI_LANGUAGES as readonly string[]).includes(c));
  return [...new Set([uiLanguageOf(first) ?? 'en', 'en' as const, ...ours])];
}

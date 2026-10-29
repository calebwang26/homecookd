// The dish pages in the reader's phone language (Caleb, Oct 29: "Her phone's language"): the 13 languages
// the cook app is written in (app/src/lib/words/words.ts UI_LANGUAGES), English for anything else.
// Translations are drafts (./tr/), as the app's are. TODO(caleb): a native speaker's check.
import { EN, type WordKey } from './en';
import { TRANSLATIONS } from './tr';

export type { WordKey };
export type Vars = Record<string, string | number | null | undefined>;
export type T = (key: WordKey, vars?: Vars) => string;

/** code, then the name in its own language (the switch shows it). The app's picker order. */
export const LANGS = [
  ['en', 'English'],
  ['hi', 'हिन्दी'],
  ['gu', 'ગુજરાતી'],
  ['ta', 'தமிழ்'],
  ['te', 'తెలుగు'],
  ['pa', 'ਪੰਜਾਬੀ'],
  ['ur', 'اردو'],
  ['zh', '中文'],
  ['ko', '한국어'],
  ['tl', 'Tagalog'],
  ['es', 'Español'],
  ['pt', 'Português'],
  ['ar', 'العربية'],
] as const;
export type Lang = (typeof LANGS)[number][0];

const CODES = new Set<string>(LANGS.map(([c]) => c));
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && CODES.has(v);
export const nativeName = (lang: Lang) => LANGS.find(([c]) => c === lang)?.[1] ?? 'English';
export const isRtl = (lang: string) => lang === 'ur' || lang === 'ar';

/** "ta-IN" → ta, "fil-PH" → tl, "mr-IN" → hi (Marathi reads Hindi, as in the app), else null. */
export function langOfTag(tag: string | null | undefined): Lang | null {
  const base = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  const code = base === 'fil' ? 'tl' : base === 'mr' ? 'hi' : base;
  return isLang(code) ? code : null;
}

/** The first of the phone's languages we have, else English. */
export function phoneLang(tags: readonly (string | null | undefined)[]): Lang {
  for (const tag of tags) {
    const code = langOfTag(tag);
    if (code) return code;
  }
  return 'en';
}

/**
 * The language Mom speaks, for Ink (DISH-ASK-SPEC §4 /dish/ask/answer): the page's language, except a
 * Marathi phone reading the Hindi page still speaks Marathi.
 */
export function spokenLang(page: Lang, tags: readonly (string | null | undefined)[]): string {
  const first = (tags.find((t) => langOfTag(t) === page) ?? '').toLowerCase().split(/[-_]/)[0];
  return page === 'hi' && first === 'mr' ? 'mr' : page;
}

export function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])));
}

export function wordsFor(lang: Lang): T {
  const own = lang === 'en' ? undefined : TRANSLATIONS[lang];
  return (key, vars) => fill(own?.[key] ?? EN[key], vars);
}

/** "What do you miss *from home?*" → runs; the starred ones are set in italic. */
export function rich(text: string): { text: string; em: boolean }[] {
  return text
    .split(/\*(.+?)\*/)
    .map((run, i) => ({ text: run, em: i % 2 === 1 }))
    .filter((r) => r.text);
}

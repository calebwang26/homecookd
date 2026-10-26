// The languages a cook can pick: the most spoken that Cartesia Sonic 3.6 can speak, so homie can talk to the
// cook in hers. Codes are ISO 639-1 (people.language, recordings.language). `inkLive` marks the five Cartesia
// Ink 2 can hear live (en fr hi ja es); Cartesia ink-whisper hears the rest (voice/src/stt.ts). Odia is hidden
// (Caleb, Oct 26): Cartesia can't hear it, and only Gemini could; it comes back if a family asks. Marathi is
// hidden too (Caleb, Oct 26: "just drop Marathi as a language"; memory marathi-dropped): a cook who saved it
// gets Hindi (activeLanguage).
// Pure TS (no React Native), so app/scripts/test-languages.mjs can run it under Node.

export type Language = { code: string; name: string; native: string; inkLive: boolean };

const INK_LIVE = new Set(['en', 'fr', 'hi', 'ja', 'es']);

// English first, then roughly by number of speakers.
const LIST: [code: string, name: string, native: string][] = [
  ['en', 'English', 'English'],
  ['zh', 'Chinese', '中文'],
  ['hi', 'Hindi', 'हिन्दी'],
  ['es', 'Spanish', 'Español'],
  ['ar', 'Arabic', 'العربية'],
  ['fr', 'French', 'Français'],
  ['bn', 'Bengali', 'বাংলা'],
  ['pt', 'Portuguese', 'Português'],
  ['ru', 'Russian', 'Русский'],
  ['ur', 'Urdu', 'اردو'],
  ['id', 'Indonesian', 'Bahasa Indonesia'],
  ['de', 'German', 'Deutsch'],
  ['ja', 'Japanese', '日本語'],
  ['te', 'Telugu', 'తెలుగు'],
  ['tr', 'Turkish', 'Türkçe'],
  ['ta', 'Tamil', 'தமிழ்'],
  ['vi', 'Vietnamese', 'Tiếng Việt'],
  ['ko', 'Korean', '한국어'],
  ['tl', 'Tagalog', 'Tagalog'],
  ['it', 'Italian', 'Italiano'],
  ['gu', 'Gujarati', 'ગુજરાતી'],
  ['th', 'Thai', 'ไทย'],
  ['kn', 'Kannada', 'ಕನ್ನಡ'],
  ['pa', 'Punjabi', 'ਪੰਜਾਬੀ'],
  ['ml', 'Malayalam', 'മലയാളം'],
  ['ms', 'Malay', 'Bahasa Melayu'],
  ['pl', 'Polish', 'Polski'],
  ['uk', 'Ukrainian', 'Українська'],
];
// Not in the picker, but a cook who picked one before still reads as its name.
const HIDDEN: [code: string, name: string, native: string][] = [
  ['or', 'Odia', 'ଓଡ଼ିଆ'],
  ['mr', 'Marathi', 'मराठी'],
];

/**
 * A dropped language and the one it's used as now. Marathi reads as Hindi: the same Devanagari letters, and the
 * language the pipeline hears a Marathi recording as. Her saved people.language stays as it is.
 * TODO(caleb): Hindi is the default; the phone's language is the other choice.
 */
const STAND_IN: Record<string, string> = { mr: 'hi' };

/** The language a saved code is used as today: the app's words, the recording screen and a new recording. */
export function activeLanguage(code: string | null | undefined): string | null {
  if (!code) return null;
  return STAND_IN[code.toLowerCase()] ?? code;
}

const language = ([code, name, native]: [string, string, string]): Language => ({ code, name, native, inkLive: INK_LIVE.has(code) });
export const LANGUAGES: Language[] = LIST.map(language);

/** The picker's search: names that start with the query first, then names that contain it ("guj" → Gujarati). */
export function matchLanguages(query: string): Language[] {
  const q = query.trim().toLowerCase();
  if (!q) return LANGUAGES;
  const names = (l: Language) => [l.name.toLowerCase(), l.native.toLowerCase()];
  const starts = LANGUAGES.filter((l) => names(l).some((n) => n.startsWith(q)));
  const contains = LANGUAGES.filter((l) => !starts.includes(l) && names(l).some((n) => n.includes(q)));
  return [...starts, ...contains];
}

/** "Marathi" for "mr"; unset or unknown codes read as English or the code itself. */
export function languageName(code?: string | null): string {
  if (!code) return 'English';
  return [...LANGUAGES, ...HIDDEN.map(language)].find((l) => l.code === code.toLowerCase())?.name ?? code;
}

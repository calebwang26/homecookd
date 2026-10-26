// Each language's words for the cook's app: Claude's drafts (Oct 26), written by scripts/draft-words.mjs from
// ../en. TODO(caleb): a native speaker's check of each language, like the recording screen's words.
import type { WordKey } from '../en';
import ar from './ar';
import es from './es';
import gu from './gu';
import hi from './hi';
import ko from './ko';
import mr from './mr';
import pa from './pa';
import pt from './pt';
import ta from './ta';
import te from './te';
import tl from './tl';
import ur from './ur';
import zh from './zh';

export type Translation = Partial<Record<WordKey, string>>;

export const TRANSLATIONS: Record<string, Translation> = { mr, hi, gu, ta, te, pa, ur, zh, ko, tl, es, pt, ar };

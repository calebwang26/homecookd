// Each language's drafted words for the dish pages (Claude's drafts, Oct 29; the app's own strings reused
// where the meaning is the same). A key left out reads in English. TODO(caleb): a native speaker's check.
import type { WordKey } from '../en';
import ar from './ar';
import es from './es';
import gu from './gu';
import hi from './hi';
import ko from './ko';
import pa from './pa';
import pt from './pt';
import ta from './ta';
import te from './te';
import tl from './tl';
import ur from './ur';
import zh from './zh';

export type Translation = Partial<Record<WordKey, string>>;

export const TRANSLATIONS: Record<string, Translation> = { ar, es, gu, hi, ko, pa, pt, ta, te, tl, ur, zh };

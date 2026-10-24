// Data for the app tour (brief 8.6). Rows come from copy.seeItWork; the stage plays SLIDES.
import type { AppClipName } from '@/content/types';
import { APP_CLIPS } from '@/content/media';
import { copy, type Copy } from '@/content/copy';
import { optSrc } from '@/lib/imageLoader';

/** Rows come from useCopy().seeItWork.rows; both versions have the same four. */
export const ROW_COUNT = copy.seeItWork.rows.length;

/**
 * Everything the stage can show, in order: one real recording per row, each ~5s (a visitor gives
 * a row a few seconds). The rows walk the whole pipeline, the same on both versions: record (the
 * Add a recipe form), her words (the recipe), send (the family table filtered to Grandma, her pork
 * belly, then the Share tap), pass it down (cook mode's Watch). app-keep never shows the share
 * sheet (brief 7.2): the text the app really hands to the sheet is shown beside the phone, never on
 * the screen. app-watch plays a Pexels stock clip inside the real Watch sheet, standing in for a
 * family recording (app-recordings.md, clip 9).
 */
export const SLIDES: readonly AppClipName[] = ['app-add', 'app-recipe', 'app-keep', 'app-watch'];

/** slides per row, in play order (a row with more than one chains them) */
export const ROW_SLIDES: readonly (readonly number[])[] = [[0], [1], [2], [3]];

/** app-keep, the recording with the Share tap */
export const SHARE_SLIDE = SLIDES.indexOf('app-keep');
/** app-keep: the Share tap lands at ~3.2s (app-recordings.md, clip 10) */
export const SHARE_TAP_AT = 3.2;

export const rowOfSlide = (s: number) => ROW_SLIDES.findIndex((r) => r.includes(s));

/** the row that sends the recipe: its words carry the share bubble and the share sentence */
export const SHARE_ROW = rowOfSlide(SHARE_SLIDE);
/** the row whose recording is cook mode's Watch: its chip gets the ▶ */
export const WATCH_ROW = rowOfSlide(SLIDES.indexOf('app-watch'));

/** a row with one recording loops it natively; a row with several chains them */
export const singleClipRow = (s: number) => ROW_SLIDES[rowOfSlide(s)].length === 1;

/** next slide inside the same row, or null at a row's end */
export function nextInRow(s: number): number | null {
  const r = ROW_SLIDES[rowOfSlide(s)];
  const i = r.indexOf(s);
  return i < r.length - 1 ? r[i + 1] : null;
}

/**
 * Where a recording starts when its row opens, when its payoff comes late. Empty now: every tour
 * recording starts on its own first action.
 */
export const START_AT: Partial<Record<AppClipName, number>> = {};

/**
 * Payoff stills: what the row's text talks about, for the tap-to-play states (reduced motion,
 * Save-Data, the static rows). Each is a calm frame of the real recording with no tap ring. While
 * the tour autoplays, the recording's own poster (its first moment) is used instead, so the swap
 * from poster to video never jumps.
 */
const POSTERS: Partial<Record<AppClipName, string>> = {
  'app-add': '/media/app/app-add-picked.jpg', // 5.4s: dish, cook and two videos picked
  'app-recipe': '/media/app/app-recipe-words.jpg', // 2.05s: Ingredients open, nothing checked
  'app-watch': '/media/app/app-watch-sheet.jpg', // 4.8s: the step's video playing, her 2nd line lit
};

/** 640w WebP posters (the screen is ≤ 300 CSS px wide) instead of the 50–150KB JPGs */
export function posterOf(name: AppClipName, payoff = false): string {
  const src = (payoff ? POSTERS[name] : undefined) ?? APP_CLIPS[name].poster;
  return optSrc(src, 640) ?? src;
}

// Label over the share-payload bubble and its screen-reader sentence. The payload itself is
// copy.seeItWork.sharePayload (the app's own text).
export function shareText(c: Copy): { label: string; sr: string } {
  return { label: c.seeItWork.shareLabel, sr: c.seeItWork.shareSr.replace('{payload}', c.seeItWork.sharePayload) };
}

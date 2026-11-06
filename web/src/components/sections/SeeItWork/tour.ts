// Data for the app tour (brief 8.6). Rows come from copy.seeItWork; the stage plays SLIDES.
import type { AppClipName } from '@/content/types';
import { APP_CLIPS } from '@/content/media';
import { copy, type Copy } from '@/content/copy';
import { optSrc } from '@/lib/imageLoader';

/** Rows come from useCopy().seeItWork.rows; both versions have the same four. */
export const ROW_COUNT = copy.seeItWork.rows.length;

/**
 * Everything the stage can show, in order: one real recording per row. The rows walk today's pathway (PRD-V2), the
 * same on both versions: the kid names the dish on /miss and taps Ask Mom (the sheet with the message is the share
 * moment), Mom answers by voice on /a and her version fills in, the kid's card shows her words and her voice, and
 * the app asks her to film it next time. The text Ask Mom really sends is shown beside the phone.
 */
export const SLIDES: readonly AppClipName[] = ['web-miss', 'web-answer', 'web-version', 'app-request'];

/** slides per row, in play order (a row with more than one chains them) */
export const ROW_SLIDES: readonly (readonly number[])[] = [[0], [1], [2], [3]];

/** web-miss, the recording with the Ask Mom sheet */
export const SHARE_SLIDE = SLIDES.indexOf('web-miss');
/** web-miss: the Ask Mom sheet is up at ~6.0s */
export const SHARE_TAP_AT = 6.0;

export const rowOfSlide = (s: number) => ROW_SLIDES.findIndex((r) => r.includes(s));

/** the row that sends the recipe: its words carry the share bubble and the share sentence */
export const SHARE_ROW = rowOfSlide(SHARE_SLIDE);
/** the row whose recording plays her voice on the card: its chip gets the ▶ */
export const WATCH_ROW = rowOfSlide(SLIDES.indexOf('web-version'));

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
  'web-miss': '/media/app/web-miss-ask.jpg', // the end: the Ask Mom sheet with the message, link copied
  'web-answer': '/media/app/web-answer-sent.jpg', // the end: "Sent to Caleb."
  'web-version': '/media/app/web-version-words.jpg', // the end: her amounts and words on the card
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

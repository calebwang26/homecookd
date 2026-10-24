// The story's own logic, kept free of React so scripts/test-recap.mjs runs it under Node: which slide a
// tap goes to, the colour of each slide, the numbers in a title, and which clip the "voices" slide plays.
import type { MissHomeClip } from '@/lib/missHome';
import type { RecapClip, RecapPhoto, RecapSlideType } from '@/lib/recapApi';
import { colors } from '@/theme/tokens';

/** Where a tap or a button leaves the story: another slide, or done (past the last one). */
export type StoryStep = { index: number; done: boolean };

/** Forward past the last slide is done; back from the first stays there. */
export function stepStory(index: number, count: number, dir: 1 | -1): StoryStep {
  if (count <= 0) return { index: 0, done: true };
  const at = Math.min(Math.max(0, Math.floor(index) || 0), count - 1);
  if (dir === 1) return at >= count - 1 ? { index: at, done: true } : { index: at + 1, done: false };
  return { index: Math.max(0, at - 1), done: false };
}

/** A tap on the left third goes back; anywhere else goes forward (the stories convention). */
export function tapDirection(x: number, width: number): 1 | -1 {
  return width > 0 && x < width / 3 ? -1 : 1;
}

/** Progress bars: every slide seen so far, this one included, is filled. */
export const barFilled = (bar: number, index: number) => bar <= index;

export type SlideTone = {
  /** The whole screen behind the slide. */
  bg: string;
  /** Titles & icons. */
  fg: string;
  /** Secondary lines. */
  soft: string;
  /** The numbers in a title. */
  accent: string;
  /** Filled & empty progress bars. */
  barOn: string;
  barOff: string;
  /** Dark slides take light controls. */
  dark: boolean;
};

const light = (bg: string, soft: string, accent: string = colors.green): SlideTone => ({
  bg,
  fg: colors.ink,
  soft,
  accent,
  barOn: colors.ink,
  barOff: 'rgba(30,36,16,0.14)',
  dark: false,
});
const dark: SlideTone = {
  bg: colors.olive,
  fg: colors.card,
  soft: 'rgba(255,253,247,0.78)',
  accent: colors.sun,
  barOn: colors.card,
  barOff: 'rgba(255,253,247,0.28)',
  dark: true,
};

/** Hearth colours, one per slide type: the olive hero tone opens & closes, warm washes between. */
export const SLIDE_TONES: Record<RecapSlideType, SlideTone> = {
  cover: dark,
  cooked: light(colors.peach, colors.peachInk),
  most_made: light(colors.butter, colors.butterInk),
  voices: light(colors.lavender, colors.lavenderInk),
  hearts_left: light(colors.rose, colors.peachInk, colors.danger),
  then_now: light(colors.page, colors.muted),
  dishes_cooked: light(colors.sage, colors.sageInk),
  most_loved: light(colors.butter, colors.butterInk, colors.danger),
  postcards: light(colors.peach, colors.peachInk),
  answered: light(colors.lavender, colors.lavenderInk),
  close: dark,
};

/** A title cut into plain text & accents (its numbers and a heart), so those carry the slide's accent. */
export function titleParts(title: string): { text: string; accent: boolean }[] {
  return title
    .split(/(\d+|\u2665)/)
    .filter((t) => t.length > 0)
    .map((text) => ({ text, accent: /^(\d+|\u2665)$/.test(text) }));
}

/** At most `max` photos, newest last as the server sends them. */
export const photosShown = (list: RecapPhoto[], max = 4) => list.slice(0, max);

/** A postcard's tilt in degrees (1.5 at most, alternating, never on a lone photo). */
export const tiltOf = (i: number, count: number) => (count < 2 ? 0 : i % 2 === 0 ? -1.5 : 1.5);

/** The most little hearts the slide draws; past it, one big heart instead. */
export const HEARTS_DRAWN_MAX = 12;

/**
 * How many little hearts to draw: exactly the count, up to 12. Past 12 none (oneBigHeart), so the
 * picture never shows a different number from the title's.
 */
export const heartsShown = (n: number) => {
  const k = Math.max(0, Math.floor(n));
  return k <= HEARTS_DRAWN_MAX ? k : 0;
};

/** More hearts than the slide can draw one by one: a single big heart stands for them. */
export const oneBigHeart = (n: number) => Math.floor(n) > HEARTS_DRAWN_MAX;

/**
 * The clip the "voices" slide plays: from the "I miss home" pool (a family cook's real recording, her
 * words verbatim), the moment that starts where the most-played clip started, else the one it falls
 * inside. Null when it can't be found (then the slide shows no play button: never a guessed range).
 */
export function findVoiceClip(pool: MissHomeClip[], clip: RecapClip | null | undefined): MissHomeClip | null {
  if (!clip || clip.start_s == null) return null;
  const start = Math.floor(clip.start_s);
  const mine = pool.filter((c) => c.recipeId === clip.recipe_id && c.cookId === clip.cook_id);
  return mine.find((c) => c.start_s === start) ?? mine.find((c) => c.start_s <= start && start < c.end_s) ?? null;
}

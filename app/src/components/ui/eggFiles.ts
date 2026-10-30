// The egg's pure rules (brand kit, docs/brand/BRAND-HANDOFF.md section 6), tested in scripts/test-brand.mjs.
//   markFile(size)   the logo file by rendered size: 64 and up mark.svg, 24-63 mark-small.svg (thicker
//                    lines), 23 and under mark-tiny.svg (no face). Never scale mark.svg down instead.
//   moodFile(mood)   a mascot mood. One per screen at most; it reacts, it never speaks for the cook:
//                      hello      greetings: the home greeting, onboarding, a welcome
//                      listening  while a voice plays (the cook's voice, a voice note)
//                      made-it    the logo itself, and success ("I made it", sent, published)
//                      sleepy     empty states
//                      oops       errors (upload failed, offline, something went wrong)
//   lockupWidth(h)   the horizontal lockup's width at a height (its viewBox is 12058 x 2342)
import type { BrandFile } from './brandSvgs';

export type EggMood = 'hello' | 'listening' | 'made-it' | 'sleepy' | 'oops';

export function markFile(size: number, reversed = false): BrandFile {
  if (reversed) return 'mark-reversed.svg';
  if (size >= 64) return 'mark.svg';
  if (size >= 24) return 'mark-small.svg';
  return 'mark-tiny.svg';
}

export function moodFile(mood: EggMood): BrandFile {
  return `mascot/${mood}.svg`;
}

export const LOCKUP_RATIO = 12058 / 2342;

/** The kit's smallest horizontal lockup (BRAND-HANDOFF 6): under this, show the mark alone. */
export const LOCKUP_MIN_WIDTH = 96;

export function lockupWidth(height: number): number {
  return Math.round(height * LOCKUP_RATIO);
}

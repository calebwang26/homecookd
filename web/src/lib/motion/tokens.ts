// Motion numbers mirrored from tokens.css (brief 3.1). Use these in GSAP / motion code.
//   import { EASE, DUR, STAGGER, SCRUB, HEX, SPRING } from '@/lib/motion/tokens';
//   animate(el, { opacity: 1 }, { duration: DUR.word, ease: EASE.quart });
//   gsap.to(el, { color: HEX.ink, ease: GS_EASE.inOut });

export type Bezier = [number, number, number, number];

export const EASE = {
  expo: [0.16, 1, 0.3, 1] as Bezier, // arrivals, glides
  quart: [0.25, 1, 0.5, 1] as Bezier, // word reveals
  inOut: [0.65, 0, 0.35, 1] as Bezier, // scrubbed layout morphs only
  soft: [0.22, 1, 0.36, 1] as Bezier, // cards/photos rise, video swaps
  back: [0.34, 1.4, 0.64, 1] as Bezier, // the one tiny overshoot
};

/** GSAP ease strings that match EASE (GSAP has no cubic-bezier without CustomEase). */
export const GS_EASE = {
  expo: 'expo.out',
  quart: 'power4.out',
  inOut: 'power2.inOut',
  soft: 'power3.out',
  back: 'back.out(1.4)',
} as const;

/** Durations in seconds. */
export const DUR = {
  word: 0.55,
  wordColor: 0.6,
  wordColorDelay: 0.12,
  para: 0.4,
  card: 0.8,
  glide: 0.7,
  swap: 0.45,
  highlight: 0.45,
  idle: 3.6,
} as const;

export const SCRUB = 0.6;

export const STAGGER = {
  heroWord: 0.1,
  word: 0.07,
  para: 0.02,
  card: 0.08,
  letter: 0.026,
  footer: 0.14,
} as const;

/** motion springs (mass 1). `chip` and `hover` are mirrored in CSS as --ease-spring-pop / --ease-spring
 *  (linear() samples in tokens.css), so a CSS transition and a motion animate() feel the same.
 *    animate(el, { scale: [0, 1] }, SPRING.chip)
 *    animate(el, { x: 4 }, SPRING.hover) */
export const SPRING = {
  /** speech-bubble pop: ~25% overshoot, settles in ~0.75s */
  chip: { type: 'spring', stiffness: 500, damping: 18 } as const,
  /** hover / press micro-motion: ~7% overshoot, ~0.65s (CSS: --ease-spring) */
  hover: { type: 'spring', stiffness: 300, damping: 22 } as const,
  /** cards settling into place: no visible overshoot */
  soft: { type: 'spring', stiffness: 220, damping: 26 } as const,
  /** the physics drop (Measures): one soft bounce */
  drop: { type: 'spring', bounce: 0.35, duration: 0.9 } as const,
};

/** Token colors as hex (CSS variables can't be interpolated by GSAP color tweens). */
export const HEX = {
  canvas: '#EEF3F0',
  surface: '#FFFFFF',
  sunken: '#E3EBE6',
  pistachioWash: '#FDF1DE',
  footerBg: '#FDF1DE',
  heroDark: '#18221D',
  ink: '#18221D',
  text: '#18221D',
  muted: '#4F5D55',
  ghost: '#C9D4CD',
  cream: '#FFFFFF',
  mutedInverse: '#B9CFC3',
  forest: '#244A39',
  forestSwirl: '#2B5443',
  greenDeep: '#244A39',
  green: '#244A39',
  greenSwirl: '#2B5443',
  leaf: '#A3580C',
  lime: '#F2A23A',
  chartreuse: '#F2A23A',
  chartreuseSwirl: '#F2A23A',
  sage: '#DCEBE2',
  limeWash: '#DCEBE2',
  oliveInk: '#244A39',
  sun: '#F2A23A',
  sunSwirl: '#F6B456',
  highlighter: '#F6BE75',
  lemon: '#FBDEBA',
  butter: '#FCEBD0',
  tomato: '#E95D3D',
  tomatoDeep: '#C8462A',
  tomatoInk: '#A8361B',
  apricot: '#FFB677',
  apricotSoft: '#FFDDBF',
  apricotInk: '#8A3F12',
  peach: '#FCEBD0',
  peachInk: '#18221D',
  blush: '#FAD6CB',
  ube: '#FFFFFF',
  ubeInk: '#18221D',
  cocoa: '#18221D',
  black: '#111915',
  /** pale tint of green, the starting color for accent words (a7: accents start pale) */
  greenPale: '#B9D3C5',
  /** yolk-deep (accent text) and its pale tint, where an accent word ends in yolk-deep */
  yolkDeep: '#A3580C',
  yolkPale: '#EBCB9F',
  /** pale tint of chartreuse on dark blocks */
  chartreusePale: '#5E8C75',
} as const;

export type HexName = keyof typeof HEX;

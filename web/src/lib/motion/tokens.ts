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
  canvas: '#FBF5EA',
  surface: '#FFFFFF',
  sunken: '#F3EAD9',
  pistachioWash: '#FDF1DE',
  footerBg: '#FDF1DE',
  heroDark: '#1F2430',
  ink: '#1F2430',
  text: '#1F2430',
  muted: '#5B554E',
  ghost: '#D8CEBD',
  cream: '#FFFFFF',
  mutedInverse: '#C9D0AE',
  forest: '#34430C',
  forestSwirl: '#3D4E10',
  greenDeep: '#4C5A10',
  green: '#34430C',
  greenSwirl: '#64790A',
  leaf: '#A3580C',
  lime: '#F2A23A',
  chartreuse: '#F2A23A',
  chartreuseSwirl: '#F2A23A',
  sage: '#E6EBCF',
  limeWash: '#E6EBCF',
  oliveInk: '#34430C',
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
  peachInk: '#1F2430',
  blush: '#FAD6CB',
  ube: '#FFFFFF',
  ubeInk: '#1F2430',
  cocoa: '#1F2430',
  black: '#15181f',
  /** pale tint of green, the starting color for accent words (a7: accents start pale) */
  greenPale: '#C9D29A',
  /** pale tint of chartreuse on dark blocks */
  chartreusePale: '#7E8A3A',
} as const;

export type HexName = keyof typeof HEX;

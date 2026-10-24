// Deck layouts (brief 8.1–8.5, a7 M6/M8/M9/M14). Pure functions, no DOM.
//
// Every pose gives the card's CENTER in stage coordinates (origin = stage top-left) as Lens, which
// mix vw / vh / px so geometry stays in viewport units until you resolve it on refresh:
//
//   const vp = { w: innerWidth, h: innerHeight };
//   gsap.to(cards, { x: (i) => px(fan(i, 7).x, vp) - cardW / 2, y: (i) => px(fan(i, 7).y, vp) - cardH / 2,
//                    rotate: (i) => fan(i, 7).rotate, scale: (i) => fan(i, 7).scale });
//
// or for static CSS:   style={poseVars(fan(i, 7))}   → --x / --y (calc strings), --r, --s, z-index
//
// `relativeTo(pose, origin)` converts an absolute pose into an offset from an anchor point, which is
// what CardFan uses to render a deck inside a normal-flow block.

export interface Len {
  vw?: number;
  vh?: number;
  px?: number;
}

export interface Pose {
  /** card center x */
  x: Len;
  /** card center y */
  y: Len;
  /** degrees */
  rotate: number;
  scale: number;
  z: number;
  /** card width in vw (when the layout fixes it) */
  w?: number;
  /** card height (when the layout fixes it; otherwise w × 5/4) */
  h?: Len;
}

export interface Viewport {
  w: number;
  h: number;
}

/** Card sizes in vw (4:5 cards). */
export const CARD = {
  fanDesktop: 16,
  fanMobile: 34,
  /** step cards 0–2 and the trailing cards 3–5 (w × h in vw) */
  stepBig: { w: 18, h: 24 },
  stepSmall: { w: 15, h: 19 },
  /** folder grid cards (w in vw, h in vh) */
  grid: { w: 16, h: 26 },
  ratio: 5 / 4,
} as const;

export const px = (l: Len, vp: Viewport): number => (l.vw ?? 0) * vp.w / 100 + (l.vh ?? 0) * vp.h / 100 + (l.px ?? 0);

export const css = (l: Len): string => {
  const parts: string[] = [];
  if (l.vw) parts.push(`${round(l.vw)}vw`);
  if (l.vh) parts.push(`${round(l.vh)}vh`);
  if (l.px) parts.push(`${round(l.px)}px`);
  if (parts.length === 0) return '0px';
  return parts.length === 1 ? parts[0] : `calc(${parts.join(' + ')})`;
};

export const add = (a: Len, b: Len): Len => ({
  vw: (a.vw ?? 0) + (b.vw ?? 0),
  vh: (a.vh ?? 0) + (b.vh ?? 0),
  px: (a.px ?? 0) + (b.px ?? 0),
});

export const sub = (a: Len, b: Len): Len => add(a, { vw: -(b.vw ?? 0), vh: -(b.vh ?? 0), px: -(b.px ?? 0) });

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Normalized slot position t ∈ [−.5, .5]. */
const tOf = (i: number, n: number) => (n <= 1 ? 0 : i / (n - 1) - 0.5);

/**
 * a7 M6 fan. Desktop: 7 cards at 16vw, x = 50 + t·56 vw, y = 60vh + 8t² vw (smile),
 * rotate = t·14 − 1 (−8° → +6°), scale = .88 + .48t², z = i.
 * Mobile: 5 cards at 34vw, x = 50 + t·58, rotate = t·20, y centered at 56vh (+ 6t² vw smile).
 */
export function fan(i: number, n: number, opts: { mobile?: boolean; cx?: Len; cy?: Len } = {}): Pose {
  const t = tOf(i, n);
  if (opts.mobile) {
    return {
      x: add(opts.cx ?? { vw: 50 }, { vw: t * 58 }),
      y: add(opts.cy ?? { vh: 56 }, { vw: 6 * t * t }),
      rotate: t * 20,
      scale: 0.9 + 0.4 * t * t,
      z: i,
      w: CARD.fanMobile,
    };
  }
  return {
    x: add(opts.cx ?? { vw: 50 }, { vw: t * 56 }),
    y: add(opts.cy ?? { vh: 60 }, { vw: 8 * t * t }),
    rotate: t * 14 - 1,
    scale: 0.88 + 0.48 * t * t,
    z: i,
    w: CARD.fanDesktop,
  };
}

/**
 * a7 M8 stack: the front card (i = n−1) at the center, the others tucked behind it,
 * each 0.6vw further left, rotated −1° more and 2% smaller.
 */
export function stack(i: number, n: number, opts: { cx?: Len; cy?: Len; w?: number } = {}): Pose {
  const k = n - 1 - i;
  return {
    x: add(opts.cx ?? { vw: 50 }, { vw: -0.6 * k }),
    y: opts.cy ?? { vh: 60 },
    rotate: -1 * k,
    scale: 1 - 0.02 * k,
    z: i,
    w: opts.w,
  };
}

/** StepsToBox stairs: stage-relative TOP-LEFT positions (x vw, y vh) from brief 8.4. */
export const STAIRS_TOP_LEFT: [number, number][] = [
  [6, 12],
  [20, 26],
  [34, 40],
  [46, 56],
  [54, 70],
  [60, 84],
];

/**
 * a7 M9 staircase (StepsToBox, desktop). Cards 0–2 are 18×24vw, 3–5 are 15×19vw; z rises toward
 * the bottom-right. Returned as centers (so x/y = top-left + half the size).
 */
export function stairs(i: number): Pose {
  const [x0, y0] = STAIRS_TOP_LEFT[Math.min(i, STAIRS_TOP_LEFT.length - 1)];
  const size = i < 3 ? CARD.stepBig : CARD.stepSmall;
  return {
    x: { vw: x0 + size.w / 2 },
    y: { vh: y0, vw: size.h / 2 },
    rotate: 0,
    scale: 1,
    z: i + 1,
    w: size.w,
    h: { vw: size.h },
  };
}

export interface GridOpts {
  cols?: number;
  rows?: number;
  /** folder panel, stage-relative: left/width in vw, top/height in vh */
  panel?: { left: number; top: number; width: number; height: number };
  card?: { w: number; h: number };
  /** gap in vw */
  gap?: number;
  /** space reserved at the top of the panel for the folder tabs (vh) */
  tabs?: number;
}

/** Folder panel (brief 8.4 fold): stage-relative at left 2vw, top 18vh, 54vw × 66vh. */
export const FOLDER_PANEL = { left: 2, top: 18, width: 54, height: 66 } as const;

/**
 * a7 M14 grid inside the folder panel: 3×2 by default, cards 16vw × 26vh with a 1.5vw gap,
 * centered horizontally in the panel and vertically in the space under the tabs.
 */
export function grid(i: number, opts: GridOpts = {}): Pose {
  const cols = opts.cols ?? 3;
  const rows = opts.rows ?? 2;
  const panel = opts.panel ?? FOLDER_PANEL;
  const card = opts.card ?? CARD.grid;
  const gap = opts.gap ?? 1.5;
  const tabs = opts.tabs ?? 4;
  const col = i % cols;
  const row = Math.floor(i / cols) % rows;
  const gridW = cols * card.w + (cols - 1) * gap;
  const left = panel.left + (panel.width - gridW) / 2;
  // vertical: rows of card.h (vh) separated by gap (vw), centered in the panel below the tabs
  const freeVh = panel.height - tabs - rows * card.h;
  const top: Len = { vh: panel.top + tabs + freeVh / 2, vw: -((rows - 1) * gap) / 2 };
  return {
    x: { vw: left + col * (card.w + gap) + card.w / 2 },
    y: add(top, { vh: row * card.h + card.h / 2, vw: row * gap }),
    rotate: 0,
    scale: 1,
    z: i + 1,
    w: card.w,
    h: { vh: card.h },
  };
}

/** Offset of a pose from an anchor point (for decks rendered inside a normal-flow block). */
export function relativeTo(p: Pose, origin: { x: Len; y: Len }): Pose {
  return { ...p, x: sub(p.x, origin.x), y: sub(p.y, origin.y) };
}

/** Resolve a pose to px (for GSAP function-based values; measure on refresh, never per frame). */
export function toPx(p: Pose, vp: Viewport): { x: number; y: number; rotate: number; scale: number; z: number; w?: number; h?: number } {
  return {
    x: px(p.x, vp),
    y: px(p.y, vp),
    rotate: p.rotate,
    scale: p.scale,
    z: p.z,
    w: p.w !== undefined ? (p.w * vp.w) / 100 : undefined,
    h: p.h ? px(p.h, vp) : p.w !== undefined ? ((p.w * vp.w) / 100) * CARD.ratio : undefined,
  };
}

/** CSS custom properties for static rendering: --x, --y (calc strings), --r (deg), --s, z-index. */
export function poseVars(p: Pose, prefix = ''): Record<string, string | number> {
  return {
    [`--${prefix}x`]: css(p.x),
    [`--${prefix}y`]: css(p.y),
    [`--${prefix}r`]: `${round(p.rotate)}deg`,
    [`--${prefix}s`]: round(p.scale),
    [`--${prefix}z`]: p.z,
  };
}

/** A tiny deterministic PRNG (mulberry32) for scattered-but-stable layouts (icon clusters, piles). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

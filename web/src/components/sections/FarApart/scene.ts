// Far apart choreography helpers (brief 8.9). Pure geometry: no DOM writes.
//
// Every traveler (the arc card, the reply bubble) rests at its FINAL place in CSS, so SSR, reduced
// motion and no-JS show the finished scene. Its start is an invisible anchor point placed in CSS on
// the other card. On refresh we measure both from layout (offsetLeft/Top ignore transforms) and the
// scene moves the traveler along a quadratic bezier from the anchor back to rest (0, 0).

export interface Pt {
  x: number;
  y: number;
}

export interface Flight {
  /** start offset from the resting place (px) */
  from: Pt;
  /** bezier control point (px, relative to the resting place) */
  ctrl: Pt;
}

/** Center of an element in its offsetParent's coordinates, ignoring transforms. */
export function layoutCenter(el: HTMLElement): Pt {
  return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
}

/** Flight from `anchor` (a point element) to `traveler`'s resting center, lifted `lift` px at the midpoint. */
export function measureFlight(traveler: HTMLElement, anchor: HTMLElement, lift: number): Flight {
  const rest = layoutCenter(traveler);
  const start = { x: anchor.offsetLeft, y: anchor.offsetTop };
  const from = { x: start.x - rest.x, y: start.y - rest.y };
  // control point: above the straight line's midpoint
  return { from, ctrl: { x: from.x / 2, y: from.y / 2 - lift } };
}

/** Quadratic bezier from `f.from` (t = 0) to the resting place (t = 1). */
export function along(f: Flight, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * f.from.x + 2 * u * t * f.ctrl.x,
    y: u * u * f.from.y + 2 * u * t * f.ctrl.y,
  };
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** smooth in-out (sine), the glide feel for a flight that starts and ends at rest */
export const inOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);

/**
 * Beats of the story. The film (desktop scrub) derives them from progress; the timed version
 * (mobile, short desktop) steps through them in order.
 *   0  the recipe rests on the cook's card
 *   1  it has landed far from home: "Delivered ✓"
 *   2  the first-try photo pops up and heads back
 *   3  it lands: "Delivered · Grandma ♥" (the card's cook), her answer, the pot smiles
 */
export type Beat = 0 | 1 | 2 | 3;
export const FINAL_BEAT: Beat = 3;

/** Scroll map (fractions of the pinned 70vh), brief 8.9's table. */
export const FILM = {
  arc: [0.1, 0.45] as const,
  delivered: 0.45,
  reply: [0.5, 0.8] as const,
  landed: 0.8,
};

export function beatAt(p: number): Beat {
  if (p >= FILM.landed) return 3;
  if (p >= FILM.reply[0]) return 2;
  if (p >= FILM.delivered) return 1;
  return 0;
}

/** progress → 0..1 inside [a, b] */
export const span = (p: number, [a, b]: readonly [number, number]) => clamp01((p - a) / (b - a));

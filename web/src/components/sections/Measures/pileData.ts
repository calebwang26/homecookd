// Precomputed final pile for the Measures "physics" drop (brief 8.10, a7 M22). Pure data.
//
// Units: x and y are sticker CENTERS in sticker diameters (D) measured from the panel floor and from
// the panel's left (anchor 'l') or right (anchor 'r') edge. Touching stickers on the floor sit 1.05 D
// apart; a sticker resting in the valley between two of them sits 0.851 D higher (√(1 − 0.525²)).
// Array order is the drop order: the stream runs left → right along the floor, then the second layer.
import type { IngredientId } from './stickers/Ingredients';

export interface PileItem {
  id: IngredientId;
  anchor: 'l' | 'r';
  x: number;
  y: number;
  /** resting rotation (deg) */
  r: number;
  /** spin while falling: start rotation = r − spin */
  spin: number;
  /** how far left of its rest x it spawns (vw), so it rolls into place */
  drift: number;
}

const ROW2 = 0.5 + 0.851;

// Desktop (a7 M22: "a loose single/double layer, not a heap"): one loose floor layer runs the whole
// width, left → right, with a small bump where the stream starts; the right pair touches (1.05 D) so
// the mascot can land on top of them. The panel floor is ~16.66 D between its side insets, so a
// right-anchored x equals 16.66 − the left-anchored x.
export const PILE_DESKTOP: PileItem[] = [
  { id: 'scallion', anchor: 'l', x: 1.05, y: 0.5, r: -14, spin: -96, drift: 3.2 },
  { id: 'bay-leaf', anchor: 'l', x: 2.25, y: 0.5, r: 22, spin: 118, drift: 2.4 },
  { id: 'peppercorn', anchor: 'l', x: 3.6, y: 0.5, r: -30, spin: -70, drift: 1.6 },
  { id: 'cinnamon', anchor: 'l', x: 5.15, y: 0.5, r: 8, spin: 112, drift: 4 },
  { id: 'garlic', anchor: 'l', x: 6.75, y: 0.5, r: -10, spin: -84, drift: 2.8 },
  { id: 'tomato', anchor: 'l', x: 8.3, y: 0.5, r: 18, spin: 102, drift: 2 },
  { id: 'ginger', anchor: 'l', x: 9.8, y: 0.5, r: 12, spin: -90, drift: 3 },
  { id: 'dumpling', anchor: 'l', x: 11.4, y: 0.5, r: -6, spin: -120, drift: 3.6 },
  { id: 'chili', anchor: 'r', x: 3.65, y: 0.5, r: -28, spin: 110, drift: 2.2 },
  { id: 'lemon', anchor: 'r', x: 2.2, y: 0.5, r: 24, spin: 76, drift: 1.8 },
  { id: 'egg', anchor: 'r', x: 1.15, y: 0.5, r: -20, spin: -64, drift: 2.6 },
  // in the valley between bay leaf and peppercorn (1.35 D apart: √(1 − 0.675²) = 0.738 higher)
  { id: 'star-anise', anchor: 'l', x: 2.925, y: 1.238, r: 30, spin: 120, drift: 1.4 },
];

export const PILE_MOBILE: PileItem[] = [
  { id: 'garlic', anchor: 'l', x: 0.8, y: 0.5, r: -12, spin: -96, drift: 4 },
  { id: 'tomato', anchor: 'r', x: 4.0, y: 0.5, r: 18, spin: 102, drift: 5 },
  { id: 'dumpling', anchor: 'r', x: 2.95, y: 0.5, r: -6, spin: -110, drift: 6 },
  { id: 'lemon', anchor: 'r', x: 1.9, y: 0.5, r: 24, spin: 80, drift: 4 },
  { id: 'egg', anchor: 'r', x: 0.85, y: 0.5, r: -20, spin: -70, drift: 5 },
  { id: 'chili', anchor: 'r', x: 3.475, y: ROW2, r: -28, spin: 110, drift: 4 },
  { id: 'star-anise', anchor: 'r', x: 2.425, y: ROW2, r: 30, spin: -100, drift: 3 },
  { id: 'scallion', anchor: 'r', x: 1.375, y: ROW2, r: -18, spin: 90, drift: 5 },
];

// The pot mascot lands last, on top: in the valley between egg and lemon on desktop (--mx 1.675 D from
// the right, --mb 0.709 D), between two second-layer stickers below 1024px (--mx 2.95, --mb 1.56).
// Both live in Measures.module.css.

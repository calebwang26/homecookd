// The Community map's geometry, as pure functions (tested by scripts/test-community-ui.mjs):
//   cellKey(at)                       a ~1 km grid cell's key: dishes in one cell share a circle
//   project(at, here, size)           lat/lng -> x/y on the square map, `here` in the middle
//   layoutSpots(recipes, here, size)  one circle per cell, nudged apart so none covers another or "You"
//   placeAreas(here, size, spots)     neighborhood names at their real places (off the map, or where a
//                                     circle or "You" would cover them: not drawn)
// Nothing here imports React or the app, so Node runs it as is.
import type { LatLng } from '@/lib/live/community';

/** A dish circle's diameter. */
export const PHOTO = 54;
/** From the middle to the edge. The seeded neighbors (0.5–3 mi) all fit; farther ones sit on the edge. */
export const HALF_MILES = 3.2;
/** Room the "You" dot and its label keep around the middle. */
export const YOU_CLEAR = 30;
const EDGE = 6; // between a circle and the map's border
const GAP = 6; // between two circles
const ROUNDS = 60;

const MI_PER_DEG_LAT = 69.0;
const MI_PER_DEG_LNG = 69.17; // at the equator; times cos(latitude)

/** "42.36,-71.09". */
export function cellKey(at: LatLng): string {
  const two = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  return `${two(at.lat)},${two(at.lng)}`;
}

/** Miles east and north of `here`. */
export function milesFrom(at: LatLng, here: LatLng): { east: number; north: number } {
  return {
    east: (at.lng - here.lng) * MI_PER_DEG_LNG * Math.cos((here.lat * Math.PI) / 180),
    north: (at.lat - here.lat) * MI_PER_DEG_LAT,
  };
}

/**
 * Where a place lands on a `size` pt square map with `here` in the middle. Distance is drawn on a
 * square-root scale, so the close ones get room and the far ones still fit: HALF_MILES reaches
 * `inset` from the edge. `pin` keeps anything farther on that edge, in its direction.
 */
export function project(at: LatLng, here: LatLng, size: number, inset = PHOTO / 2 + EDGE, pin = true): { x: number; y: number } {
  const { east, north } = milesFrom(at, here);
  const miles = Math.hypot(east, north);
  const mid = size / 2;
  if (miles === 0) return { x: mid, y: mid };
  const r = (mid - inset) * Math.sqrt((pin ? Math.min(miles, HALF_MILES) : miles) / HALF_MILES);
  return { x: mid + (east / miles) * r, y: mid - (north / miles) * r };
}

export type Spot<R> = { key: string; members: R[]; x: number; y: number };

/** Up and to the right first (as in the mockup), then around by the golden angle. */
function away(i: number): [number, number] {
  const t = -Math.PI / 4 + i * 2.39996;
  return [Math.cos(t), Math.sin(t)];
}

/**
 * One circle per grid cell, in the feed's order (nearest first), each cell's dishes in that order too.
 * Circles start where `project` puts them, then a few rounds push apart any two that touch and any
 * that sit on "You" in the middle, inside the map's border.
 */
export function layoutSpots<R extends { approx: LatLng }>(recipes: readonly R[], here: LatLng | null, size: number): Spot<R>[] {
  if (!here) return [];
  const byCell = new Map<string, Spot<R>>();
  for (const r of recipes) {
    const key = cellKey(r.approx);
    const spot = byCell.get(key);
    if (spot) spot.members.push(r);
    else byCell.set(key, { key, members: [r], ...project(r.approx, here, size) });
  }
  const spots = [...byCell.values()];
  const mid = size / 2;
  const lo = PHOTO / 2 + EDGE;
  const hi = size - lo;
  const apart = PHOTO + GAP;
  const clear = PHOTO / 2 + YOU_CLEAR;
  for (let round = 0; round < ROUNDS; round++) {
    let moved = false;
    spots.forEach((s, i) => {
      const d = Math.hypot(s.x - mid, s.y - mid);
      if (d >= clear) return;
      const [ux, uy] = d < 1e-6 ? away(i) : [(s.x - mid) / d, (s.y - mid) / d];
      s.x = mid + ux * clear;
      s.y = mid + uy * clear;
      moved = true;
    });
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i];
        const b = spots[j];
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        if (d >= apart) continue;
        const [ux, uy] = d < 1e-6 ? away(j) : [(b.x - a.x) / d, (b.y - a.y) / d];
        const push = (apart - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    for (const s of spots) {
      s.x = Math.min(hi, Math.max(lo, s.x));
      s.y = Math.min(hi, Math.max(lo, s.y));
    }
    if (!moved) break;
  }
  return spots;
}

/**
 * Neighborhood names for the map, at their real places (Cambridge, around the placeholder venue in
 * convex/lib/geo.ts). With `here` somewhere else they fall off the map and aren't drawn.
 */
export const MAP_AREAS: { name: string; at: LatLng }[] = [
  { name: 'Kendall', at: { lat: 42.3625, lng: -71.0862 } },
  { name: 'Central Square', at: { lat: 42.3655, lng: -71.1038 } },
  { name: 'Inman Square', at: { lat: 42.3734, lng: -71.1006 } },
  { name: 'Harvard Square', at: { lat: 42.3734, lng: -71.1189 } },
  { name: 'Porter Square', at: { lat: 42.3884, lng: -71.1191 } },
  { name: 'Back Bay', at: { lat: 42.3496, lng: -71.0779 } },
  { name: 'Beacon Hill', at: { lat: 42.3588, lng: -71.0707 } },
];

export type Box = { x0: number; y0: number; x1: number; y1: number };

export const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** About how much room a name takes, centred on its spot (Fraunces 600 at 13 pt). */
export function nameBox(name: string, x: number, y: number): Box {
  const half = (name.length * 7.2) / 2;
  return { x0: x - half, y0: y - 10, x1: x + half, y1: y + 10 };
}

/** What a name must stay clear of: every circle (with a little room) and "You" with its tag below. */
export function takenBoxes(spots: readonly { x: number; y: number }[], size: number): Box[] {
  const r = PHOTO / 2 + 2;
  const mid = size / 2;
  return [{ x0: mid - 24, y0: mid - 24, x1: mid + 24, y1: mid + 38 }, ...spots.map((s) => ({ x0: s.x - r, y0: s.y - r, x1: s.x + r, y1: s.y + r }))];
}

/** A neighborhood is an area, so its name may sit a little off its middle to stay clear. */
const NUDGES: [number, number][] = [[0, 0], [-16, 0], [16, 0], [0, -14], [0, 14], [-32, 0], [32, 0]];

/** The names that land fully on the map without touching a circle, "You" or another name. */
export function placeAreas(here: LatLng | null, size: number, spots: readonly { x: number; y: number }[] = []): { name: string; x: number; y: number }[] {
  if (!here) return [];
  const taken = takenBoxes(spots, size);
  const out: { name: string; x: number; y: number }[] = [];
  for (const a of MAP_AREAS) {
    const at = project(a.at, here, size, PHOTO / 2 + EDGE, false);
    for (const [dx, dy] of NUDGES) {
      const x = at.x + dx;
      const y = at.y + dy;
      const box = nameBox(a.name, x, y);
      if (box.x0 < EDGE || box.y0 < EDGE || box.x1 > size - EDGE || box.y1 > size - EDGE) continue;
      if (taken.some((t) => overlaps(box, t))) continue;
      taken.push(box);
      out.push({ name: a.name, x, y });
      break;
    }
  }
  return out;
}

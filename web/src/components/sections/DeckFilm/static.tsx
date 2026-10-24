// Static (SSR / reduced motion / no-JS) poses for the DeckFilm decks, as CSS custom properties.
// The same card elements are taken over by the GSAP film when it runs (DeckFilm.module.css switches
// .card from these CSS positions to transforms under .film).
import type { CSSProperties } from 'react';
import { fan, poseVars, relativeTo } from '@/lib/deck/layouts';

/** Pass-down fan: desktop pose (index di of dn) and phone pose (mi of mn), centered in the deck block. */
export function fanVars(di: number, dn: number, mi: number, mn: number): CSSProperties {
  const vars: Record<string, string | number> = {};
  if (di >= 0) Object.assign(vars, poseVars(relativeTo(fan(di, dn), { x: { vw: 50 }, y: { vh: 60 } })), { '--w': '16vw' });
  if (mi >= 0) Object.assign(vars, poseVars(relativeTo(fan(mi, mn, { mobile: true }), { x: { vw: 50 }, y: { vh: 56 } }), 'm'), { '--mw': '34vw' });
  return vars as CSSProperties;
}


'use client';
// StepsToBox film (desktop, brief 8.4–8.5): one scrubbed GSAP timeline in 0–100 units over the
// track (start 'top 85%', end 'bottom bottom' ≈ 215vh of scroll at 230vh).
//
// The stage is CSS-sticky from ~39.5% on, so the beats are placed where the visitor can see them:
//   0–20   the stack DeckFilm drops falls onto the first stair (tilt 12° → 0) while the deck lifts
//          ~14vh, so the stairs fill the band under the pass-down instead of leaving it empty
//   20–38  the recipe cards on top slide off to the tail, then the step cards deal into the stairs;
//          H2 line i fills ghost → ink as card i lands; the lift eases out by the time the stage sticks
//   38–54  hold: the pot mascot hops card 1 → 2 → 3, the REC timer runs 0:00 → 0:42, slow drift
//   54–76  fold (a7 M14): the six cards fly into the folder grid; the panel scales in behind them
//          (59), the trailing photos turn into full recipe cards, the step cards flip once they're in
//          their cells (64–74), the panel's header (title, then "+ Add a recipe") and the tabs settle in
//   74–92  the phone (real app-library recording) rises to rest in front of the folder's bottom-right corner
//   80     the deck copy hands over to the interactive FolderGrid (and back below 76)
//
// Hand-off from DeckFilm (for B1 / B7): the pass-down fan closes and drops its stack out of
// the viewport's bottom at x ≈ 50vw; this stack (tilted the same +12°) starts
// just inside this section's top edge at the same x, so it rises in from the bottom right after the
// other one leaves and straightens onto the first stair. It is never clipped by the stage's top edge
// (no slice line, no fade) and never on screen at the same time as DeckFilm's stack.
//
// Geometry is measured on every ScrollTrigger refresh (never per frame): viewport units, the deck
// card box (CSS vars --gw/--gh), and the real FolderGrid's grid rect (so the hand-over is exact).
import { gsap, ScrollTrigger } from '@/lib/motion/gsap';
import { SCRUB } from '@/lib/motion/tokens';
import { addWordFill } from '@/lib/motion/wordFill';

/** Stair top-left corners, stage-relative (x vw, y vh; this stage starts at 40vw). Down ~8vh so the
 *  mascot on the first card clears the nav; each step is 14vw so the previous card's title stays
 *  readable. The tail is three photo-only cards (a7 M13) that step down more steeply, so only the
 *  last ones bleed off the bottom-right and no text is ever cut off. */
export const STAIRS_TL: [number, number][] = [
  [6, 20],
  [20, 33],
  [34, 46],
  [48, 59],
  [52, 71],
  [56, 83],
];
/** Step cards 0–2 (front faces) in vw. */
export const STEP_CARD = { w: 18, h: 24 };
/** Trailing photo cards 3–5, width in vw (height follows the card ratio). */
export const TRAIL_W = 12;
/** The deck lifts this far (vh) while it falls and deals, then eases back by the time the stage sticks. */
const LIFT_VH = 14;
/** The mascot stands on a step card's top edge, this far (vw) from the card's left edge. */
const MASCOT_FROM_LEFT = 11.5;

export const P = {
  fallEnd: 20,
  dealStart: 20,
  /** the stage turns sticky here (track top reaches the viewport top) */
  stick: 39.5,
  holdStart: 38,
  hops: [42, 47.5] as const,
  hopLen: 4.5,
  holdEnd: 54,
  foldStart: 54,
  photosOut: 58,
  panelIn: 59,
  flipStart: 64,
  headIn: 65,
  tabsIn: 67,
  foldEnd: 76,
  phoneIn: 74,
  phoneEnd: 92,
  liveOn: 80,
  liveOff: 76,
} as const;

export interface FilmEls {
  track: HTMLElement;
  stage: HTMLElement;
  deck: HTMLElement;
  drift: HTMLElement;
  cards: HTMLElement[];
  fronts: (HTMLElement | null)[];
  photos: HTMLElement[];
  mascot: HTMLElement;
  puff: HTMLElement;
  recTime: HTMLElement | null;
  shellTitle: HTMLElement;
  shellAdd: HTMLElement;
  shellPanel: HTMLElement;
  shellTabs: HTMLElement;
  grid: HTMLElement;
  phone: HTMLElement;
  lines: HTMLElement[];
}

interface Pose {
  x: number;
  y: number;
  r: number;
  s: number;
}

interface Geo {
  vw: number;
  vh: number;
  gw: number;
  gh: number;
  fall: Pose[];
  stack: Pose[];
  stairs: Pose[];
  grid: Pose[];
  frontToGrid: number;
  mascot: { x: number; y: number }[];
}

export function queryFilmEls(root: HTMLElement): FilmEls | null {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const track = root;
  const stage = q('[data-stage]');
  const deck = q('[data-film-deck]');
  const drift = q('[data-drift]');
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-film-card]'));
  const mascot = q('[data-mascot]');
  const puff = q('[data-puff]');
  const shell = q('[data-shell]');
  const grid = q('[data-folder-grid]');
  const phone = q('[data-phone]');
  const h2 = q('[data-steps-h2]');
  if (!stage || !deck || !drift || cards.length !== 6 || !mascot || !puff || !shell || !grid || !phone || !h2) return null;
  const shellTitle = shell.querySelector<HTMLElement>('[data-fold-title]');
  const shellAdd = shell.querySelector<HTMLElement>('[data-fold-add]');
  const shellPanel = shell.querySelector<HTMLElement>('[data-fold-panel]');
  const shellTabs = shell.querySelector<HTMLElement>('[data-fold-tabs]');
  if (!shellTitle || !shellAdd || !shellPanel || !shellTabs) return null;
  return {
    track,
    stage,
    deck,
    drift,
    cards,
    fronts: cards.map((c) => c.querySelector<HTMLElement>('[data-face="front"]')),
    photos: Array.from(root.querySelectorAll<HTMLElement>('[data-photo-face]')),
    mascot,
    puff,
    recTime: deck.querySelector<HTMLElement>('[data-rec-time]'),
    shellTitle,
    shellAdd,
    shellPanel,
    shellTabs,
    grid,
    phone,
    lines: Array.from(h2.querySelectorAll<HTMLElement>('[data-line]')),
  };
}

function measure(els: FilmEls): Geo {
  const stageRect = els.stage.getBoundingClientRect();
  const vw = window.innerWidth / 100;
  const vh = (els.stage.clientHeight || window.innerHeight) / 100;
  const gw = els.cards[0].offsetWidth;
  const gh = els.cards[0].offsetHeight;
  // The stage track is max(60vw, 676px) (CSS --stair-dx): on a wider track the stairs shift right by the
  // difference, so they keep the same place on screen as on a 60vw stage that starts at 40vw.
  const ox = Math.max(0, stageRect.width - 60 * vw);

  const stairs: Pose[] = STAIRS_TL.map(([x, y], i) => {
    if (i < 3) return { x: (x + STEP_CARD.w / 2) * vw + ox, y: y * vh + (STEP_CARD.h / 2) * vw, r: 0, s: 1 };
    const s = (TRAIL_W * vw) / gw;
    return { x: (x + TRAIL_W / 2) * vw + ox, y: y * vh + (gh * s) / 2, r: 0, s };
  });

  // a7 M8 stack, landed on the first stair: front card (5) on top, the rest tucked behind it,
  // every card the width of a step card.
  const c0 = stairs[0];
  const stack: Pose[] = stairs.map((_, i) => {
    const k = 5 - i;
    const base = i < 3 ? 1 : (STEP_CARD.w * vw) / gw;
    return { x: c0.x - 0.6 * vw * k, y: c0.y + 0.3 * vw * k, r: -1.2 * k, s: base * (1 - 0.02 * k) };
  });
  // It falls in where DeckFilm drops its stack (viewport x ≈ 50vw = stage x 10vw) and drifts onto
  // the first stair as it lands. It starts as high as it can while its tilted front card stays inside
  // the stage's top edge, so it is never sliced by that edge and never visible before DeckFilm's
  // stack has left the screen.
  const fallDx = 10 * vw + ox - c0.x;
  const front = stack[5];
  const fw = gw * front.s;
  const fh = gh * front.s;
  const tilt = ((Math.abs(front.r) + 12) * Math.PI) / 180;
  const halfBox = (fh * Math.cos(tilt) + fw * Math.sin(tilt)) / 2;
  const fallDy = Math.min(0, halfBox + 6 - front.y);
  const fall: Pose[] = stack.map((p) => ({ ...p, x: p.x + fallDx, y: p.y + fallDy, r: p.r + 12 }));

  // the real grid, measured (identical positions for the hand-over)
  const g = els.grid.getBoundingClientRect();
  const cs = getComputedStyle(els.grid);
  const gapX = parseFloat(cs.columnGap) || 0;
  const gapY = parseFloat(cs.rowGap) || gapX;
  const gx = g.left - stageRect.left;
  const gy = g.top - stageRect.top;
  const grid: Pose[] = stairs.map((_, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return { x: gx + col * (gw + gapX) + gw / 2, y: gy + row * (gh + gapY) + gh / 2, r: 0, s: 1 };
  });

  const mascot = STAIRS_TL.slice(0, 3).map(([x, y]) => ({ x: (x + MASCOT_FROM_LEFT) * vw + ox, y: y * vh }));

  return { vw, vh, gw, gh, fall, stack, stairs, grid, frontToGrid: gw / (STEP_CARD.w * vw), mascot };
}

export interface FilmOptions {
  /** called when the timeline crosses P.liveOn (true) / P.liveOff (false) */
  onLive: (live: boolean) => void;
}

/** Build the desktop film. Returns a cleanup (gsap.matchMedia reverts the tweens themselves). */
export function buildFilm(els: FilmEls, opts: FilmOptions): { st: ScrollTrigger; cleanup: () => void } {
  let G = measure(els);
  const remeasure = () => {
    G = measure(els);
  };
  ScrollTrigger.addEventListener('refreshInit', remeasure);

  let live = false;
  const setLive = (v: boolean) => {
    if (v === live) return;
    live = v;
    opts.onLive(v);
  };
  let writeRec = () => {};
  const syncLive = (p: number) => {
    if (!live && p >= P.liveOn / 100) setLive(true);
    else if (live && p < P.liveOff / 100) setLive(false);
  };

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: els.track,
      start: 'top 85%',
      end: 'bottom bottom',
      scrub: SCRUB,
      invalidateOnRefresh: true,
      onRefresh: () => {
        syncLive(tl.progress());
        writeRec();
      },
      onToggle: (self) => els.deck.classList.toggle('is-active', self.isActive),
    },
  });
  tl.set({}, {}, 100); // the timeline is exactly 100 units long

  gsap.set(els.cards, { xPercent: -50, yPercent: -50, left: 0, top: 0, transformPerspective: 1600 });
  gsap.set(els.mascot, { xPercent: -50, yPercent: -100, left: 0, top: 0, transformOrigin: '50% 100%' });
  gsap.set(els.puff, { xPercent: -50, left: 0, top: 0 });

  // ---- cards: fall → stack → stairs → grid ----
  els.cards.forEach((card, i) => {
    const step = i < 3;
    tl.fromTo(
      card,
      { x: () => G.fall[i].x, y: () => G.fall[i].y, rotation: () => G.fall[i].r, scale: () => G.fall[i].s, rotationY: 0 },
      { x: () => G.stack[i].x, y: () => G.stack[i].y, rotation: () => G.stack[i].r, scale: () => G.stack[i].s, ease: 'power1.in', duration: P.fallEnd },
      0,
    );
    // deal, from the top of the pile: the three photo cards on top slide off to the tail first
    // (front card first), then the step cards fan out from under them, card 1 staying put, so card 1
    // settles ~26, card 2 ~30, card 3 ~35 (in step with the H2 lines)
    const dealAt = step ? P.dealStart + [0, 1.5, 2.5][i] : P.dealStart + (5 - i) * 0.6;
    const dealDur = step ? [6, 10, 13.5][i] : 11;
    tl.to(
      card,
      { x: () => G.stairs[i].x, y: () => G.stairs[i].y, rotation: 0, scale: () => G.stairs[i].s, ease: 'power3.out', duration: dealDur },
      dealAt,
    );
    tl.to(
      card,
      { x: () => G.grid[i].x, y: () => G.grid[i].y, scale: 1, ease: 'power2.inOut', duration: 14 },
      P.foldStart + i * 0.7,
    );
    if (step) {
      // flip once the card is (nearly) in its cell, not while it is still in flight
      tl.to(card, { rotationY: 180, ease: 'power2.inOut', duration: 8 }, P.flipStart + i);
      const front = els.fronts[i];
      if (front) tl.to(front, { scale: () => G.frontToGrid, ease: 'power2.inOut', duration: 12 }, P.foldStart);
    }
  });
  // the trailing cards fall in as full recipe cards (the front one stands in for the card DeckFilm dropped),
  // turn photo-only as they slide off to the tail (a7 M13), and back into full cards in the fold
  if (els.photos.length) {
    tl.fromTo(els.photos, { autoAlpha: 0 }, { autoAlpha: 1, ease: 'power1.inOut', duration: 5, stagger: 0.6 }, P.dealStart + 1);
    tl.to(els.photos, { autoAlpha: 0, ease: 'power1.inOut', duration: 5, stagger: 0.7 }, P.photosOut);
  }

  // ---- H2 lines fill as cards 1–3 land ----
  const fills: [number, number][] = [
    [21, 6],
    [26, 6],
    [31.5, 6.5],
  ];
  els.lines.forEach((line, i) => {
    const [at, span] = fills[i] ?? fills[fills.length - 1];
    addWordFill(tl, line, { at, span });
  });

  // ---- lift: before the stage sticks the stairs would sit low in the viewport under an empty band;
  // the deck rises while it falls and deals, then settles to its sticky pose exactly at P.stick ----
  tl.fromTo(els.drift, { y: 0 }, { y: () => -LIFT_VH * G.vh, ease: 'sine.out', duration: P.fallEnd }, 0);
  tl.to(els.drift, { y: 0, ease: 'sine.inOut', duration: P.stick - P.fallEnd }, P.fallEnd);

  // ---- hold: drift, mascot hops, REC timer ----
  tl.fromTo(els.drift, { x: 0 }, { x: () => -2 * G.vw, ease: 'sine.inOut', duration: P.holdEnd - P.holdStart }, P.holdStart);
  tl.to(els.drift, { x: 0, ease: 'power2.inOut', duration: 8 }, P.holdEnd);

  tl.fromTo(
    els.mascot,
    { x: () => G.mascot[0].x, y: () => G.mascot[0].y - 5 * G.vh, scale: 0.4, autoAlpha: 0 },
    { y: () => G.mascot[0].y, scale: 1, autoAlpha: 1, ease: 'back.out(2)', duration: 3.5 },
    35,
  );
  P.hops.forEach((at, h) => {
    const from = h;
    const to = h + 1;
    const half = P.hopLen / 2;
    tl.to(els.mascot, { x: () => G.mascot[to].x, ease: 'none', duration: P.hopLen }, at);
    tl.to(els.mascot, { y: () => G.mascot[from].y - 4 * G.vh, scaleY: 1.06, scaleX: 0.96, ease: 'power2.out', duration: half }, at);
    tl.to(els.mascot, { y: () => G.mascot[to].y, scaleY: 1, scaleX: 1, ease: 'power2.in', duration: half }, at + half);
    // land: squash, then settle; a steam puff
    tl.to(els.mascot, { scaleX: 1.1, scaleY: 0.9, ease: 'power1.out', duration: 0.6 }, at + P.hopLen);
    tl.to(els.mascot, { scaleX: 1, scaleY: 1, ease: 'power1.inOut', duration: 0.9 }, at + P.hopLen + 0.6);
    tl.fromTo(
      els.puff,
      { x: () => G.mascot[to].x, y: () => G.mascot[to].y - 4.6 * G.vw, autoAlpha: 0, scale: 0.7 },
      { y: () => G.mascot[to].y - 6.2 * G.vw, autoAlpha: 1, scale: 1, ease: 'power1.out', duration: 1.2 },
      at + P.hopLen,
    );
    tl.to(els.puff, { autoAlpha: 0, ease: 'power1.in', duration: 1.4 }, at + P.hopLen + 1.2);
  });
  tl.to(els.mascot, { autoAlpha: 0, scale: 0.6, y: () => G.mascot[2].y - 2 * G.vh, ease: 'power2.in', duration: 3 }, P.holdEnd);

  // REC timer on step card 2: 0:00 → 0:42 across the hold. Written from the timeline's own time
  // on every render (tween callbacks are suppressed during ScrollTrigger refreshes).
  if (els.recTime) {
    const node = els.recTime;
    const span = P.holdEnd - P.holdStart - 2;
    let last = -1;
    writeRec = () => {
      const t = Math.round(gsap.utils.clamp(0, 1, (tl.time() - P.holdStart) / span) * 42);
      if (t === last) return;
      last = t;
      node.textContent = `REC 0:${t < 10 ? '0' : ''}${t}`;
    };
    writeRec();
  }
  // The hand-over follows the (scrub-smoothed) timeline, not the raw scroll, so the grid never
  // appears while the deck is still flying in after a fast scroll.
  // while the stack falls in and the deck is lifted, the stage's clip extends above its top edge
  // (CSS [data-falling]) so a lifted card is never sliced there
  let falling: boolean | null = null;
  const syncFalling = () => {
    const f = tl.time() < P.stick;
    if (f === falling) return;
    falling = f;
    els.stage.toggleAttribute('data-falling', f);
  };
  tl.eventCallback('onUpdate', () => {
    writeRec();
    syncLive(tl.progress());
    syncFalling();
  });
  syncFalling();

  // ---- folder (decorative copy) ----
  // the panel appears behind the compressing grid and settles around it (origin ≈ the grid's center)
  tl.fromTo(
    els.shellPanel,
    { autoAlpha: 0, scale: 0.94, transformOrigin: '50% 56%' },
    { autoAlpha: 1, scale: 1, ease: 'power2.out', duration: 9 },
    P.panelIn,
  );
  // then the header (the title, then "+ Add a recipe") and the tabs drift down into place inside it
  tl.fromTo([els.shellTitle, els.shellAdd], { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, ease: 'power3.out', duration: 8, stagger: 0.8 }, P.headIn);
  tl.fromTo(els.shellTabs, { autoAlpha: 0, y: -12 }, { autoAlpha: 1, y: 0, ease: 'power3.out', duration: P.foldEnd - P.tabsIn }, P.tabsIn);

  // ---- phone ----
  tl.fromTo(
    els.phone,
    { y: () => 62 * G.vh, rotation: 11 },
    { y: 0, rotation: 4, ease: 'power2.out', duration: P.phoneEnd - P.phoneIn },
    P.phoneIn,
  );

  const st = tl.scrollTrigger!;
  syncLive(st.progress);

  return {
    st,
    cleanup: () => {
      ScrollTrigger.removeEventListener('refreshInit', remeasure);
      els.deck.classList.remove('is-active');
      els.stage.removeAttribute('data-falling');
    },
  };
}

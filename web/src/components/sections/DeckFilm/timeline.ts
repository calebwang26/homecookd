'use client';
// The DeckFilm GSAP builder (brief 8.1–8.3). Pure: it takes the elements, measures the stage, builds
// ONE pinned, scrubbed timeline (A: the hero becomes a recipe card; B: the deck drops into How it
// works) and returns a
// cleanup. Geometry lives in stage px computed from vw/vh-style ratios on every refresh (never per
// frame). Only transform, opacity/visibility, color, clip-path and one CSS variable are animated.
//
// Timeline units: A spans 130 units (desktop) / 80 (mobile), B spans 60 / 45, and one unit is one
// hundredth of the stage height of scroll. a(p) and b(p) convert the brief's local percentages.
// The pin is 190vh on desktop. On phones and tablets it lets go at b50 (~103vh), once the fan has
// closed into its stack: the stack then scrolls away with the stage while How it works rises under
// it. (Mobile How it works has no stack to catch a drop, so dropping it out of the stage there left
// a full screen of empty cream before How it works: QA B20.)
// (The call, the kid page's old third scene, is cut (Caleb, Oct 17): on desktop the fan now closes
// back into its stack and drops straight into StepsToBox, the same hand-off the call's stack made.)
import { gsap, ScrollTrigger } from '@/lib/motion/gsap';
import { addWordFill } from '@/lib/motion/wordFill';
import { HEX, SCRUB } from '@/lib/motion/tokens';
import { cardPhotoRect } from '@/components/primitives/RecipeCard';
import type { FilmFlags, FilmStore } from './store';

export interface FilmEls {
  root: HTMLElement;
  stage: HTMLElement;
  hero: HTMLElement;
  overlay: HTMLElement;
  rig: HTMLElement;
  clip: HTMLElement;
  inner: HTMLElement;
  scrim: HTMLElement;
  garnish: HTMLElement;
  rec: HTMLElement;
  watch: HTMLElement;
  sheet: HTMLElement;
  floor: HTMLElement;
  /** the fan cards shown in this mode, left → right; the last one is the front (video) card frame */
  cards: HTMLElement[];
  brand: HTMLElement;
  passChips: HTMLElement[];
  passFoot: HTMLElement;
}

/** the sheet's top radius (--r-sheet) */
const SHEET_R = 40;
/** RecipeCard's photo-only tier (<140px): the photo fills the whole panel */
const PHOTO_ONLY_BELOW = 140;
/** the stack's tilt as it drops (StepsToBox catches it at the same +12°) */
const DROP_TILT = 12;

export function collect(root: HTMLElement, mobile: boolean): FilmEls | null {
  const q = <T extends Element = HTMLElement>(f: string) => root.querySelector<T>(`[data-f="${f}"]`);
  const qa = (f: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-f="${f}"]`));
  const els = {
    root,
    stage: q('stage'),
    hero: q('hero'),
    overlay: q('overlay'),
    rig: q('rig'),
    clip: q('clip'),
    inner: q('inner'),
    scrim: q('scrim'),
    garnish: q('garnish'),
    rec: q('rec'),
    watch: q('watch'),
    sheet: q('sheet'),
    floor: q('floor'),
    cards: qa('card').filter((el) => el.hasAttribute(mobile ? 'data-mobile' : 'data-desktop')),
    brand: q('brand'),
    passChips: qa('passChip'),
    passFoot: q('passFoot'),
  };
  for (const [k, v] of Object.entries(els)) {
    if (!v || (Array.isArray(v) && v.length === 0)) {
      if (process.env.NODE_ENV !== 'production') console.warn(`[DeckFilm] missing element: ${k}`);
      return null;
    }
  }
  return els as FilmEls;
}

/** card center (px, stage space), rotation (deg), scale */
interface Pose {
  x: number;
  y: number;
  r: number;
  s: number;
}

interface Geo {
  W: number;
  H: number;
  cw: number;
  ch: number;
  base: Pose;
  /** the fan's floor shadow centre y */
  floorY: number;
  photo: { x: number; y: number; w: number; h: number; r: number };
  focus: { x: number; y: number };
  sCard: number;
  fan: Pose[];
  stackA: Pose[];
  /** how far (px) the stack falls to clear the stage's bottom edge */
  dropY: number;
  passChip: { x: number; y: number }[];
}

/** the opened fan's poses for a card width (every offset scales with cw) */
function fanPoses(n: number, W: number, fanCy: number, cw: number, mobile: boolean): Pose[] {
  const unit = cw * (mobile ? 1 / 34 : 1 / 16); // "1vw" at the reference card size
  return Array.from({ length: n }, (_, i) => {
    const t = n <= 1 ? 0 : i / (n - 1) - 0.5;
    return mobile
      ? { x: W / 2 + t * 1.7 * cw, y: fanCy + 6 * t * t * unit, r: t * 20, s: 0.9 + 0.4 * t * t }
      : { x: W / 2 + t * 3.5 * cw, y: fanCy + 8 * t * t * unit, r: t * 14 - 1, s: 0.88 + 0.48 * t * t };
  });
}

/** lowest y of a posed card (w × 1.25w, rotated about its centre) over the columns xa..xb */
function lowestIn(p: Pose, w: number, xa: number, xb: number): number {
  const c = Math.cos((p.r * Math.PI) / 180);
  const sn = Math.sin((p.r * Math.PI) / 180);
  const hw = (w * p.s) / 2;
  const hh = (w * 1.25 * p.s) / 2;
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([u, v]) => ({ x: p.x + u * c - v * sn, y: p.y + u * sn + v * c }));
  let most = -Infinity;
  for (const q of pts) if (q.x >= xa && q.x <= xb) most = Math.max(most, q.y);
  for (const x of [xa, xb]) {
    for (let i = 0; i < 4; i++) {
      const A = pts[i];
      const B = pts[(i + 1) % 4];
      if (A.x !== B.x && (x - A.x) * (x - B.x) <= 0) most = Math.max(most, A.y + ((B.y - A.y) * (x - A.x)) / (B.x - A.x));
    }
  }
  return most;
}
/** the opened fan's clearance above the pass-down copy, and its least gap under the brand line */
const FAN_CLEAR = 24;
const FAN_TOP_GAP = 32;

function measure(els: FilmEls, mobile: boolean): Geo {
  const { stage } = els;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const n = els.cards.length;
  // A: the front card's resting place before the fan opens (the stack position)
  let fanCy = (mobile ? 0.505 : 0.575) * H;
  // the card size follows the width. On short laptops (1280×720, 1366×768) the fan lifts (keeping
  // FAN_TOP_GAP under the brand line) and, if that's not enough, steps down in size until it clears
  // the pass-down copy by FAN_CLEAR (the copy's untransformed line boxes, stage space)
  const sb = stage.getBoundingClientRect();
  const brandBottom = (els.brand.parentElement ?? els.brand).getBoundingClientRect().bottom - sb.top;
  const footBox = (els.passFoot.parentElement ?? els.passFoot).getBoundingClientRect();
  const pfBox = els.passFoot.getBoundingClientRect();
  // the copy's real line boxes (a centred paragraph's box is wider than its lines), the CTA row's
  // items, each padded sideways so a corner never sits right beside a glyph
  const rects: DOMRect[] = [];
  for (const el of Array.from(els.passFoot.children)) {
    if (el.tagName === 'P') {
      const range = document.createRange();
      range.selectNodeContents(el);
      rects.push(...Array.from(range.getClientRects()));
    } else rects.push(...Array.from(el.children, (c) => c.getBoundingClientRect()));
  }
  const keepOut = rects
    .filter((r) => r.width > 0)
    .map((r) => ({ l: r.left - sb.left - 12, r: r.right - sb.left + 12, t: footBox.top - sb.top + (r.top - pfBox.top) }));
  /** the lift the fan needs at width w (0 when it already clears), or null when it can't lift that far */
  const liftFor = (w: number): number | null => {
    const poses = fanPoses(n, W, fanCy, w, mobile);
    let clear = Infinity;
    for (const k of keepOut) for (const p of poses) clear = Math.min(clear, k.t - lowestIn(p, w, k.l, k.r));
    if (clear >= FAN_CLEAR) return 0;
    const top = Math.min(...poses.map((p) => p.y - (w * 1.25 * p.s) / 2 - (w * p.s * Math.abs(Math.sin((p.r * Math.PI) / 180))) / 2));
    const lift = FAN_CLEAR - clear;
    return top - lift - brandBottom >= FAN_TOP_GAP ? lift : null;
  };
  const cw0 = mobile ? Math.min(0.34 * W, 0.28 * H, 240) : Math.min(0.16 * W, 0.3 * H);
  let cw = cw0;
  let lift = liftFor(cw);
  while (lift === null && cw > 0.75 * cw0) {
    cw *= 0.98;
    lift = liftFor(cw);
  }
  fanCy -= lift ?? 0;
  const ch = cw * 1.25;
  els.root.style.setProperty('--cw', `${cw}px`);
  const unit = cw * (mobile ? 1 / 34 : 1 / 16); // "1vw" at the reference card size

  const stackP = (i: number, cx: number, cy: number, sc: number): Pose => {
    const k = n - 1 - i;
    return { x: cx - 0.6 * k * unit * sc, y: cy, r: -k, s: (1 - 0.02 * k) * sc };
  };
  const base = stackP(n - 1, W / 2, fanCy, 1);

  // RecipeCard's <140px tier fills the panel with the photo (phones): the video window must too
  const pr0 = cardPhotoRect(cw, ch);
  const pr = cw < PHOTO_ONLY_BELOW ? { ...pr0, height: ch - 2 * pr0.y } : pr0;
  const photo = {
    x: base.x - cw / 2 + pr.x,
    y: base.y - ch / 2 + pr.y,
    w: pr.width,
    h: pr.height,
    r: pr.radius,
  };
  // the faces: both of them (and the hands) stay in the card window
  // (phones: x stays ≤ .55W so the 0.9W-wide crop never runs past the video's right edge)
  const focus = mobile ? { x: 0.53 * W, y: 0.38 * H } : { x: 0.52 * W, y: 0.45 * H };
  const sCard = photo.w / ((mobile ? 0.9 : 0.5) * W);

  const fan = fanPoses(n, W, fanCy, cw, mobile);
  const left = fan[0];
  const right = fan[Math.max(0, n - 2)];
  const top = (p: Pose) => p.y - (ch * p.s) / 2;

  return {
    W,
    H,
    cw,
    ch,
    base,
    floorY: fanCy + ch * (mobile ? 0.62 : 0.6),
    photo,
    focus,
    sCard,
    fan,
    stackA: els.cards.map((_, i) => stackP(i, W / 2, fanCy, 1)),
    // from the stack's centre to fully below the stage, tilted card and all
    dropY: H - fanCy + ch * 1.1,
    // (bottom-anchored; a lifted fan never pushes a chip up into the brand line: it rides lower,
    // over its card's top edge, instead)
    passChip: [
      { x: left.x - 0.28 * cw, y: Math.max(top(left) - (mobile ? 6 : 12), brandBottom + 10 + (els.passChips[0]?.offsetHeight ?? 0)) },
      { x: right.x + (mobile ? 0.22 : 0.3) * cw, y: Math.max(top(right) - (mobile ? 2 : 10), brandBottom + 10 + (els.passChips[1]?.offsetHeight ?? 0)) },
    ],
  };
}

export interface BuildOpts {
  mobile: boolean;
  store: FilmStore;
}

export function buildFilm(els: FilmEls, { mobile, store }: BuildOpts): () => void {
  const A = mobile ? 80 : 130;
  const B = mobile ? 45 : 60;
  const a = (p: number) => (p / 100) * A;
  const b = (p: number) => A + (p / 100) * B;
  /** where the pin lets go: phones stop at b50, right after the fan has closed (no drop) */
  const END = mobile ? b(50) : A + B;
  const da = (p: number) => (p / 100) * A; // duration in A-percent
  const db = (p: number) => (p / 100) * B;

  let G = measure(els, mobile);
  let started = false;
  const placeStatic = () => {
    // geometry that is never scrubbed, re-applied after every refresh
    gsap.set(els.rig, { transformOrigin: `${G.base.x}px ${G.base.y}px` });
    gsap.set(els.inner, { transformOrigin: `${G.focus.x}px ${G.focus.y}px` });
    Object.assign(els.garnish.style, {
      left: `${G.base.x - G.cw / 2}px`,
      top: `${G.base.y - G.ch / 2}px`,
      width: `${G.cw}px`,
      height: `${G.ch}px`,
    });
    els.floor.style.top = `${G.floorY}px`;
    gsap.set(els.passChips, { x: (i: number) => G.passChip[i]?.x ?? 0 });
    // before the timeline reaches them, these hold their time-0 pose
    if (!started || tl.time() < b(0)) gsap.set(els.passChips, { y: (i: number) => G.passChip[i]?.y ?? 0 });
    if (!started || tl.time() === 0) gsap.set(els.sheet, { y: G.H });
  };
  const onRefreshInit = () => {
    G = measure(els, mobile);
  };
  ScrollTrigger.addEventListener('refreshInit', onRefreshInit);

  // ---- pose helpers (function-based values re-read G on every refresh) ----
  type P = () => Pose;
  /** GSAP vars that put a card at a pose */
  const card = (p: P) => ({
    x: () => p().x - G.cw / 2,
    y: () => p().y - G.ch / 2,
    rotation: () => p().r,
    scale: () => p().s,
  });
  const rig = (p: P) => ({
    x: () => p().x - G.base.x,
    y: () => p().y - G.base.y,
    rotation: () => p().r,
    scale: () => p().s / G.base.s,
  });

  const n = els.cards.length;
  const front = els.cards[n - 1];
  const backs = els.cards.slice(0, n - 1);
  const cardIndex = (el: HTMLElement) => els.cards.indexOf(el);

  // clip-path window state (scrubbed proxies: x closes the sides, y the top) and the render that
  // writes it. The sides close faster than the top, so the window turns portrait (a card) early.
  const win = { x: 0, y: 0 };
  // Phones get the plain rounded inset(): rebuilding a path() clip on the playing video every
  // scroll frame janked iPhones, and the sheet-lip ears are barely visible at that size.
  const pathOK = !mobile && CSS.supports('clip-path', 'path("M0 0H1V1Z")');
  let lastClip = '';
  let lastOverlayClip = '';
  let navHero = true;
  const render = () => {
    const sheetY = Number(gsap.getProperty(els.sheet, 'y')) || 0;
    const { photo, W, H } = G;
    const T = photo.y * win.y;
    const L = photo.x * win.x;
    const Rx = W - (W - photo.x - photo.w) * win.x;
    // the bottom edge rides the sheet's top edge (a4) until it reaches the card photo
    const B = Math.min(H, Math.max(sheetY, photo.y + photo.h));
    const r = Math.max(0, Math.min(photo.r * win.x, (Rx - L) / 2, (B - T) / 2));
    let clip: string;
    if (pathOK) {
      // a4 "sheet lip": while the video rides the sheet, it also fills the notches outside the sheet's
      // rounded top corners (circle centres at (R, sheetY+R) and (W−R, sheetY+R)), so the 40px radius
      // reads over the video. d = how far the corner arc still hangs below the window's bottom edge.
      const R = SHEET_R;
      const d = Math.min(R, sheetY + R - B);
      const x0 = d > 0 ? R - Math.sqrt(R * R - d * d) : 0;
      const arcY = (u: number) => sheetY + R - Math.sqrt(Math.max(0, R * R - (R - u) * (R - u)));
      const earL = d > 0 && L < x0;
      const earR = d > 0 && W - Rx < x0;
      const f = (v: number) => v.toFixed(1);
      let p = `M${f(L + r)} ${f(T)}H${f(Rx - r)}A${f(r)} ${f(r)} 0 0 1 ${f(Rx)} ${f(T + r)}`;
      p += earR ? `V${f(arcY(W - Rx))}A${R} ${R} 0 0 0 ${f(W - x0)} ${f(B)}` : `V${f(B - r)}A${f(r)} ${f(r)} 0 0 1 ${f(Rx - r)} ${f(B)}`;
      p += earL ? `H${f(x0)}A${R} ${R} 0 0 0 ${f(L)} ${f(arcY(L))}` : `H${f(L + r)}A${f(r)} ${f(r)} 0 0 1 ${f(L)} ${f(B - r)}`;
      p += `V${f(T + r)}A${f(r)} ${f(r)} 0 0 1 ${f(L + r)} ${f(T)}Z`;
      clip = `path("${p}")`;
    } else {
      clip = `inset(${T.toFixed(1)}px ${(W - Rx).toFixed(1)}px ${(H - B).toFixed(1)}px ${L.toFixed(1)}px round ${r.toFixed(1)}px)`;
    }
    if (clip !== lastClip) {
      els.clip.style.clipPath = clip;
      lastClip = clip;
    }
    // the sheet also slides over the hero copy (a4): clip the overlay at the sheet's edge, in the
    // overlay's own (translated) coordinates
    const oy = Number(gsap.getProperty(els.overlay, 'y')) || 0;
    const ob = Math.max(0, H - sheetY + oy);
    const oclip = ob <= 0.5 ? '' : `inset(0px 0px ${ob.toFixed(1)}px 0px)`;
    if (oclip !== lastOverlayClip) {
      els.overlay.style.clipPath = oclip;
      lastOverlayClip = oclip;
    }
    // the pause button turns ink once the canvas sheet is behind it
    // nav tone contract (brief 4.5): the hero stops covering the nav once the sheet passes under it
    const heroUnderNav = sheetY > 36;
    store.set({ pauseInk: sheetY < H * 0.93 - 24, navHero: heroUnderNav });
    if (heroUnderNav !== navHero) {
      navHero = heroUnderNav;
      if (navHero) els.hero.setAttribute('data-nav-tone', 'hero');
      else els.hero.removeAttribute('data-nav-tone');
    }
  };

  const live = { hero: true, foot: true };
  const flags = (t: number) => {
    const patch: Partial<FilmFlags> = {
      passChips: t >= a(68),
      // the video plays in the front card until the stack has dropped out of sight (phones never
      // reach b90: HeroVideo pauses itself once the stage has scrolled away)
      suspended: t >= b(90),
    };
    store.set(patch);
    // invisible links never take clicks; keyboard focus brings their layer back (see focusin below)
    const heroLive = t < a(9);
    const footLive = t >= a(mobile ? 66 : 74) && t < b(mobile ? 16 : 10);
    if (heroLive !== live.hero) {
      live.hero = heroLive;
      els.overlay.toggleAttribute('data-off', !heroLive);
    }
    if (footLive !== live.foot) {
      live.foot = footLive;
      els.passFoot.toggleAttribute('data-off', !footLive);
    }
  };

  // ---- initial states (time 0) ----
  gsap.set(els.sheet, { y: () => G.H });
  gsap.set(backs, { ...card(() => G.base), autoAlpha: 0 });
  gsap.set(front, { ...card(() => G.base), scale: 0.96, autoAlpha: 0 });
  gsap.set(els.rig, { x: 0, y: 0, rotation: 0, scale: 1, autoAlpha: 1 });
  gsap.set(els.inner, { x: 0, y: 0, scale: 1 });
  gsap.set(els.garnish, { autoAlpha: 0 });
  gsap.set(els.floor, { opacity: 0 });
  gsap.set(els.watch, { autoAlpha: 0 });
  // text layers fade with opacity only, so screen readers can still read them at any scroll position
  gsap.set(els.brand, { opacity: 0 });
  gsap.set(els.passFoot, { opacity: 0, y: 24 });
  // every scrubbed word starts ghost (accents start as a pale tint of their accent)
  const ghost = (root: HTMLElement, accentFrom: string) =>
    root.querySelectorAll<HTMLElement>('.w').forEach((w) =>
      gsap.set(w, { color: w.hasAttribute('data-accent') ? accentFrom : HEX.ghost, y: '0.1em' }),
    );
  ghost(els.brand, HEX.greenPale);

  const tl = gsap.timeline({
    defaults: { ease: 'none', immediateRender: false },
    scrollTrigger: {
      trigger: els.stage,
      start: 'top top',
      end: () => `+=${Math.round((END / 100) * els.stage.clientHeight)}`,
      pin: true,
      // The stage's own parent (.root, which holds nothing else) is the spacer. Without it
      // ScrollTrigger wraps the stage in a new div on create and on every refresh, and each move out
      // of and back into the DOM restarts the hero's CSS entrance (the H1 played up to three times
      // on load).
      pinSpacer: els.root,
      scrub: SCRUB,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onRefresh: () => {
        placeStatic();
        render();
        flags(tl.time());
      },
    },
    onUpdate: () => {
      render();
      flags(tl.time());
    },
  });

  const move = (el: HTMLElement, from: P, to: P, at: number, dur: number, ease: string) =>
    tl.fromTo(el, card(from), { ...card(to), duration: dur, ease }, at);
  const moveRig = (from: P, to: P, at: number, dur: number, ease: string) =>
    tl.fromTo(els.rig, rig(from), { ...rig(to), duration: dur, ease }, at);

  // ================= A: the hero becomes a recipe card =================
  tl.fromTo(els.overlay, { y: 0, opacity: 1 }, { y: () => -0.18 * G.H, opacity: 0, duration: da(12) }, a(0));
  tl.fromTo(els.scrim, { opacity: 1 }, { opacity: 0, duration: da(25) }, a(0));
  // the sheet ends 40px above the stage top, so its rounded corners leave with the hero (a4)
  tl.fromTo(els.sheet, { y: () => G.H }, { y: -SHEET_R, duration: da(22), ease: 'power2.inOut' }, a(0));
  // (no empty beat) the window starts closing at a(8) and lands in the card frame by a(26); the top
  // shares the video's ease, so the window never shows past the scaled video's edge
  tl.fromTo(win, { x: 0 }, { x: 1, duration: da(18), ease: 'power3.out' }, a(8));
  tl.fromTo(win, { y: 0 }, { y: 1, duration: da(18), ease: 'power2.inOut' }, a(8));
  tl.fromTo(
    els.inner,
    { x: 0, y: 0, scale: 1 },
    {
      x: () => G.photo.x + G.photo.w / 2 - G.focus.x,
      y: () => G.photo.y + G.photo.h / 2 - G.focus.y,
      scale: () => G.sCard,
      duration: da(18),
      ease: 'power2.inOut',
    },
    a(8),
  );
  // the card frame gathers around the playing video while it lands; Recording → Watch
  tl.fromTo(
    front,
    { ...card(() => G.base), scale: 0.96, autoAlpha: 0 },
    { ...card(() => G.base), autoAlpha: 1, duration: da(8), ease: 'power2.out' },
    a(18),
  );
  tl.fromTo(els.garnish, { autoAlpha: 0 }, { autoAlpha: 1, duration: da(4) }, a(24));
  tl.fromTo(els.rec, { autoAlpha: 1 }, { autoAlpha: 0, duration: da(4) }, a(30));
  tl.fromTo(els.watch, { autoAlpha: 0 }, { autoAlpha: 1, duration: da(4) }, a(30));
  // the brand line arrives as ghost text while the video lands
  tl.fromTo(els.brand, { opacity: 0 }, { opacity: 1, duration: da(10) }, a(14));
  // the other cards peek out of the stack, then the fan opens (expo.out, all cards at once)
  tl.set(backs, { autoAlpha: 1 }, a(32));
  backs.forEach((c) => {
    const i = cardIndex(c);
    move(c, () => G.base, () => G.stackA[i], a(32), da(6), 'power2.out');
  });
  els.cards.forEach((c, i) => move(c, () => G.stackA[i], () => G.fan[i], a(38), da(26), 'expo.out'));
  moveRig(() => G.base, () => G.fan[n - 1], a(38), da(26), 'expo.out');
  tl.fromTo(els.floor, { opacity: 0 }, { opacity: 1, duration: da(20) }, a(40));
  addWordFill(tl, els.brand, { at: a(40), span: da(30), to: 'ink', accentTo: 'green' });
  // (phones: the copy and its CTA arrive earlier and stay longer, so a flick can't skip them)
  tl.fromTo(els.passFoot, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: da(12), ease: 'power3.out' }, a(mobile ? 62 : 70));
  tl.set({}, {}, a(100)); // hold

  // ================= B: the deck drops into How it works =================
  // The pass-down text and chips clear out first (b0–b20), while the fan closes back into the stack
  // it opened from (b6–b46), the video still playing in the front card, so the moving cards never
  // cross text or the CTA. Desktop: a beat to settle, then the stack tilts and drops out of the
  // stage's bottom at x = 50% (b56–b96): StepsToBox catches it there, tilted the same +12°, rising
  // in from the bottom just after this one leaves. Phones: the pin ends at b50 and the stack rides
  // the stage up and away (see END).
  tl.fromTo(els.brand, { y: 0, opacity: 1 }, { y: () => -0.6 * G.H, opacity: 0, duration: db(30), ease: 'power1.in' }, b(0));
  tl.fromTo(els.passFoot, { y: 0, opacity: 1 }, { y: () => -0.3 * G.H, opacity: 0, duration: db(14), ease: 'power2.in' }, b(mobile ? 6 : 0));
  tl.fromTo(
    els.passChips,
    { y: (i: number) => G.passChip[i]?.y ?? 0, autoAlpha: 1 },
    { y: (i: number) => (G.passChip[i]?.y ?? 0) - 0.3 * G.H, autoAlpha: 0, duration: db(14), ease: 'power2.in' },
    b(0),
  );
  tl.fromTo(els.floor, { opacity: 1 }, { opacity: 0, duration: db(10) }, b(0));
  els.cards.forEach((c, i) => move(c, () => G.fan[i], () => G.stackA[i], b(6), db(40), 'power2.inOut'));
  moveRig(() => G.fan[n - 1], () => G.stackA[n - 1], b(6), db(40), 'power2.inOut');
  // the drop (desktop): every card (and the video window riding the front one) turns +12° and falls
  // together
  if (!mobile) {
    const dropped = [...els.cards, els.rig];
    dropped.forEach((c) => {
      const r0 = () => (c === els.rig ? G.stackA[n - 1].r : G.stackA[cardIndex(c)].r);
      const y0 = () => (c === els.rig ? 0 : G.stackA[cardIndex(c)].y - G.ch / 2);
      tl.fromTo(c, { rotation: r0 }, { rotation: () => r0() + DROP_TILT, duration: db(14), ease: 'power2.inOut' }, b(56));
      tl.fromTo(c, { y: y0 }, { y: () => y0() + G.dropY, duration: db(34), ease: 'power2.in' }, b(62));
    });
    // once it's below the stage, hide it so its float shadow never peeks over the seam after the unpin
    tl.fromTo(dropped, { autoAlpha: 1 }, { autoAlpha: 0, duration: db(2) }, b(97));
  }
  tl.set({}, {}, END);

  placeStatic();
  started = true;
  render();
  flags(0);

  // keyboard: focusing a link in a faded layer scrolls the film to where that layer is visible
  const scrollToTime = (time: number) => {
    const st = tl.scrollTrigger;
    if (!st) return;
    window.scrollTo({ top: st.start + (time / END) * (st.end - st.start), behavior: 'auto' });
  };
  const onHeroFocus = () => {
    if (tl.time() > a(4)) scrollToTime(0);
  };
  const onFootFocus = () => {
    const t = tl.time();
    if (t < a(86) || t > b(2)) scrollToTime(a(92));
  };
  els.overlay.addEventListener('focusin', onHeroFocus);
  els.passFoot.addEventListener('focusin', onFootFocus);

  return () => {
    ScrollTrigger.removeEventListener('refreshInit', onRefreshInit);
    els.overlay.removeEventListener('focusin', onHeroFocus);
    els.passFoot.removeEventListener('focusin', onFootFocus);
    els.overlay.removeAttribute('data-off');
    els.passFoot.removeAttribute('data-off');
    els.hero.setAttribute('data-nav-tone', 'hero');
    els.clip.style.clipPath = '';
    els.overlay.style.clipPath = '';
    els.garnish.removeAttribute('style');
    els.root.style.removeProperty('--cw');
    gsap.set(
      [
        els.rig,
        els.inner,
        els.sheet,
        els.floor,
        els.overlay,
        els.scrim,
        els.garnish,
        els.rec,
        els.watch,
        ...els.cards,
        els.brand,
        ...els.passChips,
        els.passFoot,
      ],
      { clearProps: 'all' },
    );
    for (const w of els.root.querySelectorAll<HTMLElement>('.w')) {
      w.style.removeProperty('color');
      w.style.removeProperty('transform');
      w.style.removeProperty('translate');
    }
  };
}

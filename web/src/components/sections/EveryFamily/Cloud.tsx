'use client';
// The floating recipe cloud (brief 8.7, a7 M15): two wavy rows of 12 recipe tiles that drift in
// opposite directions around the centered heading.
//
// Per frame we write exactly two transforms (one per row track): the drift (2.5vw/s, plus a nudge
// from scroll velocity in the same direction) and a little scroll parallax (the rows travel a bit
// faster than the page, the bottom row more than the top, which gives the cloud its depth). Each row
// is duplicated (24 nodes) and wraps modulo its width. Tiles themselves are static; their tilt,
// depth scale and wave offset are CSS variables.
//
// Hover (fine pointer): the row eases to a stop, the tile lifts (scale 1.2, straightens, rises) and a
// bubble shows the cook's own words and the ~estimate. Touch: tap toggles the same thing; Escape or
// a tap elsewhere closes it. Tiles are aria-hidden and never focusable (moving targets); the section
// carries a visually hidden list of the same recipes.
//
// Static (SSR, reduced motion, no JS): the rows stand still and scroll sideways with snap points.
// `still` (the parent version, /teach): no drift and no parallax; the rows rest at their starting
// offsets, the tiles fade up once, and hover / tap still lift a tile with its bubble.
import { animate, inView } from 'motion';
import { useScroll, useVelocity } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Img } from '@/components/primitives/Img';
import { RecipeCard } from '@/components/primitives/RecipeCard';
import { useMotionOK } from '@/components/providers/MotionProvider';
import { usePause } from '@/components/providers/PauseProvider';
import { EASE } from '@/lib/motion/tokens';
import { MQ, matches } from '@/lib/motion/media';
import { CookBubble } from './CookBubble';
import { ROWS, type RowName, type Tile } from './cloudData';
import s from './EveryFamily.module.css';

const BASE_SPEED = 2.5; // vw/s
const MAX_BOOST = 6; // vw/s
const BOOST_PER_PX = 0.002; // vw/s per px/s of scroll velocity
/**
 * Scroll parallax: total travel (vh) of each row across the section's pass through the viewport.
 * The top row runs a little faster than the page and the bottom row a little slower, so the cloud
 * opens up as you leave and gathers around the heading as you arrive (when the bottom row is still
 * below the fold), and the rows never cross the text.
 */
const PARALLAX: Record<RowName, number> = { top: 10, bottom: -12 };
const DIR: Record<RowName, 1 | -1> = { top: -1, bottom: 1 };
/** starting offset as a fraction of the row width, so the two rows don't line up */
const START: Record<RowName, number> = { top: -0.03, bottom: -0.47 };
const TILES_PER_ROW = 12;

interface Open {
  row: RowName;
  k: number;
}

const IMG_SIZES = '(min-width: 1024px) 8vw, (min-width: 768px) 12vw, 20vw';

function TileFace({ tile }: { tile: Tile }) {
  // At tile size the card shows only the photo and a cook tag. "Grandma Lucia" would truncate, so
  // the tag keeps the relation word ("Grandma", "Grandpa", "Auntie"); the bubble has the full name.
  const recipe = { ...tile.recipe, cook: tile.recipe.cook.split(' ')[0] };
  const media = tile.photo ? (
    <Img src={tile.photo.src} alt="" fill sizes={IMG_SIZES} focus={tile.photo.focus} />
  ) : undefined;
  return (
    <RecipeCard
      recipe={recipe}
      face={tile.face}
      media={media}
      ratio={1}
      hideFeel
      imageSizes={IMG_SIZES}
      className={s.card}
      style={{ width: '100%' }}
    />
  );
}

export function Cloud({ still = false }: { still?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const motionOK = useMotionOK();
  const { paused } = usePause();
  const [open, setOpen] = useState<Open | null>(null);

  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const { scrollYProgress } = useScroll({ target: rootRef, offset: ['start end', 'end start'] });

  // mutable frame state (never React state: the loop must not re-render)
  const st = useRef({
    x: { top: START.top, bottom: START.bottom } as Record<RowName, number>, // fraction of row width, (−1, 0]
    f: { top: 1, bottom: 1 } as Record<RowName, number>, // speed factor, eased toward 0 or 1
    boost: 0,
    pitch: 9, // vw per tile slot (from CSS --pitch-n)
    vh: 900,
    active: false, // section near the viewport
    open: null as Open | null,
    paused: false,
    motion: false,
    lastType: 'mouse' as string,
  });

  useEffect(() => {
    st.current.paused = paused;
  }, [paused]);
  useEffect(() => {
    st.current.open = open;
  }, [open]);

  const write = useCallback((row: RowName) => {
    const el = row === 'top' ? topRef.current : bottomRef.current;
    if (!el) return;
    const S = st.current;
    const W = S.pitch * TILES_PER_ROW;
    const p = scrollYProgress.get();
    const py = (0.5 - p) * PARALLAX[row] * (S.vh / 100);
    el.style.transform = `translate3d(${(S.x[row] * W).toFixed(3)}vw, ${py.toFixed(2)}px, 0)`;
  }, [scrollYProgress]);

  // measure (pitch, viewport) and place the rows once; re-measure on resize
  useEffect(() => {
    const S = st.current;
    S.motion = motionOK && !still;
    if (!motionOK) {
      topRef.current?.style.removeProperty('transform');
      bottomRef.current?.style.removeProperty('transform');
      return;
    }
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      S.pitch = parseFloat(getComputedStyle(root).getPropertyValue('--pitch-n')) || 9;
      S.vh = window.innerHeight;
      if (still) {
        // rest at the starting offsets, no parallax
        for (const [row, el] of [['top', topRef.current], ['bottom', bottomRef.current]] as const) {
          if (el) el.style.transform = `translate3d(${(START[row] * S.pitch * TILES_PER_ROW).toFixed(3)}vw, 0px, 0)`;
        }
        return;
      }
      write('top');
      write('bottom');
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [motionOK, still, write]);

  // run the loop only while the section is near the viewport (its own rAF, stopped otherwise, so the
  // page can go fully idle); close an open tile when it leaves
  const tick = useRef<(delta: number) => void>(() => {});
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      tick.current(last ? t - last : 16);
      last = t;
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(
      ([e]) => {
        st.current.active = e.isIntersecting;
        if (e.isIntersecting) {
          if (!raf && !still) raf = requestAnimationFrame(loop);
        } else {
          cancelAnimationFrame(raf);
          raf = 0;
          last = 0;
          setOpen(null);
        }
      },
      { rootMargin: '15% 0px' },
    );
    io.observe(root);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [still]);

  useEffect(() => {
    tick.current = (delta: number) => {
      const S = st.current;
      if (!S.active || !S.motion) return;
      const dt = Math.min(delta, 64) / 1000;
      const k = (tau: number) => 1 - Math.exp(-dt / tau);
      const boostTarget = Math.min(Math.abs(velocity.get()) * BOOST_PER_PX, MAX_BOOST);
      S.boost += (boostTarget - S.boost) * k(0.35);
      const W = S.pitch * TILES_PER_ROW;
      for (const row of ['top', 'bottom'] as const) {
        const stopped = S.paused || S.open?.row === row;
        S.f[row] += ((stopped ? 0 : 1) - S.f[row]) * k(stopped ? 0.18 : 0.5);
        const speed = (BASE_SPEED + S.boost) * S.f[row]; // vw/s
        let x = S.x[row] + (DIR[row] * speed * dt) / W;
        if (x <= -1) x += 1;
        if (x > 0) x -= 1;
        S.x[row] = x;
        write(row);
      }
    };
  });

  // one-shot enter: tiles rise from +12vh, blur 6px → 0, top row first, 30ms stagger
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // read the DOM, not useMotionOK(): that hook is false for the hydration pass
    const motionOn =
      document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motionOn) {
      root.dataset.entered = '';
      return;
    }
    const stop = inView(
      root,
      () => {
        stop();
        const vw = window.innerWidth;
        const dy = 0.12 * window.innerHeight;
        const order: HTMLElement[] = [];
        for (const track of [topRef.current, bottomRef.current]) {
          if (!track) continue;
          const vis = Array.from(track.querySelectorAll<HTMLElement>('[data-slot]'))
            .map((el) => ({ el, x: el.getBoundingClientRect().left }))
            .filter((o) => o.x > -vw * 0.15 && o.x < vw * 1.02)
            .sort((a, b) => a.x - b.x);
          for (const v of vis) {
            const e = v.el.firstElementChild as HTMLElement | null;
            if (e) order.push(e);
          }
        }
        const blurOn = !matches(MQ.mobile); // a blur layer per tile is too heavy for phones
        for (const e of order) {
          e.style.opacity = '0';
          e.style.transform = `translateY(${dy}px)`;
          if (blurOn) e.style.filter = 'blur(6px)';
        }
        root.dataset.entered = '';
        order.forEach((e, i) => {
          const delay = i * 0.03;
          animate(e, { opacity: [0, 1] }, { duration: 0.5, delay, ease: 'easeOut' });
          if (blurOn)
            animate(e, { filter: ['blur(6px)', 'blur(0px)'] }, { duration: 0.55, delay, ease: EASE.quart }).finished.then(() => {
              e.style.filter = '';
            });
          animate(e, { y: [dy, 0] }, { duration: 1.05, delay, ease: EASE.soft });
        });
      },
      { amount: 0.22 },
    );
    return stop;
  }, []);

  // close on Escape or a tap outside the open tile
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const t = e.target as Element | null;
      if (!t?.closest?.('[data-open]')) setOpen(null);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  const closeTimer = useRef<number | undefined>(undefined);
  const handlers = (row: RowName, k: number) => ({
    // Open on real mouse movement only: tiles drift (and scroll) under a resting cursor, and the
    // browser's synthetic hover events would otherwise pop bubbles open on their own.
    onPointerMove: (e: RPointerEvent) => {
      if (e.pointerType !== 'mouse' || (!e.movementX && !e.movementY)) return;
      window.clearTimeout(closeTimer.current);
      setOpen((o) => (o && o.row === row && o.k === k ? o : { row, k }));
    },
    onPointerLeave: (e: RPointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => setOpen((o) => (o && o.row === row && o.k === k ? null : o)), 90);
    },
    onPointerDown: (e: RPointerEvent) => {
      st.current.lastType = e.pointerType;
    },
    onClick: () => {
      if (st.current.lastType === 'mouse') return;
      setOpen((o) => (o && o.row === row && o.k === k ? null : { row, k }));
    },
  });

  const renderRow = (row: RowName, ref: typeof topRef) => {
    const tiles = ROWS[row];
    const openHere = open?.row === row;
    return (
      <div className={[s.wrap, row === 'top' ? s.wrapTop : s.wrapBottom].join(' ')} data-open={openHere ? '' : undefined}>
        <div ref={ref} className={s.track}>
          {[0, 1].flatMap((copyIdx) =>
            tiles.map((tile) => {
              const k = copyIdx * TILES_PER_ROW + tile.i;
              const isOpen = openHere && open?.k === k;
              return (
                <div
                  key={k}
                  className={[s.slot, copyIdx ? s.dup : ''].join(' ')}
                  data-slot=""
                  data-open={isOpen ? '' : undefined}
                  style={
                    {
                      ['--k']: k,
                      ['--tilt']: `${tile.tilt}deg`,
                      ['--depth']: tile.depth,
                      ['--wave']: tile.wave,
                      zIndex: isOpen ? 50 : Math.round(tile.depth * 20),
                    } as CSSProperties
                  }
                  {...handlers(row, k)}
                >
                  <div className={s.enter}>
                    <div className={s.lift} data-far={tile.depth < 0.93 ? '' : undefined}>
                      <TileFace tile={tile} />
                    </div>
                  </div>
                  {isOpen ? <CookBubble recipe={tile.recipe} below={row === 'top'} /> : null}
                </div>
              );
            }),
          )}
        </div>
      </div>
    );
  };

  return (
    <div ref={rootRef} className={s.cloud} aria-hidden="true">
      {renderRow('top', topRef)}
      {renderRow('bottom', bottomRef)}
    </div>
  );
}

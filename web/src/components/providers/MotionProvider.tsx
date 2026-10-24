'use client';
// Motion gating (brief 4.1).
//   const motionOK = useMotionOK();   // false on the server, under reduced motion, or after the 4s no-JS fallback
//   const reduced = useReducedMotionPref();
//
// - Marks the page hydrated (window.__homecookdHydrated) so the inline <head> script's 4s fallback
//   doesn't switch data-motion to "off".
// - Keeps html[data-motion] in sync with prefers-reduced-motion changes.
// - Refreshes ScrollTrigger after fonts load, after the hero poster loads, and on body resize
//   (debounced, then held until scrolling pauses and the main thread is idle, so late content never
//   hitches an active scroll).
// - Marks sections that are well off screen with data-offscreen, which pauses their looping CSS
//   animations (globals.css), so steam, wobbles and blinks never repaint out of sight.
// - Keeps the reader's place when a resize flips the choreography (desktop film <-> mobile): the
//   matchMedia revert drops every pin and ScrollTrigger measures from scrollY 0, which used to land
//   the page back at the top.
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { ScrollTrigger } from '@/lib/motion/gsap';
import { loadMotion } from '@/lib/motion/lazy';
import { MQ } from '@/lib/motion/media';
import { afterLoadIdle } from '@/lib/perf';

declare global {
  interface Window {
    __homecookdHydrated?: boolean;
  }
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia(MQ.reduce);
  mq.addEventListener('change', cb);
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    mq.removeEventListener('change', cb);
    mo.disconnect();
  };
}

const getMotionOK = () =>
  !window.matchMedia(MQ.reduce).matches && document.documentElement.dataset.motion === 'on';
const getReduced = () => window.matchMedia(MQ.reduce).matches;

/** True when animated (hidden-start) states may be used. Always false during SSR/hydration. */
export function useMotionOK(): boolean {
  return useSyncExternalStore(subscribe, getMotionOK, () => false);
}

/** The user's reduced-motion preference (false on the server). */
export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(subscribe, getReduced, () => false);
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;
/** Debounced ScrollTrigger.refresh() that any component can call after a layout change. */
export function requestRefresh(delay = 200) {
  if (typeof window === 'undefined') return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => ScrollTrigger.refresh(), delay);
}

let lastScrollAt = 0;
let idleHandle: number | undefined;
/** Like requestRefresh(), but waits until scrolling has paused and the main thread is idle. */
function requestQuietRefresh(delay = 200) {
  clearTimeout(refreshTimer);
  if (idleHandle !== undefined && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleHandle);
  idleHandle = undefined;
  const run = () => {
    if (performance.now() - lastScrollAt < 180) {
      refreshTimer = setTimeout(run, 180);
      return;
    }
    if ('requestIdleCallback' in window) {
      idleHandle = window.requestIdleCallback(
        () => {
          idleHandle = undefined;
          ScrollTrigger.refresh();
        },
        { timeout: 800 },
      );
    } else ScrollTrigger.refresh();
  };
  refreshTimer = setTimeout(run, delay);
}

/** The page's top-level blocks in flow (sections, pin spacers, footer), through display: contents slots. */
function flowBlocks(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (parent: Element) => {
    for (const el of Array.from(parent.children)) {
      if (!(el instanceof HTMLElement) || el.tagName === 'SCRIPT') continue;
      const cs = getComputedStyle(el);
      if (el.tagName === 'MAIN' || cs.display === 'contents') walk(el);
      else if (cs.position !== 'fixed' && cs.position !== 'absolute' && el.offsetHeight > 0) out.push(el);
    }
  };
  walk(document.body);
  return out;
}

/** Where the viewport top sits: which block, and how far into it (0..1). */
function readAnchor(): { index: number; progress: number } | null {
  if (window.scrollY < 1) return null;
  const blocks = flowBlocks();
  for (let i = 0; i < blocks.length; i++) {
    const r = blocks[i].getBoundingClientRect();
    if (r.bottom > 0) return { index: i, progress: r.height > 0 ? Math.min(1, Math.max(0, -r.top / r.height)) : 0 };
  }
  return null;
}

function restoreAnchor(anchor: { index: number; progress: number }) {
  const block = flowBlocks()[anchor.index];
  if (!block) return;
  const r = block.getBoundingClientRect();
  const y = Math.round(window.scrollY + r.top + anchor.progress * r.height);
  if (Math.abs(y - window.scrollY) > 2) window.scrollTo(0, y);
}

export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.__homecookdHydrated = true;
    const root = document.documentElement;
    const mq = window.matchMedia(MQ.reduce);
    const onChange = () => {
      // Only ever switch on → off here; never re-hide content after the no-JS fallback fired.
      if (mq.matches) root.dataset.motion = 'off';
      requestRefresh(50);
    };
    mq.addEventListener('change', onChange);

    // Motion stays out of the first-load JS (src/lib/motion/lazy.ts): fetch it once the page is idle.
    const cancelMotion = afterLoadIdle(() => void loadMotion(), 2000);

    // Refresh after fonts and the hero poster (LCP image) settle.
    let cancelled = false;
    document.fonts?.ready.then(() => !cancelled && requestRefresh(0));
    const poster = document.querySelector<HTMLImageElement>('img[data-hero-poster]');
    const onPoster = () => requestRefresh(0);
    if (poster && !poster.complete) poster.addEventListener('load', onPoster, { once: true });
    window.addEventListener('load', onPoster, { once: true });

    // Body resize (images, accordions, late content) → refresh once scrolling pauses, ignoring our
    // own pin-spacing churn (a refresh re-measures lastH when it completes).
    let lastH = document.body.scrollHeight;
    const ro = new ResizeObserver(() => {
      if ((ScrollTrigger as unknown as { isRefreshing?: boolean }).isRefreshing) return;
      const h = document.body.scrollHeight;
      if (Math.abs(h - lastH) < 2) return;
      lastH = h;
      requestQuietRefresh(200);
    });
    ro.observe(document.body);
    const onScroll = () => {
      lastScrollAt = performance.now();
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Resize anchor: read where the reader is on the first resize event of a burst (before the
    // matchMedia revert, which runs after resize listeners), then put them back after every refresh
    // that follows, until the burst has settled.
    let anchor: ReturnType<typeof readAnchor> = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let lastW = window.innerWidth;
    let lastVH = window.innerHeight;
    const coarse = window.matchMedia('(pointer: coarse)');
    const onResize = () => {
      const w = window.innerWidth;
      const vh = window.innerHeight;
      // Touch browsers resize the height as the URL bar shows/hides: not a layout change.
      const changed = w !== lastW || (vh !== lastVH && !coarse.matches);
      lastW = w;
      lastVH = vh;
      if (!changed) return;
      if (!settle) anchor = readAnchor();
      clearTimeout(settle);
      settle = setTimeout(() => {
        settle = undefined;
        anchor = null;
      }, 2000);
    };
    window.addEventListener('resize', onResize);
    const onRefresh = () => {
      lastH = document.body.scrollHeight;
      if (anchor) restoreAnchor(anchor);
    };
    ScrollTrigger.addEventListener('refresh', onRefresh);

    // Off-screen sections: data-offscreen pauses their CSS loops. Deferred slots swap a section's
    // nodes when they mount, so new sections are picked up as main's children change.
    const vis = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) delete el.dataset.offscreen;
          else el.dataset.offscreen = '';
        }
      },
      { rootMargin: '25% 0px' },
    );
    const main = document.getElementById('main');
    const observeSections = () => {
      main?.querySelectorAll(':scope section').forEach((el) => vis.observe(el));
      document.querySelectorAll('footer').forEach((el) => vis.observe(el));
    };
    observeSections();
    let scan = 0;
    const mo = new MutationObserver(() => {
      if (!scan) scan = requestAnimationFrame(() => ((scan = 0), observeSections()));
    });
    if (main) mo.observe(main, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      cancelMotion();
      vis.disconnect();
      mo.disconnect();
      cancelAnimationFrame(scan);
      mq.removeEventListener('change', onChange);
      poster?.removeEventListener('load', onPoster);
      window.removeEventListener('load', onPoster);
      ro.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      ScrollTrigger.removeEventListener('refresh', onRefresh);
      clearTimeout(settle);
    };
  }, []);

  return <>{children}</>;
}

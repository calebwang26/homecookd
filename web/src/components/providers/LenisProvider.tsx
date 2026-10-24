'use client';
// Smooth scroll (brief section 2): Lenis on desktop wheel only
// ((pointer: fine) and (min-width: 1024px) and motion allowed), driven by gsap.ticker and synced
// to ScrollTrigger. Off on touch and under reduced motion (native scroll), where its code is never
// even downloaded (dynamic import).
//
//   const lenis = useLenis();               // Lenis | null
//   const scrollToId = useScrollToId();     // scrollToId('see-it-work')
//
// Every in-page `a[href^="#"]` click is intercepted globally: it scrolls (Lenis, or native
// scrollIntoView, both honoring html's scroll-padding-top), updates the URL hash, moves focus to
// the target for keyboard/screen-reader users, and dispatches `homecookd:anchor` (detail: { id }) on
// window so a section can react (e.g. FinalCta focuses its email field on #early-access).
import type Lenis from 'lenis';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { gsap, ScrollTrigger } from '@/lib/motion/gsap';
import { MQ, MQ_LENIS } from '@/lib/motion/media';
import { SECTIONS_READY } from '@/lib/deferred';

const LenisCtx = createContext<Lenis | null>(null);

export function useLenis(): Lenis | null {
  return useContext(LenisCtx);
}

export const ANCHOR_EVENT = 'homecookd:anchor';

function prefersReduced() {
  return window.matchMedia(MQ.reduce).matches || document.documentElement.dataset.motion === 'off';
}

export function scrollToId(id: string, lenis: Lenis | null) {
  if (id === 'top' || id === '') {
    if (lenis) lenis.scrollTo(0);
    else window.scrollTo({ top: 0, behavior: prefersReduced() ? 'auto' : 'smooth' });
  } else {
    const el = document.getElementById(id);
    if (!el) return;
    // Lenis subtracts html's scroll-padding-top (88px, clears the nav) itself, like native scrolling
    if (lenis) lenis.scrollTo(el);
    else el.scrollIntoView({ behavior: prefersReduced() ? 'auto' : 'smooth', block: 'start' });
    // Move focus without a second scroll jump.
    if (!el.matches('a, button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
  window.dispatchEvent(new CustomEvent(ANCHOR_EVENT, { detail: { id } }));
}

export function useScrollToId(): (id: string) => void {
  const lenis = useLenis();
  return useCallback((id: string) => scrollToId(id, lenis), [lenis]);
}

export function LenisProvider({ children }: { children: ReactNode }) {
  const [lenis, setLenis] = useState<Lenis | null>(null);

  // Create / destroy Lenis as the media query flips (e.g. window resized, reduced motion toggled).
  useEffect(() => {
    const mq = window.matchMedia(MQ_LENIS);
    let instance: Lenis | null = null;
    let tick: ((time: number) => void) | null = null;

    let gen = 0; // bumps on stop/unmount so a late import never starts a stale instance
    const start = () => {
      if (instance || document.documentElement.dataset.motion === 'off') return;
      const mine = ++gen;
      import('lenis').then(({ default: LenisCtor }) => {
        if (mine !== gen || instance || !mq.matches) return;
        instance = new LenisCtor({ lerp: 0.1, autoRaf: false, smoothWheel: true, anchors: false });
        instance.on('scroll', ScrollTrigger.update);
        tick = (time: number) => instance?.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
        setLenis(instance);
      });
    };
    const stop = () => {
      gen++;
      if (tick) gsap.ticker.remove(tick);
      tick = null;
      instance?.destroy();
      instance = null;
      setLenis(null);
    };
    const sync = () => (mq.matches ? start() : stop());
    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
      stop();
    };
  }, []);

  // Deep links (/#questions): the browser jumps to the hash before hydration, but the pinned and
  // sticky scenes then add ~3.5 viewports of track above most sections. Once fonts are in, every
  // deferred section has mounted (src/lib/deferred.ts mounts them all at once for a hash) and
  // ScrollTrigger has laid out its pin spacing, land on the hash target again.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id || id === 'top') return;
    let cancelled = false;
    let raf = 0;
    const land = () => {
      if (cancelled) return;
      ScrollTrigger.refresh();
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    const fontsReady = document.fonts?.ready ?? Promise.resolve();
    let onReady: (() => void) | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const sectionsReady = new Promise<void>((resolve) => {
      if (window.__homecookdSectionsReady || !document.querySelector('[data-section]')) return resolve();
      onReady = () => resolve();
      window.addEventListener(SECTIONS_READY, onReady, { once: true });
      fallback = setTimeout(resolve, 4000);
    });
    Promise.all([fontsReady, sectionsReady]).then(() => {
      raf = requestAnimationFrame(() => (raf = requestAnimationFrame(land)));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(fallback);
      if (onReady) window.removeEventListener(SECTIONS_READY, onReady);
    };
  }, []);

  // Global in-page anchor handling.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]') as HTMLAnchorElement | null;
      if (!a) return;
      const id = decodeURIComponent(a.getAttribute('href')!.slice(1));
      if (id && id !== 'top' && !document.getElementById(id)) return;
      e.preventDefault();
      scrollToId(id, lenis);
      try {
        const url = new URL(window.location.href);
        url.hash = id ? `#${id}` : '';
        window.history.pushState(window.history.state, '', url.toString());
      } catch {
        /* ignore */
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [lenis]);

  return <LenisCtx.Provider value={lenis}>{children}</LenisCtx.Provider>;
}

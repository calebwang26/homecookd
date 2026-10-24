'use client';
// Keep the real recordings off the network until the visitor is close (brief 11): nothing in
// See it work or Questions downloads at page load, five viewports early.
import { useEffect, useState, type RefObject } from 'react';

/** true once `ref` comes within `rootMargin` of the viewport; stays true. */
export function useNear(ref: RefObject<Element | null>, rootMargin = '150% 0px'): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setNear(true);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, near]);
  return near;
}

/** the visitor asked for less data (same rule as HeroVideo): posters + tap to play */
export function saveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !!c?.saveData;
}

/**
 * Play `video` from `at` seconds instead of 0: on every restart (AppClip's currentTime = 0), on
 * a native loop (which seeks to 0) and on a first play before any data. Returns the cleanup.
 */
export function startFrom(video: HTMLVideoElement, at: number): () => void {
  const fix = () => {
    if (video.currentTime < at - 0.05) {
      try {
        video.currentTime = at;
      } catch {
        /* not seekable yet: loadedmetadata runs this again */
      }
    }
  };
  const events = ['seeking', 'play', 'loadedmetadata'] as const;
  events.forEach((t) => video.addEventListener(t, fix));
  if (video.readyState > 0) fix();
  return () => events.forEach((t) => video.removeEventListener(t, fix));
}

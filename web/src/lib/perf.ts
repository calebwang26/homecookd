// Adaptive mode flags, set before first paint by the inline MOTION_GATE script (src/app/layout.tsx).
//
//   if (slowNet()) …   // Save-Data or a 2G/3G connection: no autoplaying video, no prefetch
//   if (weakDevice()) … // ≤ 2 GB memory or 2 cores (Chromium only): data-motion is already "off"
//
// Client-only (read them in effects, never during render).

export function slowNet(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.net === 'slow';
}

export function weakDevice(): boolean {
  return typeof document !== 'undefined' && 'weak' in document.documentElement.dataset;
}

/** Run fn once the page has loaded and the main thread is idle (poster and first paint go first). */
export function afterLoadIdle(fn: () => void, timeout = 1500): () => void {
  let cancelled = false;
  let handle: number | undefined;
  const run = () => {
    if (cancelled) return;
    const go = () => {
      if (!cancelled) fn();
    };
    if (typeof window.requestIdleCallback === 'function') handle = window.requestIdleCallback(go, { timeout });
    else handle = setTimeout(go, 60) as unknown as number;
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
    if (handle !== undefined) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
      clearTimeout(handle);
    }
  };
}

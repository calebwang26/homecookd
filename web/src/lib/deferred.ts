// Deferred section mounting (performance budget, brief 11). Used only by src/app/sections.tsx.
//
// Everything below DeckFilm is server-rendered into the HTML as usual, but its JavaScript is a
// separate chunk that the page does not run during the first hydration. The section's server HTML
// stays on screen untouched (a "frozen" slot) until its turn comes, then the real component mounts
// in its place in one commit. Turns, whichever comes first:
//   1. the slot gets near the viewport (one viewport ahead), is focused, or is touched;
//   2. the page has loaded and the main thread is idle: then every slot mounts in page order, one
//      per idle callback, so no single long task holds up input. The queue waits while the visitor
//      is scrolling, so a mount never lands mid-scroll. Slow connection or weak device
//      (src/lib/perf.ts): no queue and no prefetch; slots mount only on approach (turn 1);
//   3. a deep link (/#questions): everything mounts straight away, then the hash is landed again.
// When the last slot has mounted, window gets the SECTIONS_READY event.

import type { ComponentType } from 'react';
import { slowNet, weakDevice } from './perf';

export const SECTIONS_READY = 'homecookd:sections-ready';

type Loader = () => Promise<ComponentType>;
type Mount = (C: ComponentType) => void;

interface Slot {
  order: number;
  load: Loader;
  mount?: Mount;
  promise?: Promise<ComponentType>;
  mounted: boolean;
}

const slots = new Map<string, Slot>();
let queueStarted = false;
let readyFired = false;

declare global {
  interface Window {
    __homecookdSectionsReady?: boolean;
  }
}

function fetchSlot(id: string): Promise<ComponentType> {
  const slot = slots.get(id)!;
  if (!slot.promise) {
    const attempt = () => slot.load();
    slot.promise = attempt()
      .catch(() => new Promise<void>((r) => setTimeout(r, 1500)).then(attempt))
      .catch((err) => {
        // Never leave reveal-gated content hidden: the frozen server HTML is the final, readable
        // state once data-motion is off.
        document.documentElement.dataset.motion = 'off';
        throw err;
      });
  }
  return slot.promise;
}

function checkReady() {
  if (readyFired) return;
  for (const s of slots.values()) if (!s.mounted) return;
  readyFired = true;
  window.__homecookdSectionsReady = true;
  window.dispatchEvent(new Event(SECTIONS_READY));
}

/** Mount one slot now (near the viewport, focused, or next in the idle queue). */
export function mountSlot(id: string): Promise<void> {
  const slot = slots.get(id);
  if (!slot) return Promise.resolve();
  if (slot.mounted) return Promise.resolve();
  return fetchSlot(id).then(
    (C) => {
      // already in, or its page left while the chunk loaded: a later page mounts its own copy
      if (slot.mounted || !slot.mount) return;
      slot.mounted = true;
      slot.mount?.(C);
      checkReady();
    },
    () => {},
  );
}

const idle = (fn: () => void, timeout = 1200) => {
  if ('requestIdleCallback' in window) window.requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 60);
};

let lastScrollAt = 0;
const SCROLL_QUIET_MS = 220;
/** idle(), but held until scrolling has paused */
const quietIdle = (fn: () => void, timeout: number) => {
  const wait = () => {
    const since = performance.now() - lastScrollAt;
    if (since < SCROLL_QUIET_MS) setTimeout(wait, SCROLL_QUIET_MS - since);
    else idle(fn, timeout);
  };
  wait();
};

function runQueue(immediate: boolean) {
  if (queueStarted) return;
  queueStarted = true;
  window.addEventListener('scroll', () => (lastScrollAt = performance.now()), { passive: true });
  const ids = [...slots.entries()].sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
  // Fetch every chunk up front (they are already preloaded at low priority), then mount one per
  // idle period in page order.
  ids.forEach((id) => fetchSlot(id).catch(() => {}));
  let i = 0;
  const next = () => {
    if (i >= ids.length) return;
    const id = ids[i++];
    mountSlot(id).then(() => (immediate ? requestAnimationFrame(next) : quietIdle(next, 600)));
  };
  next();
}

/** Called by each slot on the client after hydration. Returns an unregister function. */
export function registerSlot(id: string, order: number, load: Loader, mount: Mount): () => void {
  const existing = slots.get(id);
  if (existing) {
    existing.mount = mount;
    existing.load = load;
  } else {
    slots.set(id, { order, load, mount, mounted: false });
  }
  scheduleQueue();
  return () => {
    // The slot left the page (its page unmounted): a later page that registers the same slot must
    // mount its own copy, so it's no longer counted as mounted.
    const s = slots.get(id);
    if (s && s.mount === mount) {
      s.mount = undefined;
      s.mounted = false;
    }
  };
}

let scheduled = false;
function scheduleQueue() {
  if (scheduled) return;
  scheduled = true;
  // Let every slot register in this commit first.
  queueMicrotask(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && hash !== 'top') {
      runQueue(true);
      return;
    }
    // slow connection / weak device: mount on approach only (each slot's own observer)
    if (slowNet() || weakDevice()) return;
    const start = () => idle(() => runQueue(false), 1500);
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  });
}

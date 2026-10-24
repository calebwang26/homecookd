// Motion, off the first-load path (brief 11). The first screen (DeckFilm, HeroOverlay, Chip,
// Highlighter, LetterArc) imports from here instead of 'motion', so Motion's ~44 KB (gzip) leaves
// the initial bundle. MotionProvider prefetches it once the page is idle; deferred sections import
// 'motion' directly and share the same chunk.
//
//   loadMotion().then(({ animate }) => animate(el, …))   // waits for it
//   motionNow()?.animate(el, …)                          // only if already here (else skip the flourish)
//   const stop = inView(el, () => { stop(); play(); }, { amount: 0.6 })   // native, no Motion needed

type MotionModule = typeof import('motion');

let mod: MotionModule | undefined;
let pending: Promise<MotionModule> | undefined;

export function loadMotion(): Promise<MotionModule> {
  pending ??= import('motion').then((m) => (mod = m));
  return pending;
}

/** Motion if it has already loaded, else undefined (and starts loading it). */
export function motionNow(): MotionModule | undefined {
  if (!mod) void loadMotion();
  return mod;
}

/**
 * Motion's inView(), on a plain IntersectionObserver. onStart runs when `el` enters (with `amount`
 * of it visible, inside `margin`); if it returns a function, that runs when it leaves, otherwise
 * observing stops after the first entry. Returns a stop function.
 */
export function inView(
  el: Element,
  onStart: (entry: IntersectionObserverEntry) => void | (() => void),
  { margin, amount = 'some' }: { margin?: string; amount?: number | 'some' | 'all' } = {},
): () => void {
  const threshold = amount === 'some' ? 0 : amount === 'all' ? 1 : amount;
  let onEnd: (() => void) | undefined;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const inside = e.isIntersecting && e.intersectionRatio >= threshold - 0.001;
        if (inside && !onEnd) {
          const end = onStart(e);
          if (typeof end === 'function') onEnd = end;
          else io.unobserve(e.target);
        } else if (!inside && onEnd) {
          onEnd();
          onEnd = undefined;
        }
      }
    },
    { rootMargin: margin, threshold },
  );
  io.observe(el);
  return () => io.disconnect();
}

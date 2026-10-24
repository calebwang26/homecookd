// gsap.matchMedia() conditions (brief section 2). Film (pinned/scrubbed) choreography only on
// desktop ≥1024 wide AND ≥600 tall; everything below uses the mobile versions.
//
//   useGSAP(() => {
//     const mm = gsap.matchMedia();
//     mm.add(MQ.desktop, () => { /* pinned, scrubbed film */ });
//     mm.add(MQ.mobile, () => { /* one-shot enters */ });
//   }, { scope: root });
//   if (matches(MQ_PHONE)) …        // one-off checks in effects (never during render)
export const MQ = {
  desktop: '(min-width: 1024px) and (min-height: 600px) and (prefers-reduced-motion: no-preference)',
  mobile: '(max-width: 1023px) and (prefers-reduced-motion: no-preference)',
  reduce: '(prefers-reduced-motion: reduce)',
} as const;

/** Desktop width but too short for film mode: use the mobile (unpinned) choreography. */
export const MQ_SHORT_DESKTOP = '(min-width: 1024px) and (max-height: 599px) and (prefers-reduced-motion: no-preference)';

/** Lenis runs only for a fine pointer on a wide screen with motion allowed. */
export const MQ_LENIS = '(pointer: fine) and (min-width: 1024px) and (prefers-reduced-motion: no-preference)';

/** Breakpoints (px). mobile < 768, tablet 768–1023 (mobile choreography), desktop ≥ 1024. */
export const BP = { tablet: 768, desktop: 1024 } as const;

export const MQ_PHONE = '(max-width: 767px)';
export const MQ_FINE_POINTER = '(hover: hover) and (pointer: fine)';

export function matches(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

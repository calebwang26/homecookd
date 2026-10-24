// Custom next/image loader for the static export (brief section 2 / 7.1).
// /media/<dir>/<name>.(jpg|png) → /media/_opt/<dir>/<name>-<w>.webp, with <w> rounded UP to the
// nearest width scripts/media.mjs generated. Widths above the source size were written at the
// source's own width, so every generated URL exists. Anything else (svg, other paths) is passed
// through with a ?w= hint so next/image still sees a width-aware loader.
//
//   <Img src="/media/stock/dish-pho.jpg" … />                 // next/image uses this loader automatically
//   optSrc('/media/stock/hero-loop-poster.jpg', 1920)        // → /media/_opt/stock/hero-loop-poster-1920.webp
//   blurSrc(PHOTOS.youngAdultNight.src)                      // → …/photo-young-adult-cooking-night-blur.webp
//   style={{ backgroundImage: `url(${optSrc(src, 640)})` }}  // CSS backgrounds / <img> outside next/image

export const OPT_WIDTHS = [160, 320, 480, 640, 960, 1280, 1920] as const;
const OPT_DIRS = new Set(['stock', 'app-covers', 'app']);

export function optWidth(width: number): number {
  for (const w of OPT_WIDTHS) if (w >= width) return w;
  return OPT_WIDTHS[OPT_WIDTHS.length - 1];
}

/** Map a raw /media path to its optimized WebP (or return null if it isn't optimizable). */
export function optSrc(src: string, width: number): string | null {
  const m = /^\/media\/([a-z-]+)\/([^/]+)\.(jpe?g|png)$/i.exec(src);
  if (!m || !OPT_DIRS.has(m[1])) return null;
  return `/media/_opt/${m[1]}/${m[2]}-${optWidth(width)}.webp`;
}

/** The pre-blurred 96px layer for photo-*.jpg (a6 mobile layer). */
export function blurSrc(src: string): string | null {
  const m = /^\/media\/stock\/(photo-[^/]+)\.jpe?g$/i.exec(src);
  return m ? `/media/_opt/stock/${m[1]}-blur.webp` : null;
}

export default function imageLoader({ src, width }: { src: string; width: number; quality?: number }): string {
  return optSrc(src, width) ?? `${src}${src.includes('?') ? '&' : '?'}w=${width}`;
}

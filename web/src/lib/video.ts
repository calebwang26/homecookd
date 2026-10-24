// Delivery video (scripts/media.mjs step 4d writes the files to /media/_opt/video/).
//
//   heroSrc(HERO.desktop, HERO.mobile)   // size + codec for this screen
//   videoSrc(src)                        // HEVC copy where one exists and plays, else the master
//
// Client-only: canPlayType and the screen size are read in effects, never during render.

// Masters that have an HEVC copy (keep in sync with VIDEO_HEVC in scripts/media.mjs). The app
// recordings have none: their H.264 masters are already as small.
const HAS_HEVC = new Set(['/media/stock/hero-family-1920.mp4', '/media/stock/hero-family-mobile.mp4']);
const OPT = '/media/_opt/video/';
const base = (src: string) => src.slice(src.lastIndexOf('/') + 1, -'.mp4'.length);

let hevc: boolean | undefined;
/** HEVC in MP4 (hvc1): Safari, Chrome and Edge with hardware decode. */
export function canPlayHevc(): boolean {
  if (hevc === undefined) {
    const v = document.createElement('video');
    hevc = v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') !== '';
  }
  return hevc;
}

/** The HEVC copy of a master when this browser plays it, else the master itself. */
export function videoSrc(master: string): string {
  return HAS_HEVC.has(master) && canPlayHevc() ? `${OPT}${base(master)}.hevc.mp4` : master;
}

// Masters with re-encoded copies in OPT (H.264 .mp4 and HEVC .hevc.mp4); the 1920 one also has a
// 1280-wide pair. Other masters are served as they are.
const REENCODED: Record<string, { small?: string }> = {
  '/media/stock/hero-family-1920.mp4': { small: 'hero-family-1280' },
  '/media/stock/hero-family-mobile.mp4': {},
};

/**
 * The hero source for this screen: phones (≤ 767 CSS px) get the 9:16 master, wider screens the
 * landscape one, 1280 wide when the screen has fewer than 1600 physical px across (no visible
 * difference there). Re-encoded copies are ~25–55% smaller than the masters at SSIM ≥ 0.99.
 */
export function heroSrc(desktopMaster: string, mobileMaster: string): string {
  const master = window.matchMedia('(max-width: 767px)').matches ? mobileMaster : desktopMaster;
  const re = REENCODED[master];
  if (!re) return videoSrc(master);
  const physical = window.innerWidth * (window.devicePixelRatio || 1);
  const name = re.small && physical < 1600 ? re.small : base(master);
  return `${OPT}${name}${canPlayHevc() ? '.hevc.mp4' : '.mp4'}`;
}

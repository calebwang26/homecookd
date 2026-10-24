import type { AppClipName } from './types';
import { copy } from './copy';

// Media map (brief 6.4). Paths are under /public. Every photo listed here was opened and checked
// against its filename on Oct 12 (the restored Pexels set).

/**
 * Hero video: Gustavo Fring's family-kitchen shoot (Pexels 7423603 + 7423605, 4K sources). A mom
 * laughs with her adult son and daughter over a salad, then a wide shot shows her slicing tomatoes
 * while they cook at the stove. The loop is a hard cut between the two angles (no crossfade
 * ghosting) with a gentle warm grade; the posters are frame 0 of each file, so the poster → video
 * swap never jumps. The mobile file is already a 9:16 crop. See docs/lander-qa/hero-candidates/round2.md.
 * Contrast: the text area's brightest frame is YAVG 137 (mean 127), close to the old hero's 134.
 */
export const HERO = {
  desktop: '/media/stock/hero-family-1920.mp4',
  mobile: '/media/stock/hero-family-mobile.mp4',
  poster: '/media/stock/hero-family-poster.jpg',
  posterMobile: '/media/stock/hero-family-poster-mobile.jpg',
  focus: '45% 40%',
  /** the mobile file is already cropped to 9:16 around the faces and the cutting board */
  focusMobile: '50% 40%',
  alt: 'A mother laughing with her adult son and daughter as they make a salad together in the kitchen.',
  /** the previous hero (a grandmother and granddaughter folding dumplings), kept as a fallback */
  raw: {
    desktop: '/media/stock/hero-1920.mp4',
    tablet: '/media/stock/hero-1080.mp4',
    mobile: '/media/stock/hero-mobile-720x1280.mp4',
    poster: '/media/stock/hero-poster.jpg',
    posterMobile: '/media/stock/hero-poster-mobile.jpg',
  },
} as const;

/** Real screen recordings (780×1688, 30fps). Labels say what the clip really shows (brief 7.2). */
export const APP_CLIPS: Record<AppClipName, { src: string; poster: string; label: string; duration: number }> = {
  'app-record': { src: '/media/app/app-record.mp4', poster: '/media/app/app-record.jpg', label: copy.appClips['app-record'], duration: 12.8 },
  'app-recipe': { src: '/media/app/app-recipe.mp4', poster: '/media/app/app-recipe.jpg', label: copy.appClips['app-recipe'], duration: 4.8 },
  'app-cook': { src: '/media/app/app-cook.mp4', poster: '/media/app/app-cook.jpg', label: copy.appClips['app-cook'], duration: 13.5 },
  'app-share': { src: '/media/app/app-share.mp4', poster: '/media/app/app-share.jpg', label: copy.appClips['app-share'], duration: 8.8 },
  'app-library': { src: '/media/app/app-library.mp4', poster: '/media/app/app-library.jpg', label: copy.appClips['app-library'], duration: 12.2 },
  'app-questions': { src: '/media/app/app-questions.mp4', poster: '/media/app/app-questions.jpg', label: copy.appClips['app-questions'], duration: 13.7 },
  'app-add': { src: '/media/app/app-add.mp4', poster: '/media/app/app-add.jpg', label: copy.appClips['app-add'], duration: 5.7 },
  // the video playing inside the app is a Pexels stock clip standing in for a family recording
  'app-watch': { src: '/media/app/app-watch.mp4', poster: '/media/app/app-watch.jpg', label: copy.appClips['app-watch'], duration: 5.1 },
  'app-keep': { src: '/media/app/app-keep.mp4', poster: '/media/app/app-keep.jpg', label: copy.appClips['app-keep'], duration: 5.0 },
};

/** Extra real-app stills made by scripts/media.mjs (step 4). */
export const APP_STILLS = {
  /** app-record at 11.5s: "Add a recipe" with "Sunday dumplings" typed and Grandma picked (no tap ring) */
  recordAdd: {
    src: '/media/app/app-record-add.jpg',
    alt: 'The Add a recipe screen in homecookd, with Sunday dumplings typed in and Grandma picked as the cook.',
    width: 780,
    height: 1688,
  },
  /** last frame of app-share (the share sheet is NOT visible in the current file) */
  shareEnd: { src: '/media/app/app-share-end.jpg', alt: "Grandma's Red-Braised Pork Belly in homecookd.", width: 780, height: 1688 },
} as const;

/** Has app-share been re-recorded with the native share sheet? (brief 7.2). Flip when it lands. */
export const APP_SHARE_HAS_SHEET = false;

export interface HandPhone {
  src: string;
  width: number;
  height: number;
  /** the transparent screen hole, as % of the image */
  screen: { left: string; top: string; width: string; height: string };
  /** border-radius of the screen hole */
  radius: string;
  rotate: number;
  /** the phone body's bounding box as % of the image (used to size the image from the phone width) */
  body: { left: number; top: number; width: number; height: number };
  alt: string;
}

/**
 * Hand-holding-phone cutout (a8). Checked: clean edges at ≤ 600px display width, a pale lavender
 * bumper, light-to-medium skin tone, thumb on the right edge, fingertips on the left, the forearm
 * leaving the bottom-right. Screen hole measured from the alpha channel (the 800px and 1228px files
 * agree within 0.1%). Uses the 1228px master so a ~330px phone stays sharp on 2× screens, after
 * scripts/media.mjs step 4b removed the cutout's pale background fringe (it showed as a halo on the
 * green block): /media/_opt/stock/hand-phone-clean-<w>.webp.
 */
export const HAND_PHONE: HandPhone | null = {
  src: '/media/stock/hand-phone-clean.png',
  width: 1228,
  height: 1789,
  screen: { left: '12.25%', top: '3.52%', width: '42.5%', height: '61.66%' },
  radius: '7.7% / 3.6%',
  rotate: 0,
  body: { left: 8.3, top: 0.7, width: 50.7, height: 67.1 },
  alt: '',
};

export type PhotoRole =
  | 'phoneTripod'
  | 'cookRecordingPhone'
  | 'handsKneading'
  | 'pinchIntoPot'
  | 'youngAdultNight'
  | 'parentPhoneCall'
  | 'grandmaGranddaughterDumplings'
  | 'grandpaGrandson'
  | 'abuelaTortillas'
  | 'dadSon'
  | 'grandpaChopping'
  | 'elderHandsDumpling'
  | 'familyDinnerTable'
  | 'familyLaughingTable'
  | 'momDaughter'
  | 'steamingPot';

export interface Photo {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** object-position for the focal point */
  focus: string;
}

/** Lifestyle photos by role (brief 7.3). Dimensions are the source files'. */
export const PHOTOS: Record<PhotoRole, Photo> = {
  phoneTripod: {
    src: '/media/stock/photo-phone-tripod-kitchen.jpg',
    alt: 'A phone on a small tripod on a kitchen counter, ready to record.',
    width: 1505, height: 2000, focus: '47% 60%',
  },
  cookRecordingPhone: {
    src: '/media/stock/photo-cook-recording-phone.jpg',
    alt: 'A young woman cooking at her counter while a phone on a stand records her.',
    width: 1333, height: 2000, focus: '55% 40%',
  },
  handsKneading: {
    src: '/media/stock/photo-hands-kneading.jpg',
    alt: 'Hands kneading golden dough on a floured counter.',
    width: 2000, height: 1333, focus: '60% 50%',
  },
  pinchIntoPot: {
    src: '/media/stock/photo-pinch-into-pot.jpg',
    alt: 'A hand dropping a pinch of herbs into a steaming pot.',
    width: 1333, height: 2000, focus: '55% 45%',
  },
  youngAdultNight: {
    src: '/media/stock/photo-young-adult-cooking-night.jpg',
    alt: 'A young man cooking alone at night in a small apartment kitchen.',
    width: 1334, height: 2000, focus: '35% 45%',
  },
  parentPhoneCall: {
    src: '/media/stock/photo-parent-phone-call.jpg',
    alt: 'A woman in her sixties covers her mouth in delight as she looks at her phone in the kitchen.',
    width: 2000, height: 1335, focus: '45% 40%',
  },
  // a still from hero-1920.mp4 (2.6s), cropped square: both faces, the dumplings in their hands, the
  // steamer basket below (the star's inner circle holds the faces and hands)
  grandmaGranddaughterDumplings: {
    src: '/media/stock/photo-grandma-granddaughter-dumplings.jpg',
    alt: 'A grandmother and her granddaughter smile as they fold dumplings together over a steamer basket.',
    width: 1000, height: 1000, focus: '50% 50%',
  },
  grandpaGrandson: {
    src: '/media/stock/photo-grandpa-grandson-breakfast.jpg',
    alt: 'A grandpa and his teenage grandson talking over a pancake breakfast.',
    width: 2000, height: 1333, focus: '50% 45%',
  },
  abuelaTortillas: {
    src: '/media/stock/photo-abuela-tortillas.jpg',
    alt: 'A grandmother in a green dress pressing tortillas by hand.',
    width: 1333, height: 2000, focus: '45% 35%',
  },
  dadSon: {
    src: '/media/stock/photo-dad-son-cooking.jpg',
    alt: 'A father whisking in the kitchen with his arm around his grown son, both smiling.',
    width: 2000, height: 1335, focus: '45% 25%',
  },
  grandpaChopping: {
    src: '/media/stock/photo-grandpa-chopping.jpg',
    alt: 'A grandfather in a red gingham apron slicing tomatoes in a sunny kitchen.',
    width: 1334, height: 2000, focus: '50% 30%',
  },
  elderHandsDumpling: {
    src: '/media/stock/photo-elder-hands-dumpling.jpg',
    alt: "An elder's floury hands folding a filled piece of dough.",
    width: 2000, height: 1333, focus: '45% 40%',
  },
  familyDinnerTable: {
    src: '/media/stock/photo-family-dinner-table.jpg',
    alt: 'Three generations of a family talking over a table of shared dishes.',
    width: 2000, height: 1333, focus: '50% 45%',
  },
  familyLaughingTable: {
    src: '/media/stock/photo-family-laughing-table.jpg',
    alt: 'A family of three generations laughing and toasting around a dinner table.',
    width: 2000, height: 1335, focus: '55% 45%',
  },
  momDaughter: {
    src: '/media/stock/photo-mom-daughter-cooking.jpg',
    alt: 'A mother and her grown daughter laughing together while they cook.',
    width: 1333, height: 2000, focus: '50% 35%',
  },
  steamingPot: {
    src: '/media/stock/photo-steaming-pot.jpg',
    alt: 'A pot breathing steam on a gas stove in warm light.',
    width: 1329, height: 2000, focus: '50% 55%',
  },
};

/** App cover images (1280×720) copied from data/synthetic/posters by scripts/media.mjs. */
export const COVER_SIZE = { width: 1280, height: 720 } as const;
/** Dish photos are 1000×1000 squares. */
export const DISH_SIZE = { width: 1000, height: 1000 } as const;

/** Intrinsic size of any recipe image path (covers vs square dish photos vs photos). */
export function imageSize(src: string): { width: number; height: number } {
  if (src.includes('/app-covers/')) return COVER_SIZE;
  if (src.includes('/dish-')) return DISH_SIZE;
  const p = Object.values(PHOTOS).find((ph) => ph.src === src);
  return p ? { width: p.width, height: p.height } : DISH_SIZE;
}

/** VERO topographic swirl patterns (scripts/swirls.mjs), in the *-swirl token color on transparent.
 *  Use as `background: var(--sun) url(SWIRLS.sun) center / cover`. Never behind the footer wordmark. */
export const SWIRLS = {
  green: '/patterns/swirl-green.svg',
  forest: '/patterns/swirl-forest.svg',
  sun: '/patterns/swirl-sun.svg',
  chartreuse: '/patterns/swirl-chartreuse.svg',
} as const;

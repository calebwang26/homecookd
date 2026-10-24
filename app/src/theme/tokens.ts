// homecookd "Hearth" design tokens, read 1:1 from the design bible
// (docs/design/hearth-bible/source/*.dc.html, 390x844). Every value here appears in the bible;
// comments name where. Light only: the bible has no dark mode.
import type { TextStyle } from 'react-native';

export const colors = {
  // Surfaces
  page: '#F7F7F2', // every screen background
  card: '#FFFDF7', // cards, round buttons, tab bar, sheets
  well: '#EFEFE6', // segmented track, list dividers, quiet play buttons
  track: '#E3E3D8', // unfilled step progress
  // Text
  ink: '#1E2410', // titles, strong labels, dark pills, active tab
  text: '#2D3222', // body text, inactive tab
  muted: '#5F6352', // secondary lines
  // Greens
  green: '#5B6F00', // primary buttons, progress, unread dot, checks
  greenDeep: '#4C5A10', // green text links ("See all", "Leo asked you")
  olive: '#34430C', // hero card base, "Look for" text on sage
  sageInk: '#3C4A0B', // text on sage / lime-wash (count pill, step numbers, initial tiles)
  sage: '#E6EBCF', // count pill, numbered dots, "Look for" box
  limeWash: '#EDF2BE', // initial avatar tile (Maya)
  // Warm accents
  sun: '#FEBE29', // selected filter chip, "New" badge, waiting ring
  butter: '#FFF1C7', // "Waiting for your answer" pill, give-back card
  butterInk: '#5A3A22', // text on butter
  peach: '#F9E3CF', // quote cards, cook's chat bubbles, "More from Mom", parent wash
  peachInk: '#6E4A33', // text on peach, voice note ink, parent date line
  lavender: '#ECE6F2', // kid wash, learner's chat bubbles, request cards
  lavenderInk: '#3F3558', // text on lavender, step chip on a message
  rose: '#F6D5CC', // spare warm tint (spec)
  danger: '#9A4F47', // saved heart, record dot, recording mic
  // Pot mascot (Main brand mark)
  potBody: '#F6BFA8',
  potLid: '#F2A98F',
  potLine: '#6E5A4C',
  potFace: '#4A3B30',
} as const;

/** Translucent values used on photos and overlays. */
export const alpha = {
  glassChip: 'rgba(255,253,247,0.88)', // "Just in from Mom" chip on the hero
  glassButton: 'rgba(255,253,247,0.92)', // round back / heart / play over photos
  glassPill: 'rgba(255,253,247,0.94)', // "Back" and "Watch yourself" pills over photos
  glassOnDark: 'rgba(255,253,247,0.22)', // "Hear Mom" button inside the dark hero
  glassHeart: 'rgba(255,253,247,0.3)', // unsaved heart on a photo card
  tabBar: 'rgba(255,253,247,0.96)',
  tabBarFrosted: 'rgba(255,253,247,0.88)', // with blur (motion spec 2)
  headerFrosted: 'rgba(247,247,242,0.72)', // sticky header over blur (motion spec 2)
  hairline: 'rgba(30,36,16,0.08)',
  border: 'rgba(30,36,16,0.12)', // 1.5px outline buttons (Watch / Hear, Record row)
  borderStrong: 'rgba(30,36,16,0.14)', // "Send to Maya"
  checkRing: 'rgba(30,36,16,0.2)', // empty ingredient check
  dashed: 'rgba(71,67,42,0.28)', // "Add family" dashed tile
  grabber: 'rgba(30,36,16,0.18)',
  backdrop: 'rgba(30,36,16,0.35)', // sheet backdrop (motion spec 4)
  recordHalo: 'rgba(154,79,71,0.18)',
  photoShadeTop: 'rgba(18,20,16,0)',
  photoShade: 'rgba(18,20,16,0.82)', // hero card bottom
  photoShadeCard: 'rgba(18,20,16,0.75)', // "Picked for you" cards
  photoShadeLeft: 'rgba(18,20,16,0.8)', // "Leo made your ramen" (left to right)
} as const;

/** Top-of-screen washes: [from, to], over `height` px. Kid = lavender, parent = peach. */
export const washes = {
  kid: ['#ECE6F2', '#F7F7F2'],
  parent: ['#F9E3CF', '#F7F7F2'],
} as const;

/** Box shadows exactly as the bible writes them (RN 0.86 renders CSS `boxShadow` strings). */
export const shadows = {
  card: '0 8px 24px rgba(30,36,16,0.06)', // list cards, panels
  cardRaised: '0 10px 30px rgba(30,36,16,0.08)', // "Leo asked you" / "Waiting for your answer"
  hero: '0 16px 40px rgba(30,36,16,0.16)', // Kid-Home hero card
  button: '0 4px 14px rgba(30,36,16,0.08)', // round cream back / close buttons
  field: '0 4px 14px rgba(30,36,16,0.06)', // search field, voice search button
  chip: '0 2px 8px rgba(30,36,16,0.05)', // filter chips, "About ..." pill
  person: '0 2px 8px rgba(30,36,16,0.06)', // "Who is it for?" chips
  segment: '0 2px 8px rgba(30,36,16,0.08)', // selected segment
  composer: '0 6px 20px rgba(30,36,16,0.08)', // chat text field
  cta: '0 10px 24px rgba(52,67,12,0.25)', // big green buttons
  mic: '0 12px 28px rgba(52,67,12,0.3)', // "Tap to talk"
  micRecording: '0 0 0 10px rgba(154,79,71,0.18)',
  tabBar: '0 10px 30px rgba(30,36,16,0.14), 0 0 0 1px rgba(30,36,16,0.04)',
  panelUp: '0 -10px 30px rgba(30,36,16,0.06)', // Parent-Chat answer panel
  ringCard: '0 0 0 3px #FFFDF7', // avatar ring, dot ring
  ringSun: '0 0 0 2px #FEBE29', // waiting question bubble
  ringGreen: '0 0 0 3px #5B6F00', // selected video thumb
} as const;

export const radii = {
  pill: 999,
  sheet: 32, // recipe sheet top corners, bottom sheets, Kid-Home hero
  panel: 28, // list cards, "Waiting" cards, clip box
  card: 24, // profile tiles, picked cards, hello card
  segment: 22, // segmented track, compact clip
  quote: 20, // quote card, closed dropdown, video thumbs
  thumb: 18, // 64px list thumbnails
  tile: 16, // segments, date tile, "Look for" box, give-back thumb
  step: 3, // progress segments
} as const;

export const space = {
  gutter: 24, // page side padding everywhere
  top: 60, // first line under the status bar (56 on detail screens)
  topDetail: 56,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Floating tab bar geometry (bible: left/right 20, bottom 24, height 76, padding 8). */
export const tabBar = {
  side: 20,
  bottom: 24,
  height: 76,
  padding: 8,
  gap: 4,
  /** Bottom padding a scroll view needs so its last row clears the floating bar. */
  clearance: 24 + 76 + 24,
} as const;

/** Loaded font family names (see theme/fonts.ts). */
export const fonts = {
  serif: 'Fraunces_400Regular',
  serifMedium: 'Fraunces_500Medium',
  serifSemi: 'Fraunces_600SemiBold',
  serifItalic: 'Fraunces_400Regular_Italic',
  serifMediumItalic: 'Fraunces_500Medium_Italic',
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemi: 'DMSans_600SemiBold',
  sansBold: 'DMSans_700Bold',
} as const;

export type SansWeight = 400 | 500 | 600 | 700;
export type SerifWeight = 400 | 500 | 600;

const sansFamily: Record<SansWeight, string> = {
  400: fonts.sans,
  500: fonts.sansMedium,
  600: fonts.sansSemi,
  700: fonts.sansBold,
};
const serifFamily: Record<SerifWeight, string> = {
  400: fonts.serif,
  500: fonts.serifMedium,
  600: fonts.serifSemi,
};

const lh = (size: number, ratio?: number) => (ratio ? Math.round(size * ratio * 10) / 10 : undefined);

/**
 * Type roles. Each returns a plain TextStyle you can spread into StyleSheet.create.
 * Line heights are only set where the bible sets them (otherwise the font's natural height,
 * which is what CSS `normal` renders).
 */
export const typography = {
  /** Fraunces 500 titles with -0.02em tracking. Bible: 40 Main, 34 parent, 32 kid, 30 recipe. */
  display: (size = 32, lineHeight = 1.1): TextStyle => ({
    fontFamily: fonts.serifMedium,
    fontSize: size,
    lineHeight: lh(size, lineHeight),
    letterSpacing: -0.02 * size,
    color: colors.ink,
  }),
  /** Fraunces at a weight, no tracking. Section titles (500, 22/20), names (600, 20), brand (600, 22). */
  serif: (size = 22, weight: SerifWeight = 500, lineHeight?: number): TextStyle => ({
    fontFamily: serifFamily[weight],
    fontSize: size,
    lineHeight: lh(size, lineHeight),
    color: colors.ink,
  }),
  /** Fraunces italic: the cook's words. Bible: 17/1.4 quote cards, 19/1.35, 24/1.25 big asks. */
  quote: (size = 17, lineHeight = 1.4): TextStyle => ({
    fontFamily: fonts.serifItalic,
    fontSize: size,
    lineHeight: lh(size, lineHeight),
    color: colors.ink,
  }),
  /** DM Sans UI text. */
  sans: (size = 16, weight: SansWeight = 400, color: string = colors.text, lineHeight?: number): TextStyle => ({
    fontFamily: sansFamily[weight],
    fontSize: size,
    lineHeight: lh(size, lineHeight),
    color,
  }),
  /** Small caps label ("IN THIS STEP"): 13/700, +0.04em, uppercase, muted. */
  eyebrow: (size = 13): TextStyle => ({
    fontFamily: fonts.sansBold,
    fontSize: size,
    letterSpacing: 0.04 * size,
    textTransform: 'uppercase',
    color: colors.muted,
  }),
} as const;

/** Alias of `typography` (the spec calls it `type.display(size)`). */
export const type = typography;

export function sansFont(weight: SansWeight) {
  return sansFamily[weight];
}
export function serifFont(weight: SerifWeight) {
  return serifFamily[weight];
}

/**
 * Motion constants (docs/design/ANIMATIONS.md). Springs give `mass: 1` explicitly: Reanimated 4
 * defaults mass to 4, which makes the spec's springs wobble for seconds (and leaves glyphs at a
 * fuzzy 0.99x-1.01x scale meanwhile).
 */
export const motion = {
  press: { damping: 15, stiffness: 300, mass: 1 }, // press-in scale 0.96 + opacity 0.9
  pressScale: 0.96,
  pressScaleCard: 0.97,
  pressOpacity: 0.9,
  sheet: { damping: 20, stiffness: 220, mass: 0.9 },
  sheetCloseMs: 240,
  backdropMs: 220,
  hero: { damping: 18, stiffness: 180, mass: 1 },
  settle: { damping: 14, stiffness: 160, mass: 1 },
  tab: { damping: 20, stiffness: 220, mass: 0.9 },
  reducedFadeMs: 150,
  loadingMinMs: 450,
  crossfadeMs: 180,
  successHoldMs: 1400,
  stickyFadeDistance: 48,
  listEnterMs: 380,
  listStaggerMs: 40,
} as const;

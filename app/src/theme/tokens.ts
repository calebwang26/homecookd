// homecookd design tokens. Layout, radii, type roles and motion come from the "Hearth" design bible
// (docs/design/hearth-bible/source/*.dc.html, 390x844). The COLORS are the egg brand kit's
// (docs/brand/tokens/tokens.json, "Kitchen tile", Oct 30), which wins over the bible: a pale sage page, ink, yolk (the main color)
// and bottle green (the second). No peach, lavender or butter. Light only: the app has no dark mode yet
// (the kit's dark values are in `darkColors`, unused until it does).
import type { TextStyle } from 'react-native';

export const colors = {
  // Surfaces
  page: '#EEF3F0', // pale sage ("Kitchen tile"): every screen background
  card: '#FFFFFF', // white: cards, round buttons, tab bar, sheets
  well: '#E3EBE6', // sunken sage (the web's --sunken): segmented track, quiet buttons
  line: '#D6E0DA', // hairlines and card borders
  track: '#D6E0DA', // unfilled step progress (the line color)
  // Text
  ink: '#18221D', // titles, body text, ink on yolk, dark pills, active tab
  text: '#18221D', // body text (ink: the kit has one text color)
  muted: '#4F5D55', // secondary lines (6.2:1 on the page)
  // Yolk, the main color
  yolk: '#F2A23A', // FILLS only: primary buttons (ink label, never white), selected chips, badges, progress
  yolkDeep: '#A3580C', // links and accent text on the page, white or yolkTint (never yolk text on light)
  yolkTint: '#FCEBD0', // guesses and asks: the kid's asks, waiting pills, request cards, the top wash
  // Bottle green, the second color
  green: '#244A39', // secondary and success: checks, "Sent", secondary fills (white label), text on greenTint
  greenTint: '#DCEBE2', // the cook's answers: her bubbles, her quote cards, "Look for"
  danger: '#9A4F47', // the kit's "record": record dot, recording mic, saved heart, errors
} as const;

/** The kit's dark palette (docs/brand/tokens/tokens.json "semantic.dark"), for when the app gets a dark mode. */
export const darkColors = {
  page: '#111915',
  card: '#18221D',
  ink: '#EEF3F0',
  muted: '#C9C1B4',
  line: '#343A48',
  yolk: '#F2A23A',
  yolkDeep: '#F2A23A',
  yolkTint: '#3A2E1A',
  green: '#B7C48A',
  greenTint: '#27301C',
  danger: '#E07A6F',
} as const;

/** Translucent values used on photos and overlays. */
export const alpha = {
  glassChip: 'rgba(255,255,255,0.88)', // "Just in from Mom" chip on the hero
  glassButton: 'rgba(255,255,255,0.92)', // round back / heart / play over photos
  glassPill: 'rgba(255,255,255,0.94)', // "Back" and "Watch yourself" pills over photos
  glassOnDark: 'rgba(255,255,255,0.22)', // "Hear Mom" button inside the dark hero
  glassHeart: 'rgba(255,255,255,0.3)', // unsaved heart on a photo card
  tabBar: 'rgba(255,255,255,0.96)',
  tabBarFrosted: 'rgba(255,255,255,0.88)', // with blur (motion spec 2)
  headerFrosted: 'rgba(238,243,240,0.72)', // sticky header over blur (motion spec 2)
  pageClear: 'rgba(238,243,240,0)', // the page color, see-through (top and bottom fades)
  hairline: 'rgba(24,34,29,0.08)',
  border: 'rgba(24,34,29,0.12)', // 1.5px outline buttons (Watch / Hear, Record row)
  borderStrong: 'rgba(24,34,29,0.14)', // "Send to Maya"
  checkRing: 'rgba(24,34,29,0.2)', // empty ingredient check
  dashed: 'rgba(24,34,29,0.28)', // "Add family" dashed tile
  grabber: 'rgba(24,34,29,0.18)',
  backdrop: 'rgba(24,34,29,0.35)', // sheet backdrop (motion spec 4)
  glass: 'rgba(24,34,29,0.08)', // over the light blur behind a centred popup: frosted glass, not a grey-out
  recordHalo: 'rgba(154,79,71,0.18)',
  yolkGlow: 'rgba(242,162,58,0.28)', // a soft yolk ring or halo (homie lit, the "you" dot)
  photoShadeTop: 'rgba(17,25,21,0)',
  photoShade: 'rgba(17,25,21,0.82)', // hero card bottom
  photoShadeCard: 'rgba(17,25,21,0.75)', // "Picked for you" cards
  photoShadeLeft: 'rgba(17,25,21,0.8)', // "Leo made your ramen" (left to right)
} as const;

/** Top-of-screen washes: [from, to], over `height` px. Both are the yolk tint into the page (no lavender or peach). */
export const washes = {
  kid: ['#FCEBD0', '#EEF3F0'],
  parent: ['#FCEBD0', '#EEF3F0'],
} as const;

/** Box shadows (RN 0.86 renders CSS `boxShadow` strings): the bible's, in the kit's ink. */
export const shadows = {
  card: '0 8px 24px rgba(24,34,29,0.06)', // list cards, panels
  cardRaised: '0 10px 30px rgba(24,34,29,0.08)', // "Leo asked you" / "Waiting for your answer"
  hero: '0 16px 40px rgba(24,34,29,0.16)', // Kid-Home hero card
  popup: '0 20px 50px rgba(24,34,29,0.22)', // a centred popup over blurred glass ("Update homecookd")
  button: '0 4px 14px rgba(24,34,29,0.08)', // round white back / close buttons
  field: '0 4px 14px rgba(24,34,29,0.06)', // search field, voice search button
  chip: '0 2px 8px rgba(24,34,29,0.05)', // filter chips, "About ..." pill
  person: '0 2px 8px rgba(24,34,29,0.06)', // "Who is it for?" chips
  segment: '0 2px 8px rgba(24,34,29,0.08)', // selected segment
  composer: '0 6px 20px rgba(24,34,29,0.08)', // chat text field
  cta: '0 10px 24px rgba(163,88,12,0.22)', // big yolk buttons (a warm yolk-deep shadow)
  mic: '0 12px 28px rgba(163,88,12,0.28)', // "Tap to talk"
  micRecording: '0 0 0 10px rgba(154,79,71,0.18)',
  tabBar: '0 10px 30px rgba(24,34,29,0.14), 0 0 0 1px rgba(24,34,29,0.04)',
  panelUp: '0 -10px 30px rgba(24,34,29,0.06)', // Parent-Chat answer panel
  ringCard: '0 0 0 3px #FFFFFF', // avatar ring, dot ring
  ringYolk: '0 0 0 2px #F2A23A', // the question waiting for an answer
  ringSelected: '0 0 0 3px #F2A23A', // selected video thumb
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
  /** Caveat: only for what the cook "wrote" (the kit's handwriting face), never for UI. */
  hand: 'Caveat_500Medium',
  handBold: 'Caveat_700Bold',
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
  /** Fraunces 600 titles (the kit's headings: 600-650) with -0.02em tracking. Bible: 40 Main, 34 parent, 32 kid, 30 recipe. */
  display: (size = 32, lineHeight = 1.1): TextStyle => ({
    fontFamily: fonts.serifSemi,
    fontSize: size,
    lineHeight: lh(size, lineHeight),
    letterSpacing: -0.02 * size,
    color: colors.ink,
  }),
  /** Fraunces at a weight, no tracking. Headings are 600 (the kit): section titles 22/20, names 20. */
  serif: (size = 22, weight: SerifWeight = 600, lineHeight?: number): TextStyle => ({
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
  /** Caveat: words the cook "wrote" by hand (the kit). Never UI. Caveat runs small, so give it ~1.3x the size. */
  hand: (size = 22, lineHeight = 1.2): TextStyle => ({
    fontFamily: fonts.hand,
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

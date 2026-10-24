// The big card at the top of the share sheet (Spotify's story card, in Hearth clothes):
//   a swatch-coloured stage (radius 28) holding a cream card: the dish photo (square, radius 20),
//   the dish name (Fraunces 500, -0.02em), "by Dad · ~50 min" with the cook's 20 px avatar, and the
//   homecookd pot + wordmark. The stage colour crossfades when a swatch is picked.
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Avatar, Brand, PotMark, Skeleton, Txt } from '@/components/ui';
import { colors, radii } from '@/theme/tokens';

import { SWATCHES, type SwatchId } from './swatches';
import { trail } from './trail';

export type ShareCardData = {
  title: string;
  cook: string | null;
  /** "~50 min" or null. */
  time: string | null;
  poster: string | null;
  /**
   * In place of "by Dad" ("Hosted by Mama Ngozi" on a dinner invite); the cook's avatar still leads it.
   * It may take two lines (BYLINE_EXTRA more), so a long name is never cut.
   */
  byline?: string;
};

export type ShareCardProps = {
  data: ShareCardData | null;
  swatch: SwatchId;
  /** Photo height (and width, from 150 up); the card grows around it. 0: no photo (the shortest
   *  phones); the stage keeps the photo's 12 px gap as padding. */
  photo: number;
  /** Fixed stage height, so the sheet keeps one shape whatever the dish is called. */
  stageHeight: number;
  /** Short phones: tighter stage padding (14 instead of 22). */
  compact?: boolean;
};

// Card height without the photo, with a full two-line title at 24 (12 top + 12 gap + 2 x 26.9
// title + 6 + 20 meta + 12 gap + 23 brand + 14 bottom). The sheet plans the stage with this.
const CARD_CHROME = 153;
/** A byline's second line (14 pt meta). */
export const BYLINE_EXTRA = 20;
export const STAGE_PAD = { regular: 22, compact: 14 } as const;
/** Stage height for a photo edge: card chrome plus the stage's top and bottom padding. */
export function stageFor(photo: number, compact: boolean) {
  return photo + CARD_CHROME + 2 * (compact ? STAGE_PAD.compact : STAGE_PAD.regular);
}

const TITLE_LINES = 2;
const MIN_INNER = 150;
const MIN_TITLE = 14;
const TITLE_LEADING = 1.12;

// Rough Fraunces 500 advance widths in em (measured in the browser), minus the -0.02em tracking.
function emWidth(text: string) {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 0.25;
    else if ("'’-.,".includes(ch)) w += 0.3;
    else if (ch >= 'A' && ch <= 'Z') w += 0.71;
    else w += 0.55;
    w -= 0.02;
  }
  return w;
}

/** How many lines `title` wraps to at `size` in `width` px (greedy, by words). */
function linesAt(title: string, size: number, width: number) {
  let lines = 1;
  let line = 0;
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const ww = emWidth(word) * size;
    const next = line ? line + 0.25 * size + ww : ww;
    if (next <= width || !line) line = next;
    else {
      lines += 1;
      line = ww;
    }
  }
  return lines;
}

/**
 * Fraunces 24 for short names, stepping 22 / 20 / 18 as names get longer, then further (down to
 * 14) while the estimate says the name would still need a third line in this card. The estimate
 * keeps a 4% margin; past 14 the second line ends in an ellipsis.
 *
 * We size the title ourselves instead of native `adjustsFontSizeToFit` (iOS NSTextStorage+
 * FontScaling), which the estimate makes unnecessary. Dropping it was a precaution: the Expo Go
 * crash on opening this sheet (FEEDBACK-OCT16b 2) is not tied to a native frame yet (no device
 * crash log so far), and Profiles still uses that routine on every open without crashing.
 */
export function titleSizeFor(title: string, width: number) {
  const n = title.length;
  const cap = n <= 14 ? 24 : n <= 24 ? 22 : n <= 34 ? 20 : 18;
  const w = Math.max(1, width * 0.96);
  for (let size = cap; size > MIN_TITLE; size -= 2) if (linesAt(title, size, w) <= TITLE_LINES) return size;
  return MIN_TITLE;
}

const ORDER = SWATCHES.map((s) => s.id);
const STOPS = ORDER.map((_, i) => i);
const STAGE_COLORS = SWATCHES.map((s) => s.stage);
const indexOf = (id: SwatchId) => Math.max(0, ORDER.indexOf(id));

export function ShareCard({ data, swatch, photo, stageHeight, compact = false }: ShareCardProps) {
  const reduce = useReducedMotion();
  const idx = useSharedValue(indexOf(swatch));
  useEffect(() => {
    idx.set(withTiming(indexOf(swatch), { duration: reduce ? 1 : 260 }));
  }, [swatch, reduce, idx]);

  // Plain arrays of numbers and hex strings, built once (not inside the worklet).
  const stageStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(idx.value, STOPS, STAGE_COLORS),
  }));
  // A photo that fails to load falls back to the pot, like a dish with no photo.
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const poster = data?.poster && data.poster !== failedPoster ? data.poster : null;
  const dark = SWATCHES.find((s) => s.id === swatch)?.dark ?? false;

  // Square photo; on short phones (photo under 150) it goes landscape so the name keeps room.
  const inner = Math.max(photo, MIN_INNER);
  const cardW = inner + 24;
  const title = data?.title ?? '';
  // Text column = card minus its 12 px padding and the words' 2 px inset, each side.
  const titleSize = titleSizeFor(title, cardW - 28);
  // "by Dad · ~50 min" when it fits on one line beside the avatar, else just "by Grandma".
  // Room: the text column (inner - 4) minus the 20 px avatar and its 6 px gap; DM Sans 14 runs
  // about 7.4 px a character.
  const by = data?.byline ?? (data?.cook ? `by ${data.cook}` : '');
  const full = [by || null, data?.time ?? null].filter(Boolean).join(' · ');
  const meta = full.length <= Math.floor((inner - 30) / 7.4) ? full : by || full;

  return (
    <Animated.View
      style={[styles.stage, { width: cardW + 44, height: stageHeight, paddingVertical: compact ? STAGE_PAD.compact : STAGE_PAD.regular }, stageStyle]}
      accessibilityRole="image"
      accessibilityLabel={data ? `${title}${data.byline ? `, ${data.byline}` : data.cook ? `, from ${data.cook}` : ''}, on homecookd` : 'Recipe card'}>
      <View style={[styles.card, { width: cardW, boxShadow: dark ? '0 16px 40px rgba(0,0,0,0.32)' : '0 10px 30px rgba(30,36,16,0.10)' }]}>
        {photo > 0 ? (
          <View style={[styles.photo, { width: inner, height: photo }]}>
            {poster ? (
              <Image
                source={poster}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                onError={() => {
                  trail('card photo failed, showing the pot');
                  setFailedPoster(poster);
                }}
              />
            ) : data ? (
              <View style={styles.noPhoto}>
                <PotMark size={Math.round(photo * 0.36)} />
              </View>
            ) : (
              <Skeleton width={inner} height={photo} radius={radii.quote} />
            )}
          </View>
        ) : null}

        <View style={styles.words}>
          {data ? (
            <Txt
              variant="display"
              size={titleSize}
              leading={TITLE_LEADING}
              numberOfLines={TITLE_LINES}>
              {title}
            </Txt>
          ) : (
            <Skeleton width="85%" height={24} />
          )}
          {meta ? (
            <View style={styles.meta}>
              {data?.cook ? <Avatar name={data.cook} size={20} /> : null}
              <Txt variant="meta" size={14} numberOfLines={data?.byline ? 2 : 1} style={styles.metaText}>
                {meta}
              </Txt>
            </View>
          ) : null}
        </View>

        <Brand size={15} style={styles.brand} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignSelf: 'center',
    borderRadius: radii.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.card,
    padding: 12,
    paddingBottom: 14,
    gap: 12,
  },
  photo: { borderRadius: radii.quote, overflow: 'hidden', backgroundColor: colors.well },
  noPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.peach },
  words: { gap: 6, paddingHorizontal: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flexShrink: 1 },
  brand: { paddingHorizontal: 2 },
});

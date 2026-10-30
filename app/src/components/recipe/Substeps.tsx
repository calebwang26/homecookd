// A cook-mode step's short lines (kid QA round 2, notes 4 and 8): a green StepNumber and the line,
// two lines at most. A line with more to it ends in "…" (note 4): a tap swaps in its fuller wording,
// in the line's place (never the same words twice), and a second tap swaps it back. A line cut at two
// lines opens to the whole line the same way. Amounts, heat and times in **bold**. The recipe's own
// substeps (pipeline/shorten.py), else the instruction split into lines (steps.ts).
// Following along: while the step's video plays, the line being said (its `start_s`, steps.ts
// activeLine) sits on a soft green-tint wash in ink; the others stay as they are. Nothing lit otherwise.
// A line with a `start_s` and `onSeek` is a tap target too: the tap plays the video from that line
// (and, on a line with more to it, opens it at the same time).
import { useState, type ReactNode } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { PressableScale, Txt } from '@/components/ui';
import { playheadAt, usePlayhead } from '@/lib/media';
import type { Step } from '@/lib/types';
import { colors, radii } from '@/theme/tokens';

import { StepNumber } from './StepNumber';
import { activeLine, parseBold, plainText, stepSubsteps, type SubstepLine } from './steps';

const SIZE = 17;
const LEADING = 1.5;
/** Taller than two lines (with a pixel of rounding, at the phone's text size) = cut. */
const twoLines = () => Math.round(SIZE * LEADING * 2 * PixelRatio.getFontScale()) + 2;

export function Substeps({
  step,
  video,
  onSeek,
}: {
  step: Pick<Step, 'substeps' | 'instruction' | 'sensory_cue' | 'start_s' | 'end_s'>;
  /** The step video's URL: light up the line being said while it plays. */
  video?: string | null;
  /** Play the step video from here (seconds in the file). */
  onSeek?: (at: number) => void;
}) {
  const lines = stepSubsteps(step);
  // Re-renders only when the lit line changes (the playhead moves 4 times a second).
  const lit = usePlayhead(() => (video ? activeLine(lines, playheadAt(video), step) : -1));
  if (!lines.length) return null;
  return (
    <View style={styles.list}>
      {lines.map((line, i) => (
        <Row key={`${i}:${line.text}`} n={i + 1} line={line} lit={i === lit} onSeek={onSeek} />
      ))}
    </View>
  );
}

/** "Mix the glaze." -> "Mix the glaze…": there is more to it. */
const withMore = (text: string) => `${text.trim().replace(/[.!?]+$/, '')}…`;

function Row({ n, line, lit, onSeek }: { n: number; line: SubstepLine; lit: boolean; onSeek?: (at: number) => void }) {
  const [open, setOpen] = useState(false);
  // The whole line's height, measured unseen, to tell whether two lines cut it.
  const [fullH, setFullH] = useState(0);
  const canOpen = !!line.detail || fullH > twoLines();
  const at = onSeek ? line.start_s : null;
  const shown = open ? line.detail ?? line.text : line.detail ? withMore(line.text) : line.text;
  const said = plainText(open ? shown : line.text);

  const content = (
    <>
      <StepNumber n={n} size={28} style={styles.num} />
      <View style={styles.words}>
        <Animated.View key={open ? 'open' : 'closed'} entering={open ? FadeIn.duration(180) : undefined}>
          <Txt variant="bodyInk" size={SIZE} leading={LEADING} color={lit ? colors.ink : colors.text} numberOfLines={open ? undefined : 2}>
            <Bold text={shown} />
          </Txt>
        </Animated.View>
        <Txt
          variant="bodyInk"
          size={SIZE}
          leading={LEADING}
          style={styles.ghost}
          onLayout={(e) => setFullH(Math.round(e.nativeEvent.layout.height))}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden>
          <Bold text={line.text} />
        </Txt>
      </View>
    </>
  );

  if (!canOpen && at == null) {
    return (
      <View style={[styles.row, lit ? styles.lit : null]} accessible accessibilityLabel={`${n}. ${said}`} accessibilityState={{ selected: lit }}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      scaleTo={0.99}
      onPress={() => {
        if (canOpen) setOpen((o) => !o);
        if (at != null) onSeek?.(at);
      }}
      accessibilityRole="button"
      accessibilityState={canOpen ? { expanded: open, selected: lit } : { selected: lit }}
      aria-expanded={canOpen ? open : undefined}
      accessibilityLabel={`${n}. ${said}`}
      accessibilityHint={at == null ? (open ? 'Shows less' : 'Shows more') : canOpen ? `${open ? 'Shows less' : 'Shows more'} and plays the video from here` : 'Plays the video from here'}
      style={[styles.row, lit ? styles.lit : null]}>
      {content}
    </PressableScale>
  );
}

/** The line with its **bold** spans in ink 700. */
function Bold({ text }: { text: string }): ReactNode {
  return parseBold(text).map((p, i) =>
    p.bold ? (
      <Txt key={i} variant="bodyInk" size={SIZE} leading={LEADING} weight={700} color={colors.ink}>
        {p.text}
      </Txt>
    ) : (
      p.text
    ),
  );
}

// Each row is padded inside the same outline it had (negative margin), so lighting one moves nothing.
const PAD_V = 6;
const PAD_H = 10;

const styles = StyleSheet.create({
  list: { gap: 14 - PAD_V * 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: PAD_V,
    paddingHorizontal: PAD_H,
    marginHorizontal: -PAD_H,
    borderRadius: radii.tile,
  },
  lit: { backgroundColor: colors.greenTint },
  // Centred on the first line (25.5 tall).
  num: { marginTop: -1 },
  // overflow hidden: the unseen copy is measured, never drawn past the row.
  words: { flex: 1, overflow: 'hidden' },
  ghost: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});

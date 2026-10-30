// "0:12 ━━●━── 0:48": elapsed, a 4 px track, total. Times are relative to the clip.
// With `onSeek` it is a control: a 48 pt bar to tap or drag, and round 48 pt "back 10" / "forward
// 10" buttons at its ends, the easy way to go back and forward (a tap can't be lost to a scroll).
// Only a sideways drag seeks: once the finger has gone sideways it holds a scrolling page still
// (ui/ScrollHold) and keeps the touch until it lifts. A drag that starts up or down is the page
// scrolling: it is let go and seeks nothing. A tap seeks to where it lands.
// `disabled` keeps the buttons in place while the clip loads, so the row doesn't jump.
// `skips={false}` leaves the 10 s buttons out (full screen has them beside its play button: SkipGlyph).
// `marks` (0..1, lib/media chapterMarks) split the track with small gaps where each substep starts,
// like YouTube's chapters.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Platform, StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { IconButton, Txt, useHoldPage } from '@/components/ui';
import { mmss } from '@/lib/format';
import { colors } from '@/theme/tokens';

const SKIP_S = 10;
// How far a finger moves before it is a drag (sideways: seek) or a scroll (up or down: not ours).
const SLOP = 6;
// The gap between two chapters of the track.
const GAP = 3;

export function ProgressRow({ elapsed, duration, progress, tone = 'page', onSeek, disabled, skips = true, marks, style }: {
  elapsed: number;
  duration: number;
  progress: number;
  /** 'tint' on the Hear card (the green tint), 'video' over a clip, 'page' on cream. */
  tone?: 'page' | 'tint' | 'video';
  onSeek?: (elapsed: number) => void;
  disabled?: boolean;
  /** Back / forward 10 s buttons at the ends (default true when seekable). */
  skips?: boolean;
  /** Where each later chapter (substep) starts, 0..1: a gap in the track. */
  marks?: readonly number[];
  style?: StyleProp<ViewStyle>;
}) {
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const holdPage = useHoldPage();
  const held = useRef(false);
  // Where the finger came down, and what it turned out to be.
  const touch = useRef<{ x: number; y: number; kind: 'tap' | 'drag' | 'scroll' } | null>(null);
  const p = Math.max(0, Math.min(1, preview ?? (progress || 0)));
  const ink = tone === 'video' ? colors.card : tone === 'tint' ? colors.ink : colors.muted;
  const seekable = !!onSeek;
  const enabled = seekable && !disabled && duration > 0;
  const fraction = (x: number) => Math.max(0, Math.min(1, width > 0 ? x / width : 0));
  const adjust = (seconds: number) => onSeek?.(Math.max(0, Math.min(duration, seconds)));
  const hold = (on: boolean) => {
    if (held.current === on) return;
    held.current = on;
    holdPage(on);
  };
  // Gone mid-drag: let the page scroll again.
  useEffect(
    () => () => {
      if (held.current) holdPage(false);
    },
    [holdPage],
  );
  const keyboard = Platform.OS === 'web' && enabled ? {
    onKeyDown: (event: KeyboardEvent) => {
      const target = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? elapsed + SKIP_S
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? elapsed - SKIP_S
        : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null;
      if (target == null) return;
      event.preventDefault();
      adjust(target);
    },
  } : {};
  const fill = tone === 'page' ? colors.yolk : ink;
  /** Tells a tap, a sideways drag and an up-or-down scroll apart; holds the page once it is a drag. */
  const follow = (event: GestureResponderEvent) => {
    const t = touch.current;
    if (!t || t.kind !== 'tap') return t?.kind;
    const dx = Math.abs(event.nativeEvent.pageX - t.x);
    const dy = Math.abs(event.nativeEvent.pageY - t.y);
    if (dx > SLOP && dx > dy) {
      t.kind = 'drag';
      hold(true);
    } else if (dy > SLOP && dy >= dx) {
      t.kind = 'scroll';
    }
    return t.kind;
  };
  const letGo = () => {
    touch.current = null;
    hold(false);
    setPreview(null);
  };
  const skip = (back: boolean) => (
    <IconButton
      tone="clear"
      disabled={!enabled}
      accessibilityLabel={back ? 'Back 10 seconds' : 'Forward 10 seconds'}
      onPress={() => adjust(elapsed + (back ? -SKIP_S : SKIP_S))}
      icon={<SkipGlyph back={back} color={tone === 'page' ? colors.ink : ink} />}
      style={enabled ? null : styles.off}
    />
  );
  return (
    // box-none: a tap between the controls falls through (over a clip: to its play / pause).
    <View pointerEvents="box-none" style={[styles.row, seekable ? styles.rowSeek : null, style]}>
      {seekable && skips ? skip(true) : null}
      <Txt variant="caption" color={ink} style={styles.time}>{mmss(preview == null ? Math.min(elapsed, duration) : p * duration)}</Txt>
      <View
        {...keyboard}
        style={seekable ? styles.hitArea : styles.bare}
        accessible
        focusable={enabled}
        accessibilityRole={enabled ? 'adjustable' : 'progressbar'}
        accessibilityLabel={enabled ? 'Playback position' : 'Playback progress'}
        accessibilityHint={enabled ? 'Swipe up or down to skip ten seconds, or drag to seek.' : undefined}
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(p * duration), text: `${mmss(p * duration)} of ${mmss(duration)}` }}
        accessibilityActions={enabled ? [{ name: 'increment', label: 'Forward 10 seconds' }, { name: 'decrement', label: 'Back 10 seconds' }] : undefined}
        onAccessibilityAction={(event) => adjust(elapsed + (event.nativeEvent.actionName === 'increment' ? SKIP_S : -SKIP_S))}
        // VoiceOver's double-tap would otherwise land as a touch in the middle: a jump to halfway.
        onAccessibilityTap={enabled ? () => {} : undefined}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        // Taken at once so a tap works; the page can still take it back until it is a sideways drag.
        onStartShouldSetResponder={() => enabled}
        onResponderGrant={(event) => {
          touch.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, kind: 'tap' };
        }}
        onResponderMove={(event) => {
          if (follow(event) === 'drag') setPreview(fraction(event.nativeEvent.locationX));
        }}
        // A finger drifting up or down while it drags is still dragging, not scrolling.
        onResponderTerminationRequest={() => touch.current?.kind !== 'drag'}
        onResponderRelease={(event) => {
          const kind = follow(event);
          if (kind === 'tap' || kind === 'drag') adjust(fraction(event.nativeEvent.locationX) * duration);
          letGo();
        }}
        onResponderTerminate={letGo}>
        <View pointerEvents="none" style={styles.chapters}>
          {chapters(marks).map(([a, b]) => (
            <View key={a} style={[styles.track, { flex: b - a, backgroundColor: tone === 'tint' ? 'rgba(52,67,12,0.18)' : tone === 'video' ? 'rgba(255,255,255,0.35)' : colors.track }]}>
              <View style={[styles.fill, { width: `${Math.max(0, Math.min(1, (p - a) / (b - a))) * 100}%`, backgroundColor: fill }]} />
            </View>
          ))}
        </View>
        {enabled ? <View pointerEvents="none" style={[styles.thumb, { left: `${p * 100}%`, backgroundColor: fill }]} /> : null}
      </View>
      <Txt variant="caption" color={ink} style={styles.time}>{mmss(duration)}</Txt>
      {seekable && skips ? skip(false) : null}
    </View>
  );
}

/** The track's pieces as [from, to] (0..1): one without marks, else split at each. */
function chapters(marks: readonly number[] | undefined): [number, number][] {
  const edges = [...new Set([0, ...(marks ?? []).filter((m) => m > 0 && m < 1).sort((a, b) => a - b), 1])];
  return edges.slice(0, -1).map((a, i) => [a, edges[i + 1]]);
}

/** A round arrow with "10" in it: back (anticlockwise) or forward. 26 px, 2 px round strokes. */
export function SkipGlyph({ back, color }: { back: boolean; color: string }) {
  return (
    <View style={styles.glyph}>
      <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={StyleSheet.absoluteFill}>
        <Path d={back ? 'M12 5a8 8 0 1 1-5.66 2.34M14.5 2.5 12 5l2.5 2.5' : 'M12 5a8 8 0 1 0 5.66 2.34M9.5 2.5 12 5 9.5 7.5'} />
      </Svg>
      <Txt variant="label" size={9} weight={700} color={color} leading={1} style={styles.ten}>
        10
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowSeek: { gap: 6 },
  time: { fontVariant: ['tabular-nums'], minWidth: 34 },
  hitArea: { flex: 1, height: 48, justifyContent: 'center' },
  bare: { flex: 1, justifyContent: 'center' },
  chapters: { flexDirection: 'row', gap: GAP },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2 },
  thumb: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6 },
  off: { opacity: 0.4 },
  glyph: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  ten: { marginTop: 2, fontVariant: ['tabular-nums'] },
});

// A ticked ingredient's hand-drawn strike-through (retention PR 7, RETENTION-HANDOFF 4): one wobbly
// pen stroke per line of the cook's words (lib/touches strikeStrokes), drawn on left to right in
// 260 ms when it's ticked and faded out when it's unticked. Rows that were already ticked when the
// screen opened show it drawn. Reduce Motion: it fades in and out instead of drawing. The words stay
// readable under it (a light green stroke); screen readers hear "checked" from the row.
//
//   <StruckText done={done} settled={checklist.loaded} seed={i} lineHeight={21}>{words as a Txt}</StruckText>
// `settled` false while the saved ticks are still loading: the ticks that arrive with them show drawn.
// The child is the Txt; StruckText sizes itself to it (alignSelf flex-start) and reads its lines from
// onTextLayout on iOS and Android, from the browser's line boxes on web, and failing both, from its
// own box (one full-width line per `lineHeight`).
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type NativeSyntheticEvent, type TextLayoutEventData } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { blockLines, mergeLineRects, strikeStrokes, type Stroke, type TextLine } from '@/lib/touches';
import { colors, motion } from '@/theme/tokens';

const AnimatedPath = Animated.createAnimatedComponent(Path);
/** Room around the text for the stroke's overshoot. */
const PAD = 6;

type TextProps = { onTextLayout?: (e: NativeSyntheticEvent<TextLayoutEventData>) => void };

export function StruckText({
  done,
  settled = true,
  seed = 0,
  lineHeight,
  children,
}: {
  done: boolean;
  settled?: boolean;
  seed?: number;
  lineHeight: number;
  children: ReactElement<TextProps>;
}) {
  const reduce = useReducedMotion();
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [lines, setLines] = useState<TextLine[] | null>(null);
  // Already ticked when the screen opened: drawn, not drawing.
  const draw = useSharedValue(done ? 1 : 0);
  const shown = useSharedValue(done ? 1 : 0);
  // Only a change animates (not the first run, nor a repeated effect run for the same state).
  const was = useRef(done);
  const wasSettled = useRef(settled);
  useEffect(() => {
    const loading = !wasSettled.current;
    wasSettled.current = settled;
    if (was.current === done) return;
    was.current = done;
    if (loading) {
      // Saved ticks just arrived: already done before the screen opened.
      draw.value = done ? 1 : 0;
      shown.value = done ? 1 : 0;
      return;
    }
    if (done) {
      shown.value = withTiming(1, { duration: reduce ? motion.reducedFadeMs : 80 });
      draw.value = reduce ? 1 : 0;
      if (!reduce) draw.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
    } else {
      shown.value = withTiming(0, { duration: reduce ? motion.reducedFadeMs : 140 });
    }
  }, [done, settled, reduce, draw, shown]);

  const wrap = useRef<View>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: Math.round(width), h: Math.round(height) });
    if (Platform.OS === 'web') setLines(webLines(wrap.current));
  };
  const onTextLayout = (e: NativeSyntheticEvent<TextLayoutEventData>) => {
    setLines(e.nativeEvent.lines.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height })));
    children.props.onTextLayout?.(e);
  };
  const strokes: Stroke[] = box ? strikeStrokes(lines?.length ? lines : blockLines(box.w, box.h, lineHeight), seed, PAD) : [];
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  return (
    <View ref={wrap} style={styles.wrap} onLayout={onLayout}>
      {isValidElement(children) ? cloneElement(children, { onTextLayout }) : children}
      {box && strokes.length ? (
        <Animated.View pointerEvents="none" style={[styles.over, fade]}>
          <Svg width={box.w + 2 * PAD} height={box.h + 2 * PAD}>
            {strokes.map((s, i) => (
              <StrikePath key={i} stroke={s} draw={draw} />
            ))}
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Web: the text's line boxes from a Range over its first child (the Txt), relative to the wrapper. */
function webLines(node: unknown): TextLine[] | null {
  const el = node as { firstElementChild?: Element | null; getBoundingClientRect?: () => DOMRect } | null;
  const text = el?.firstElementChild;
  if (!text || !el?.getBoundingClientRect || typeof document === 'undefined') return null;
  try {
    const range = document.createRange();
    range.selectNodeContents(text);
    const base = el.getBoundingClientRect();
    const lines = mergeLineRects([...range.getClientRects()].map((r) => ({ x: r.left - base.left, y: r.top - base.top, width: r.width, height: r.height })));
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

function StrikePath({ stroke, draw }: { stroke: Stroke; draw: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: stroke.length * (1 - draw.value) }));
  return (
    <AnimatedPath
      d={stroke.d}
      stroke={colors.green}
      strokeOpacity={0.62}
      strokeWidth={1.9}
      strokeLinecap="round"
      fill="none"
      strokeDasharray={`${stroke.length} ${stroke.length}`}
      animatedProps={props}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', maxWidth: '100%' },
  over: { position: 'absolute', left: -PAD, top: -PAD },
});

// Cook mode's "All steps" sheet (mockup A-AllSteps): every step as a circle + its title (2 lines max).
// Steps done (before the furthest reached) are a dark green circle with a light green check; steps not
// done yet a light green circle with a dark green number. The one on screen sits on a sage row marked
// "You're here", its number on solid dark green so it stands out on that row (one place label only:
// the checks and "Continue at step N" already show the furthest).
// Tap a step to jump there. Long lists scroll, starting near the current step.
import { useRef } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { BottomSheet, CheckIcon, PressableScale, Txt } from '@/components/ui';
import type { Step } from '@/lib/types';
import { colors } from '@/theme/tokens';

import { StepNumber } from './StepNumber';

export function StepsSheet({
  visible,
  onClose,
  steps,
  current,
  furthest = current,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  steps: Step[];
  /** 1-based step on screen. */
  current: number;
  /** 1-based furthest step reached (defaults to `current`). */
  furthest?: number;
  /** 1-based step tapped. */
  onPick: (n: number) => void;
}) {
  const { height } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="All steps">
      <ScrollView
        ref={scroll}
        style={{ maxHeight: Math.min(560, height * 0.62) }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}>
        {steps.map((s, i) => {
          const n = i + 1;
          const here = n === current;
          const done = !here && n < furthest;
          return (
            <PressableScale
              key={`${s.order}-${i}`}
              onPress={() => onPick(n)}
              haptic
              scaleTo={0.98}
              accessibilityLabel={`Step ${n}: ${s.title}${here ? ', you’re here' : done ? ', done' : ''}`}
              accessibilityState={{ selected: here }}
              onLayout={here ? (e) => scroll.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - 120), animated: false }) : undefined}
              style={[styles.row, here ? styles.rowHere : null]}>
              {done ? (
                <View style={styles.check}>
                  <CheckIcon size={16} strokeWidth={3} color={colors.sage} />
                </View>
              ) : (
                <StepNumber n={n} size={32} soft={!here} />
              )}
              <Txt variant="rowTitle" size={16} weight={here ? 700 : 600} color={colors.ink} numberOfLines={2} style={styles.title}>
                {s.title}
              </Txt>
              {here ? (
                <Txt variant="label" size={13} weight={700} color={colors.sageInk} style={styles.tag}>
                  You’re here
                </Txt>
              ) : null}
            </PressableScale>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 4, paddingBottom: 8 },
  row: { minHeight: 56, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowHere: { backgroundColor: colors.sage },
  check: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.green },
  title: { flex: 1 },
  tag: { flexShrink: 0 },
});

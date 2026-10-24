// "Dad’s tip ⌄" on a cook-mode step (kid QA round 2, note 12): a small peach pill, closed at first so
// it never crowds the step. Tap it and the tip drops down under it; tap the top again to fold it. Plain
// body text, no quote marks: the tip is shortened from what the cook said, and the label already says
// whose it is. Only for a step whose recipe gives it a `tip`.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';

import { ChevronDownIcon, ChevronUpIcon, PressableScale, Txt } from '@/components/ui';
import { colors } from '@/theme/tokens';

export function TipPill({ cookName, tip }: { cookName: string; tip: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const words = (tip ?? '').trim().replace(/^["“”]+|["“”]+$/g, '');
  if (!words) return null;
  const title = `${cookName}’s tip`;
  const Chevron = open ? ChevronUpIcon : ChevronDownIcon;

  return (
    <Animated.View layout={LinearTransition.duration(220)} style={[styles.box, open ? styles.open : null]}>
      <PressableScale
        scaleTo={0.97}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        accessibilityLabel={title}
        accessibilityHint={open ? 'Hides the tip' : 'Shows the tip'}
        style={styles.head}>
        <Txt variant="label" size={16} weight={700} color={colors.peachInk}>
          {title}
        </Txt>
        <Chevron size={18} color={colors.peachInk} />
      </PressableScale>
      {open ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <View style={styles.body}>
            <Txt variant="bodyInk" size={17} leading={1.45} color={colors.ink} selectable>
              {words}
            </Txt>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'flex-start', backgroundColor: colors.peach, borderRadius: 24 },
  open: { alignSelf: 'stretch', borderRadius: 20 },
  head: { minHeight: 48, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  body: { paddingHorizontal: 18, paddingBottom: 16 },
});

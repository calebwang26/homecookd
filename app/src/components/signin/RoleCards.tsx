// "What do you want to do first?": two big cards, Record a dish (a cook) / Learn a dish (a learner).
// Picked like the bible's chosen video: a green ring and a check. Only asked when the role can't
// come from how they arrived (an invite carries it; a recipe link means a learner).
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { BookIcon, CheckIcon, haptic, PressableScale, Txt, VideoIcon } from '@/components/ui';
import type { Role } from '@/lib/api';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors, motion, radii, shadows } from '@/theme/tokens';

const CHOICES: { role: Role; label: WordKey }[] = [
  { role: 'cook', label: 'signin.role.record' },
  { role: 'learner', label: 'signin.role.learn' },
];

export function RoleCards({ value, onChange }: { value: Role | null; onChange: (role: Role) => void }) {
  const { t } = useWords();
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={t('signin.role.title')}>
      {CHOICES.map(({ role, label: key }) => {
        const label = t(key);
        const on = value === role;
        const cook = role === 'cook';
        return (
          <PressableScale
            key={role}
            scaleTo={motion.pressScaleCard}
            onPress={() => {
              if (!on) haptic('selection');
              onChange(role);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={label}
            style={[styles.card, on && styles.cardOn]}>
            <View style={[styles.icon, { backgroundColor: cook ? colors.peach : colors.lavender }]}>
              {cook ? <VideoIcon size={28} color={colors.peachInk} /> : <BookIcon size={28} color={colors.lavenderInk} />}
            </View>
            <Txt variant="title" size={18} align="center">
              {label}
            </Txt>
            {on ? (
              <Animated.View entering={FadeIn.duration(160)} style={styles.check}>
                <CheckIcon size={16} color={colors.card} strokeWidth={3} />
              </Animated.View>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  card: {
    flex: 1,
    height: 168,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    borderWidth: 2.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 12,
  },
  cardOn: { borderColor: colors.green },
  icon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

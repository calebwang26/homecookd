// "Invite family :)": the one big invite button on parent Home and kid Home, dark green (the second
// color) so it stands apart from parent Home's yolk "Record a new recipe". Opens the shared,
// no-question invite share sheet (AddFamilySheet): one family link, sent by Copy link, Messages,
// Instagram, ... ; whoever opens it adds themselves, so it invites anyone.
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { AddFamilySheet } from '@/components/profiles';
import { ActionButton, PlusIcon, type ActionVariant } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

export function InviteButton({ variant = 'secondary', style }: { variant?: ActionVariant; style?: StyleProp<ViewStyle> }) {
  // A fresh key per open, so the sheet's form starts empty every time.
  const [sheet, setSheet] = useState({ open: false, n: 0 });
  const { t } = useWords();
  const fg = variant === 'ink' || variant === 'secondary' ? colors.card : colors.ink;
  return (
    <>
      <ActionButton
        label={t('parent.invite.button')}
        variant={variant}
        size="xl"
        haptics
        icon={<PlusIcon size={22} color={fg} />}
        onPress={() => setSheet((s) => ({ open: true, n: s.n + 1 }))}
        accessibilityHint={t('parent.invite.hint')}
        style={style}
      />
      <AddFamilySheet key={sheet.n} visible={sheet.open} onClose={() => setSheet((s) => ({ ...s, open: false }))} />
    </>
  );
}

// "Invite family :)": the invite button on parent Home, a quiet white outline so "Record a new recipe"
// stays the one filled button there (Caleb, Oct 29: one primary action per parent screen). Opens the shared,
// no-question invite share sheet (AddFamilySheet): one family link, sent by Copy link, Messages,
// Instagram, ... ; whoever opens it adds themselves, so it invites anyone.
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { AddFamilySheet } from '@/components/profiles';
import { ActionButton, PlusIcon, type ActionVariant } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

export function InviteButton({ variant = 'outline', style }: { variant?: ActionVariant; style?: StyleProp<ViewStyle> }) {
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

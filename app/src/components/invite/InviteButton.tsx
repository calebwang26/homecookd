// "Invite family :)": the one big invite button on parent Home and kid Home, sun yellow so it
// stands out from the page (and from parent Home's green "Record a new recipe"). Opens the shared,
// no-question invite share sheet (AddFamilySheet): one family link, sent by Copy link, Messages,
// Instagram, ... ; whoever opens it adds themselves, so it invites anyone.
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { AddFamilySheet } from '@/components/profiles';
import { ActionButton, PlusIcon, type ActionVariant } from '@/components/ui';
import { colors } from '@/theme/tokens';

export function InviteButton({ variant = 'sun', style }: { variant?: ActionVariant; style?: StyleProp<ViewStyle> }) {
  // A fresh key per open, so the sheet's form starts empty every time.
  const [sheet, setSheet] = useState({ open: false, n: 0 });
  const fg = variant === 'primary' || variant === 'ink' ? colors.card : colors.ink;
  return (
    <>
      <ActionButton
        label="Invite family :)"
        variant={variant}
        size="xl"
        haptics
        icon={<PlusIcon size={22} color={fg} />}
        onPress={() => setSheet((s) => ({ open: true, n: s.n + 1 }))}
        accessibilityHint="Add someone to your family on homecookd"
        style={style}
      />
      <AddFamilySheet key={sheet.n} visible={sheet.open} onClose={() => setSheet((s) => ({ ...s, open: false }))} />
    </>
  );
}

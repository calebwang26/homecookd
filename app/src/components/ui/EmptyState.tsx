// Warm empty states in the bible's voice: the pot mascot in a soft peach circle, a Fraunces line,
// one short sentence, and at most one clear action.
//   <EmptyState title="Nothing cooking yet" body="Record one dish and Leo can make it tonight."
//               actionLabel="Record a new recipe" onAction={...} />
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

import { ActionButton } from './ActionButton';
import { PotMark } from './icons';
import { Txt } from './Txt';

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  icon,
  tone = 'peach',
  compact,
  style,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  /** Replace the pot with your own glyph. */
  icon?: ReactNode;
  tone?: 'peach' | 'lavender' | 'sage';
  /** Smaller, for use inside a card. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const disc = compact ? 64 : 88;
  const bg = tone === 'lavender' ? colors.lavender : tone === 'sage' ? colors.sage : colors.peach;
  return (
    <View style={[styles.wrap, compact ? styles.compact : null, style]}>
      <View style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2, backgroundColor: bg }]}>
        {icon ?? <PotMark size={compact ? 40 : 54} />}
      </View>
      <View style={styles.text}>
        <Txt variant="section" size={compact ? 20 : 22} align="center">
          {title}
        </Txt>
        {body ? (
          <Txt variant="body" leading={1.45} align="center">
            {body}
          </Txt>
        ) : null}
      </View>
      {actionLabel && onAction ? <ActionButton label={actionLabel} onPress={onAction} size="md" style={styles.action} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 16, paddingVertical: 32, paddingHorizontal: 8 },
  compact: { paddingVertical: 20, gap: 12 },
  disc: { alignItems: 'center', justifyContent: 'center' },
  text: { gap: 6, alignItems: 'center', maxWidth: 300 },
  action: { alignSelf: 'stretch', marginTop: 4 },
});

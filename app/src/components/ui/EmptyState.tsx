// Warm empty states: the egg mascot (sleepy for an empty state, oops for an error), a Fraunces line,
// one short sentence, and at most one clear action.
//   <EmptyState title="Nothing cooking yet" body="Record one dish and Leo can make it tonight."
//               actionLabel="Record a new recipe" onAction={...} />
//   <EmptyState mood="oops" title="We couldn’t reach homecookd" ... />
// The egg sits straight on the page (the kit: cream, white or yolk grounds only); a custom `icon` gets a
// soft yolk-tint disc instead.
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors } from '@/theme/tokens';

import { ActionButton } from './ActionButton';
import { EggMascot, type EggMood } from './Egg';
import { Txt } from './Txt';

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  icon,
  mood = 'sleepy',
  compact,
  style,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void | Promise<unknown>;
  /** Replace the egg with your own glyph (on a yolk-tint disc). */
  icon?: ReactNode;
  /** The egg's mood: sleepy (empty, the default), oops (an error), hello (a first step). */
  mood?: EggMood;
  /** Smaller, for use inside a card. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const disc = compact ? 64 : 88;
  return (
    <View style={[styles.wrap, compact ? styles.compact : null, style]}>
      {icon ? (
        <View style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}>{icon}</View>
      ) : (
        <EggMascot mood={mood} size={disc} />
      )}
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
  disc: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.yolkTint },
  text: { gap: 6, alignItems: 'center', maxWidth: 300 },
  action: { alignSelf: 'stretch', marginTop: 4 },
});

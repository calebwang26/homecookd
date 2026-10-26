// The big card on /i: a face (whoever sent the invite, else the pot), one Fraunces question or
// sentence, at most one short line, and the card's actions as children. InviteCardSkeleton draws
// it while the invite loads.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, PotMark, Skeleton, Txt } from '@/components/ui';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

const FACE = 96;

export type InviteFace = { name: string; avatar_key?: string | null } | null;

export function InviteCard({
  face,
  title,
  line,
  faded,
  children,
}: {
  face: InviteFace;
  title: string;
  line?: string | null;
  /** A dead invite: the face steps back. */
  faded?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={[styles.face, faded ? styles.faded : null]}>
        {face ? (
          <Avatar profile={face} size={FACE} />
        ) : (
          <View style={styles.pot}>
            <PotMark size={52} />
          </View>
        )}
      </View>
      <View style={styles.words}>
        <Txt variant="display" size={34} leading={1.1} align="center" accessibilityRole="header">
          {title}
        </Txt>
        {line ? (
          <Txt variant="lead" align="center">
            {line}
          </Txt>
        ) : null}
      </View>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

export function InviteCardSkeleton() {
  const { t } = useWords();
  return (
    <View style={styles.card} accessibilityLabel={t('signin.invite.opening')} accessibilityState={{ busy: true }}>
      <Skeleton circle width={FACE} height={FACE} />
      <View style={[styles.words, styles.skelWords]}>
        <Skeleton width="86%" height={30} radius={10} />
        <Skeleton width="58%" height={30} radius={10} />
        <Skeleton width="64%" height={18} radius={8} style={styles.skelLine} />
      </View>
      <Skeleton height={64} radius={32} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.sheet,
    boxShadow: shadows.cardRaised,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 24,
    alignItems: 'center',
    gap: 22,
    overflow: 'hidden',
  },
  face: { width: FACE, height: FACE },
  faded: { opacity: 0.5 },
  pot: { width: FACE, height: FACE, borderRadius: FACE / 2, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' },
  words: { gap: 10, alignSelf: 'stretch' },
  skelWords: { alignItems: 'center' },
  skelLine: { marginTop: 6 },
  actions: { alignSelf: 'stretch', gap: 10 },
});

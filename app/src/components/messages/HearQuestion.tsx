// A question asked out loud with no words to show: `isSpoken` tells, and <HearQuestion/> is the
// yolk-tint "Hear Maya · 0:04" play pill shown in place of its quote.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PauseIcon, PlayIcon, PressableScale, Txt } from '@/components/ui';
import type { Message, Profile } from '@/lib/api';
import { mmss } from '@/lib/format';
import { useVoicePlayback } from '@/lib/voice';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

/** A question asked out loud with no words to show (no typed text or transcript). */
export function isSpoken(m: Pick<Message, 'body' | 'transcript' | 'audio_url' | 'duration_s'>): boolean {
  return !(m.body ?? '').trim() && !(m.transcript ?? '').trim() && (!!m.audio_url || !!m.duration_s);
}

/** "Hear Maya · 0:04": plays a spoken question in place of its quote. */
export function HearQuestion({ from, question, style }: { from: Pick<Profile, 'name'>; question: Message; style?: StyleProp<ViewStyle> }) {
  const v = useVoicePlayback(question);
  const { t } = useWords();
  const playing = v.phase === 'playing' || v.phase === 'loading';
  const active = playing || v.phase === 'paused';
  const time = active && v.elapsed > 0 ? mmss(v.elapsed) : mmss(v.total);
  return (
    <PressableScale
      onPress={v.toggle}
      disabled={!v.available}
      haptic
      accessibilityLabel={playing ? t('messages.hear.pause', { name: from.name }) : t('messages.hear.label', { name: from.name })}
      style={[styles.hear, style, !v.available ? { opacity: 0.5 } : null]}>
      <View style={styles.hearDisc}>{playing ? <PauseIcon size={16} color={colors.card} /> : <PlayIcon size={16} color={colors.card} />}</View>
      <Txt variant="label" size={17} weight={700} color={colors.ink} style={styles.tnum}>
        {t('messages.hear.pill', { name: from.name, time })}
      </Txt>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  hear: {
    alignSelf: 'flex-start',
    height: 60,
    paddingLeft: 8,
    paddingRight: 20,
    borderRadius: 999,
    backgroundColor: colors.yolkTint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  hearDisc: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  tnum: { fontVariant: ['tabular-nums'] },
});

// Voice cooking on the cook screen (docs/build/STACK.md, How a cook works, step 4). Two pieces:
//   <VoiceMicButton/>  a round mic at the left of the bottom bar: tap to cook by voice, tap to stop.
//                      Red while listening.
//   <VoiceLine/>       one short line just above the bottom bar, only while voice is on:
//                      "Listening…" / what the kid said / "AI voice" while the AI's reply plays /
//                      "Translated from Mom" while the AI voices the clip that just played in English /
//                      "I asked Mom" for a few seconds after a question went to the cook.
// The cook's own clips are never labelled: only the AI's voice is.
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { IconButton, MicIcon, Txt } from '@/components/ui';
import type { VoiceStatus } from '@/lib/live/voice';
import { SAY_KEY_PREFIX, TRANSLATION_KEY_PREFIX } from '@/lib/live/say';
import { useNowPlaying } from '@/lib/media';
import { colors, radii, shadows } from '@/theme/tokens';

const ASKED_SHOWN_MS = 6000;

export function VoiceMicButton({ status, onPress }: { status: VoiceStatus; onPress: () => void }) {
  const on = status === 'listening' || status === 'connecting';
  return (
    <IconButton
      tone={on ? 'peach' : 'cream'}
      size={60}
      haptic
      selected={on}
      accessibilityLabel={on ? 'Stop cooking by voice' : 'Cook by voice'}
      icon={<MicIcon size={26} color={on ? colors.danger : colors.ink} />}
      onPress={onPress}
    />
  );
}

export function VoiceLine({ status, heard, askedAt, error, cookName, bottom }: { status: VoiceStatus; heard: string | null; askedAt: number | null; error: string | null; cookName: string; bottom: number }) {
  const now = useNowPlaying();
  const aiSpeaking = now.phase === 'playing' && !!now.key?.startsWith(SAY_KEY_PREFIX);
  const translating = aiSpeaking && !!now.key?.startsWith(TRANSLATION_KEY_PREFIX);
  // "I asked Mom" shows for a few seconds after each question.
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!askedAt) return;
    const t = setTimeout(() => setExpired(askedAt), ASKED_SHOWN_MS);
    return () => clearTimeout(t);
  }, [askedAt]);
  const asked = !!askedAt && expired !== askedAt;

  const text =
    status === 'error' ? error
    : status === 'off' ? null
    : asked ? `I asked ${cookName}`
    : translating ? `Translated from ${cookName}`
    : aiSpeaking ? 'AI voice'
    : status === 'connecting' ? 'Connecting…'
    : heard ? `“${heard}”`
    : 'Listening…';
  if (!text) return null;
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} pointerEvents="none" style={[styles.wrap, { bottom }]}>
      <View style={[styles.pill, asked && styles.asked, aiSpeaking && !asked && styles.ai]} accessibilityLiveRegion="polite">
        <Txt variant="label" size={15} weight={600} color={asked ? colors.butterInk : aiSpeaking ? colors.lavenderInk : colors.ink} numberOfLines={2} align="center">
          {text}
        </Txt>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
  pill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radii.pill, backgroundColor: colors.card, boxShadow: shadows.chip, maxWidth: '100%' },
  asked: { backgroundColor: colors.butter },
  ai: { backgroundColor: colors.lavender },
});

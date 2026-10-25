// Voice cooking on the cook screen (docs/build/STACK.md "kid cooking additions"), around homie, who
// docks in the middle of the bottom bar (components/homie draws the pot; the screen holds its place):
//   <TimerPill/>    beside the step title while homie's timer runs: "Timer 4:32", then "Done"
//   <VoiceLine/>    one tiny label by the pot when it isn't speaking (above it when it sits low): "I
//                   asked Grandma" for a few seconds after a question went to her, "Connecting…", "Mic
//                   off". While homie speaks, the overlay's own label says "AI voice" (or "Translated
//                   from Grandma").
//   <ClipCaption/>  under the step video while it plays the moment homie found: her words, and the English
//   <VoiceHold/>    no picture (its own component, so playback ticks re-render only it): while the cook's
//                   own voice plays (any video, her voice note) the pot shrinks a little and homie says
//                   nothing on its own (the service is told); while her clip or her voice note answers
//                   the kid, homie's next line waits for her too, and a video the kid starts turns homie
//                   off (it has the sound). Half duplex (none of the app's own sound reaches the voice
//                   service as the kid's voice) is lib/live/mic's, on every frame.
// The cook's own clips are never labelled: only the AI's voice is. Motion: the pill counts down each
// half second while the pot's ring empties (HomiePot), and the pill and the line fade in and out (a
// fade is all Reduce Motion needs here).
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { useAiSpeaking } from '@/lib/homie/hooks';
import { labelAbove, sayPhase } from '@/lib/homie/logic';
import { setHomie, type HomieFrame } from '@/lib/homie/store';
import { ANSWER_KEY } from '@/lib/live/answers';
import type { VoiceCooking } from '@/lib/live/voice';
import { clockText, secondsLeft, timerA11y, type CookTimer } from '@/lib/live/voiceLogic';
import { playheadAt, useKidVideoPlaying, useNowPlaying, usePlayhead, useVideoPlaying } from '@/lib/media';
import { colors, radii, shadows } from '@/theme/tokens';

const ASKED_SHOWN_MS = 8000;

/** The soonest of homie's timers, counting down on this phone's clock. */
export function TimerPill({ timers }: { timers: readonly CookTimer[] }) {
  const t = timers[0];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!t) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [t]);
  if (!t) return null;
  const left = secondsLeft(t, now);
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      style={[styles.timer, !left && styles.timerDone]}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={timerA11y(t, now)}>
      <Txt variant="label" size={14} weight={700} color={left ? colors.card : colors.butterInk} style={styles.digits}>
        {left ? `Timer ${clockText(left)}` : 'Done'}
      </Txt>
    </Animated.View>
  );
}

export function VoiceLine({ voice, cookName, slot }: { voice: Pick<VoiceCooking, 'status' | 'muted' | 'askedAt'>; cookName: string; slot: HomieFrame }) {
  const speaking = useAiSpeaking();
  // "I asked Grandma" shows for a few seconds after each question.
  const [expired, setExpired] = useState<number | null>(null);
  const { askedAt } = voice;
  useEffect(() => {
    if (!askedAt) return;
    const t = setTimeout(() => setExpired(askedAt), ASKED_SHOWN_MS);
    return () => clearTimeout(t);
  }, [askedAt]);
  const asked = !!askedAt && expired !== askedAt;
  const { height: windowH } = useWindowDimensions();

  const text = speaking
    ? null
    : asked
      ? `I asked ${cookName}`
      : voice.status === 'connecting'
        ? 'Connecting…'
        : voice.status === 'listening' && voice.muted
          ? 'Mic off'
          : null;
  if (!text) return null;
  // Low on the screen (the bottom bar): centred above the pot. Else under it, its right edge a little
  // past the pot's, so a long name grows left and stays on screen.
  const place = labelAbove(slot, windowH)
    ? [styles.lineAbove, { top: slot.y - 26, left: slot.x + slot.size / 2 - LINE_W / 2 }]
    : [styles.lineWrap, { top: slot.y + slot.size - 2, left: 0, width: slot.x + slot.size + 8 }];
  return (
    <Animated.View key={text} entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} pointerEvents="none" style={place} accessibilityLiveRegion="polite">
      <Txt variant="caption" size={11} weight={700} color={asked ? colors.butterInk : colors.muted} numberOfLines={1} style={[styles.line, asked && styles.lineAsked]}>
        {text}
      </Txt>
    </Animated.View>
  );
}

/** The cook's words for the moment homie is playing; the English under them when she spoke another language. */
export function ClipCaption({ quote, quoteEn }: { quote: string; quoteEn?: string }) {
  return (
    <Animated.View entering={FadeIn.duration(200)} style={styles.caption} accessibilityLiveRegion="polite">
      <Txt variant="quote" size={17}>{`“${quote}”`}</Txt>
      {quoteEn && quoteEn !== quote ? (
        <Txt variant="meta" size={14} color={colors.muted}>
          {quoteEn}
        </Txt>
      ) : null}
    </Animated.View>
  );
}

/**
 * The cook's own voice is playing: the resting pot steps back (shrinks) and homie says nothing on its
 * own until it stops (setVideo); while her clip or her voice note answers the kid, homie's next line
 * waits for her too. `herClip`: the moment homie asked for is on screen (play_clip), so the step video
 * playing is her answer. A play the kid started (lib/media kidVideoPlaying: a tap, never her clip) has
 * the sound, and homie turns off (setVideo's `kid`). (Half duplex is lib/live/mic's.)
 */
export function VoiceHold({ voice, videoUrl, herClip }: { voice: Pick<VoiceCooking, 'setHold' | 'setVideo'>; videoUrl?: string | null; herClip: boolean }) {
  const now = useNowPlaying();
  const video = usePlayhead(() => playheadAt(videoUrl) != null);
  const anyVideo = useVideoPlaying();
  const sound = now.phase === 'playing' || now.phase === 'loading';
  // Her own voice: any video (the full-screen player too), or anything on the player that isn't homie
  // (a story, her voice note).
  const hers = anyVideo || (sound && sayPhase(now.key, now.phase) === 'none');
  const answering = (herClip && video) || (sound && !!now.key?.startsWith(ANSWER_KEY));
  const kid = useKidVideoPlaying();
  // homie's own line playing (an answer that paused the video): a line that waited goes once it ends.
  const talking = sayPhase(now.key, now.phase) !== 'none';
  const { setHold, setVideo } = voice;
  useEffect(() => setHold(answering), [answering, setHold]);
  useEffect(() => setVideo(hers, kid), [hers, kid, talking, setVideo]);
  useEffect(() => setHomie({ shrunk: hers }), [hers]);
  useEffect(() => () => setHomie({ shrunk: false }), []);
  return null;
}

const LINE_W = 220;

const styles = StyleSheet.create({
  // The canvas's dark "Timer 7:41" pill beside the title.
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
    paddingHorizontal: 12,
    marginTop: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    flexShrink: 0,
  },
  timerDone: { backgroundColor: colors.butter },
  digits: { fontVariant: ['tabular-nums'] },
  lineWrap: { position: 'absolute', zIndex: 3, alignItems: 'flex-end' },
  lineAbove: { position: 'absolute', zIndex: 3, alignItems: 'center', width: LINE_W },
  line: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.card, overflow: 'hidden', boxShadow: shadows.chip },
  lineAsked: { backgroundColor: colors.butter },
  caption: { gap: 4, paddingHorizontal: 4 },
});

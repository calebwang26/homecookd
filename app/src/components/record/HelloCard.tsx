// Parent-Send "Add a hello": a cream card (radius 24, padding 14 14 14 20) with the
// round peach mic (52). Tap to talk, tap again to stop; then it plays back, and a small x removes it.
// Recording turns the mic red (#9A4F47) with a soft halo, like Parent-Chat's recording state.
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CloseIcon, IconButton, MicIcon, PauseIcon, PlayIcon, PressableScale, StopIcon, Txt } from '@/components/ui';
import { mmss } from '@/lib/format';
import { useClipAudio } from '@/lib/media';
import { openMicSettings, useVoiceRecorder, type VoiceRecording } from '@/lib/voice';
import { colors, radii, shadows } from '@/theme/tokens';

/** A hello is short; the server allows 5 min, a hello needs one. */
const HELLO_MAX_S = 90;

export function HelloCard({
  hello,
  onChange,
  onRecordingChange,
  disabled,
}: {
  hello: VoiceRecording | null;
  onChange: (rec: VoiceRecording | null) => void;
  /** True from the mic tap until the hello is kept (Send waits for it). */
  onRecordingChange?: (on: boolean) => void;
  disabled?: boolean;
}) {
  const rec = useVoiceRecorder({ maxSeconds: HELLO_MAX_S, onAutoStop: (r) => r && onChange(r) });
  const live = rec.phase === 'requesting' || rec.phase === 'recording' || rec.phase === 'stopping';
  const notify = useRef(onRecordingChange);
  useEffect(() => {
    notify.current = onRecordingChange;
  });
  useEffect(() => {
    notify.current?.(live);
  }, [live]);
  const play = useClipAudio(hello ? { url: hello.uri, key: `hello:${hello.uri}`, start_s: 0, end_s: null } : null);

  const recording = rec.phase === 'recording' || rec.phase === 'requesting';
  const reduce = useReducedMotion();
  const halo = useSharedValue(0);
  useEffect(() => {
    if (rec.phase === 'recording' && !reduce) {
      halo.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.35, { duration: 700 })), -1);
    } else {
      cancelAnimation(halo);
      halo.value = withTiming(0, { duration: 150 });
    }
  }, [rec.phase, reduce, halo]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: halo.value, transform: [{ scale: 0.9 + 0.1 * halo.value }] }));

  const busy = useRef(false);
  const onMic = async () => {
    if (disabled || busy.current) return;
    busy.current = true;
    try {
      if (rec.phase === 'denied') {
        openMicSettings();
      } else if (rec.phase === 'recording') {
        const r = await rec.stop();
        if (r) onChange(r);
      } else if (rec.phase !== 'requesting') {
        play.stop();
        await rec.start();
      }
    } finally {
      busy.current = false;
    }
  };

  let title = 'Add a hello';
  let sub = '';
  if (recording) {
    title = rec.phase === 'requesting' ? 'Getting the mic ready' : `Recording · ${mmss(rec.elapsed)}`;
    sub = 'Tap again to stop';
  } else if (hello) {
    title = `Your hello · ${mmss(hello.duration_s)}`;
    sub = play.playing ? `Playing · ${mmss(play.elapsed)}` : 'Tap to hear it';
  } else if (rec.phase === 'denied') {
    sub = 'Turn on the microphone in Settings';
  } else if (rec.phase === 'unsupported') {
    sub = 'Works in the app on your phone';
  } else if (rec.phase === 'error' && rec.error) {
    sub = 'The mic didn’t start. Try again.';
  }

  return (
    <View style={styles.card} accessibilityRole="none" accessibilityLabel="Voice note, optional">
      <View style={styles.text}>
        <Txt variant="rowTitle" size={16} weight={700} numberOfLines={1}>
          {title}
        </Txt>
        {sub ? (
          <Txt variant="meta" size={14} numberOfLines={1}>
            {sub}
          </Txt>
        ) : null}
      </View>

      {hello && !recording ? (
        <>
          <IconButton
            tone="well"
            size={40}
            accessibilityLabel="Remove your hello"
            onPress={() => {
              play.stop();
              onChange(null);
            }}
            disabled={disabled}
            icon={<CloseIcon size={18} color={colors.muted} />}
          />
          <IconButton
            tone="peach"
            size={52}
            accessibilityLabel={play.playing ? 'Pause your hello' : 'Hear your hello'}
            onPress={play.toggle}
            icon={play.playing ? <PauseIcon size={20} color={colors.peachInk} /> : <PlayIcon size={20} color={colors.peachInk} />}
          />
        </>
      ) : (
        <View style={styles.micWrap}>
          <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
          <PressableScale
            onPress={onMic}
            haptic
            disabled={disabled || rec.phase === 'unsupported'}
            accessibilityLabel={recording ? 'Stop and keep your hello' : 'Tap to talk. Tap again to stop.'}
            style={[
              styles.mic,
              recording ? { backgroundColor: colors.danger } : { backgroundColor: colors.peach },
              rec.phase === 'unsupported' ? { opacity: 0.5 } : null,
            ]}>
            {recording ? <StopIcon size={22} color={colors.card} /> : <MicIcon size={24} color={colors.peachInk} />}
          </PressableScale>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    paddingVertical: 14,
    paddingRight: 14,
    paddingLeft: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  text: { flex: 1, gap: 2 },
  micWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  // Parent-Chat's recording halo (0 0 0 10px rgba(154,79,71,0.18)), scaled to the 52 px mic.
  halo: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(154,79,71,0.18)',
  },
  mic: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});

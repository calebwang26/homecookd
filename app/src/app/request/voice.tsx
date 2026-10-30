// Tell Caleb how you make it (/request/voice?ask=<askId>, Phase 5 screen 8, mockups VoiceNow and VoiceDone): a
// 2-minute voice note that the server writes up as a recipe in her words, so he can cook it tonight.
// "For Caleb · braised pork", the title and three prompts (What goes in · About how much · How you know it's
// ready), then one of three states:
//   ready      one red "Tap to start"
//   recording  the clock out of 2:00 and only a stop button (it stops itself at 2:00)
//   done       "Listen back · 1:52", "Send to Caleb" and "Start over"
// Her voice goes to Cartesia and Claude, so the first start (and every send) waits for this phone's yes
// (lib/aiConsent). Send -> sendVoiceRecipe, then "Sent"; a failure says so and keeps the note. Nothing talks.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListeningBars } from '@/components/record/ListeningBars';
import { ActionButton, CloseIcon, IconButton, MicIcon, PauseIcon, PlayIcon, PressableScale, ScreenWash, StopIcon, Txt, useToast } from '@/components/ui';
import { ensureAiConsent } from '@/lib/aiConsent';
import { sendVoiceRecipe, useCravingAsk } from '@/lib/cravings';
import { mmss } from '@/lib/format';
import { useClipAudio } from '@/lib/media';
import { openMicSettings, useVoiceRecorder, type RecorderPhase, type VoiceRecording } from '@/lib/voice';
import { useWords } from '@/lib/words/useWords';
import type { T, WordKey } from '@/lib/words/words';
import { alpha, colors, radii, shadows, space } from '@/theme/tokens';

const MAX_S = 120;
const PROMPTS: WordKey[] = ['request.voice.prompt1', 'request.voice.prompt2', 'request.voice.prompt3'];

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}

export default function VoiceRecipeScreen() {
  const { ask: askId } = useLocalSearchParams<{ ask: string }>();
  const ask = useCravingAsk(askId);
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { t } = useWords();
  const [note, setNote] = useState<VoiceRecording | null>(null);
  const [sending, setSending] = useState(false);
  const rec = useVoiceRecorder({ maxSeconds: MAX_S, onAutoStop: (r) => r && setNote(r) });
  const play = useClipAudio(note ? { url: note.uri, key: `recipe-note:${note.uri}`, start_s: 0, end_s: null } : null);
  const kid = ask?.kidName.trim() || t('dish.yourKid');
  const dish = ask?.dish ?? '';

  const busy = useRef(false);
  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (rec.phase === 'denied') return openMicSettings();
      if (!(await ensureAiConsent())) return;
      play.stop();
      setNote(null);
      await rec.start();
    } finally {
      busy.current = false;
    }
  };

  const stop = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await rec.stop();
      if (r) setNote(r);
      else toast.show(t('request.voice.tooShort'), { tone: 'info' });
    } finally {
      busy.current = false;
    }
  };

  const send = async () => {
    if (!note || !askId || sending) return;
    if (!(await ensureAiConsent())) return;
    play.stop();
    setSending(true);
    try {
      await sendVoiceRecipe(askId, { uri: note.uri, contentType: note.contentType, durationS: note.duration_s });
      router.replace({ pathname: '/request/sent', params: { ask: askId } });
    } catch {
      // The note stays: she can send it again.
      toast.show(t('request.voice.sendFailed'), { tone: 'error', durationMs: 3600 });
      setSending(false);
    }
  };

  const startOver = () => {
    play.stop();
    setNote(null);
  };

  const recording = rec.phase === 'recording' || rec.phase === 'stopping';
  const state: 'ready' | 'recording' | 'done' = recording ? 'recording' : note ? 'done' : 'ready';

  return (
    <View style={styles.page}>
      <ScreenWash tone="parent" height={420} />
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.col, { paddingTop: Math.max(space.topDetail, insets.top + 4), paddingBottom: Math.max(space.xxxl, insets.bottom + 16) }]}>
        <IconButton icon={<CloseIcon size={18} color={colors.ink} />} accessibilityLabel={t('request.close')} onPress={goBack} size={44} />

        <View style={styles.head}>
          {ask ? (
            <Txt variant="heading" size={17} weight={600} color={colors.ink} numberOfLines={1}>
              {t('request.voice.for', { kid, dish })}
            </Txt>
          ) : null}
          <Txt variant="display" size={36} leading={1.08} accessibilityRole="header">
            {t('request.voice.title', { kid })}
          </Txt>
        </View>

        <View style={styles.prompts}>
          {PROMPTS.map((key, i) => (
            <View key={key} style={styles.prompt}>
              <View style={styles.num}>
                <Txt variant="label" size={16} weight={700} color={colors.green}>
                  {i + 1}
                </Txt>
              </View>
              <Txt variant="label" size={18} weight={600} style={styles.flex}>
                {t(key)}
              </Txt>
            </View>
          ))}
        </View>

        <View style={styles.middle}>
          {state === 'recording' ? (
            <>
              <View style={styles.clock} accessible accessibilityLabel={`${mmss(rec.elapsed)} ${t('request.voice.of', { max: mmss(MAX_S) })}`}>
                <Txt variant="title" size={44} weight={700} style={styles.tight}>
                  {mmss(rec.elapsed)}
                </Txt>
                <Txt variant="lead" size={18}>
                  {t('request.voice.of', { max: mmss(MAX_S) })}
                </Txt>
              </View>
              <ListeningBars level={rec.level} color={colors.danger} />
              <BigMic recording onPress={() => void stop()} label={t('request.voice.stopA11y')} />
              <Txt variant="label" size={17} weight={600} color={colors.muted} align="center">
                {t('request.voice.stop')}
              </Txt>
            </>
          ) : state === 'done' && note ? (
            <PressableScale
              onPress={play.toggle}
              accessibilityLabel={play.playing ? t('request.voice.pause', { time: mmss(note.duration_s) }) : t('request.voice.listen', { time: mmss(note.duration_s) })}
              style={styles.listen}>
              <View style={styles.listenDisc}>{play.playing ? <PauseIcon size={20} color={colors.green} /> : <PlayIcon size={20} color={colors.green} />}</View>
              <Txt variant="title" size={19}>
                {play.playing ? t('request.voice.pause', { time: mmss(play.elapsed) }) : t('request.voice.listen', { time: mmss(note.duration_s) })}
              </Txt>
            </PressableScale>
          ) : (
            <>
              <BigMic
                recording={false}
                disabled={rec.phase === 'requesting' || rec.phase === 'unsupported'}
                onPress={() => void start()}
                label={t('request.voice.start')}
              />
              <Txt variant="title" size={19} align="center" color={rec.phase === 'denied' || rec.phase === 'error' ? colors.danger : colors.ink}>
                {readyLine(rec.phase, t)}
              </Txt>
            </>
          )}
        </View>

        {state === 'done' ? (
          <View style={styles.foot}>
            <ActionButton label={t('request.voice.send', { kid })} loadingLabel={t('request.voice.sending')} onPress={() => void send()} state={sending ? 'loading' : 'idle'} size="xl" labelSize={20} disabled={!ask} />
            <PressableScale onPress={startOver} disabled={sending} accessibilityLabel={t('request.voice.startOver')} style={styles.over}>
              <Txt variant="label" size={18} weight={700} color={colors.yolkDeep}>
                {t('request.voice.startOver')}
              </Txt>
            </PressableScale>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function readyLine(phase: RecorderPhase, t: T): string {
  if (phase === 'requesting') return t('request.voice.starting');
  if (phase === 'denied') return t('request.voice.micOff');
  if (phase === 'unsupported') return t('request.voice.phoneOnly');
  if (phase === 'error') return t('request.voice.micError');
  return t('request.voice.start');
}

/** The 112 pt red button: a mic to start, a cream square to stop, with the soft halo while recording. */
function BigMic({ recording, onPress, label, disabled }: { recording: boolean; onPress: () => void; label: string; disabled?: boolean }) {
  const reduce = useReducedMotion();
  const halo = useSharedValue(recording ? 1 : 0);
  useEffect(() => {
    if (recording && !reduce) halo.set(withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1));
    else {
      cancelAnimation(halo);
      halo.set(withTiming(recording ? 1 : 0, { duration: 150 }));
    }
  }, [recording, reduce, halo]);
  const haloStyle = useAnimatedStyle(() => ({ opacity: halo.value }));
  return (
    <View style={styles.micWrap}>
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      <PressableScale onPress={onPress} haptic disabled={disabled} accessibilityLabel={label} style={[styles.mic, disabled ? styles.dim : null]}>
        {recording ? <StopIcon size={34} color={colors.card} /> : <MicIcon size={40} color={colors.card} />}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  col: { flexGrow: 1, paddingHorizontal: space.gutter, gap: 18 },
  flex: { flex: 1 },
  head: { gap: 6 },
  prompts: { backgroundColor: colors.card, borderRadius: radii.card, paddingVertical: 18, paddingHorizontal: 20, gap: 12, boxShadow: shadows.card },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  num: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.greenTint, alignItems: 'center', justifyContent: 'center' },
  middle: { flexGrow: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: 14 },
  clock: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  tight: { letterSpacing: -0.88 },
  micWrap: { width: 136, height: 136, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  halo: { position: 'absolute', width: 136, height: 136, borderRadius: 68, backgroundColor: alpha.recordHalo },
  mic: { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
  listen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 22,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: alpha.border,
    backgroundColor: colors.card,
  },
  listenDisc: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.greenTint, alignItems: 'center', justifyContent: 'center' },
  foot: { gap: 6 },
  over: { height: 52, alignItems: 'center', justifyContent: 'center' },
});

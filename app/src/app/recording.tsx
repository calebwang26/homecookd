// Grandma's recording screen: /recording?id=<recordingId>&source=glasses|phone (from Record's
// pre-record sheet). homie rests top-right and talks with her over the /record socket
// (lib/live/homie useHomieRecording). Everything is in her language with small English under it.
//   intro        homie says hello; then one huge "Start cooking".
//   recording    (glasses) the status pill "Recording from the glasses", the big elapsed clock, "for
//                Shreya · Chicken biryani", the calm line, one huge "I'm done" (it asks once:
//                "Done cooking?"). homie's questions come up as moments.
//                (phone) "Start cooking" opens the phone's camera instead; homie waits meanwhile.
//   wrapping_up  homie's last questions and "Can Shreya hear your stories too?", as moments.
//   ended        glasses: back home, "Your recording is on its way" (the glasses VM uploads it);
//                phone: Send, with the camera's video and this recording in the draft.
// The screen stays awake (its own keep-awake tag) and can't be swiped away once filming started.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BiLine } from '@/components/record/BiLine';
import { useDraft } from '@/components/record/draft';
import { afterEnd, elapsedLabel, forLine, recordingView } from '@/components/record/recordingLogic';
import { usePickVideos } from '@/components/record/usePickVideos';
import { ActionButton, CloseIcon, IconButton, PressableScale, ScreenWash, Txt, useToast } from '@/components/ui';
import { useAiSpeaking } from '@/lib/homie/hooks';
import { showMoment } from '@/lib/homie/store';
import { cookWords, type Line } from '@/lib/homie/strings';
import { useRecording } from '@/lib/live/convex';
import { useHomieRecording } from '@/lib/live/homie';
import { speak } from '@/lib/live/speak';
import { alpha, colors, fonts, motion, shadows, space } from '@/theme/tokens';

const AWAKE_TAG = 'homecookd-recording';
/** After homie's goodbye, a beat before the screen changes. */
const ENDED_HOLD_MS = 700;

function useRecordingAwake() {
  useEffect(() => {
    let alive = true;
    activateKeepAwakeAsync(AWAKE_TAG).then(
      () => {
        if (!alive) deactivateKeepAwake(AWAKE_TAG).catch(() => {});
      },
      () => {},
    );
    return () => {
      alive = false;
      deactivateKeepAwake(AWAKE_TAG).catch(() => {});
    };
  }, []);
}

/** Now, every second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}

export default function RecordingScreen() {
  useRecordingAwake();
  const params = useLocalSearchParams<{ id?: string; source?: string; kid?: string; lang?: string }>();
  const id = params.id || null;
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const toast = useToast();
  const draft = useDraft();
  const pick = usePickVideos();
  const rec = useRecording(id);
  const source = rec?.source ?? (params.source === 'phone' ? 'phone' : 'glasses');
  const homie = useHomieRecording(id, { language: params.lang || 'en', kidName: params.kid || undefined, dish: draft.dish ?? undefined });
  const lang = homie.info?.language ?? rec?.language ?? params.lang ?? 'en';
  const w = useMemo(() => cookWords(lang), [lang]);
  const kid = homie.info?.kidName ?? (params.kid || null);
  const dish = homie.info?.dish ?? rec?.dish ?? draft.dish;
  const ended = homie.phase === 'ended' || rec?.status === 'ended' || rec?.status === 'abandoned';
  const view = recordingView(ended ? 'ended' : homie.phase, source, homie.introDone);

  // The clock: Convex's startedAt (the server's), else when this phone heard filming began. A phone
  // recording shows its video's length once the camera is back.
  const now = useNow(view.clock === 'running');
  const startedAt = rec?.startedAt ?? homie.recordingSince;
  const stoppedAt = rec?.endedAt ?? homie.stoppedSince;
  const cameraMs = draft.clips.filter((c) => c.selected).reduce((a, c) => a + (c.asset.duration ?? 0), 0);
  const clockMs = source === 'phone' ? cameraMs || null : startedAt ? (view.clock === 'stopped' && stoppedAt ? stoppedAt : now) - startedAt : null;

  // No swiping away once she's filming.
  const navigation = useNavigation();
  const filming = homie.phase === 'recording' || homie.phase === 'wrapping_up';
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !filming });
  }, [navigation, filming]);

  // homie's goodbye has been said: glasses go home (the VM uploads); a phone recording goes to Send.
  const aiSpeaking = useAiSpeaking();
  const left = useRef(false);
  useEffect(() => {
    if (!ended || aiSpeaking || left.current) return;
    const t = setTimeout(() => {
      left.current = true;
      if (afterEnd(source) === 'send') return router.replace('/send');
      const done = w.line('onItsWay');
      toast.show(done.en ? `${done.text}\n${done.en}` : done.text, { tone: 'success', durationMs: 4000 });
      if (router.canGoBack()) router.dismissTo('/parent/home');
      else router.replace('/parent/home');
    }, ENDED_HOLD_MS);
    return () => clearTimeout(t);
  }, [ended, aiSpeaking, source, toast, w]);

  const startCooking = async () => {
    if (source === 'glasses') return homie.start();
    // The phone films in its own camera; homie waits (no mic, no voice) until it's back.
    homie.pause();
    const ok = await pick.record({ dish: draft.dish, requestFrom: draft.requestFrom });
    homie.resume(ok);
  };

  const askDone = () => {
    const q = w.line('doneAsk');
    const yes = w.line('yesDone');
    const no = w.line('notYet');
    showMoment({
      id: `done:${Date.now()}`,
      question: q.text,
      questionEn: q.en ?? undefined,
      options: [
        { id: 'yes', label: yes.text, sublabel: yes.en ?? undefined, kind: 'primary' },
        { id: 'not_now', label: no.text, sublabel: no.en ?? undefined },
      ],
      onChoose: (choice) => choice === 'yes' && homie.done(),
    });
    void speak(q.text, { lang: w.lang });
  };

  const status = w.line(view.status);
  const forWhat = forLine(w, kid, dish);
  const enter = (i: number) => (reduce ? FadeIn.duration(motion.reducedFadeMs) : FadeInDown.duration(380).delay(i * 40));

  return (
    <View style={styles.page}>
      <ScreenWash tone="parent" height={320} />
      <View style={[styles.top, { paddingTop: Math.max(space.topDetail, insets.top + 4) }]}>
        {filming ? <View style={styles.topSpacer} /> : <IconButton icon={<CloseIcon size={20} color={colors.ink} />} accessibilityLabel="Close" onPress={leave} />}
      </View>

      <View style={styles.col}>
        <Animated.View key={view.status} entering={FadeIn.duration(reduce ? motion.reducedFadeMs : 220)} style={styles.statusCol}>
          <View style={styles.pill} accessibilityRole="text" accessibilityLabel={status.en ? `${status.text}. ${status.en}` : status.text}>
            <View style={[styles.dot, view.live ? styles.dotLive : styles.dotCalm]} />
            <Txt variant="label" size={17} weight={600} color={colors.ink}>
              {status.text}
            </Txt>
          </View>
          {status.en ? (
            <Txt variant="caption" size={13} color={colors.peachInk}>
              {status.en}
            </Txt>
          ) : null}
        </Animated.View>

        {view.clock !== 'none' && clockMs != null ? (
          <Txt style={styles.clock} accessibilityRole="timer" accessibilityLabel={`${elapsedLabel(clockMs)} recorded`}>
            {elapsedLabel(clockMs)}
          </Txt>
        ) : null}

        {forWhat ? (
          <Txt variant="label" size={20} weight={500} color={colors.peachInk} align="center" numberOfLines={2}>
            {forWhat}
          </Txt>
        ) : null}

        <BiLine line={w.line('cookAsAlways')} size={18} weight={400} color={colors.muted} leading={1.5} style={styles.calm} />

        {homie.micDenied ? (
          <Txt variant="meta" size={15} color={colors.danger} align="center">
            homie can’t hear you: homecookd needs the microphone. Turn it on in Settings.
          </Txt>
        ) : null}
        {homie.error ? (
          <View style={styles.error}>
            <Txt variant="meta" size={15} color={colors.danger} align="center">
              {homie.error}
            </Txt>
            <ActionButton label="Try again" variant="outline" size="sm" onPress={homie.retry} />
          </View>
        ) : null}
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(36, insets.bottom + 16) }]}>
        {view.button ? (
          <Animated.View key={view.button} entering={enter(0)}>
            <BigButton
              line={w.line(view.button === 'start' ? 'startCooking' : 'imDone')}
              tone={view.button === 'start' ? 'green' : 'ink'}
              disabled={!!pick.busy}
              onPress={view.button === 'start' ? () => void startCooking() : askDone}
            />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

/** The one huge button: 92 pt, her words big, the English small under them. */
function BigButton({ line, tone, onPress, disabled }: { line: Line; tone: 'green' | 'ink'; onPress: () => void; disabled?: boolean }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="medium"
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={line.en ? `${line.text}. ${line.en}` : line.text}
      style={[styles.big, tone === 'green' ? styles.bigGreen : styles.bigInk, disabled && styles.dim]}>
      <Txt variant="button" size={30} weight={700} color={colors.card} leading={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {line.text}
      </Txt>
      {line.en ? (
        <Txt variant="meta" size={14} color="rgba(255,253,247,0.75)">
          {line.en}
        </Txt>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  top: { paddingHorizontal: space.gutter, flexDirection: 'row' },
  topSpacer: { height: 48 },
  col: { paddingHorizontal: space.gutter, paddingTop: 34, alignItems: 'center', gap: 12 },
  statusCol: { alignItems: 'center', gap: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.card,
    boxShadow: shadows.chip,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotLive: { backgroundColor: colors.danger, boxShadow: `0 0 0 5px ${alpha.recordHalo}` },
  dotCalm: { backgroundColor: colors.green, boxShadow: '0 0 0 5px rgba(91,111,0,0.16)' },
  clock: { fontFamily: fonts.serifMedium, fontSize: 96, lineHeight: 104, letterSpacing: -1.9, color: colors.ink, fontVariant: ['tabular-nums'] },
  calm: { marginTop: 22 },
  error: { alignItems: 'center', gap: 10, marginTop: 8 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 0 },
  big: { height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  bigInk: { backgroundColor: colors.ink },
  bigGreen: { backgroundColor: colors.green, boxShadow: shadows.cta },
  dim: { opacity: 0.6 },
});

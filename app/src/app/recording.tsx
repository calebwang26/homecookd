// Grandma's recording screen (Caleb's v3): /recording?id=<recordingId>&source=glasses|phone[&kid&lang]
// (from Record's pre-record sheet). One big red record button in the middle of a warm peach screen,
// one line under it, and homie resting top-right, talking with her over the /record socket
// (lib/live/homie). Her language big, small English under it. Nothing else.
//   connecting, intro  homie says hello while the button rests ("homie is saying hello"). Then filming
//                      starts by itself; "Skip, start filming" starts it now (homie stops mid-line).
//   recording          glasses: rings pulse out of the button; a tap is "I'm done" ("माझं झालं" / "Tap
//                      when you're done"). With homie's line down, that tap ends the recording through
//                      Convex (live.endRecording), so the glasses' video still goes. phone: the phone's
//                      own camera opens instead (homie waits, its socket closed); when the video is
//                      back, homie wraps up. No video: back to Record.
//   wrapping_up        homie's last questions and "Can Shreya hear your stories too?". If it stalls
//                      (nothing moves for 2 min, or 20 s after an error or a lost line), the app ends
//                      the recording itself; a phone video then sends anyway.
//   ended              the done view (components/record/DoneView): homie waves, the video goes, home.
// homie's questions come up as AskMoments: answered out loud, no buttons (a tap closes one).
// Glasses through the laptop bridge (glasses/BRIDGE.md): above the button, what the glasses see (about a
// frame a second), whether they're live, and the last step the live pass saw (components/record/GlassesView).
// If homie's connection is lost: the reason, "Try again" and the × (a phone recording can also film
// without homie; one already filmed goes straight to the done view and sends). The screen stays
// awake, and can't be swiped away once filming started.
// Dev aids (web screenshots only): ?preview=done shows the done view without sending; ?preview=ask
// shows a made-up question from homie as a phone with a microphone would (the listening bars).
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AskMoment } from '@/components/record/AskMoment';
import { BiLine } from '@/components/record/BiLine';
import { DoneView } from '@/components/record/DoneView';
import { GlassesView } from '@/components/record/GlassesView';
import { useDraft } from '@/components/record/draft';
import { RecordButton } from '@/components/record/RecordButton';
import { recordingView, shouldAutoStart, wrapStallMs, type Ask } from '@/components/record/recordingLogic';
import { COLUMN, RecordWash } from '@/components/record/RecordWash';
import { usePickVideos } from '@/components/record/usePickVideos';
import { recordWords, type Line } from '@/components/record/words';
import { ActionButton, CloseIcon, IconButton } from '@/components/ui';
import { useAiSpeaking, useHomieScreen } from '@/lib/homie/hooks';
import { useLiveFrame, useLiveLog, useRecording } from '@/lib/live/convex';
import { useHomieRecording } from '@/lib/live/homie';
import { colors, motion, space } from '@/theme/tokens';

const AWAKE_TAG = 'homecookd-recording';
const PREVIEW_ASK: Ask = { promptId: 'preview', text: 'आजी, आलं साधारण किती घातलं?', textEn: 'About how much ginger was that?', kind: 'amount' };

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

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}

/** A button's one label: her words · the English. */
const both = (l: Line) => (l.en ? `${l.text} · ${l.en}` : l.text);

export default function RecordingScreen() {
  useRecordingAwake();
  const params = useLocalSearchParams<{ id?: string; source?: string; kid?: string; lang?: string; preview?: string }>();
  const devPreview = __DEV__ && Platform.OS === 'web' && (params.preview === 'done' || params.preview === 'ask') ? params.preview : null;
  const preview = devPreview === 'done';
  const id = devPreview ? null : params.id || null;
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const draft = useDraft();
  const pick = usePickVideos();
  const rec = useRecording(id);
  const glassesId = rec?.source === 'glasses' ? id : null;
  const liveLog = useLiveLog(glassesId);
  const liveFrame = useLiveFrame(glassesId);
  const steps = liveLog?.events.filter((e) => e.kind === 'step') ?? [];
  const lastStep = steps.length ? steps[steps.length - 1] : null;
  const source = rec?.source ?? (params.source === 'phone' ? 'phone' : 'glasses');
  const homie = useHomieRecording(id, { language: params.lang || 'en', kidName: params.kid || undefined, dish: draft.dish ?? undefined });
  const lang = homie.info?.language ?? rec?.language ?? (params.lang || 'en');
  const words = useMemo(() => recordWords(lang), [lang]);
  const kid = homie.info?.kidName ?? (params.kid || null);
  const ended = homie.phase === 'ended' || rec?.status === 'ended' || rec?.status === 'abandoned';
  // A phone recording is over once its camera is back: homie only wraps up.
  const [phoneFilmed, setPhoneFilmed] = useState(false);
  const view = recordingView(ended ? 'ended' : phoneFilmed && homie.phase === 'recording' ? 'wrapping_up' : homie.phase, words);

  // Filmed without homie (its connection was lost before filming): straight to the done view.
  const [filmedAlone, setFilmedAlone] = useState(false);
  // homie's goodbye has been said: the done view. Once shown it stays (it sends a phone recording
  // once, when it first shows). A phone video that is already filmed goes even if homie is lost.
  const aiSpeaking = useAiSpeaking();
  const [finished, setFinished] = useState(false);
  if (!finished && (preview || filmedAlone || (phoneFilmed && !!homie.error) || (ended && !aiSpeaking))) setFinished(true);

  // homie's wrap-up that never finishes (the voice service stalled): the app ends the recording
  // itself. Any new phase, question or line is progress; an error or a lost line shortens the wait.
  // Not when another phone has taken this recording over: that one finishes it.
  const wrapping = !finished && !devPreview && homie.error !== 'elsewhere' && (phoneFilmed || homie.phase === 'wrapping_up');
  const trouble = homie.serverError || homie.error === 'lostConnection';
  const progress = `${homie.phase}|${homie.ask?.promptId ?? ''}|${aiSpeaking}`;
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!wrapping || stalled) return;
    const t = setTimeout(() => setStalled(true), wrapStallMs(trouble));
    return () => clearTimeout(t);
  }, [wrapping, stalled, trouble, progress]);
  const endWithoutHomie = homie.end;
  useEffect(() => {
    if (!stalled) return;
    let alive = true;
    void endWithoutHomie().then((ok) => {
      // A phone video is filmed already: it sends either way. A glasses one that didn't end shows the ×.
      if (alive && (ok || source === 'phone')) setFinished(true);
    });
    return () => {
      alive = false;
    };
  }, [stalled, endWithoutHomie, source]);

  // No swiping away once she's filming (the × comes back if homie's connection is lost).
  const navigation = useNavigation();
  const filming = homie.phase === 'recording' || homie.phase === 'wrapping_up';
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !filming && !finished });
  }, [navigation, filming, finished]);

  // The corner pot hides while homie asks (it comes to the centre) and on the done view.
  const [asking, setAsking] = useState(false);
  useHomieScreen({ hidden: asking || finished });

  // A phone recording: the system camera films; homie waits with its socket closed.
  const film = homie.filmWithPhone;
  const record = pick.record;
  const filmOnPhone = useCallback(async () => {
    const ok = await film(() => record({ dish: draft.dish, requestFrom: draft.requestFrom }));
    if (ok) setPhoneFilmed(true);
    else leave(); // no video: back to Record
  }, [film, record, draft.dish, draft.requestFrom]);

  // Filming starts by itself once homie's hello has played (once).
  const started = useRef(false);
  const autoStart = shouldAutoStart({ phase: homie.phase, introDone: homie.introDone, aiSpeaking, error: !!homie.error });
  const begin = useRef(() => {});
  useEffect(() => {
    begin.current = source === 'glasses' ? homie.start : () => void filmOnPhone();
  });
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    begin.current();
  }, [autoStart]);

  // She doesn't want the hello: start filming now. The service cuts homie off ({type:"start"} mid-line).
  const [skipped, setSkipped] = useState(false);
  const skipIntro = () => {
    setSkipped(true);
    if (started.current) return;
    started.current = true;
    begin.current();
  };

  const filmWithoutHomie = async () => {
    started.current = true;
    if (await pick.record({ dish: draft.dish, requestFrom: draft.requestFrom })) setFilmedAlone(true);
  };

  const error = homie.error ? words.line(homie.error) : null;
  const micOff = homie.micDenied ? words.line('micOff') : null;
  const showClose = !!homie.error || (!filming && !finished) || (stalled && !finished);
  const beforeFilming = homie.phase === 'connecting' || homie.phase === 'intro';

  return (
    <View style={styles.page}>
      <RecordWash />
      {finished ? (
        <DoneView source={source} lang={lang} kidName={kid} preview={preview} />
      ) : (
        <>
          <View style={styles.column}>
            {source === 'glasses' && !devPreview ? (
              <GlassesView frame={liveFrame} filming={view.live} lastStep={lastStep?.title ?? null} steps={steps.length} />
            ) : null}
            <RecordButton
              live={view.live}
              disabled={!view.live || !!pick.busy}
              onPress={homie.done}
              accessibilityLabel={view.live ? 'Recording. Tap when you’re done.' : view.line.en ?? view.line.text}
            />
            <Animated.View key={view.line.text} entering={FadeIn.duration(reduce ? motion.reducedFadeMs : 220)} style={styles.label}>
              <BiLine line={view.line} size={30} weight={700} enSize={15} leading={1.3} />
            </Animated.View>
            {beforeFilming && !homie.error && !skipped ? (
              <View style={styles.skip}>
                <ActionButton label={both(words.line('skipIntro'))} variant="outline" size="sm" onPress={skipIntro} />
              </View>
            ) : null}
            {micOff || error ? (
              <View style={styles.problem}>
                {micOff ? <BiLine line={micOff} size={16} weight={600} color={colors.danger} enColor={colors.danger} /> : null}
                {error ? <BiLine line={error} size={16} weight={600} color={colors.danger} enColor={colors.danger} /> : null}
                {homie.error === 'lostConnection' ? <ActionButton label={both(words.line('tryAgain'))} variant="outline" size="sm" onPress={homie.retry} /> : null}
                {homie.error && source === 'phone' && beforeFilming ? (
                  <ActionButton label={both(words.line('filmWithoutHomie'))} variant="outline" size="sm" onPress={() => void filmWithoutHomie()} />
                ) : null}
              </View>
            ) : null}
          </View>
          <AskMoment
            ask={devPreview === 'ask' ? PREVIEW_ASK : homie.ask}
            words={words}
            micOn={devPreview === 'ask' || homie.micOn}
            onNotNow={homie.notNow}
            onActive={setAsking}
          />
        </>
      )}
      {showClose && !asking ? (
        <View style={[styles.top, { paddingTop: Math.max(space.topDetail, insets.top + 4) }]} pointerEvents="box-none">
          <IconButton icon={<CloseIcon size={20} color={colors.ink} />} accessibilityLabel={words.line('leave').en ?? 'Leave'} onPress={leave} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.gutter, flexDirection: 'row' },
  column: { flex: 1, paddingHorizontal: COLUMN.side, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: COLUMN.toLabel },
  problem: { marginTop: 24, alignItems: 'center', gap: 10 },
  skip: { marginTop: 20 },
});

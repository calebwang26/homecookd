// Grandma's recording screen (Caleb's v3): /recording?id=<recordingId>&source=glasses|phone[&kid&lang]
// (from Record's pre-record sheet). One big red record button in the middle of a warm peach screen,
// one line under it, and homie resting top-right, talking with her over the /record socket
// (lib/live/homie). Her language big, small English under it. Nothing else.
//   connecting, intro  homie says hello while the button rests ("homie is saying hello"). Then filming
//                      starts by itself; "Skip, start filming" starts it now (homie stops mid-line).
//                      Glasses (the MVP: start and stop are hers): one big button. "Tap to start" ->
//                      live.startFilming (no hello; homie only connects once filming, for its timed
//                      questions); then "I'm done" -> live.endRecording (no wrap-up questions). The laptop
//                      keeps glasses footage only between the two, and Home offers "Save to Photos".
//   recording          glasses: rings pulse out of the button; a tap is "I'm done" ("माझं झालं" / "Tap
//                      when you're done"). With homie's line down, that tap ends the recording through
//                      Convex (live.endRecording), so the glasses' video still goes. phone, filmed in
//                      the app (a build with VisionCamera, lib/live/camera): the back camera films at
//                      1080p into 5-minute files (components/record/useInAppCamera) while homie stays
//                      live: the mic and the /record socket stay open, a small still goes to homie
//                      every 5 s, and the camera card above the button shows the shot ("● 4:07"). The
//                      card shows from the hello on, so she can set the phone up. Beside it, a big
//                      flip-camera button ("कॅमेरा बदला" / "Flip camera", components/record/
//                      FlipCameraButton) swaps the back and the front camera at any time: before filming,
//                      while paused, after "I'm done", and while filming, where the flip ends the file,
//                      switches the camera and starts the next file on it (a gap of about a second that
//                      homie is told about; the mic is never touched while a file is written). It hides
//                      under homie's questions. The front camera's preview, video and plate photo are
//                      mirrored, like a selfie (CameraCard: VisionCamera's default; `false` stored them
//                      upside down). A camera that stops by itself (a
//                      flip that never comes up, a file that fails) never leaves the clock ticking:
//                      filming pauses with "The camera stopped. Your video so far is saved." and the
//                      button films again (components/record/filming.ts). Leaving the app (a
//                      lock, a call) finishes the file at once: "Recording stopped while you were away",
//                      the button films again, "I'm done" ends. The stop button finishes the last file
//                      and homie wraps up. Older builds (no VisionCamera, or no camera permission): the
//                      phone's own camera opens instead (homie waits, its socket closed); when the
//                      video is back, homie wraps up. No video: back to Record.
//   wrapping_up        homie's last questions and "Can Shreya hear your stories too?", then the plate photo
//                      when filmed in the app (components/record/PlateMoment: the camera card grows to the
//                      middle, one shutter with the flip button on its right, so she can turn to the front
//                      camera and hold the plate up; live.setCover), the thanks and the goodbye. The voice
//                      service holds homie big in the middle across the run of questions ({type:"hold"},
//                      homie.hold): from her "I'm done" (a live question up then stays up; homie thinks
//                      while the questions are written), through the count line ("Before we send it: two
//                      quick questions…"), to the last answer, homie never goes back to its corner between
//                      two questions; the words under it change in place. It goes back before the plate
//                      photo or the goodbye, or when the wrap-up stalls (the × then shows). An
//                      older service never holds: each question opens and closes on its own. If it stalls
//                      (nothing moves for 2 min, or 20 s after an error or a lost line), the app ends
//                      the recording itself; a phone video then sends anyway.
//   ended              the done view (components/record/DoneView): homie waves, the video goes, home.
// homie's questions come up as AskMoments: answered out loud, no buttons (a tap closes one; while homie is
// only held between questions, a tap does nothing). Live questions while filming are minutes apart (the
// service's pacing: 3.5 min, 90 s in its demo mode), so each opens and closes on its own.
// Glasses through the laptop bridge (glasses/BRIDGE.md): above the button, what the glasses see (about a
// frame a second), whether they're live, and the last step the live pass saw (components/record/GlassesView).
// If homie's connection is lost: the reason, "Try again" and the × (a phone recording can also film
// without homie; one already filmed goes straight to the done view and sends). The screen stays
// awake, and can't be swiped away once filming started.
// Dev aids (web screenshots only): ?preview=done shows the done view without sending; ?preview=ask
// shows a made-up question from homie as a phone with a microphone would (the listening bars);
// ?preview=camera filming in the app, ?preview=paused after she came back, ?preview=plate the plate
// photo (a kitchen picture stands in for the camera; the flip button only spins its icon), ?preview=wrapup
// the stub's whole wrap-up through the real hook (homie held across two questions and the opt-in, then
// the plate photo and the goodbye; a tap skips a question; &plate=0 without the plate photo, as filmed
// with the system camera; &lang=hi&kid=Shreya for her words).
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AskMoment } from '@/components/record/AskMoment';
import { BiLine } from '@/components/record/BiLine';
import { CameraCard, cameraSlotSize, type SlotFrame } from '@/components/record/CameraCard';
import { flipBeside, flipPlace, otherFacing, type Facing } from '@/components/record/cameraLogic';
import { DoneView } from '@/components/record/DoneView';
import { FLIP_SIZE, FlipCameraButton } from '@/components/record/FlipCameraButton';
import { GlassesView } from '@/components/record/GlassesView';
import { addClips, useDraft } from '@/components/record/draft';
import { PLATE_FLIP_SIDE, PlateControls, PlateDim } from '@/components/record/PlateMoment';
import { RecordButton } from '@/components/record/RecordButton';
import { momentView, recordingView, shouldAutoStart, wrapStallMs, type Ask } from '@/components/record/recordingLogic';
import { COLUMN, RecordWash } from '@/components/record/RecordWash';
import { useInAppCamera } from '@/components/record/useInAppCamera';
import { usePickVideos } from '@/components/record/usePickVideos';
import { recordWords, type Line } from '@/components/record/words';
import { ActionButton, CloseIcon, IconButton, useToast } from '@/components/ui';
import { useAiSpeaking, useHomieScreen, useHomieSlot } from '@/lib/homie/hooks';
import { inAppCameraSupported } from '@/lib/live/camera';
import { endRecording, setCover, startFilming, useLiveFrame, useLiveLog, useRecording } from '@/lib/live/convex';
import { STUB_NO_PLATE, STUB_WRAPUP_PREFIX, useHomieRecording } from '@/lib/live/homie';
import { useSession } from '@/lib/session';
import { saveUnsent } from '@/lib/unsentRecordings';
import { colors, motion, space } from '@/theme/tokens';

const AWAKE_TAG = 'homecookd-recording';
// A long one, so the preview shows the layout's worst case (an iPhone SE: homie goes up to fit it).
const PREVIEW_ASK: Ask = {
  promptId: 'preview',
  text: 'आजी, फोडणी करताना मोहरी तयार झाली हे तुम्हाला कसं कळतं, कढीपत्ता घालण्याआधी?',
  textEn: 'Aaji, when you make the tadka, how do you know the mustard seeds are ready, before the curry leaves go in?',
  kind: 'cue',
};
const PREVIEW_PLATE: Ask = { promptId: 'preview-plate', text: 'शेवटचं, आजी. ताट कॅमेऱ्यासमोर धरा, म्हणजे Shreya ला दिसेल ते कसं दिसतं.', textEn: 'Last thing, Aaji. Hold the plate up to the camera, so Shreya can see how it looks.', kind: 'plate' };
const PREVIEWS = ['done', 'ask', 'camera', 'paused', 'plate', 'wrapup'] as const;
const KITCHEN = require('@/components/record/tripod.jpg') as number;

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
  const params = useLocalSearchParams<{ id?: string; source?: string; kid?: string; lang?: string; preview?: string; plate?: string }>();
  const devPreview = __DEV__ && Platform.OS === 'web' ? (PREVIEWS.find((p) => p === params.preview) ?? null) : null;
  const previewCamera = devPreview === 'camera' || devPreview === 'paused' || devPreview === 'plate' || devPreview === 'ask' || devPreview === 'wrapup';
  // ?preview=wrapup: the stub voice service runs its wrap-up for this made-up recording (one per page load).
  const [wrapupId] = useState(() => `${STUB_WRAPUP_PREFIX}${params.plate === '0' ? STUB_NO_PLATE : ''}${Date.now()}`);
  const preview = devPreview === 'done';
  const id = devPreview ? null : params.id || null;
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const reduce = useReducedMotion();
  const draft = useDraft();
  const session = useSession();
  const pick = usePickVideos();
  const rec = useRecording(id);
  const glassesId = rec?.source === 'glasses' ? id : null;
  const liveLog = useLiveLog(glassesId);
  const liveFrame = useLiveFrame(glassesId);
  const steps = liveLog?.events.filter((e) => e.kind === 'step') ?? [];
  const lastStep = steps.length ? steps[steps.length - 1] : null;
  const source = rec?.source ?? (params.source === 'phone' || previewCamera ? 'phone' : 'glasses');
  const glasses = source === 'glasses';
  // A phone recording films in the app when this build has VisionCamera (else the system camera).
  const inAppPossible = source === 'phone' && !devPreview && inAppCameraSupported();
  // Glasses: filming is exactly what Convex says, set by her two taps.
  const glassesFilming = glasses && rec?.status === 'recording';
  // homie joins a glasses recording only once she has started it: no hello before her Start.
  const homie = useHomieRecording(
    glasses && !glassesFilming ? null : devPreview === 'wrapup' ? wrapupId : id,
    { language: params.lang || 'en', kidName: params.kid || undefined, dish: draft.dish ?? undefined },
    { camera: inAppPossible },
  );
  const lang = homie.info?.language ?? rec?.language ?? (params.lang || 'en');
  const words = useMemo(() => recordWords(lang), [lang]);
  const kid = homie.info?.kidName ?? (params.kid || null);
  const ended = homie.phase === 'ended' || rec?.status === 'ended' || rec?.status === 'abandoned';
  // A phone recording is over once its camera is back: homie only wraps up.
  const [phoneFilmed, setPhoneFilmed] = useState(false);
  const [starting, setStarting] = useState(false);
  const view =
    glasses && !ended
      ? glassesFilming
        ? { line: words.line('stop'), live: true }
        : { line: words.line(starting ? 'gettingReady' : 'tapToStart'), live: false }
      : devPreview === 'camera' || devPreview === 'ask'
        ? recordingView('recording', words)
        : recordingView(ended ? 'ended' : phoneFilmed && homie.phase === 'recording' ? 'wrapping_up' : homie.phase, words);

  // Filmed without homie (its connection was lost before filming): straight to the done view.
  const [filmedAlone, setFilmedAlone] = useState(false);
  // homie's goodbye has been said: the done view. Once shown it stays (it sends a phone recording
  // once, when it first shows). A phone video that is already filmed goes even if homie is lost.
  const aiSpeaking = useAiSpeaking();
  const [finished, setFinished] = useState(false);
  if (!finished && (preview || filmedAlone || (phoneFilmed && !!homie.error) || (ended && !aiSpeaking))) setFinished(true);

  // Filming in the app: the camera runs from the hello to the plate photo. The mic never starts or
  // stops while a file is being written (useInAppCamera); these callbacks say when it may.
  const cam = useInAppCamera({
    recordingId: id,
    on: inAppPossible && !finished,
    onFrame: homie.sendFrame,
    onPause: homie.pause,
    onResume: homie.resume,
    // Busy again only if filming goes on: after "I'm done" (doneInApp) the mic must be free to stop.
    beforeResume: async (goesOn) => {
      homie.cameraFilming(false);
      await homie.restartMic();
      if (goesOn()) homie.cameraFilming(true);
    },
    betweenFiles: async (goesOn) => {
      homie.cameraFilming(false);
      await homie.restartMic({ fresh: false });
      if (goesOn()) homie.cameraFilming(true);
    },
  });
  const inApp = inAppPossible && cam.usable === true;
  const camPaused = (inApp && cam.phase === 'paused') || devPreview === 'paused';
  // Paused because she left the app, or because the camera stopped by itself (filming.ts `trouble`).
  const pausedLine = words.line(inApp && cam.trouble ? 'cameraTrouble' : 'stopped');
  const plateAsk = devPreview === 'plate' ? PREVIEW_PLATE : homie.ask?.kind === 'plate' ? homie.ask : null;
  const [photo, setPhoto] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const [slot, setSlot] = useState<SlotFrame | null>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const slotSize = cameraSlotSize({ width: screenW, height: screenH }, COLUMN.side);
  const showCamera = !finished && (inApp || previewCamera);

  // homie's wrap-up that never finishes (the voice service stalled): the app ends the recording
  // itself. Any new phase, question or line is progress; an error or a lost line shortens the wait.
  // Not when another phone has taken this recording over: that one finishes it.
  const wrapping = !finished && !devPreview && homie.error !== 'elsewhere' && (phoneFilmed || homie.phase === 'wrapping_up');
  const trouble = homie.serverError || homie.error === 'lostConnection';
  const progress = `${homie.phase}|${homie.ask?.promptId ?? ''}|${homie.hold}|${aiSpeaking}`;
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
  const filming = previewCamera || (glasses ? glassesFilming : homie.phase === 'recording' || homie.phase === 'wrapping_up');
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !filming && !finished });
  }, [navigation, filming, finished]);

  // The corner pot hides while homie asks (it comes to the centre), for the plate photo (homie's words
  // fill the top) and on the done view.
  const [asking, setAsking] = useState(false);
  useHomieScreen({ hidden: asking || !!plateAsk || finished });
  const potSlot = useHomieSlot();

  // The flip-camera button: beside the card, beside the shutter for the plate photo, hidden under
  // homie's question. A flip while filming is a file boundary (useInAppCamera flip). The dev previews
  // only turn the icon (no camera on the web).
  const [previewFacing, setPreviewFacing] = useState<Facing>('back');

  // "I'm done" while filming in the app: homie wraps up while the last file is saved. A note on the
  // phone keeps the videos queued until Convex has the job and every file is uploaded; if the app dies
  // before that, the next launch sends them again (lib/unsentRecordings).
  const doneInApp = async () => {
    homie.done();
    const clips = await cam.stop();
    homie.cameraFilming(false);
    if (clips.length) {
      if (id && session.me) {
        const { dish, language, forKids, everyone, requestFrom } = draft;
        saveUnsent({ recordingId: id, cookId: session.me.id, familyId: session.family?.id ?? null, clips, dish, language, forKids, everyone, requestFrom });
      }
      addClips(clips, { dish: draft.dish, requestFrom: draft.requestFrom });
      setPhoneFilmed(true);
    } else {
      toast.show('That didn’t record a video. Try again.', { tone: 'error' });
      leave();
    }
  };

  // The plate photo: a still from the camera, shown in the card, sent as the cover in the background.
  const shootPlate = async () => {
    if (shooting || photo) return;
    if (devPreview) {
      setPhoto(Image.resolveAssetSource?.(KITCHEN)?.uri ?? null);
      if (devPreview === 'wrapup') homie.plateDone(true);
      return;
    }
    setShooting(true);
    const uri = await cam.still();
    setShooting(false);
    if (!uri) {
      toast.show('The photo didn’t work. Try again.', { tone: 'error' });
      return;
    }
    setPhoto(uri);
    homie.plateDone(true);
    if (id) void setCover(id, uri);
  };
  const skipPlate = () => {
    if (!devPreview || devPreview === 'wrapup') homie.plateDone(false);
  };

  // A phone recording on an older build: the system camera films; homie waits with its socket closed.
  const film = homie.filmWithPhone;
  const record = pick.record;
  const filmOnPhone = useCallback(async () => {
    const ok = await film(() => record({ dish: draft.dish, requestFrom: draft.requestFrom }));
    if (ok) setPhoneFilmed(true);
    else leave(); // no video: back to Record
  }, [film, record, draft.dish, draft.requestFrom]);
  const filmOnPhoneRef = useRef(filmOnPhone);
  useEffect(() => {
    filmOnPhoneRef.current = filmOnPhone;
  });

  // Filming in the app: start on the server, then the camera; if the camera won't start, the system camera.
  const filmInApp = useCallback(async () => {
    const ok = await homie.filmInApp(() => {
      homie.cameraFilming(true);
      return cam.start();
    });
    if (ok) return;
    homie.cameraFilming(false);
    toast.show('The camera didn’t start here. Opening the phone’s camera.', { tone: 'info' });
    await filmOnPhoneRef.current();
  }, [homie, cam, toast]);

  // Filming starts by itself once homie's hello has played (once).
  const started = useRef(false);
  // Glasses never start by themselves: her Start does it.
  // In the app it waits for her answer to the camera and microphone prompts.
  const camAsking = inAppPossible && cam.usable === null;
  const autoStart = !glasses && !camAsking && shouldAutoStart({ phase: homie.phase, introDone: homie.introDone, aiSpeaking, error: !!homie.error });
  const begin = useRef(() => {});
  useEffect(() => {
    begin.current = source === 'glasses' ? homie.start : inApp ? () => void filmInApp() : () => void filmOnPhone();
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

  // Glasses: her two taps. Start -> filming (live.startFilming); I'm done -> ended (live.endRecording).
  const startGlasses = async () => {
    if (!id || starting) return;
    setStarting(true);
    const ok = await startFilming(id).catch(() => false);
    if (!ok) {
      setStarting(false);
      toast.show('Couldn’t start. Check the connection and try again.', { tone: 'error' });
    }
  };
  const [stopping, setStopping] = useState(false);
  const stopGlasses = async () => {
    if (!id || stopping) return;
    setStopping(true);
    const ok = await endRecording(id);
    if (!ok) {
      setStopping(false);
      toast.show('Couldn’t stop. Check the connection and try again.', { tone: 'error' });
    }
  };
  const press = () => {
    if (devPreview) return;
    if (camPaused) return void cam.resume();
    if (inApp && cam.phase === 'filming') return void doneInApp();
    if (!glasses) return homie.done();
    void (glassesFilming ? stopGlasses() : startGlasses());
  };

  const filmWithoutHomie = async () => {
    started.current = true;
    if (await pick.record({ dish: draft.dish, requestFrom: draft.requestFrom })) setFilmedAlone(true);
  };

  const flipAt = flipPlace({ camera: showCamera, twoCameras: previewCamera || cam.twoCameras, asking, plate: !!plateAsk, photo: !!photo });
  const flipCamera = () => {
    if (devPreview) setPreviewFacing((f) => otherFacing(f));
    else void cam.flip();
  };
  const flipButton = (onDark: boolean, width?: number) => (
    <FlipCameraButton
      label={words.line('flipCamera')}
      facing={devPreview ? previewFacing : cam.facing}
      disabled={shooting || (!devPreview && !cam.canFlip)}
      onPress={flipCamera}
      onDark={onDark}
      width={width}
    />
  );
  // Beside the card, and clear of homie's corner pot (on a small phone the two would read as a pair).
  const beside = slot ? flipBeside(slot, screenW, FLIP_SIZE, potSlot) : null;

  const error = homie.error ? words.line(homie.error) : null;
  const micOff = homie.micDenied ? words.line('micOff') : null;
  const showClose = !!homie.error || (!filming && !finished) || (stalled && !finished);
  const beforeFilming = !previewCamera && (homie.phase === 'connecting' || homie.phase === 'intro');

  return (
    <View style={styles.page}>
      <RecordWash />
      {finished ? (
        <DoneView source={source} lang={lang} kidName={kid} preview={!!devPreview} />
      ) : (
        <>
          <View style={styles.column}>
            {glassesFilming && !devPreview ? (
              <GlassesView frame={liveFrame} filming={view.live} lastStep={lastStep?.title ?? null} steps={steps.length} />
            ) : null}
            {showCamera ? (
              <View
                style={[styles.cameraSlot, slotSize]}
                onLayout={(e) => {
                  const { x, y, width, height } = e.nativeEvent.layout;
                  if (!slot || slot.x !== x || slot.y !== y || slot.width !== width) setSlot({ x, y, width, height });
                }}
              />
            ) : null}
            <RecordButton
              live={view.live && !camPaused}
              resume={camPaused}
              disabled={glasses ? !id || ended || (starting && !glassesFilming) || stopping : !(view.live || camPaused) || !!pick.busy}
              onPress={press}
              accessibilityLabel={camPaused ? 'Keep filming' : view.live ? 'Recording. Tap when you’re done.' : view.line.en ?? view.line.text}
            />
            <Animated.View key={camPaused ? pausedLine.text : view.line.text} entering={FadeIn.duration(reduce ? motion.reducedFadeMs : 220)} style={styles.label}>
              <BiLine line={camPaused ? pausedLine : view.line} size={camPaused ? 24 : 30} weight={700} enSize={15} leading={1.3} />
            </Animated.View>
            {camPaused ? (
              <View style={styles.skip}>
                <ActionButton label={both(words.line('imDone'))} variant="outline" size="sm" onPress={() => {
                    if (!devPreview) void doneInApp();
                  }} />
              </View>
            ) : null}
            {source === 'phone' && beforeFilming && !homie.error && !skipped && !camAsking ? (
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
          {showCamera ? <PlateDim on={!!plateAsk} /> : null}
          {showCamera ? (
            <CameraCard cam={cam} attach={cam.setCamera} slot={slot} big={!!plateAsk} side={COLUMN.side} photo={photo} standIn={previewCamera ? KITCHEN : null} />
          ) : null}
          {flipAt === 'card' && beside ? (
            <Animated.View entering={FadeIn.duration(reduce ? motion.reducedFadeMs : 220)} style={[styles.flip, beside]}>
              {flipButton(false, beside.width)}
            </Animated.View>
          ) : null}
          {showCamera ? (
            <PlateControls
              ask={plateAsk}
              words={words}
              taken={!!photo}
              busy={shooting || cam.flipping}
              onShoot={() => void shootPlate()}
              onSkip={skipPlate}
              flip={flipAt === 'shutter' ? flipButton(true, PLATE_FLIP_SIDE) : null}
            />
          ) : null}
          <AskMoment
            view={momentView({ ask: devPreview === 'ask' ? PREVIEW_ASK : homie.ask, hold: homie.hold, said: homie.said, ended, stalled })}
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
  cameraSlot: { marginBottom: 28 },
  flip: { position: 'absolute', alignItems: 'center' },
});

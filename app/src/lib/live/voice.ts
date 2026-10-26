// Tracks B + E boundary: voice cooking over the live voice service's WebSocket (docs/build/STACK.md
// "App ↔ voice service" and "kid cooking additions"): wss://<voice>/cook?session=<sessionToken>&recipe=<recipeId>.
//
//   const voice = useVoiceCooking({ libraryId, step, cookName, auto, onGoTo, onClip, onOffer, onOfferClosed, onHeard });
//   voice.status          'off' | 'connecting' | 'listening' (the line is open) | 'error'
//   voice.live            the real service is on the line: chips go to it (else they act on their own)
//   voice.unavailable     no line will read for the kid: auto start gave up (no service, a dish Convex
//                         doesn't know, 4404), or the line failed for good (the phone reads instead)
//   voice.active          homie is on (a tap, or a step line's 8 s window): the mic streams
//   voice.kidTalking      the kid is mid-sentence ("Ask Grandma anything" never closes then)
//   voice.listening       the recorder really runs (the pot's listening); voice.hearing: the kid can
//                         answer a yes-or-no out loud for as long as it's up (on by a tap)
//   voice.muted           the mic can't work here (refused, or it failed to start): a tap tries again
//   voice.timers          kitchen timers the service set, soonest first; this phone counts them down
//                         (ids are per socket: one from before a pause keeps going and leaves on its own),
//                         and each buzzes once, at its zero here or the service's timer_done, whichever is first
//   voice.askedAt         when a question last went to the cook ("I asked Grandma"); askedIds: which ones
//   voice.toggle()        a tap on homie: on, or off again (opens the line first if it isn't open)
//   voice.stop()          hangs up
//   voice.command('back', fallback)  says it to homie as text; `fallback` runs when nobody is on the line,
//                                    or nothing comes back within 1.5 s (an older service)
//   voice.sendText('yes')            words for homie, as if the kid said them
//   voice.setMoment('answer' | null) an app-only moment is up on the phone ({ type: "moment" }; the
//                                    service then never takes its yes or no for its own offer); 'ask'
//                                    ("Ask Grandma anything") also holds the mic on until it closes
//   voice.setHold(on)                the cook's own voice is playing (her clip, her voice note): homie's
//                                    next line waits until she's done, so it never talks over her
//   voice.setVideo(on, kid)          any video (or the cook's voice) is playing: the service is told
//                                    ({ type: "video" }) and holds what it would say on its own, and a
//                                    line of that kind already on its way waits here too (voiceLogic
//                                    waitsForVideo). Answers to the kid still play (they pause the video).
//                                    `kid`: a video the kid started (not her clip): it has the sound.
// homie and a video hand the sound to each other (Caleb, Oct 25): a tap on homie while a video plays
// fades the video out and pauses it (lib/media), turns homie on and sends { type: "tap" }, so the
// service says the step's short line at once (the pot lights now), then homie listens. A video the
// kid starts while homie talks, listens or thinks fades homie's voice out (lib/media useClipVideo) and
// turns homie off; an answer or a clip of hers still on its way is dropped, and the lines homie says
// on its own still wait for the video (voiceLogic dropsForKidVideo). Her clip homie played doesn't
// turn homie off. The iOS session: audio-studio deactivates it whenever the recorder starts or stops,
// which stops whatever plays. So a video waits at lib/media's gate (videoGate) for the recorder to stop
// (after homie's voice has faded), the recorder starts only once a video has paused, and homie's line
// waits for a start or stop under way (voiceLogic lineMayStart).
// homie on or off (Caleb, Oct 24: no always-on mic; voiceLogic micAfter, micTimer): a tap toggles what
// the kid sees. On a quiet pot it turns homie on (the recorder starts and streams) until the next tap,
// or a minute with no word from the kid; on a listening or thinking pot it turns homie off (the
// recorder stops: no frames, no Ink credits), and a step line still playing then opens no window.
// When a step line or a nudge has played, the mic listens for 8 s of really hearing (no app sound);
// the kid's words (two or more) keep it for that turn, which closes once homie's first answer is over,
// and the window and its turn end 20 s after it opened whatever is still talking (a TV). At the 8 s
// mark a kid mid-sentence (the mic loud just now, or Ink's words still coming) gets up to 3 s more,
// so Ink hears the end. The line stays open either way, so step lines still arrive; the service closes
// its Ink stream after 2 min without audio and opens it again with the next frame (voice/src/ink.ts).
// Half duplex is lib/live/mic's: while the app makes sound, its frames are zeroed, and none of those
// reach the socket (Cartesia's Ink bills every second it gets, silence too; voiceLogic cookSendsFrame).
// The app in the background (AppState; not iOS 'inactive', still on screen) closes the line and turns
// homie off, and back on top the line opens again, homie still off (voiceLogic appStateStep). One
// socket at a time: a retry or a connect from before a hang-up never opens one after it (voiceLogic
// lineMayOpen), and only the current socket is heard.
// The read-aloud offer (onOffer): `accept` sends "yes", `decline` sends "no" (that visit, steps change
// silently); the service's { type: "offer_closed", accepted } goes to onOfferClosed.
//
// The screen follows the server: go_to_step moves the step, play_clip plays that moment of the cook's
// video (with her words, `quote` / `quoteEn`, for a caption), and a step the kid taps goes back as
// { type: "step" } (the service then says that step's short line); a step her clip moved the screen to
// goes with read: false, so no line plays over her and her translation still comes. On `ready` the
// screen's step goes back too, and the service's own go_to_step right after it (the step it saved
// last) is not followed: the step on screen is the truth.
// homie shows the rest (lib/homie): listening while homie is on and the mic's frames really go out
// (not while the app makes sound: they're zeroed then; the steam follows the kid's voice), thinking
// from what the kid said to homie's answer, lit while homie's line arrives (at least a beat)
// and speaking while it plays, labelled "AI voice" ("Translated from Grandma", "AI hint"), and the ring
// while a timer runs. Neither what the kid said nor homie's words are shown: homie only talks. Its
// offers (read the steps aloud, hear a story) go to `onOffer`, which shows a moment or answers from a
// choice this phone remembers ('skip' drops that line's audio). The service echoes every text it gets
// as a finished transcript: that echo is the chip's answer, and it never reaches onHeard as the kid's.
// `auto` opens the line on its own, quietly, with homie off: only with the voice service set and a dish
// Convex knows. A line opened by a tap without a real service talks to a local stub
// (lib/live/voiceStub); for a real socket on the laptop: app/scripts/pcm-echo-server.mjs. Another screen
// on top turns homie off; leaving the screen hangs up (and drops any line of homie's still arriving).
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import { hasAiConsent } from '@/lib/aiConsent';
import { sayPhase } from '@/lib/homie/logic';
import { doneSpeaking, getHomie, LIT_BEAT_MS, setHomie, setHomieLevel, useHomieSelect } from '@/lib/homie/store';
import { audioFaded, audioNow, HANDOFF_FADE_MS, kidVideoPlaying, pauseAllVideos, setVideoGate, VIDEO_GATE_MAX_MS, videoPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';

import { convexRecipeId, convexSession } from './convex';
import { useMicStream } from './mic';
import { playSay, stopSay } from './say';
import {
  answersTap,
  appInForeground,
  appStateStep,
  cookPotState,
  cookSendsFrame,
  DECLINE_TEXT,
  dropsForKidVideo,
  echoAt,
  edgeWait,
  endSay,
  endsThinking,
  hearsAnswers,
  holdAfterTap,
  HOMIE_ACTIONS,
  KID_QUIET_MS,
  lineMayOpen,
  lineMayStart,
  micAfter,
  micTimer,
  micWanted,
  momentMessage,
  offerClosed,
  offerOf,
  opensWindow,
  parseTimer,
  sayKind,
  sayLabel,
  sentText,
  saysOnTap,
  SPEECH_LEVEL,
  stepMessage,
  TAP_LINE_WAIT_MS,
  TAP_MESSAGE,
  thinksAfter,
  timerBuzz,
  timerDone,
  turnWords,
  videoMessage,
  waitsForVideo,
  withTimer,
  type AppMomentKind,
  type CookTimer,
  type MicEvent,
  type MicHold,
  type OfferKind,
  type SayKind,
  type SentText,
} from './voiceLogic';
import { stubSocket, type Socket } from './voiceStub';

const VOICE_URL = (process.env.EXPO_PUBLIC_VOICE_URL ?? '').trim().replace(/\/$/, '');
/** The voice service is set in this build (cook mode starts voice on its own only then). */
export const VOICE_CONFIGURED = !!VOICE_URL;
/** No say_end within this long after the last audio frame = the reply is complete. */
const SAY_GAP_MS = 400;
const RETRIES = 3;
/** A chip's words get an answer (an echo, a step, a clip, a line) within this, or the chip acts on its own. */
const COMMAND_WAIT_MS = 1500;
/** 'thinking' ends on its own if homie never answers what the kid said. */
const THINKING_MAX_MS = 10_000;
/** A timer that buzzed stays on screen ("Done") this long, unless the service's timer_done comes after the buzz. */
const TIMER_DUE_HOLD_MS = 10_000;
/** The service's go_to_step to its saved step comes right after `ready`. */
const RESTORE_MS = 3000;
const ECHOES_KEPT = 8;
/** How often homie's next line checks again for a recorder start or stop under way (lineMayStart). */
const MIC_POLL_MS = 25;

type ServerMsg =
  | { type: 'ready' }
  | { type: 'transcript'; text: string; final?: boolean }
  | { type: 'go_to_step'; stepOrder: number }
  | { type: 'play_clip'; startS: number; endS: number; quote?: string; quoteEn?: string }
  | { type: 'say'; text: string; kind?: string; textEn?: string; ai: true; translation?: boolean; audio?: { sampleRate?: number }; sampleRate?: number }
  | { type: 'say_end'; interrupted?: boolean }
  | { type: 'asked_cook'; questionId: string }
  | { type: 'timer'; id: string; seconds: number; label?: string }
  | { type: 'timer_done'; id: string }
  | { type: 'offer_closed'; accepted?: boolean }
  | { type: 'quiet' }
  | { type: 'error'; message?: string };

type PendingSay = {
  kind: SayKind;
  chunks: ArrayBuffer[];
  rate: number;
  translation: boolean;
  label?: string;
  drop: boolean;
  at: number;
  gap: ReturnType<typeof setTimeout> | null;
  /** An offer that came while a video played: shown once the line may play (true: the phone answers it, skip the audio). */
  offer?: () => boolean;
};

export type VoiceStatus = 'off' | 'connecting' | 'listening' | 'error';
export type VoiceClip = { startS: number; endS: number; quote?: string; quoteEn?: string };
/**
 * homie's offer, and how to answer it for the kid: `accept` says yes; `decline` says no to the
 * read-aloud offer. `hearing`: the kid can answer it out loud right now.
 */
export type VoiceOffer = { kind: OfferKind; text: string; hearing: boolean; accept: () => void; decline: () => void };

export type VoiceOptions = {
  libraryId: string | null;
  step: number;
  cookName: string;
  /** Open the line on its own (cook mode, once per visit), and give up quietly when it can't. */
  auto?: boolean;
  onGoTo: (n: number) => void;
  /** Plays her clip; returns the step it shows (a step the clip moved to is sent with read: false). */
  onClip: (clip: VoiceClip) => number | void;
  /** 'skip' drops the offer's audio (the phone already knows the answer). */
  onOffer?: (offer: VoiceOffer) => 'play' | 'skip';
  /** The service closed its read-aloud offer: true, it reads now; false, it was declined. */
  onOfferClosed?: (accepted: boolean) => void;
  /** Every line homie says, by kind (after onOffer); `tap`: the line a tap on homie asked for. */
  onSay?: (kind: SayKind, line: { tap: boolean }) => void;
  /** What the kid finished saying (answers or closes a moment). Never the phone's own texts. */
  onHeard?: (text: string) => void;
};

export function useVoiceCooking(opts: VoiceOptions) {
  const { me } = useSession();
  const focused = useIsFocused();
  const [status, setStatus] = useState<VoiceStatus>('off');
  const [live, setLive] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [muted, setMutedState] = useState(false);
  // Why the mic is on (voiceLogic MicHold): the ref is read at once, the state drives the pot and timers.
  const [micHold, setMicHoldState] = useState<MicHold>('off');
  const micHoldRef = useRef<MicHold>('off');
  // The recorder really started (the pot shows listening only then).
  const [listening, setListening] = useState(false);
  // The kid is mid-sentence (partial transcripts of 2+ words are arriving): a window holds for the turn.
  const [kidTalking, setKidTalking] = useState(false);
  const kidTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // This window's first finished words came (later ones never hold its turn), and a count of the kid's
  // finished words (each one restarts a tapped-on homie's idle minute).
  const [heardFinal, setHeardFinal] = useState(false);
  const [finals, setFinals] = useState(0);
  // When the window opened (its turn's cap counts from here); when the mic was last loud (the kid
  // talking, for the window's edge); when Ink's last partial came with no final since (0: none).
  const windowAt = useRef(0);
  const loudAt = useRef(0);
  const wordsAt = useRef(0);
  // A video or her voice plays (VoiceHold): with homie's own lines, the app is making sound, and the mic's
  // frames are all zeroed then.
  const [videoState, setVideoState] = useState(false);
  // homie's lit / speaking beat (any line): a window's count pauses for it, and a step line's end opens one.
  const talking = useHomieSelect((h) => h.state === 'lit' || h.state === 'speaking');
  // A step line is playing: when homie goes quiet after it, the mic listens for a while.
  const stepLine = useRef(false);
  const [thinking, setThinking] = useState(false);
  const [timers, setTimers] = useState<CookTimer[]>([]);
  // Counted up on each timer's buzz: the pot and the wait for the next timer follow it.
  const [buzzes, setBuzzes] = useState(0);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [askedIds, setAskedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<{ text: string; at: number } | null>(null);
  const [foreground, setForeground] = useState(() => appInForeground(AppState.currentState));

  const sock = useRef<Socket | null>(null);
  const want = useRef(false);
  // Bumped by each hang-up (stop): a retry or a connect from before it never opens a socket (lineMayOpen).
  const line = useRef(0);
  const retries = useRef(0);
  // Counted up on each socket's open: timer ids are per socket (the service starts again at "timer-1").
  const socketNo = useRef(0);
  // The recorder is wanted now (voiceLogic micWanted): frames go out only meanwhile.
  const micOn = useRef(false);
  const mutedRef = useRef(false);
  const liveRef = useRef(false);
  const hold = useRef(false);
  // A video (or her voice) is playing: lines homie says on its own wait (waitsForVideo).
  const videoOn = useRef(false);
  // VoiceHold's last word on a video the kid started (lib/media kidVideoPlaying): its start turns homie off.
  const kidSaid = useRef(false);
  // When the app last sent { type: "tap" } (0: its line came): that line isn't a yes to reading aloud.
  const tapAt = useRef(0);
  // The app-only moment up on the phone (the service hears about it, and again on a new socket).
  const appMoment = useRef<AppMomentKind | null>(null);
  const focusedRef = useRef(focused);
  const autoTried = useRef(false);
  // The line closed because the app left the foreground: it opens again when the app is back.
  const paused = useRef(false);
  // How the line was last opened (on its own or by the kid), for opening it again the same way.
  const lineAuto = useRef(false);
  // Bumped by each answer from the service (an echo, a step, a clip, a line, a timer): a chip's fallback checks it.
  const answers = useRef(0);
  const reconnect = useRef<((auto: boolean) => Promise<void>) | null>(null);
  const pending = useRef(new Set<ReturnType<typeof setTimeout>>());
  // The timers that buzzed here, by id: each buzzes once (voiceLogic timerBuzz, timerDone).
  const buzzed = useRef<Set<string>>(new Set());
  // The timers as this hook last set them (the state follows): timer_done reads them at once.
  const timerList = useRef<CookTimer[]>([]);
  // The step the server just moved us to: not echoed back as a kid's tap.
  const lastServerStep = useRef<number | null>(null);
  // The step her clip just moved the screen to: sent with read: false (no step line over her).
  const fromClip = useRef<number | null>(null);
  // When `ready` came (0: not restoring): the service's go_to_step right after it isn't followed.
  const restoring = useRef(0);
  // Texts this phone sent that the service hasn't echoed yet.
  const echoes = useRef<SentText[]>([]);
  // Lines the service started (say) and hasn't ended (say_end) yet.
  const openSays = useRef(0);
  const say = useRef<PendingSay | null>(null);
  // A whole line that arrived while the cook's own voice played: it plays once she's done.
  const waiting = useRef<PendingSay | null>(null);
  const beat = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The line in that beat (while `beat` is set).
  const beatSay = useRef<PendingSay | null>(null);
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(opts);
  const meId = useRef(me?.id);
  useEffect(() => {
    cb.current = opts;
    meId.current = me?.id;
    focusedRef.current = focused;
  });

  // Only the kid's own frames go out, while homie is on: none while the app makes sound (lib/live/mic
  // `quiet`), and none while another screen is on top or after homie went off, until the recorder stops.
  const mic = useMicStream(
    (pcm, quiet) => {
      const s = sock.current;
      if (!s || s.readyState !== 1 || !cookSendsFrame({ quiet, focused: focusedRef.current, active: micOn.current })) return;
      s.send(pcm);
    },
    (level) => {
      if (level >= SPEECH_LEVEL) loudAt.current = Date.now();
      setHomieLevel(focusedRef.current && micOn.current ? level : 0);
    },
  );
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  });
  // The recorder as this hook last left it, and a start or stop still under way (one at a time).
  const recording = useRef(false);
  const micBusy = useRef(false);

  /**
   * Starts or stops the recorder to match voiceLogic micWanted. One call at a time: a start or stop
   * under way checks again when it's done. A mic that's refused (or fails) turns homie off, and the
   * line stays open (step lines still play); a tap tries again.
   */
  const syncMic = useCallback(function sync() {
    // A video about to play counts at once (lib/media sets its playhead before the gate lets it sound).
    const video = videoOn.current || videoPlaying();
    const on = micWanted({ hold: micHoldRef.current, open: sock.current?.readyState === 1, focused: focusedRef.current, muted: mutedRef.current, video });
    micOn.current = on;
    if (!on) setHomieLevel(0);
    if (micBusy.current) return;
    if (on === recording.current) return setListening(on);
    micBusy.current = true;
    if (!on) {
      setListening(false);
      // The stop deactivates the iOS session (audio-studio), which would cut homie's voice off mid-fade.
      void audioFaded()
        .then(() => micRef.current.stop())
        .finally(() => {
          recording.current = false;
          micBusy.current = false;
          sync();
        });
      return;
    }
    void micRef.current.start().then((r) => {
      micBusy.current = false;
      if (r === 'ok') {
        recording.current = true;
        return sync();
      }
      micOn.current = false;
      mutedRef.current = true;
      setMutedState(true);
      micHoldRef.current = 'off';
      setMicHoldState('off');
      if (r === 'denied') setError({ text: 'To talk to homie, turn on the microphone for homecookd in Settings.', at: Date.now() });
    });
  }, []);

  /** homie on or off (voiceLogic micAfter, or 'off' when the line or the screen goes); the recorder follows. */
  const setMicHold = useCallback(
    (next: MicHold) => {
      if (micHoldRef.current !== next) {
        micHoldRef.current = next;
        setMicHoldState(next);
      }
      syncMic();
    },
    [syncMic],
  );
  const micEvent = useCallback(
    (e: MicEvent) => {
      const next = micAfter(micHoldRef.current, e);
      // A fresh window: its cap counts from now, and its first finished words are still to come.
      if (e === 'step_line_end' && next === 'window') {
        windowAt.current = Date.now();
        setHeardFinal(false);
      }
      setMicHold(next);
    },
    [setMicHold],
  );

  /** The kid's partial words: they're mid-sentence until the turn ends, or KID_QUIET_MS without more. */
  const kidSpeaks = useCallback(
    (on: boolean) => {
      if (kidTimer.current) clearTimeout(kidTimer.current);
      kidTimer.current = on ? setTimeout(() => setKidTalking(false), KID_QUIET_MS) : null;
      setKidTalking(on);
    },
    [],
  );

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      pending.current.delete(t);
      fn();
    }, ms);
    pending.current.add(t);
  }, []);

  const changeTimers = useCallback((next: (list: CookTimer[]) => CookTimer[]) => {
    timerList.current = next(timerList.current);
    setTimers(timerList.current);
  }, []);

  /** A timer's one buzz (its zero here, or the service's timer_done first): the haptic, "Done", and it leaves a little later. */
  const buzzTimer = useCallback(
    (id: string) => {
      if (buzzed.current.has(id)) return;
      buzzed.current.add(id);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setBuzzes((n) => n + 1);
      later(() => changeTimers((list) => list.filter((x) => x.id !== id)), TIMER_DUE_HOLD_MS);
    },
    [later, changeTimers],
  );

  const think = useCallback((on: boolean) => {
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    thinkTimer.current = on ? setTimeout(() => setThinking(false), THINKING_MAX_MS) : null;
    setThinking(on);
  }, []);

  /**
   * The lit beat before homie's voice (even when the line arrived at once), then the line, once no
   * recorder start or stop is under way (voiceLogic lineMayStart: it changes the iOS session).
   */
  const speakNow = useCallback((s: PendingSay) => {
    const beatEnd = s.at + LIT_BEAT_MS;
    const play = () => {
      if (!lineMayStart({ micBusy: micBusy.current, since: beatEnd, now: Date.now() })) {
        beat.current = setTimeout(play, MIC_POLL_MS);
        return;
      }
      beat.current = null;
      if (opensWindow(s.kind)) stepLine.current = true;
      setHomie({ state: 'speaking', label: s.label });
      if (!playSay(s.chunks, s.rate, s.translation)) doneSpeaking();
    };
    beatSay.current = s;
    const wait = beatEnd - Date.now();
    if (wait > 0) beat.current = setTimeout(play, wait);
    else play();
  }, []);

  /** Resolves once no recorder start or stop is under way, or after `ms`. */
  const micIdle = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const until = Date.now() + ms;
        const check = () => (!micBusy.current || Date.now() >= until ? resolve() : void setTimeout(check, MIC_POLL_MS));
        check();
      }),
    [],
  );

  /** Her voice holds every line; a video holds the ones homie says on its own. */
  const waits = useCallback((s: PendingSay) => hold.current || (videoOn.current && waitsForVideo(s.kind)), []);

  /** A line that may play now: its offer (if it waited for a video) shows first, then the line. */
  const begin = useCallback(
    (s: PendingSay, waited: boolean) => {
      const offer = s.offer;
      s.offer = undefined;
      if (offer?.()) return waited ? undefined : doneSpeaking();
      if (waited) {
        s.at = Date.now();
        setHomie({ state: 'lit', label: s.label });
      }
      speakNow(s);
    },
    [speakNow],
  );

  const flushSay = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (!s) return;
    if (s.gap) clearTimeout(s.gap);
    if (s.drop) return;
    if (!s.chunks.length) return doneSpeaking();
    if (!waits(s)) return begin(s, false);
    // Her voice or a video is playing: this line waits (the newest one only).
    waiting.current = s;
    doneSpeaking();
  }, [waits, begin]);

  /**
   * The waiting line, once nothing holds it any more and no line of homie's is playing or in its lit
   * beat (an answer that paused the video, the line a tap on homie asked for).
   */
  const release = useCallback(() => {
    const s = waiting.current;
    const now = audioNow();
    if (!s || waits(s) || beat.current || sayPhase(now.key, now.phase) !== 'none') return;
    waiting.current = null;
    begin(s, true);
  }, [waits, begin]);

  /** Cuts off homie's line: still arriving, in its lit beat, waiting for her, or playing. */
  const dropSay = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (s?.gap) clearTimeout(s.gap);
    if (beat.current) clearTimeout(beat.current);
    beat.current = null;
    waiting.current = null;
    stepLine.current = false;
    stopSay();
    doneSpeaking();
  }, []);

  const sendText = useCallback((text: string): boolean => {
    const s = sock.current;
    if (!s || s.readyState !== 1) return false;
    s.send(JSON.stringify({ type: 'text', text }));
    echoes.current = [...echoes.current, sentText(text, Date.now())].slice(-ECHOES_KEPT);
    return true;
  }, []);

  const sendStep = useCallback((stepOrder: number, read = true) => {
    const s = sock.current;
    if (s?.readyState === 1) s.send(JSON.stringify(stepMessage(stepOrder, read)));
  }, []);

  const onMessage = useCallback(
    (data: unknown) => {
      if (data instanceof ArrayBuffer) {
        const s = say.current;
        if (!s || s.drop) return;
        s.chunks.push(data);
        if (s.gap) clearTimeout(s.gap);
        s.gap = setTimeout(flushSay, SAY_GAP_MS);
        return;
      }
      let m: ServerMsg;
      try {
        m = JSON.parse(String(data)) as ServerMsg;
      } catch {
        return;
      }
      if (!m || typeof m.type !== 'string') return;
      const restore = m.type === 'go_to_step' && restoring.current > 0 && Date.now() - restoring.current < RESTORE_MS;
      if (m.type !== 'ready') restoring.current = 0;
      // A new say cuts off the one before it; a clip drops it (the service aborted it); homie doing
      // something else ends the reply's audio (the kid's words arriving meanwhile don't).
      const acts = HOMIE_ACTIONS.has(m.type);
      if (m.type === 'say') {
        if (say.current?.gap) clearTimeout(say.current.gap);
        if (beat.current) clearTimeout(beat.current);
        beat.current = null;
      } else if (m.type === 'play_clip') dropSay();
      else if (acts && say.current) flushSay();
      if (acts || m.type === 'say') answers.current += 1;
      if (endsThinking(m.type)) think(false);

      if (m.type === 'ready') {
        restoring.current = Date.now();
        sendStep(cb.current.step);
      } else if (m.type === 'transcript') {
        if (!m.text) return;
        // The kid is mid-sentence: a step line's window holds for the turn (Ink needs the audio after
        // they stop to end it). A word or two ("um", a TV's stray word) never does, but a window's end
        // still waits for Ink to finish it. An older service sends only finished turns, without `final`.
        if (m.final === false) {
          wordsAt.current = Date.now();
          if (!turnWords(m.text)) return;
          kidSpeaks(true);
          return micEvent('heard');
        }
        wordsAt.current = 0;
        answers.current += 1;
        const echo = echoAt(echoes.current, m.text, Date.now());
        // homie thinks only when an answer is on its way: never for this phone's own text (a tapped
        // "no" gets none), nor a yes or no the service holds or answers with silence.
        if (thinksAfter({ echo: echo >= 0, appMoment: !!appMoment.current, asking: appMoment.current === 'ask', momentUp: !!getHomie().moment, text: m.text })) think(true);
        if (echo >= 0) {
          // This phone's own text: never the kid's words.
          echoes.current = echoes.current.filter((_, i) => i !== echo);
          return;
        }
        kidSpeaks(false);
        setHeardFinal(true);
        setFinals((n) => n + 1);
        micEvent('heard');
        cb.current.onHeard?.(m.text);
      } else if (m.type === 'go_to_step') {
        if (restore) {
          // The service starts at the step it saved last; the screen's step (sent on ready) wins.
          if (m.stepOrder !== cb.current.step) sendStep(cb.current.step);
          return;
        }
        lastServerStep.current = m.stepOrder;
        cb.current.onGoTo(m.stepOrder);
      } else if (m.type === 'play_clip') {
        // From a turn still on its way when the kid started a video: the kid's video keeps the sound
        // (voiceLogic dropsForKidVideo). The service's own wait for the clip ends with a tap or a step.
        if (dropsForKidVideo('clip', kidVideoPlaying())) return;
        const shows = cb.current.onClip({ startS: m.startS, endS: m.endS, quote: m.quote || undefined, quoteEn: m.quoteEn || undefined });
        if (typeof shows === 'number' && shows !== cb.current.step) fromClip.current = shows;
      } else if (m.type === 'say') {
        openSays.current += 1;
        const kind = sayKind(m);
        const text = typeof m.text === 'string' ? m.text : '';
        const offer = offerOf(kind, text);
        const answer = { accept: () => void sendText('yes'), decline: () => void sendText(DECLINE_TEXT) };
        const hearing = () => hearsAnswers({ live: liveRef.current, hold: micHoldRef.current, listening: recording.current && micOn.current });
        const ask = () => !!offer && cb.current.onOffer?.({ kind: offer, text, hearing: hearing(), ...answer }) === 'skip';
        // Sent just before the service heard a video started: its offer and its words wait for the video.
        const later = videoOn.current && waitsForVideo(kind);
        // A video the kid started has the sound: an answer still on its way isn't said over it.
        const drop = !later && (dropsForKidVideo(kind, kidVideoPlaying()) || ask());
        // The line a tap on homie asked for: never a yes to reading aloud (onSay).
        const tap = answersTap(kind, tapAt.current, Date.now());
        if (kind === 'step') tapAt.current = 0;
        const label = sayLabel(kind, cb.current.cookName);
        say.current = {
          kind,
          chunks: [],
          rate: m.audio?.sampleRate ?? m.sampleRate ?? 24000,
          translation: kind === 'translation',
          label,
          drop,
          at: Date.now(),
          gap: null,
          offer: later && offer ? ask : undefined,
        };
        if (!drop && !hold.current && !later) setHomie({ state: 'lit', label });
        cb.current.onSay?.(kind, { tap });
      } else if (m.type === 'say_end') {
        const end = endSay(openSays.current);
        openSays.current = end.open;
        // The end of a line a newer one already replaced: the newer one keeps playing.
        if (end.stale) return;
        if (!m.interrupted) return flushSay();
        // The service cut it off (a newer line or a clip took its place): never play the rest.
        const s = say.current;
        say.current = null;
        if (s?.gap) clearTimeout(s.gap);
        if (s && !s.drop) doneSpeaking();
      } else if (m.type === 'asked_cook') {
        setAskedAt(Date.now());
        if (typeof m.questionId === 'string') setAskedIds((ids) => new Set(ids).add(m.questionId));
      } else if (m.type === 'timer') {
        const t = parseTimer(m, Date.now(), socketNo.current);
        if (t) changeTimers((list) => withTimer(list, t));
      } else if (m.type === 'timer_done') {
        // Usually before this phone's own zero: a timer that hasn't buzzed buzzes now.
        const done = timerDone(timerList.current, buzzed.current, socketNo.current, m.id, Date.now());
        changeTimers(() => done.list);
        if (done.buzz) buzzTimer(done.buzz);
      } else if (m.type === 'offer_closed') {
        cb.current.onOfferClosed?.(offerClosed(m));
      } else if (m.type === 'error') {
        console.warn('[voice]', m.message);
      }
    },
    [flushSay, dropSay, sendText, sendStep, think, changeTimers, buzzTimer, kidSpeaks, micEvent],
  );

  const fail = useCallback((text: string) => {
    setError({ text, at: Date.now() });
    setStatus('error');
  }, []);

  /** The socket is gone (sock.current already null): the recorder stops; homie stays on only through a retry. */
  const hangUp = useCallback(() => {
    syncMic();
    liveRef.current = false;
    setLive(false);
    think(false);
    kidSpeaks(false);
    wordsAt.current = 0;
    setHomieLevel(0);
    dropSay();
  }, [syncMic, think, kidSpeaks, dropSay]);

  const connect = useCallback(
    async (auto: boolean) => {
      const libraryId = cb.current.libraryId;
      if (!libraryId) return;
      const began = line.current;
      lineAuto.current = auto;
      if (!auto) setStatus('connecting');
      const [token, recipeId, agreed] = await Promise.all([convexSession(meId.current), convexRecipeId(libraryId), hasAiConsent()]).catch(() => [null, libraryId, false] as const);
      // Hung up (or hung up and opened again) meanwhile, or a socket is already open: this one isn't needed.
      if (!lineMayOpen({ want: want.current, line: line.current, began, open: !!sock.current })) return;
      const real = !!VOICE_URL && !!token && token !== 'stub';
      // Never a real line without this phone's yes to the AI companies (cook mode asks for it first).
      if (real && !agreed) {
        want.current = false;
        setMicHold('off');
        return setStatus('off');
      }
      // It only calls a service that can cook this dish (one Convex knows; a sample dish isn't), on
      // its own or on a tap; nothing to say when it can't (the phone reads instead).
      if ((auto && !real) || (real && recipeId === libraryId)) {
        want.current = false;
        setUnavailable(true);
        setMicHold('off');
        if (!auto) setStatus('off');
        return;
      }
      setStatus('connecting');
      const s: Socket = real
        ? (new WebSocket(`${VOICE_URL}/cook?session=${encodeURIComponent(token)}&recipe=${encodeURIComponent(recipeId)}`) as unknown as Socket)
        : stubSocket(recipeId, () => cb.current.step);
      if ('binaryType' in s) (s as unknown as WebSocket).binaryType = 'arraybuffer';
      sock.current = s;
      // Only the current socket is heard: an older one's messages or open change nothing.
      s.onmessage = (e) => {
        if (sock.current === s) onMessage(e.data);
      };
      s.onopen = () => {
        if (sock.current !== s) return;
        socketNo.current += 1;
        retries.current = 0;
        openSays.current = 0;
        restoring.current = 0;
        echoes.current = [];
        liveRef.current = real;
        setLive(real);
        // The stub reads nothing: the phone still reads for the kid then.
        setUnavailable(!real);
        setStatus('listening');
        s.send(JSON.stringify({ type: 'step', stepOrder: cb.current.step }));
        if (appMoment.current) s.send(JSON.stringify(momentMessage(appMoment.current)));
        if (videoOn.current) s.send(JSON.stringify(videoMessage(true)));
        // The mic starts only if homie is on (a tap while the line was opening, or through a retry).
        syncMic();
      };
      s.onclose = (e) => {
        if (sock.current !== s) return;
        sock.current = null;
        hangUp();
        // 4401: the session token was refused. 4404: this recipe isn't ready for voice. Neither gets better on retry.
        if (e?.code === 4401 || e?.code === 4404) {
          want.current = false;
          setUnavailable(true);
          setMicHold('off');
          if (auto && e.code === 4404) return setStatus('off');
          return fail(e.code === 4401 ? 'Signed out. Open homecookd again to sign in.' : 'homie can’t cook this dish by voice yet.');
        }
        if (want.current && retries.current < RETRIES) {
          retries.current += 1;
          setStatus('connecting');
          const on = line.current;
          later(() => lineMayOpen({ want: want.current, line: line.current, began: on, open: !!sock.current }) && void reconnect.current?.(auto), 1500 * retries.current);
          return;
        }
        if (want.current) {
          setUnavailable(true);
          fail('homie lost the connection. Tap homie to try again.');
        } else setStatus('off');
        want.current = false;
        setMicHold('off');
      };
    },
    [onMessage, syncMic, setMicHold, hangUp, fail, later],
  );

  useEffect(() => {
    reconnect.current = connect;
  });

  const stop = useCallback(() => {
    want.current = false;
    line.current += 1;
    const s = sock.current;
    sock.current = null;
    s?.close();
    hangUp();
    setMicHold('off');
    setStatus('off');
  }, [hangUp, setMicHold]);

  /** homie, just turned on by a tap, says the step's short line at once ({ type: "tap" }): the pot lights for it now. */
  const sayOnTap = useCallback(() => {
    const s = sock.current;
    const h = getHomie().state;
    if (!s || !saysOnTap({ live: liveRef.current, open: s.readyState === 1, talking: h === 'lit' || h === 'speaking' })) return;
    s.send(JSON.stringify(TAP_MESSAGE));
    tapAt.current = Date.now();
    setHomie({ state: 'lit' });
    const mark = answers.current;
    later(() => {
      if (answers.current === mark && !say.current && !beat.current && getHomie().state === 'lit') doneSpeaking();
    }, TAP_LINE_WAIT_MS);
  }, [later]);

  /**
   * A tap on homie: on (the mic streams), or off again, from a tap or a window alike (voiceLogic
   * micAfter); while a video plays, always on (holdAfterTap). A step line still playing opens no window
   * after it (off stays off; on stays on). Turning it on takes the sound: any video fades out and pauses,
   * and homie says the step's short line. It also tries a refused mic again, and opens the line when it
   * isn't open (it failed, or never started).
   */
  const toggle = useCallback(() => {
    const video = videoPlaying();
    const next = holdAfterTap(micHoldRef.current, video);
    stepLine.current = false;
    if (next !== 'off' && mutedRef.current) {
      mutedRef.current = false;
      setMutedState(false);
    }
    if (next !== 'off') {
      // Her clip is the video fading out: it holds homie's line no longer. The recorder starts only
      // once the video has paused (micWanted), so the session change can't stop it.
      if (video) hold.current = false;
      pauseAllVideos({ fadeMs: HANDOFF_FADE_MS });
    }
    setMicHold(next);
    if (next !== 'off') sayOnTap();
    if (next === 'off' || sock.current || want.current) return;
    want.current = true;
    retries.current = 0;
    void connect(false);
  }, [setMicHold, sayOnTap, connect]);

  /** A chip: `text` to homie when it's there (and answers), else `fallback` does it here. */
  const command = useCallback(
    (text: string, fallback?: () => void) => {
      if (!liveRef.current || !sendText(text)) return fallback?.();
      if (!fallback) return;
      const mark = answers.current;
      later(() => answers.current === mark && fallback(), COMMAND_WAIT_MS);
    },
    [sendText, later],
  );

  /**
   * An app-only moment opened (its kind) or closed (null): the service is told, once per change. "Ask
   * <cook> anything" holds the mic on for as long as it's up (voiceLogic micAfter 'ask').
   */
  const setMoment = useCallback((kind: AppMomentKind | null) => {
    const was = appMoment.current;
    if (was === kind) return;
    appMoment.current = kind;
    if (kind === 'ask' || was === 'ask') micEvent(kind === 'ask' ? 'ask' : 'ask_end');
    const s = sock.current;
    if (s?.readyState !== 1) return;
    // One moment straight after another: the first one closes, then the next opens.
    if (was && kind) s.send(JSON.stringify(momentMessage(null)));
    s.send(JSON.stringify(momentMessage(kind)));
  }, [micEvent]);

  // She's done (or the video stopped): now homie's line, after its lit beat.
  const setHold = useCallback(
    (on: boolean) => {
      hold.current = on;
      release();
    },
    [release],
  );

  /**
   * A video the kid started: it has the sound. homie's voice is already fading out (lib/media
   * useClipVideo), and homie turns off: no line in its lit beat, no answer still on its way, no
   * thinking. The lines homie says on its own (in their beat too) wait for the video instead.
   */
  const hush = useCallback(() => {
    if (say.current && dropsForKidVideo(say.current.kind, true)) say.current.drop = true;
    if (waiting.current && dropsForKidVideo(waiting.current.kind, true)) waiting.current = null;
    const inBeat = beat.current ? beatSay.current : null;
    if (beat.current) clearTimeout(beat.current);
    beat.current = null;
    if (inBeat && !dropsForKidVideo(inBeat.kind, true) && !waiting.current) waiting.current = inBeat;
    stepLine.current = false;
    stopSay();
    doneSpeaking();
    think(false);
    setMicHold('off');
  }, [think, setMicHold]);

  /**
   * lib/media's gate before a video sounds: a play the kid started turns homie off first, and any video
   * stops the recorder (micWanted reads the playhead). It waits while the recorder starts or stops
   * (after homie's voice has faded): that deactivates the iOS session, which would stop the video.
   */
  const videoGate = useCallback(
    (kid: boolean) => {
      if (kid) hush();
      else syncMic();
      return micBusy.current ? micIdle(VIDEO_GATE_MAX_MS) : null;
    },
    [hush, syncMic, micIdle],
  );
  useEffect(() => setVideoGate(videoGate), [videoGate]);

  /** Also called when homie's own line stops playing, so a line that waited goes then. */
  const setVideo = useCallback(
    (on: boolean, kid = false) => {
      if (videoOn.current !== on) {
        videoOn.current = on;
        setVideoState(on);
        const s = sock.current;
        if (s?.readyState === 1) s.send(JSON.stringify(videoMessage(on)));
        // No recorder while a video plays, so it plays at full volume (voiceLogic micWanted).
        syncMic();
      }
      if (kidSaid.current !== kid) {
        kidSaid.current = kid;
        if (kid) hush();
      }
      release();
    },
    [release, syncMic, hush],
  );

  /** Opens the line again after a pause, the way it was opened (homie stays off until a tap). */
  const resume = useCallback(() => {
    paused.current = false;
    if (want.current || sock.current) return;
    want.current = true;
    retries.current = 0;
    void connect(lineAuto.current);
  }, [connect]);

  // The app goes to the background (Cartesia credit fix B): the line closes and homie goes off, quietly
  // (want off: no retries, no error). Back on top, on this screen, the line opens again.
  const lineCtl = useRef({ stop, resume });
  useEffect(() => {
    lineCtl.current = { stop, resume };
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setForeground(appInForeground(next));
      const step = appStateStep({ next, lineOn: want.current || !!sock.current, paused: paused.current });
      if (step === 'pause') {
        lineCtl.current.stop();
        paused.current = true;
      } else if (step === 'resume' && focusedRef.current) lineCtl.current.resume();
    });
    return () => sub.remove();
  }, []);

  // Cook mode opens the line by itself, once a visit, with homie off (after that, a tap opens it again).
  const { auto, libraryId } = opts;
  useEffect(() => {
    if (!auto || !libraryId || !focused || !foreground || autoTried.current) return;
    autoTried.current = true;
    want.current = true;
    retries.current = 0;
    void connect(true);
  }, [auto, libraryId, focused, foreground, connect]);

  // Another screen on top: homie goes off (the recorder stops, so that screen's voice notes can record
  // and the mic light goes off). Paused meanwhile: back here the line opens again.
  useEffect(() => {
    if (!focused) return setMicHold('off');
    if (paused.current && appInForeground(AppState.currentState)) lineCtl.current.resume();
  }, [focused, setMicHold]);

  // A step line has played (homie went quiet after it): the mic listens for a while (voiceLogic micAfter).
  useEffect(() => {
    if (talking || !stepLine.current) return;
    stepLine.current = false;
    // Not with a refused mic: only a tap tries it again.
    if (liveRef.current && focusedRef.current && !mutedRef.current) micEvent('step_line_end');
  }, [talking, micEvent]);

  // The app making sound: every mic frame is zeroed then (lib/live/mic), so nothing is heard.
  const sounding = talking || videoState;

  // The mic's timers (voiceLogic micTimer): a window's 8 s of hearing, the beat after a turn's answer,
  // the cap from the window's start, a tapped-on homie's idle minute (each word from the kid restarts
  // it: `finals`). A window's end waits while the kid is mid-sentence (edgeWait), so Ink gets the end.
  useEffect(() => {
    const t = micTimer({ hold: micHold, listening, sounding, thinking, talking, kidTalking, heardFinal, openFor: Date.now() - windowAt.current });
    if (!t) return;
    let extended = 0;
    let timer: ReturnType<typeof setTimeout>;
    const fire = () => {
      const wait = t.event === 'window_timeout' ? edgeWait({ loudAgo: Date.now() - loudAt.current, wordsAgo: wordsAt.current ? Date.now() - wordsAt.current : Infinity, extended }) : 0;
      if (wait <= 0) return micEvent(t.event);
      extended += wait;
      timer = setTimeout(fire, wait);
    };
    timer = setTimeout(fire, t.ms);
    return () => clearTimeout(timer);
  }, [micHold, listening, sounding, thinking, talking, kidTalking, heardFinal, finals, micEvent]);

  // A step the kid tapped (not one the server just sent) goes to the server, which says its short line;
  // one her clip moved the screen to goes with read: false, so no line plays over her.
  useEffect(() => {
    const clip = fromClip.current === opts.step;
    fromClip.current = null;
    if (lastServerStep.current === opts.step) return;
    lastServerStep.current = null;
    sendStep(opts.step, !clip);
  }, [opts.step, sendStep]);

  // The soonest timer still to buzz, reaching zero on this phone's clock: one buzz and the pot's timer
  // state (a timer_done that comes first buzzes it then instead); it leaves a little later, or with a
  // timer_done after the buzz. Two at zero together (old-socket timers after a pause, with no timer_done
  // to come) buzz once each.
  useEffect(() => {
    const { next, kept } = timerBuzz(timers, buzzed.current);
    buzzed.current = kept;
    if (!next) return;
    const { id } = next;
    const t = setTimeout(() => buzzTimer(id), Math.max(0, next.endsAt - Date.now()));
    return () => clearTimeout(t);
  }, [timers, buzzes, buzzTimer]);

  // What the pot shows, while this screen is the one on top.
  useEffect(() => {
    if (!focused) return;
    const timerDue = timerBuzz(timers, buzzed.current).due;
    // A video that just started counts at once (VoiceHold tells this hook a render later): never a listening blip under it.
    const sound = sounding || videoPlaying();
    setHomie({ state: cookPotState({ active: micHold !== 'off', listening, sounding: sound, thinking, timers: timers.length, timerDue }), timer: timers[0] });
  }, [focused, micHold, listening, sounding, thinking, timers, buzzes]);
  useEffect(() => {
    if (!focused) return;
    return () => setHomie({ state: 'off', timer: undefined, level: 0 });
  }, [focused]);

  // Leaving the screen hangs up (and drops any line of homie's still on its way).
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  useEffect(() => {
    const timeouts = pending.current;
    return () => {
      stopRef.current();
      for (const t of timeouts) clearTimeout(t);
      if (thinkTimer.current) clearTimeout(thinkTimer.current);
      if (kidTimer.current) clearTimeout(kidTimer.current);
    };
  }, []);

  const active = micHold !== 'off';
  const hearing = hearsAnswers({ live, hold: micHold, listening });
  return { status, live, unavailable, active, listening, hearing, muted, kidTalking, timers, askedAt, askedIds, error, toggle, stop, command, sendText, setMoment, setHold, setVideo };
}

export type VoiceCooking = ReturnType<typeof useVoiceCooking>;

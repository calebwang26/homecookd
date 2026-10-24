// Tracks B + E boundary: voice cooking over the live voice service's WebSocket (docs/build/STACK.md
// "App ↔ voice service" and "kid cooking additions"): wss://<voice>/cook?session=<sessionToken>&recipe=<recipeId>.
//
//   const voice = useVoiceCooking({ libraryId, step, cookName, auto, readAloud, onGoTo, onClip, onOffer, onOfferClosed, onHeard });
//   voice.status          'off' | 'connecting' | 'listening' (the line is open) | 'error'
//   voice.live            the real service is on the line: chips go to it (else they act on their own)
//   voice.unavailable     no line will read for the kid: auto start gave up (no service, a dish Convex
//                         doesn't know, 4404), or the line failed for good (the phone reads instead)
//   voice.muted           the kid turned the mic off: the recorder stops, the line stays open
//   voice.timers          kitchen timers the service set, soonest first; this phone counts them down
//                         (ids are per socket: one from before a pause keeps going and leaves on its own)
//   voice.askedAt         when a question last went to the cook ("I asked Grandma"); askedIds: which ones
//   voice.listen() / stop() / setMuted(on)
//   voice.command('back', fallback)  says it to homie as text; `fallback` runs when nobody is on the line,
//                                    or nothing comes back within 1.5 s (an older service)
//   voice.sendText('yes')            words for homie, as if the kid said them
//   voice.setMoment('answer' | null) an app-only moment is up on the phone ({ type: "moment" }; the
//                                    service then never takes its yes or no for its own offer)
//   voice.setHold(on)                the cook's own voice is playing (her clip, her voice note): homie's
//                                    next line waits until she's done, so it never talks over her
// Half duplex is lib/live/mic's: while the app makes sound, its frames are zeroed, and none of those
// reach the socket (Cartesia's Ink bills every second it gets, silence too; voiceLogic cookSendsFrame).
// The app in the background (AppState; not iOS 'inactive', still on screen) closes the line and stops
// the mic, and back on top it opens again, with the mic only if the kid hadn't turned it off (voiceLogic
// appStateStep). One socket at a time: a retry or a connect from before a hang-up never opens one
// after it (voiceLogic lineMayOpen), and only the current socket is heard. There's no idle timeout while the screen is open (Caleb, Oct 24: hands-free, a kid
// may say nothing for minutes while it simmers); the service closes its own Ink stream after 2 min
// without audio.
// The read-aloud offer (onOffer): `accept` sends "yes", `decline` sends "no" (that visit, steps change
// silently); the service's { type: "offer_closed", accepted } goes to onOfferClosed.
//
// The screen follows the server: go_to_step moves the step, play_clip plays that moment of the cook's
// video (with her words, `quote` / `quoteEn`, for a caption), and a step the kid taps goes back as
// { type: "step" } (then "repeat" when the kid asked for the steps read aloud, so it reads that one too;
// not when her clip moved the step). On `ready` the screen's step goes back too, and the service's own
// go_to_step right after it (the step it saved last) is not followed: the step on screen is the truth.
// homie shows the rest (lib/homie): listening while the mic is on (the steam follows the kid's voice),
// thinking from what the kid said to homie's answer, lit while homie's line arrives (at least a beat)
// and speaking while it plays, labelled "AI voice" ("Translated from Grandma", "AI hint"), and the ring
// while a timer runs. Neither what the kid said nor homie's words are shown: homie only talks. Its
// offers (read the steps aloud, hear a story) go to `onOffer`, which shows a moment or answers from a
// choice this phone remembers ('skip' drops that line's audio). The service echoes every text it gets
// as a finished transcript: that echo is the chip's answer, and it never reaches onHeard as the kid's.
// `auto` starts it on its own, quietly: only with the voice service set and a dish Convex knows. Without
// EXPO_PUBLIC_VOICE_URL, a mic turned on by hand talks to a local stub (lib/live/voiceStub); for a real
// socket on the laptop: app/scripts/pcm-echo-server.mjs. Leaving the screen stops the mic (and any line
// of homie's still arriving); coming back starts it again.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import { doneSpeaking, getHomie, LIT_BEAT_MS, setHomie, setHomieLevel } from '@/lib/homie/store';
import { useSession } from '@/lib/session';

import { convexRecipeId, convexSession } from './convex';
import { micAsking, useMicStream } from './mic';
import { playSay, stopSay } from './say';
import {
  appInForeground,
  appStateStep,
  cookPotState,
  cookSendsFrame,
  DECLINE_TEXT,
  echoAt,
  endSay,
  endsThinking,
  HOMIE_ACTIONS,
  lineMayOpen,
  momentMessage,
  offerClosed,
  offerOf,
  parseTimer,
  sayKind,
  sayLabel,
  sentText,
  thinksAfter,
  withoutTimer,
  withTimer,
  type AppMomentKind,
  type CookTimer,
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
/** A timer at zero stays on screen ("Done") this long if the service never says timer_done. */
const TIMER_DUE_HOLD_MS = 10_000;
/** The service's go_to_step to its saved step comes right after `ready`. */
const RESTORE_MS = 3000;
const ECHOES_KEPT = 8;

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
  | { type: 'error'; message?: string };

type PendingSay = { chunks: ArrayBuffer[]; rate: number; translation: boolean; label?: string; drop: boolean; at: number; gap: ReturnType<typeof setTimeout> | null };

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
  /** Start on its own (cook mode, once per visit), and give up quietly when it can't. */
  auto?: boolean;
  /** The kid said yes to "read it out loud?" on this phone: a tapped step is read too. */
  readAloud?: boolean;
  onGoTo: (n: number) => void;
  /** Plays her clip; returns the step it shows (a step the clip moved to isn't read aloud). */
  onClip: (clip: VoiceClip) => number | void;
  /** 'skip' drops the offer's audio (the phone already knows the answer). */
  onOffer?: (offer: VoiceOffer) => 'play' | 'skip';
  /** The service closed its read-aloud offer: true, it reads now; false, it was declined. */
  onOfferClosed?: (accepted: boolean) => void;
  /** Every line homie says, by kind (after onOffer). */
  onSay?: (kind: SayKind) => void;
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
  const [thinking, setThinking] = useState(false);
  const [timers, setTimers] = useState<CookTimer[]>([]);
  // The timer at zero, by id.
  const [due, setDue] = useState<string | null>(null);
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
  const micOn = useRef(false);
  const mutedRef = useRef(false);
  const liveRef = useRef(false);
  const hold = useRef(false);
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
  // The step the server just moved us to: not echoed back as a kid's tap.
  const lastServerStep = useRef<number | null>(null);
  // The step her clip just moved the screen to: sent, but not read aloud.
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
  const thinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(opts);
  const meId = useRef(me?.id);
  useEffect(() => {
    cb.current = opts;
    meId.current = me?.id;
    focusedRef.current = focused;
  });

  // Only the kid's own frames go out: none while the app makes sound (lib/live/mic `quiet`), and none
  // while another screen is on top, until the recorder stops.
  const mic = useMicStream(
    (pcm, quiet) => {
      const s = sock.current;
      if (!s || s.readyState !== 1 || !cookSendsFrame({ quiet, focused: focusedRef.current })) return;
      s.send(pcm);
    },
    (level) => setHomieLevel(focusedRef.current ? level : 0),
  );

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      pending.current.delete(t);
      fn();
    }, ms);
    pending.current.add(t);
  }, []);

  const think = useCallback((on: boolean) => {
    if (thinkTimer.current) clearTimeout(thinkTimer.current);
    thinkTimer.current = on ? setTimeout(() => setThinking(false), THINKING_MAX_MS) : null;
    setThinking(on);
  }, []);

  /** The lit beat before homie's voice (even when the line arrived at once), then the line. */
  const speakNow = useCallback((s: PendingSay) => {
    const play = () => {
      beat.current = null;
      setHomie({ state: 'speaking', label: s.label });
      if (!playSay(s.chunks, s.rate, s.translation)) doneSpeaking();
    };
    const wait = LIT_BEAT_MS - (Date.now() - s.at);
    if (wait > 0) beat.current = setTimeout(play, wait);
    else play();
  }, []);

  const flushSay = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (!s) return;
    if (s.gap) clearTimeout(s.gap);
    if (s.drop) return;
    if (!s.chunks.length) return doneSpeaking();
    if (!hold.current) return speakNow(s);
    // Her voice is playing: this line waits for her (the newest one only).
    waiting.current = s;
    doneSpeaking();
  }, [speakNow]);

  /** Cuts off homie's line: still arriving, in its lit beat, waiting for her, or playing. */
  const dropSay = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (s?.gap) clearTimeout(s.gap);
    if (beat.current) clearTimeout(beat.current);
    beat.current = null;
    waiting.current = null;
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

  const sendStep = useCallback((stepOrder: number) => {
    const s = sock.current;
    if (s?.readyState === 1) s.send(JSON.stringify({ type: 'step', stepOrder }));
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
        // An older service sends only finished turns, without `final`.
        if (m.final === false || !m.text) return;
        answers.current += 1;
        const echo = echoAt(echoes.current, m.text, Date.now());
        // homie thinks only when an answer is on its way: never for this phone's own text (a tapped
        // "no" gets none), nor a yes or no the service holds or answers with silence.
        if (thinksAfter({ echo: echo >= 0, appMoment: !!appMoment.current, momentUp: !!getHomie().moment, text: m.text })) think(true);
        if (echo >= 0) {
          // This phone's own text: never the kid's words.
          echoes.current = echoes.current.filter((_, i) => i !== echo);
          return;
        }
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
        const shows = cb.current.onClip({ startS: m.startS, endS: m.endS, quote: m.quote || undefined, quoteEn: m.quoteEn || undefined });
        if (typeof shows === 'number' && shows !== cb.current.step) fromClip.current = shows;
      } else if (m.type === 'say') {
        openSays.current += 1;
        const kind = sayKind(m);
        const text = typeof m.text === 'string' ? m.text : '';
        const offer = offerOf(kind, text);
        const hearing = liveRef.current && micOn.current && !mutedRef.current;
        const answer = { accept: () => void sendText('yes'), decline: () => void sendText(DECLINE_TEXT) };
        const drop = !!offer && cb.current.onOffer?.({ kind: offer, text, hearing, ...answer }) === 'skip';
        const label = sayLabel(kind, cb.current.cookName);
        say.current = { chunks: [], rate: m.audio?.sampleRate ?? m.sampleRate ?? 24000, translation: kind === 'translation', label, drop, at: Date.now(), gap: null };
        if (!drop && !hold.current) setHomie({ state: 'lit', label });
        cb.current.onSay?.(kind);
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
        if (t) setTimers((list) => withTimer(list, t));
      } else if (m.type === 'timer_done') {
        const n = socketNo.current;
        setTimers((list) => withoutTimer(list, n, m.id));
      } else if (m.type === 'offer_closed') {
        cb.current.onOfferClosed?.(offerClosed(m));
      } else if (m.type === 'error') {
        console.warn('[voice]', m.message);
      }
    },
    [flushSay, dropSay, sendText, sendStep, think],
  );

  const fail = useCallback((text: string) => {
    setError({ text, at: Date.now() });
    setStatus('error');
  }, []);

  const startMic = useCallback(() => {
    if (micOn.current || mutedRef.current) return setStatus('listening');
    micOn.current = true;
    void mic.start().then((r) => {
      if (r === 'ok' && !micOn.current) {
        // Turned off (left the screen, muted, hung up) while it was starting: stop what just started.
        mic.stop();
        if (sock.current?.readyState === 1) setStatus('listening');
        return;
      }
      if (r === 'ok') return setStatus('listening');
      micOn.current = false;
      // No mic, but the line stays open: the chips still go to homie, and it can still read.
      mutedRef.current = true;
      setMutedState(true);
      if (sock.current?.readyState === 1) setStatus('listening');
      if (r === 'denied') setError({ text: 'To talk to homie, turn on the microphone for homecookd in Settings.', at: Date.now() });
    });
  }, [mic]);

  const hangUp = useCallback(() => {
    mic.stop();
    micOn.current = false;
    liveRef.current = false;
    setLive(false);
    think(false);
    setHomieLevel(0);
    dropSay();
  }, [mic, think, dropSay]);

  const connect = useCallback(
    async (auto: boolean) => {
      const libraryId = cb.current.libraryId;
      if (!libraryId) return;
      const began = line.current;
      lineAuto.current = auto;
      if (!auto) setStatus('connecting');
      const [token, recipeId] = await Promise.all([convexSession(meId.current), convexRecipeId(libraryId)]).catch(() => [null, libraryId] as const);
      // Hung up (or hung up and opened again) meanwhile, or a socket is already open: this one isn't needed.
      if (!lineMayOpen({ want: want.current, line: line.current, began, open: !!sock.current })) return;
      const real = !!VOICE_URL && !!token && token !== 'stub';
      // On its own it only calls a service that can cook this dish; nothing to say when it can't (the
      // phone reads instead).
      if (auto && (!real || recipeId === libraryId)) {
        want.current = false;
        setUnavailable(true);
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
        fromClip.current = null;
        liveRef.current = real;
        setLive(real);
        // The stub reads nothing: the phone still reads for the kid then.
        setUnavailable(!real);
        s.send(JSON.stringify({ type: 'step', stepOrder: cb.current.step }));
        if (appMoment.current) s.send(JSON.stringify(momentMessage(appMoment.current)));
        startMic();
      };
      s.onclose = (e) => {
        if (sock.current !== s) return;
        sock.current = null;
        hangUp();
        // 4401: the session token was refused. 4404: this recipe isn't ready for voice. Neither gets better on retry.
        if (e?.code === 4401 || e?.code === 4404) {
          want.current = false;
          setUnavailable(true);
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
      };
    },
    [onMessage, startMic, hangUp, fail, later],
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
    setStatus('off');
  }, [hangUp]);

  /** Mic on: unmutes an open line, or opens one. */
  const listen = useCallback(() => {
    mutedRef.current = false;
    setMutedState(false);
    if (sock.current?.readyState === 1) return startMic();
    if (want.current) return;
    want.current = true;
    retries.current = 0;
    void connect(false);
  }, [connect, startMic]);

  const setMuted = useCallback(
    (on: boolean) => {
      if (!on) return listen();
      mutedRef.current = true;
      setMutedState(true);
      mic.stop();
      micOn.current = false;
      setHomieLevel(0);
    },
    [listen, mic],
  );

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

  /** An app-only moment opened (its kind) or closed (null): the service is told, once per change. */
  const setMoment = useCallback((kind: AppMomentKind | null) => {
    const was = appMoment.current;
    if (was === kind) return;
    appMoment.current = kind;
    const s = sock.current;
    if (s?.readyState !== 1) return;
    // One moment straight after another: the first one closes, then the next opens.
    if (was && kind) s.send(JSON.stringify(momentMessage(null)));
    s.send(JSON.stringify(momentMessage(kind)));
  }, []);

  const setHold = useCallback(
    (on: boolean) => {
      hold.current = on;
      const s = waiting.current;
      if (on || !s) return;
      // She's done: now homie's line, after its lit beat.
      waiting.current = null;
      s.at = Date.now();
      setHomie({ state: 'lit', label: s.label });
      speakNow(s);
    },
    [speakNow],
  );

  /** Opens the line again after a pause, the way it was opened (onopen starts the mic unless muted). */
  const resume = useCallback(() => {
    paused.current = false;
    if (want.current || sock.current) return;
    want.current = true;
    retries.current = 0;
    void connect(lineAuto.current);
  }, [connect]);

  // The app goes to the background (Cartesia credit fix B): the line closes and the mic stops, quietly
  // (want off: no retries, no error). Back on top, on this screen, it opens again.
  const lineCtl = useRef({ stop, resume });
  useEffect(() => {
    lineCtl.current = { stop, resume };
  });
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      setForeground(appInForeground(next));
      const step = appStateStep({ next, lineOn: want.current || !!sock.current, paused: paused.current, asking: micAsking() });
      if (step === 'pause') {
        lineCtl.current.stop();
        paused.current = true;
      } else if (step === 'resume' && focusedRef.current) lineCtl.current.resume();
    });
    return () => sub.remove();
  }, []);

  // Cook mode turns voice on by itself, once a visit (after that, only the kid turns it back on).
  const { auto, libraryId } = opts;
  useEffect(() => {
    if (!auto || !libraryId || !focused || !foreground || autoTried.current) return;
    autoTried.current = true;
    want.current = true;
    retries.current = 0;
    void connect(true);
  }, [auto, libraryId, focused, foreground, connect]);

  // Another screen on top (Ask pushes the chat): the recorder stops, so its own voice notes can record
  // and the mic light goes off; back here it starts again (unless the kid turned it off).
  const micCtl = useRef({ stop: mic.stop, start: startMic });
  useEffect(() => {
    micCtl.current = { stop: mic.stop, start: startMic };
  });
  useEffect(() => {
    if (!focused) {
      if (!micOn.current) return;
      micCtl.current.stop();
      micOn.current = false;
      setHomieLevel(0);
      return;
    }
    // Paused while another screen was on top: the line opens again here.
    if (paused.current && appInForeground(AppState.currentState)) return lineCtl.current.resume();
    if (sock.current?.readyState === 1 && !mutedRef.current && !micOn.current) micCtl.current.start();
  }, [focused]);

  // A step the kid tapped (not one the server just sent) goes to the server.
  useEffect(() => {
    const clip = fromClip.current === opts.step;
    fromClip.current = null;
    if (lastServerStep.current === opts.step) return;
    lastServerStep.current = null;
    const s = sock.current;
    if (!s || s.readyState !== 1) return;
    s.send(JSON.stringify({ type: 'step', stepOrder: opts.step }));
    // Her clip moved the step: it's playing, so homie doesn't read over it.
    if (!clip && cb.current.readAloud && liveRef.current) sendText('repeat');
  }, [opts.step, sendText]);

  // The soonest timer reaching zero on this phone's clock: a buzz and the pot's timer state; it leaves
  // with the service's timer_done, or on its own a little later.
  useEffect(() => {
    const next = timers.find((t) => t.id !== due);
    if (!next) return;
    const { id } = next;
    const t = setTimeout(() => {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setDue(id);
      later(() => setTimers((list) => list.filter((x) => x.id !== id)), TIMER_DUE_HOLD_MS);
    }, Math.max(0, next.endsAt - Date.now()));
    return () => clearTimeout(t);
  }, [timers, due, later]);

  // What the pot shows, while this screen is the one on top.
  const ring = timers[0];
  const timerDue = !!due && timers.some((t) => t.id === due);
  useEffect(() => {
    if (!focused) return;
    setHomie({ state: cookPotState({ status, muted, thinking, timers: timers.length, timerDue }), timer: ring });
  }, [focused, status, muted, thinking, timers.length, timerDue, ring]);
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
    };
  }, []);

  return { status, live, unavailable, muted, timers, askedAt, askedIds, error, listen, stop, setMuted, command, sendText, setMoment, setHold };
}

export type VoiceCooking = ReturnType<typeof useVoiceCooking>;

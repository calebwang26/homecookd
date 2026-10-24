// homie while a cook records (docs/build/STACK.md "App ↔ voice service: homie while recording"):
// wss://<voice>/record?session=<sessionToken>&recording=<recordingId>.
//
//   const homie = useHomieRecording(recordingId, { language, kidName, dish });
//   homie.phase          'connecting' | 'intro' | 'recording' | 'wrapping_up' | 'ended'
//   homie.introDone      homie finished its hello (the screen then starts filming by itself); once it
//                        plays, the pot's own "Hi, I’m homie." never comes for her (lib/homie/intro)
//   homie.ask            homie's question while it waits for her spoken answer (null when none)
//   homie.start()        filming starts (glasses)
//   homie.done()         "I'm done" (the stop button): over the socket when it's open; with no socket,
//                        Convex ends the recording itself (live.endRecording), so the glasses' computer
//                        still uploads; if that fails too, "done" goes once the socket is back
//   await homie.end()    ends the recording through Convex without homie (a stalled wrap-up)
//   homie.notNow()       closes the question (a tap on it, VoiceOver's escape)
//   await homie.filmWithPhone(record)   a phone recording with the system camera (older builds): start,
//                        wait until the server has saved that filming began, close the socket and the
//                        mic, run the phone's camera, then reconnect and end (the server finishes with
//                        homie's last questions)
//   const homie = useHomieRecording(id, info, { camera: true })   filming in the app (useInAppCamera): the
//                        socket and the mic stay open the whole time, the mic in the camera's audio
//                        settings (lib/live/camera). Then:
//   await homie.filmInApp(() => cam.start())   start ({type:"start", camera:true}), wait for the server,
//                        then the camera; homie keeps listening and asking while she films
//   homie.cameraFilming(on)   the camera is writing a file: the mic never starts or stops meanwhile (the
//                        recorder deactivates iOS's audio session when it does); a start waits for
//                        restartMic, between two files
//   await homie.restartMic()  between two files (after a pause): the mic fresh, in the camera's settings
//   homie.sendFrame(jpeg)     a small still for homie's look at the stove (open socket only)
//   homie.pause() / homie.resume(gapS)   the camera stopped / films again; gapS = seconds the video skipped
//   homie.plateDone(ok)       the plate photo was taken (or skipped): answers homie's "plate" ask
//   homie.error          'lostConnection' | 'signedOut' | 'ended' | 'elsewhere' (components/record/words)
//   homie.serverError    the service reported an error after "I'm done" (the wrap-up may be stuck)
//
// The phone by the stove streams the mic (16 kHz PCM) the whole time. Half duplex: while homie is lit
// or speaking, or anything plays on the phone, the socket gets zeros of the same length instead
// (recordingLogic micQuiet / silence); the recorder keeps running. homie's lines play on the shared
// player (lib/live/say). The pot follows the service: lit just before a say, then speaking; listening
// with the mic level, thinking. Her answers are spoken: the service hears them, and fades the question
// itself when she says "not now" or after ~10 s of quiet. At `ended` the mic stops.
// A lost line retries a few times, then says so; while the in-app camera films it keeps trying every
// 10 s and the message clears when a socket opens (filming never depends on homie's line).
// One socket at a time: a connect waits while another is on its way or open, and a socket that is no
// longer the current one is not heard. A new socket has no open question (the server keeps it per
// socket; the wrap-up asks again whatever is left).
// Without EXPO_PUBLIC_VOICE_URL, with the Convex stub, or for a stub recording, a local stub plays the
// service's part with the phone's own voice, so the screens can be tried on one phone.
import { useCallback, useEffect, useRef, useState } from 'react';

import { micQuiet, notNowMessage, potFor, silence, type Ask, type RecordPhase, type ServerState } from '@/components/record/recordingLogic';
import { markIntroduced } from '@/lib/homie/intro';
import { doneSpeaking, getHomie, pulseLit, setHomie, setHomieLevel } from '@/lib/homie/store';
import { stopAudio, useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';

import { convexSession, endRecording, stubRecordingStatus } from './convex';
import { micStreamingSupported, useMicStream } from './mic';
import { playSay, SAY_KEY_PREFIX } from './say';
import { speak, stopSpeaking } from './speak';

const VOICE_URL = (process.env.EXPO_PUBLIC_VOICE_URL ?? '').trim().replace(/\/$/, '');
/** The service always ends a line with say_end; this only catches one that never came. */
const SAY_GAP_MS = 3000;
const RETRIES = 3;
/** While the in-app camera films, a lost line keeps trying this often (Wi-Fi drops; filming goes on). */
const FILMING_RETRY_MS = 10_000;
/** The hello counts as said this long after it began, even if its end never came. */
const INTRO_MAX_MS = 20_000;
/** A phone recording waits this long for the server to save that filming began, then films anyway. */
const START_WAIT_MS = 8000;

export type RecordingInfo = { language: string; cookName?: string; kidName?: string; dish?: string };
export type HomieError = 'lostConnection' | 'signedOut' | 'ended' | 'elsewhere';

type ServerMsg =
  | { type: 'ready'; recording: { id: string; language: string; cookName: string; kidName?: string; dish?: string } }
  | { type: 'phase'; phase: Exclude<RecordPhase, 'connecting'> }
  | { type: 'state'; state: ServerState }
  | { type: 'say'; text: string; textEn?: string; kind?: string; audio?: { sampleRate?: number }; stubVoice?: boolean }
  | { type: 'say_end'; interrupted?: boolean }
  | ({ type: 'ask' } & Ask)
  | { type: 'drop' | 'answered'; promptId: string }
  | { type: 'transcript'; text: string; final: boolean }
  | { type: 'error'; message: string };

type Socket = {
  send: (data: ArrayBuffer | string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: ((e?: { code?: number }) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  readyState: number;
};

type PendingSay = { chunks: ArrayBuffer[]; rate: number; kind?: string; drop: boolean; timer: ReturnType<typeof setTimeout> | null };

/** Close codes that never get better on retry (STACK.md): signed out, no such recording, a newer socket took over. */
const FINAL_CLOSE: Record<number, HomieError> = { 4401: 'signedOut', 4404: 'ended', 4409: 'elsewhere' };

export function useHomieRecording(recordingId: string | null | undefined, stubInfo: RecordingInfo, { camera = false }: { camera?: boolean } = {}) {
  const { me } = useSession();
  const [phase, setPhase] = useState<RecordPhase>('connecting');
  const [info, setInfo] = useState<RecordingInfo | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [error, setError] = useState<HomieError | null>(null);
  const [serverError, setServerError] = useState(false);

  const sock = useRef<Socket | null>(null);
  /** A connect is waiting for the Convex session (no second one meanwhile). */
  const connecting = useRef(false);
  /** "I'm done" went over a socket: from then on the service is wrapping up. */
  const doneSent = useRef(false);
  const ending = useRef<Promise<boolean> | null>(null);
  const want = useRef(false);
  const paused = useRef(false);
  const retries = useRef(0);
  const afterReady = useRef<{ type: string }[]>([]);
  const introHeard = useRef(false);
  const phaseRef = useRef<RecordPhase>('connecting');
  const phaseWaiters = useRef(new Set<() => void>());
  const say = useRef<PendingSay | null>(null);
  const askRef = useRef<Ask | null>(null);
  const micLive = useRef(false);
  /** The in-app camera is writing a file: the mic must not start or stop now. */
  const cameraBusy = useRef(false);
  /** A mic start that waited for the camera (restartMic does it). */
  const micWanted = useRef(false);
  const cameraMode = useRef(camera);
  const meId = useRef(me?.id);
  const stubRef = useRef(stubInfo);
  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    meId.current = me?.id;
    stubRef.current = stubInfo;
    cameraMode.current = camera;
  });

  // Half duplex: silence instead of the mic (and no steam from the speaker) while the phone talks.
  // The pot's state is read from the store at each chunk, so the lit beat counts from its first frame.
  const now = useNowPlaying();
  const player = useRef({ key: now.key, phase: now.phase as string });
  const playingKey = useRef(now.key);
  useEffect(() => {
    player.current = { key: now.key, phase: now.phase };
    playingKey.current = now.key;
  });
  const quiet = () => micQuiet(getHomie().state, player.current);

  const mic = useMicStream(
    (pcm) => {
      const s = sock.current;
      if (!s || s.readyState !== 1 || paused.current) return;
      s.send(quiet() ? silence(pcm.byteLength) : pcm);
    },
    (level) => {
      if (!paused.current) setHomieLevel(quiet() ? 0 : level);
    },
  );
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  });

  const send = useCallback((msg: { type: string }) => {
    const s = sock.current;
    if (!s || s.readyState !== 1) return;
    s.send(JSON.stringify(msg));
    if (msg.type === 'done') doneSent.current = true;
  }, []);

  const startMic = useCallback(async () => {
    if (micLive.current || !micStreamingSupported()) return;
    if (cameraBusy.current) {
      micWanted.current = true;
      return;
    }
    micLive.current = true;
    micWanted.current = false;
    const r = await micRef.current.start({ camera: cameraMode.current });
    if (r === 'ok') return setMicOn(true);
    micLive.current = false;
    setMicOn(false);
    if (r === 'denied') setMicDenied(true);
  }, []);

  /** Resolves once the recorder has let go of the audio session. While the camera films it keeps running. */
  const stopMic = useCallback(async () => {
    micWanted.current = false;
    if (cameraBusy.current) return;
    micLive.current = false;
    setMicOn(false);
    setHomieLevel(0);
    await micRef.current.stop();
  }, []);

  const showAsk = useCallback((a: Ask | null) => {
    askRef.current = a;
    setAsk(a);
  }, []);

  /** Stops homie's line wherever it is: still arriving, or already playing on the phone. */
  const hush = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (s?.timer) clearTimeout(s.timer);
    if (playingKey.current?.startsWith(SAY_KEY_PREFIX)) stopAudio(playingKey.current);
    stopSpeaking(); // the stub's lines (the phone's voice)
    doneSpeaking();
  }, []);

  const goPhase = useCallback(
    (p: RecordPhase) => {
      phaseRef.current = p;
      setPhase(p);
      for (const w of [...phaseWaiters.current]) w();
      if (p === 'ended') {
        // The goodbye has been said: nothing more to hear, and no reconnect.
        want.current = false;
        showAsk(null);
        void stopMic();
      }
    },
    [showAsk, stopMic],
  );

  const flushSay = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    if (s.drop) return;
    if (!s.chunks.length) return doneSpeaking();
    if (s.kind === 'intro') {
      introHeard.current = true;
      markIntroduced(meId.current);
    }
    playSay(s.chunks, s.rate);
  }, []);

  const onMessage = useCallback(
    (data: unknown) => {
      if (data instanceof ArrayBuffer) {
        const s = say.current;
        if (!s) return;
        s.chunks.push(data);
        if (s.timer) clearTimeout(s.timer);
        s.timer = setTimeout(flushSay, SAY_GAP_MS);
        return;
      }
      let m: ServerMsg;
      try {
        m = JSON.parse(String(data)) as ServerMsg;
      } catch {
        return;
      }
      // A new say cuts off the one before it; any other message ends the line's audio.
      if (m.type === 'say' && say.current?.timer) clearTimeout(say.current.timer);
      else if (m.type !== 'say_end' && say.current) flushSay();
      switch (m.type) {
        case 'ready': {
          const r = m.recording;
          setInfo({ language: r.language, cookName: r.cookName, kidName: r.kidName, dish: r.dish });
          // A new socket has no open question: the old one's drop or answered never comes.
          showAsk(null);
          if (introHeard.current) setIntroDone(true);
          for (const msg of afterReady.current.splice(0)) send(msg);
          return;
        }
        case 'phase':
          goPhase(m.phase);
          if (m.phase === 'intro' && !introTimer.current) introTimer.current = setTimeout(() => setIntroDone(true), INTRO_MAX_MS);
          return;
        case 'state': {
          const pot = potFor(m.state, micLive.current);
          if (pot) setHomie({ state: pot });
          // The service goes quiet once its hello has been said.
          if (phaseRef.current === 'intro' && (m.state === 'quiet' || m.state === 'listening')) setIntroDone(true);
          return;
        }
        case 'say': {
          // While the camera is up nothing plays; after a reconnect the hello isn't said twice.
          const drop = paused.current || (m.kind === 'intro' && introHeard.current);
          if (m.stubVoice) {
            if (!drop) {
              if (m.kind === 'intro') {
                introHeard.current = true;
                markIntroduced(meId.current);
              }
              void speak(m.text, { lang: stubRef.current.language });
            }
            return;
          }
          say.current = { chunks: [], rate: m.audio?.sampleRate ?? 24000, kind: m.kind, drop, timer: null };
          if (!drop) pulseLit();
          return;
        }
        case 'say_end':
          if (!m.interrupted) return flushSay();
          // She tapped start or done mid-line: never play the rest, and stop what is playing.
          return hush();
        case 'ask':
          if (!paused.current) showAsk({ promptId: m.promptId, text: m.text, textEn: m.textEn, kind: m.kind });
          return;
        case 'drop':
        case 'answered':
          if (askRef.current?.promptId === m.promptId) showAsk(null);
          return;
        case 'error':
          console.warn('[homie] the voice service said', m.message);
          // After "I'm done" the screen may end the recording without homie (recording.tsx).
          if (doneSent.current || phaseRef.current === 'wrapping_up') setServerError(true);
          return;
      }
    },
    [flushSay, goPhase, hush, send, showAsk],
  );

  const connectRef = useRef<(() => Promise<void>) | null>(null);

  /** A socket that didn't open or dropped: try again a few times, then say so. */
  const lost = useCallback(() => {
    if (!want.current || paused.current) return; // paused: filmWithPhone reconnects
    if (retries.current < RETRIES) {
      retries.current += 1;
      setTimeout(() => want.current && !paused.current && void connectRef.current?.(), 1500 * retries.current);
      return;
    }
    // Filming in the app: the camera keeps going, so homie keeps trying and comes back on its own.
    if (cameraBusy.current) {
      setError('lostConnection');
      setTimeout(() => want.current && void connectRef.current?.(), FILMING_RETRY_MS);
      return;
    }
    want.current = false;
    void stopMic();
    setError('lostConnection');
  }, [stopMic]);

  const connect = useCallback(async () => {
    if (!recordingId || connecting.current) return;
    // One socket at a time: a retry timer and a tap on stop may both ask for one.
    const open = sock.current;
    if (open && (open.readyState === 0 || open.readyState === 1)) return;
    connecting.current = true;
    // While filming in the app a lost line keeps its message until a socket opens (no flicker per retry).
    if (!cameraBusy.current) setError(null);
    const token = await convexSession(meId.current).catch(() => null);
    connecting.current = false;
    if (!want.current || paused.current || sock.current) return;
    const stub = !VOICE_URL || token === 'stub' || recordingId.startsWith('stub-');
    // A live recording with no session (sessions.start failed): a failed connect, never the stub.
    if (!stub && !token) return lost();
    let s: Socket;
    try {
      s = stub
        ? stubSocket(recordingId, stubRef.current)
        : (new WebSocket(`${VOICE_URL}/record?session=${encodeURIComponent(token!)}&recording=${encodeURIComponent(recordingId)}`) as unknown as Socket);
    } catch (e) {
      console.warn('[homie] could not open the socket', String(e).slice(0, 120));
      return lost();
    }
    if ('binaryType' in s) (s as unknown as WebSocket).binaryType = 'arraybuffer';
    sock.current = s;
    // Only the current socket is heard: an older one's messages, open or close change nothing.
    s.onmessage = (e) => {
      if (sock.current === s) onMessage(e.data);
    };
    s.onopen = () => {
      if (sock.current !== s) return;
      retries.current = 0;
      setError((e) => (e === 'lostConnection' ? null : e));
      if (!paused.current) void startMic();
    };
    s.onclose = (e) => {
      if (sock.current !== s) return;
      sock.current = null;
      // Its question went with it (the server keeps it per socket): nobody would hear her answer.
      showAsk(null);
      const final = e?.code ? FINAL_CLOSE[e.code] : undefined;
      if (final) {
        want.current = false;
        void stopMic();
        if (phaseRef.current !== 'ended') setError(final);
        return;
      }
      lost();
    };
  }, [recordingId, onMessage, startMic, stopMic, lost, showAsk]);
  useEffect(() => {
    connectRef.current = connect;
  });

  const closeSocket = useCallback(() => {
    const s = sock.current;
    sock.current = null;
    s?.close();
  }, []);

  useEffect(() => {
    if (!recordingId) return;
    want.current = true;
    retries.current = 0;
    void connectRef.current?.();
    return () => {
      want.current = false;
      closeSocket();
      void micRef.current.stop();
      micLive.current = false;
      if (say.current?.timer) clearTimeout(say.current.timer);
      say.current = null;
      if (introTimer.current) clearTimeout(introTimer.current);
      if (playingKey.current?.startsWith(SAY_KEY_PREFIX)) stopAudio(playingKey.current);
      stopSpeaking();
      setHomie({ state: 'off', level: 0 });
    };
  }, [recordingId, closeSocket]);

  /** Sends now, or once the socket is back (a dropped connection). */
  const sendOrQueue = useCallback(
    (msg: { type: string }) => {
      if (sock.current?.readyState === 1) return send(msg);
      afterReady.current.push(msg);
      if (!sock.current && !paused.current) {
        want.current = true;
        retries.current = 0;
        void connectRef.current?.();
      }
    },
    [send],
  );

  /** Resolves when the phase is `p` (or later), or after `ms`. */
  const reached = useCallback((p: RecordPhase, ms: number) => {
    const order: RecordPhase[] = ['connecting', 'intro', 'recording', 'wrapping_up', 'ended'];
    const there = () => order.indexOf(phaseRef.current) >= order.indexOf(p);
    return new Promise<void>((resolve) => {
      if (there()) return resolve();
      const finish = () => {
        clearTimeout(t);
        phaseWaiters.current.delete(check);
        resolve();
      };
      const check = () => there() && finish();
      const t = setTimeout(finish, ms);
      phaseWaiters.current.add(check);
    });
  }, []);

  const filmWithPhone = useCallback(
    async (record: () => Promise<boolean>): Promise<boolean> => {
      // Filming starts on the server first, so homie's last questions land on the video's clock.
      sendOrQueue({ type: 'start' });
      await reached('recording', START_WAIT_MS);
      // The camera needs the microphone, and homie asks nothing while it's up: no mic, no voice, no socket.
      paused.current = true;
      showAsk(null);
      hush();
      closeSocket();
      await stopMic();
      const ok = await record();
      paused.current = false;
      if (!ok) return false;
      // Back: the server finds the recording filming and the queued "done" starts the wrap-up.
      afterReady.current.push({ type: 'done' });
      want.current = true;
      retries.current = 0;
      void connectRef.current?.();
      return true;
    },
    [sendOrQueue, reached, showAsk, hush, closeSocket, stopMic],
  );

  /** Filming in the app: start on the server, then the camera (`begin`); the socket and mic stay open. */
  const filmInApp = useCallback(
    async (begin: () => Promise<boolean>): Promise<boolean> => {
      sendOrQueue({ type: 'start', camera: true } as { type: string });
      await reached('recording', START_WAIT_MS);
      return begin();
    },
    [sendOrQueue, reached],
  );

  const cameraFilming = useCallback((on: boolean) => {
    cameraBusy.current = on;
  }, []);

  /**
   * Between two files: the mic fresh, in the camera's audio settings (an interruption may have changed
   * them). `fresh: false` only starts one that waited for the camera (a file rolling over).
   */
  const restartMic = useCallback(async ({ fresh = true }: { fresh?: boolean } = {}) => {
    if (cameraBusy.current || !want.current) return;
    if (!fresh && (micLive.current || !micWanted.current)) return;
    if (micLive.current) {
      micLive.current = false;
      await micRef.current.stop();
    }
    await startMic();
  }, [startMic]);

  const sendFrame = useCallback(
    (jpeg: string) => {
      if (phaseRef.current === 'recording') send({ type: 'frame', jpeg } as { type: string });
    },
    [send],
  );
  const pause = useCallback(() => {
    showAsk(null);
    hush();
    sendOrQueue({ type: 'pause' });
  }, [showAsk, hush, sendOrQueue]);
  const resume = useCallback((gapS: number) => sendOrQueue({ type: 'resume', gapS } as { type: string }), [sendOrQueue]);
  const plateDone = useCallback((ok: boolean) => sendOrQueue({ type: 'plate', ok } as { type: string }), [sendOrQueue]);

  const notNow = useCallback(() => {
    const a = askRef.current;
    if (!a) return;
    send(notNowMessage(a.kind));
    showAsk(null);
  }, [send, showAsk]);

  const retry = useCallback(() => {
    want.current = true;
    retries.current = 0;
    void connectRef.current?.();
  }, []);

  /**
   * Ends the recording through Convex, without the voice service (live.endRecording): the glasses'
   * computer then finishes the video. Here it then counts as ended: no socket, no mic, no reconnect.
   * True once it has ended. Calls while one is on its way share it.
   */
  const end = useCallback((): Promise<boolean> => {
    if (!recordingId) return Promise.resolve(false);
    if (phaseRef.current === 'ended') return Promise.resolve(true);
    ending.current ??= endRecording(recordingId).then((ok) => {
      ending.current = null;
      if (ok && phaseRef.current !== 'ended') {
        want.current = false;
        closeSocket();
        hush();
        setError(null);
        goPhase('ended');
      }
      return ok;
    });
    return ending.current;
  }, [recordingId, closeSocket, hush, goPhase]);

  /** The stop button: "done" over an open socket; with none, Convex ends it (else "done" waits for one). */
  const done = useCallback(() => {
    if (sock.current?.readyState === 1) return send({ type: 'done' });
    if (ending.current) return; // a second tap while Convex is ending it
    void end().then((ok) => {
      if (!ok) sendOrQueue({ type: 'done' });
    });
  }, [send, end, sendOrQueue]);

  return {
    phase,
    info,
    introDone,
    ask,
    micOn,
    micDenied,
    error,
    serverError,
    start: useCallback(() => sendOrQueue({ type: 'start' }), [sendOrQueue]),
    done,
    end,
    notNow,
    filmWithPhone,
    filmInApp,
    cameraFilming,
    restartMic,
    sendFrame,
    pause,
    resume,
    plateDone,
    retry,
  };
}

// ---------------------------------------------------------------------------
// The stand-in for the voice service: the same messages, homie's lines said by the phone's voice.
// Where each stub recording is survives a reconnect (a phone recording closes the socket while the
// camera is up), as the service's memory does.

const STUB_LINES = {
  intro: { en: 'Hello! I’m homie. I may ask a small question now and then. Start whenever you’re ready.', mr: 'नमस्कार! मी homie. मी मधूनच एखादा छोटा प्रश्न विचारेन. तयार झालात की सुरू करा.' },
  ask: { en: 'About how much ginger was that?', mr: 'आलं साधारण किती घातलं?' },
  optin: { en: 'Can {kid} hear your stories too?', mr: '{kid} ला तुमच्या गोष्टी पण ऐकू द्यायच्या का?' },
  closing: { en: 'That’s a wrap. Thank you for sharing it.', mr: 'झालं! हे शेअर केल्याबद्दल खूप धन्यवाद.' },
};
const STUB_ASK_AFTER_MS = 15_000;
const STUB_DROP_MS = 10_000;
type StubPhase = 'intro' | 'recording' | 'wrapping_up' | 'ended';
const stubPhases = new Map<string, StubPhase>();

function stubSocket(recordingId: string, info: RecordingInfo): Socket {
  const lang = info.language === 'mr' ? 'mr' : 'en';
  const kid = info.kidName?.trim() || (lang === 'mr' ? 'घरच्यां' : 'your family');
  const line = (k: keyof typeof STUB_LINES) => ({ text: STUB_LINES[k][lang].replace('{kid}', kid), textEn: STUB_LINES[k].en.replace('{kid}', info.kidName?.trim() || 'your family') });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let phase: StubPhase = stubPhases.get(recordingId) ?? 'intro';
  let waiting: { promptId: string; kind: string } | null = null;
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  const emit = (msg: object) => s.readyState === 1 && s.onmessage?.({ data: JSON.stringify(msg) });
  const toPhase = (p: StubPhase) => {
    phase = p;
    stubPhases.set(recordingId, p);
    stubRecordingStatus(recordingId, p);
    emit({ type: 'phase', phase: p });
  };
  const sayLine = (k: keyof typeof STUB_LINES, kind: string) => emit({ type: 'say', ...line(k), kind, ai: true, stubVoice: true });
  const askLine = (k: 'ask' | 'optin', kind: string) => {
    const promptId = `stub-prompt-${Date.now()}`;
    waiting = { promptId, kind };
    emit({ type: 'ask', promptId, ...line(k), kind });
    sayLine(k, kind);
    later(STUB_DROP_MS + 4000, () => waiting?.promptId === promptId && answer(false));
  };
  const answer = (heard: boolean) => {
    if (!waiting) return;
    const { promptId, kind } = waiting;
    waiting = null;
    emit({ type: heard ? 'answered' : 'drop', promptId });
    if (kind === 'optin') {
      sayLine('closing', 'closing');
      later(4000, () => toPhase('ended'));
    }
  };
  const filming = () => {
    emit({ type: 'state', state: 'listening' });
    later(STUB_ASK_AFTER_MS, () => phase === 'recording' && askLine('ask', 'amount'));
  };
  const wrapUp = () => {
    emit({ type: 'state', state: 'thinking' });
    later(1200, () => askLine('optin', 'optin'));
  };
  const handle = (data: string) => {
    const msg = JSON.parse(data) as { type: string; text?: string };
    if (msg.type === 'start' && phase === 'intro') {
      toPhase('recording');
      filming();
    } else if (msg.type === 'done' && (phase === 'intro' || phase === 'recording')) {
      if (waiting) answer(false);
      toPhase('wrapping_up');
      wrapUp();
    } else if (msg.type === 'not_now' || (msg.type === 'text' && /not now/i.test(msg.text ?? ''))) answer(false);
    else if (msg.type === 'text') answer(true);
  };
  // Like the service: what the app sends on `ready` is handled once the recording is set up.
  let loaded = false;
  const early: string[] = [];
  const s: Socket = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onmessage: null,
    send(data) {
      if (typeof data !== 'string') return;
      if (loaded) handle(data);
      else early.push(data);
    },
    close() {
      timers.forEach(clearTimeout);
      s.readyState = 3;
      setTimeout(() => s.onclose?.(), 0);
    },
  };
  later(150, () => {
    if (phase === 'ended') {
      s.readyState = 3;
      return s.onclose?.({ code: 4404 });
    }
    s.readyState = 1;
    s.onopen?.();
    emit({ type: 'ready', recording: { id: recordingId, language: info.language, cookName: info.cookName ?? '', kidName: info.kidName, dish: info.dish } });
    toPhase(phase);
    if (phase === 'recording') filming();
    else if (phase === 'wrapping_up') wrapUp();
    else {
      emit({ type: 'state', state: 'thinking' });
      later(700, () => sayLine('intro', 'intro'));
      later(6000, () => phase === 'intro' && emit({ type: 'state', state: 'quiet' }));
    }
    loaded = true;
    early.splice(0).forEach(handle);
  });
  return s;
}

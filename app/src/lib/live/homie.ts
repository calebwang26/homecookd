// homie while a cook records (docs/build/STACK.md "App ↔ voice service: homie while recording"):
// wss://<voice>/record?session=<sessionToken>&recording=<recordingId>.
//
//   const homie = useHomieRecording(recordingId, { language, kidName, dish });
//   homie.phase        'connecting' | 'intro' | 'recording' | 'wrapping_up' | 'ended'
//   homie.introDone    homie finished its hello ("Start cooking" may show)
//   homie.start()      she starts cooking      homie.done()   "I'm done"
//   homie.pause()      the phone's own camera is about to open: no mic, no voice, the socket waits
//   homie.resume(true) back from the camera: the end questions (true) or the intro again (false)
//
// The phone by the stove streams the mic (16 kHz PCM) the whole time, except while homie speaks (half
// duplex: no frames while a say plays; the recorder keeps running). homie's lines play on the shared
// player (lib/live/say). The pot follows the service: lit just before a say, then speaking; listening
// with the mic level, thinking. homie's questions are moments (lib/homie store): the question in her
// language with the English under it, "Just say it, I'm listening", Say it again / Not now.
// "Say it again" replays the question's audio on the phone: the service has no repeat message, and
// sending the words "repeat" would be taken as her answer.
// Without EXPO_PUBLIC_VOICE_URL or a Convex session (or for a stub recording), a local stub plays the
// service's part with the phone's own voice, so the screens can be tried on one phone.
import { useCallback, useEffect, useRef, useState } from 'react';

import { askMoment, notNowMessage, potFor, type Ask, type RecordPhase, type ServerState } from '@/components/record/recordingLogic';
import { useAiSpeaking } from '@/lib/homie/hooks';
import { closeMoment, doneSpeaking, pulseLit, setHomie, setHomieLevel, showMoment } from '@/lib/homie/store';
import { cookWords } from '@/lib/homie/strings';
import { stopAudio, useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';

import { convexSession, stubRecordingStatus } from './convex';
import { micStreamingSupported, useMicStream } from './mic';
import { playSay, SAY_KEY_PREFIX } from './say';
import { speak } from './speak';

const VOICE_URL = (process.env.EXPO_PUBLIC_VOICE_URL ?? '').trim().replace(/\/$/, '');
/** No say_end within this long after the last audio frame = the line is complete. */
const SAY_GAP_MS = 400;
const RETRIES = 3;
/** "Start cooking" shows this long after the hello began, even if its end never came. */
const INTRO_MAX_MS = 20_000;

export type RecordingInfo = { language: string; cookName?: string; kidName?: string; dish?: string };

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

type PendingSay = { chunks: ArrayBuffer[]; rate: number; text: string; kind?: string; drop: boolean; timer: ReturnType<typeof setTimeout> | null };

export function useHomieRecording(recordingId: string | null | undefined, stubInfo: RecordingInfo) {
  const { me } = useSession();
  const [phase, setPhase] = useState<RecordPhase>('connecting');
  const [info, setInfo] = useState<RecordingInfo | null>(null);
  const [introDone, setIntroDone] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When filming began on this phone's clock (a fallback until Convex's startedAt arrives). */
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  /** When "I'm done" took effect on this phone's clock (until Convex's endedAt). */
  const [stoppedSince, setStoppedSince] = useState<number | null>(null);

  const sock = useRef<Socket | null>(null);
  const want = useRef(false);
  const paused = useRef(false);
  const retries = useRef(0);
  const afterReady = useRef<object[]>([]);
  const introHeard = useRef(false);
  const phaseRef = useRef<RecordPhase>('connecting');
  const say = useRef<PendingSay | null>(null);
  // The last line homie said, kept so "Say it again" can play the question again.
  const lastSay = useRef<{ chunks: ArrayBuffer[]; rate: number; text: string } | null>(null);
  const ask = useRef<Ask | null>(null);
  const words = useRef(cookWords(stubInfo.language));
  const micLive = useRef(false);
  const meId = useRef(me?.id);
  const stubRef = useRef(stubInfo);
  const introTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    meId.current = me?.id;
    stubRef.current = stubInfo;
  });

  // Half duplex: no frames (and no steam from the speaker) while homie or a say is speaking.
  const aiSpeaking = useAiSpeaking();
  const speaking = useRef(aiSpeaking);
  const now = useNowPlaying();
  const playingKey = useRef(now.key);
  useEffect(() => {
    speaking.current = aiSpeaking;
    playingKey.current = now.key;
  });

  const mic = useMicStream(
    (pcm) => {
      const s = sock.current;
      if (!s || s.readyState !== 1 || paused.current || speaking.current) return;
      s.send(pcm);
    },
    (level) => {
      if (!speaking.current && !paused.current) setHomieLevel(level);
    },
  );
  const micRef = useRef(mic);
  useEffect(() => {
    micRef.current = mic;
  });

  const send = useCallback((msg: object) => {
    const s = sock.current;
    if (s && s.readyState === 1) s.send(JSON.stringify(msg));
  }, []);

  const startMic = useCallback(async () => {
    if (micLive.current || !micStreamingSupported()) return;
    micLive.current = true;
    const r = await micRef.current.start();
    if (r === 'ok') return setMicOn(true);
    micLive.current = false;
    setMicOn(false);
    if (r === 'denied') setMicDenied(true);
  }, []);

  const stopMic = useCallback(() => {
    micLive.current = false;
    setMicOn(false);
    micRef.current.stop();
    setHomieLevel(0);
  }, []);

  const goPhase = useCallback((p: RecordPhase) => {
    phaseRef.current = p;
    setPhase(p);
    if (p === 'recording') setRecordingSince((t) => t ?? Date.now());
    if (p === 'wrapping_up' || p === 'ended') setStoppedSince((t) => t ?? Date.now());
  }, []);

  const flushSay = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
    if (s.drop) return;
    if (!s.chunks.length) return doneSpeaking();
    if (s.kind === 'intro') introHeard.current = true;
    lastSay.current = { chunks: s.chunks, rate: s.rate, text: s.text };
    playSay(s.chunks, s.rate);
  }, []);

  const replay = useCallback((a: Ask) => {
    const last = lastSay.current;
    if (last?.text !== a.text) return void speak(a.text, { lang: words.current.lang });
    pulseLit();
    playSay(last.chunks, last.rate);
  }, []);

  const showAsk = useCallback(
    (a: Ask) => {
      ask.current = a;
      showMoment({
        ...askMoment(a, words.current, micLive.current),
        onChoose: (id) => {
          if (id === 'again') replay(a);
          else if (id === 'yes') send({ type: 'text', text: 'yes' });
          else send(notNowMessage(a.kind));
        },
      });
    },
    [replay, send],
  );

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
          words.current = cookWords(r.language);
          setInfo({ language: r.language, cookName: r.cookName, kidName: r.kidName, dish: r.dish });
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
            if (!drop) void speak(m.text, { lang: words.current.lang });
            return;
          }
          say.current = { chunks: [], rate: m.audio?.sampleRate ?? 24000, text: m.text, kind: m.kind, drop, timer: null };
          if (!drop) pulseLit();
          return;
        }
        case 'say_end':
          if (!m.interrupted) return flushSay();
          if (say.current && !say.current.drop) doneSpeaking();
          say.current = null; // cut off: never play the rest
          return;
        case 'ask':
          if (!paused.current) showAsk(m);
          return;
        case 'drop':
        case 'answered':
          closeMoment(m.promptId);
          if (ask.current?.promptId === m.promptId) ask.current = null;
          return;
        case 'error':
          console.warn('[homie] the voice service said', m.message);
          return;
      }
    },
    [flushSay, goPhase, send, showAsk],
  );

  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const connect = useCallback(async () => {
    if (!recordingId) return;
    setError(null);
    const token = await convexSession(meId.current).catch(() => null);
    if (!want.current) return;
    const real = !!VOICE_URL && !!token && token !== 'stub' && !recordingId.startsWith('stub-');
    const s: Socket = real
      ? (new WebSocket(`${VOICE_URL}/record?session=${encodeURIComponent(token)}&recording=${encodeURIComponent(recordingId)}`) as unknown as Socket)
      : stubSocket(recordingId, stubRef.current);
    if ('binaryType' in s) (s as unknown as WebSocket).binaryType = 'arraybuffer';
    sock.current = s;
    s.onmessage = (e) => onMessage(e.data);
    s.onopen = () => {
      retries.current = 0;
      if (!paused.current) void startMic();
    };
    s.onclose = (e) => {
      if (sock.current !== s) return;
      sock.current = null;
      // 4401: signed out. 4404: no such recording (or it has ended). Neither gets better on retry.
      if (e?.code === 4401 || e?.code === 4404) {
        want.current = false;
        stopMic();
        setError(e.code === 4401 ? 'Signed out. Open homecookd again to sign in.' : 'This recording has ended.');
        return;
      }
      if (!want.current || paused.current) return; // paused: resume() reconnects
      if (retries.current < RETRIES) {
        retries.current += 1;
        setTimeout(() => want.current && !paused.current && void connectRef.current?.(), 1500 * retries.current);
        return;
      }
      want.current = false;
      stopMic();
      setError('Lost homie’s connection. Tap to try again.');
    };
  }, [recordingId, onMessage, startMic, stopMic]);
  useEffect(() => {
    connectRef.current = connect;
  });

  useEffect(() => {
    if (!recordingId) return;
    want.current = true;
    retries.current = 0;
    void connectRef.current?.();
    return () => {
      want.current = false;
      const s = sock.current;
      sock.current = null;
      s?.close();
      micRef.current.stop();
      micLive.current = false;
      if (say.current?.timer) clearTimeout(say.current.timer);
      say.current = null;
      if (introTimer.current) clearTimeout(introTimer.current);
      if (ask.current) closeMoment(ask.current.promptId);
      if (playingKey.current?.startsWith(SAY_KEY_PREFIX)) stopAudio(playingKey.current);
      setHomie({ state: 'off', level: 0 });
    };
  }, [recordingId]);

  /** Sends now, or once the socket is back (a dropped connection). */
  const sendOrQueue = useCallback(
    (msg: object) => {
      if (sock.current?.readyState === 1) return send(msg);
      afterReady.current.push(msg);
      if (!sock.current) {
        want.current = true;
        retries.current = 0;
        void connectRef.current?.();
      }
    },
    [send],
  );

  const pause = useCallback(() => {
    paused.current = true;
    stopMic();
    if (ask.current) closeMoment(ask.current.promptId);
  }, [stopMic]);

  const resume = useCallback(
    (thenDone: boolean) => {
      paused.current = false;
      if (thenDone && sock.current?.readyState === 1) send({ type: 'done' });
      else if (thenDone) {
        // The socket dropped while the camera was up: it comes back in the intro, so skip that, then end.
        sendOrQueue({ type: 'start' });
        afterReady.current.push({ type: 'done' });
      } else if (!sock.current) {
        want.current = true;
        void connectRef.current?.();
      }
      void startMic();
    },
    [send, sendOrQueue, startMic],
  );

  const retry = useCallback(() => {
    want.current = true;
    retries.current = 0;
    void connectRef.current?.();
  }, []);

  return {
    phase,
    info,
    introDone,
    micOn,
    micDenied,
    error,
    recordingSince,
    stoppedSince,
    start: useCallback(() => sendOrQueue({ type: 'start' }), [sendOrQueue]),
    done: useCallback(() => sendOrQueue({ type: 'done' }), [sendOrQueue]),
    pause,
    resume,
    retry,
  };
}

// ---------------------------------------------------------------------------
// The stand-in for the voice service: the same messages, homie's lines said by the phone's voice.

const STUB_LINES = {
  intro: { en: 'Hello! I’m homie. I may ask a small question now and then. Start whenever you’re ready.', mr: 'नमस्कार! मी homie. मी मधूनच एखादा छोटा प्रश्न विचारेन. तयार झालात की सुरू करा.' },
  ask: { en: 'About how much ginger was that?', mr: 'आलं साधारण किती घातलं?' },
  optin: { en: 'Can {kid} hear your stories too?', mr: '{kid} ला तुमच्या गोष्टी पण ऐकू द्यायच्या का?' },
  closing: { en: 'That’s a wrap. Thank you for sharing it.', mr: 'झालं! हे शेअर केल्याबद्दल खूप धन्यवाद.' },
};
const STUB_ASK_AFTER_MS = 15_000;
const STUB_DROP_MS = 10_000;

function stubSocket(recordingId: string, info: RecordingInfo): Socket {
  const lang = info.language === 'mr' ? 'mr' : 'en';
  const kid = info.kidName?.trim() || (lang === 'mr' ? 'घरच्यां' : 'your family');
  const line = (k: keyof typeof STUB_LINES) => ({ text: STUB_LINES[k][lang].replace('{kid}', kid), textEn: STUB_LINES[k].en.replace('{kid}', info.kidName?.trim() || 'your family') });
  const timers: ReturnType<typeof setTimeout>[] = [];
  let phase = 'intro';
  let waiting: { promptId: string; kind: string } | null = null;
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
  const emit = (msg: object) => s.readyState === 1 && s.onmessage?.({ data: JSON.stringify(msg) });
  const toPhase = (p: 'intro' | 'recording' | 'wrapping_up' | 'ended') => {
    phase = p;
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
  const s: Socket = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onmessage: null,
    send(data) {
      if (typeof data !== 'string') return;
      const msg = JSON.parse(data) as { type: string; text?: string };
      if (msg.type === 'start' && phase === 'intro') {
        toPhase('recording');
        emit({ type: 'state', state: 'listening' });
        later(STUB_ASK_AFTER_MS, () => phase === 'recording' && askLine('ask', 'amount'));
      } else if (msg.type === 'done' && (phase === 'intro' || phase === 'recording')) {
        if (waiting) answer(false);
        toPhase('wrapping_up');
        emit({ type: 'state', state: 'thinking' });
        later(1200, () => askLine('optin', 'optin'));
      } else if (msg.type === 'not_now' || (msg.type === 'text' && /not now/i.test(msg.text ?? ''))) answer(false);
      else if (msg.type === 'text') answer(true);
    },
    close() {
      timers.forEach(clearTimeout);
      s.readyState = 3;
      setTimeout(() => s.onclose?.(), 0);
    },
  };
  later(150, () => {
    s.readyState = 1;
    s.onopen?.();
    emit({ type: 'ready', recording: { id: recordingId, language: info.language, cookName: info.cookName ?? '', kidName: info.kidName, dish: info.dish } });
    toPhase('intro');
    emit({ type: 'state', state: 'thinking' });
    later(700, () => sayLine('intro', 'intro'));
    later(6000, () => phase === 'intro' && emit({ type: 'state', state: 'quiet' }));
  });
  return s;
}

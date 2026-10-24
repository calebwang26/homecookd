// Track B boundary: voice cooking over the live voice service's WebSocket (docs/build/STACK.md
// "App ↔ voice service"): wss://<voice>/cook?session=<sessionToken>&recipe=<recipeId>.
//
//   const voice = useVoiceCooking({ libraryId, step, onGoTo, onClip });
//   voice.toggle()            mic on / off (on = streaming 16 kHz PCM)
//   voice.status              'off' | 'connecting' | 'listening' | 'error'
//   voice.heard               the last thing the kid said (server transcript)
//   voice.askedAt             set when the service sent the question to the cook ("I asked Mom")
//
// The app follows the server: go_to_step moves the cook screen, play_clip plays that moment of the
// cook's video, say plays the AI's short reply (lib/live/say). A step the kid taps goes back as
// { type: "step" }. Without EXPO_PUBLIC_VOICE_URL (Track B not deployed) a local stub stands in: it
// can't understand speech, but it counts the PCM it gets ("Hearing you · 3 s"), so the mic
// streaming can be checked on a phone. For a real socket on the laptop: app/scripts/pcm-echo-server.mjs.
import { useCallback, useEffect, useRef, useState } from 'react';

import { convexRecipeId, convexSession, stubAskCook } from './convex';
import { MIC_SAMPLE_RATE, useMicStream } from './mic';
import { playSay } from './say';

const VOICE_URL = (process.env.EXPO_PUBLIC_VOICE_URL ?? '').trim().replace(/\/$/, '');
/** No say_end within this long after the last audio frame = the reply is complete. */
const SAY_GAP_MS = 400;
const RETRIES = 3;

type ServerMsg =
  | { type: 'transcript'; text: string }
  | { type: 'go_to_step'; stepOrder: number }
  | { type: 'play_clip'; startS: number; endS: number }
  | { type: 'say'; text: string; ai: true; audio?: { sampleRate?: number }; sampleRate?: number }
  | { type: 'say_end'; interrupted?: boolean }
  | { type: 'asked_cook'; questionId: string };

/** The part of a WebSocket the hook uses, so the stub can stand in. */
type Socket = {
  send: (data: ArrayBuffer | string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onclose: ((e?: { code?: number }) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  readyState: number;
};

export type VoiceStatus = 'off' | 'connecting' | 'listening' | 'error';

export function useVoiceCooking(opts: { libraryId: string | null; step: number; onGoTo: (n: number) => void; onClip: (startS: number, endS: number) => void }) {
  const [status, setStatus] = useState<VoiceStatus>('off');
  const [heard, setHeard] = useState<string | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sock = useRef<Socket | null>(null);
  const want = useRef(false);
  const retries = useRef(0);
  const micOn = useRef(false);
  const reconnect = useRef<(() => Promise<void>) | null>(null);
  // The step the server just moved us to: not echoed back as a kid's tap.
  const lastServerStep = useRef<number | null>(null);
  const say = useRef<{ chunks: ArrayBuffer[]; rate: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });

  const mic = useMicStream((pcm) => {
    const s = sock.current;
    if (s && s.readyState === 1) s.send(pcm);
  });

  const flushSay = useCallback(() => {
    const s = say.current;
    say.current = null;
    if (!s) return;
    if (s.timer) clearTimeout(s.timer);
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
      // A new say cuts off the one before it (Track B); any other message ends the reply's audio.
      if (m.type === 'say' && say.current?.timer) clearTimeout(say.current.timer);
      else if (m.type !== 'say_end' && say.current) flushSay();
      if (m.type === 'transcript') setHeard(m.text);
      else if (m.type === 'go_to_step') {
        lastServerStep.current = m.stepOrder;
        cb.current.onGoTo(m.stepOrder);
      } else if (m.type === 'play_clip') cb.current.onClip(m.startS, m.endS);
      else if (m.type === 'say') say.current = { chunks: [], rate: m.audio?.sampleRate ?? m.sampleRate ?? 24000, timer: null };
      else if (m.type === 'say_end') {
        if (m.interrupted) say.current = null; // the kid spoke over it: never play the rest
        else flushSay();
      }
      else if (m.type === 'asked_cook') setAskedAt(Date.now());
    },
    [flushSay],
  );

  const connect = useCallback(async () => {
    const libraryId = cb.current.libraryId;
    if (!libraryId) return;
    setStatus('connecting');
    setError(null);
    const [token, recipeId] = await Promise.all([convexSession(), convexRecipeId(libraryId)]).catch(() => [null, libraryId] as const);
    if (!want.current) return;
    const s: Socket = VOICE_URL && token
      ? (new WebSocket(`${VOICE_URL}/cook?session=${encodeURIComponent(token)}&recipe=${encodeURIComponent(recipeId)}`) as unknown as Socket)
      : stubSocket(recipeId, () => cb.current.step);
    if ('binaryType' in s) (s as unknown as WebSocket).binaryType = 'arraybuffer';
    sock.current = s;
    s.onmessage = (e) => onMessage(e.data);
    s.onopen = () => {
      retries.current = 0;
      s.send(JSON.stringify({ type: 'step', stepOrder: cb.current.step }));
      if (!micOn.current) {
        micOn.current = true;
        void mic.start().then((r) => {
          if (r === 'ok') return setStatus('listening');
          micOn.current = false;
          setError(r === 'denied' ? 'homecookd needs the microphone. Turn it on in Settings.' : 'The microphone works in the homecookd app.');
          setStatus('error');
          want.current = false;
          sock.current = null; // closed on purpose: onclose leaves the error up
          s.close();
        });
      } else setStatus('listening');
    };
    s.onclose = (e) => {
      if (sock.current !== s) return;
      sock.current = null;
      // 4401: the session token was refused. 4404: this recipe isn't ready for voice. Neither gets better on retry.
      if (e?.code === 4401 || e?.code === 4404) {
        mic.stop();
        micOn.current = false;
        want.current = false;
        setError(e.code === 4401 ? 'Signed out. Open homecookd again to sign in.' : 'Voice isn’t ready for this recipe yet.');
        setStatus('error');
        return;
      }
      if (want.current && retries.current < RETRIES) {
        retries.current += 1;
        setStatus('connecting');
        setTimeout(() => want.current && void reconnect.current?.(), 1500 * retries.current);
        return;
      }
      mic.stop();
      micOn.current = false;
      if (want.current) {
        setError('Lost the connection. Tap to try again.');
        setStatus('error');
      } else setStatus('off');
      want.current = false;
    };
  }, [mic, onMessage]);

  useEffect(() => {
    reconnect.current = connect;
  });

  const stop = useCallback(() => {
    want.current = false;
    mic.stop();
    micOn.current = false;
    sock.current?.close();
    sock.current = null;
    setStatus('off');
  }, [mic]);

  const toggle = useCallback(() => {
    if (want.current) return stop();
    want.current = true;
    retries.current = 0;
    void connect();
  }, [connect, stop]);

  // A step the kid tapped (not one the server just sent) goes to the server.
  useEffect(() => {
    const s = sock.current;
    if (lastServerStep.current === opts.step) return;
    lastServerStep.current = null;
    if (s && s.readyState === 1) s.send(JSON.stringify({ type: 'step', stepOrder: opts.step }));
  }, [opts.step]);

  // Leaving the screen hangs up.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  useEffect(() => () => stopRef.current(), []);

  return { status, heard, askedAt, error, toggle, stop };
}

/**
 * Track B stand-in: counts the PCM it receives and says so every 3 s of audio. Saying "ask" in a
 * real service sends the question to the cook; here, every 4th report asks the cook on the Convex
 * stub, so the parent's side can be tried on one phone.
 */
function stubSocket(recipeId: string, step: () => number): Socket {
  let bytes = 0;
  let reports = 0;
  const s: Socket = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onmessage: null,
    send(data) {
      if (typeof data === 'string') return;
      bytes += data.byteLength;
      const seconds = Math.floor(bytes / (MIC_SAMPLE_RATE * 2));
      if (seconds >= (reports + 1) * 3) {
        reports += 1;
        s.onmessage?.({ data: JSON.stringify({ type: 'transcript', text: `Hearing you · ${seconds} s` }) });
        if (reports % 4 === 0) {
          const questionId = stubAskCook(recipeId, 'How do I know when it’s done?', step());
          s.onmessage?.({ data: JSON.stringify({ type: 'asked_cook', questionId }) });
        }
      }
    },
    close() {
      s.readyState = 3;
      setTimeout(() => s.onclose?.(), 0);
    },
  };
  setTimeout(() => {
    s.readyState = 1;
    s.onopen?.();
  }, 150);
  return s;
}

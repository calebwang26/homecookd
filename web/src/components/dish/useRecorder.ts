// Mom's voice answers on /a: one microphone stream for the whole visit, asked for on her first press
// of the mic (so the permission prompt comes from her own tap), and one MediaRecorder per answer.
// Chrome, Android and a recent Safari record webm/opus; an older iPhone records mp4 (AAC). Cartesia
// takes both, and both upload as they are. A clip with no sound in it (a muted or broken microphone)
// comes back `silent`, so it is never sent. The stream is let go when the page goes away (pagehide)
// or the questions are done (unmount), so the browser's "recording" dot never lingers.
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Best first; '' lets the browser pick its own default. webm leads because Chrome's mp4 carries
 * Opus, which Safari can't play.
 */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
/** The longest answer: the recorder stops itself here (the server takes up to 120 s). */
export const MAX_MS = 120_000;
/** A clip whose loudest 50 ms stays under this (about −40 dBFS) has no voice in it. */
const SILENT_RMS = 0.01;

/** `silent`: nothing in it was louder than a faint hiss (a muted or broken microphone). */
export type Clip = { blob: Blob; contentType: string; durationS: number; silent: boolean };

/** False in browsers that can't record audio (old in-app browsers, old iOS). */
export function canRecord(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Opened inside an app's own browser: WeChat, Instagram, Facebook, Messenger, Snapchat, TikTok,
 * LinkedIn, X, Pinterest, Reddit, KakaoTalk or Line (the patterns ROUTE_GATE uses in
 * lib/audience-gate.ts, plus KakaoTalk). They may not pass the microphone on, so a refusal there
 * means "open it in Safari or Chrome", not "turn the microphone on".
 */
export function inAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /MicroMessenger|Instagram|Snapchat|musical_ly|BytedanceWebview|TikTok|LinkedInApp|Twitter|Pinterest|Reddit|KAKAOTALK/i.test(ua) ||
    /FBAN|FBAV|FB_IAB|FBIOS| Line\//.test(ua)
  );
}

function pickType(): string {
  for (const t of TYPES) {
    if (!t) return '';
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* no isTypeSupported: try the next one */
    }
  }
  return '';
}

/**
 * True when the clip has no sound in it. A model can write a plausible answer for a clip with no speech
 * (DISH-I-MISS-SPEC §3), so such a clip is never sent. It reads the recorded file itself, which needs
 * no audio graph or tap; a clip this browser can't decode (or not within 2 s) counts as heard.
 */
function isSilent(blob: Blob): Promise<boolean> {
  return Promise.race([measure(blob), new Promise<boolean>((r) => window.setTimeout(() => r(false), 2000))]);
}

async function measure(blob: Blob): Promise<boolean> {
  try {
    const audio = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(await blob.arrayBuffer());
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const data = audio.getChannelData(c);
      const win = Math.min(data.length, Math.round(audio.sampleRate * 0.05));
      for (let i = 0; i + win <= data.length && win > 0; i += win) {
        let sum = 0;
        for (let j = i; j < i + win; j++) sum += data[j] * data[j];
        if (Math.sqrt(sum / win) >= SILENT_RMS) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** "audio/webm;codecs=opus" → "audio/webm". A recorder that won't say: WebKit (every iOS browser) records mp4. */
function contentTypeOf(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (base) return base;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua) ? 'audio/mp4' : 'audio/webm';
}

/**
 * open() asks for the microphone once (call it inside the press); begin() starts an answer; stop()
 * ends it and resolves with the clip (null when nothing was recorded). onLimit runs at MAX_MS.
 */
export function useRecorder(onLimit: () => void, maxMs = MAX_MS) {
  const stream = useRef<MediaStream | null>(null);
  const opening = useRef<Promise<boolean> | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef<number | undefined>(undefined);
  const cap = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const limit = useRef(onLimit);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    limit.current = onLimit;
  });

  const live = useCallback(() => !!stream.current?.getAudioTracks().some((t) => t.readyState === 'live'), []);

  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    window.clearInterval(ticker.current);
    window.clearTimeout(cap.current);
  }, []);

  /** Resolves false when the microphone is blocked or missing. */
  const open = useCallback((): Promise<boolean> => {
    if (live()) return Promise.resolve(true);
    if (!canRecord()) return Promise.resolve(false);
    if (!opening.current) {
      const asking = navigator.mediaDevices.getUserMedia({ audio: true }).then(
        (s) => {
          release(); // a stream that ended (iOS drops it in the background)
          if (!alive.current) {
            s.getTracks().forEach((t) => t.stop());
            return false;
          }
          stream.current = s;
          return true;
        },
        () => false,
      );
      opening.current = asking;
      void asking.then(() => {
        opening.current = null;
      });
    }
    return opening.current;
  }, [live, release]);

  const begin = useCallback((): boolean => {
    const s = stream.current;
    if (!s || !live()) return false;
    const type = pickType();
    let r: MediaRecorder;
    try {
      r = type ? new MediaRecorder(s, { mimeType: type }) : new MediaRecorder(s);
    } catch {
      try {
        r = new MediaRecorder(s);
      } catch {
        return false;
      }
    }
    chunks.current = [];
    r.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.current.push(e.data);
    };
    try {
      r.start(); // one chunk at the end: Safari's timeslice chunks don't always join into a valid file
    } catch {
      return false;
    }
    recorder.current = r;
    startedAt.current = performance.now();
    setElapsedMs(0);
    setRecording(true);
    ticker.current = window.setInterval(() => setElapsedMs(performance.now() - startedAt.current), 250);
    cap.current = window.setTimeout(() => limit.current(), maxMs);
    return true;
  }, [live, maxMs]);

  const stop = useCallback((): Promise<Clip | null> => {
    const r = recorder.current;
    recorder.current = null;
    clearTimers();
    setRecording(false);
    if (!r || r.state === 'inactive') return Promise.resolve(null);
    const durationS = Math.min(maxMs, performance.now() - startedAt.current) / 1000;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const contentType = contentTypeOf(r.mimeType || '');
        const blob = new Blob(chunks.current, { type: contentType });
        chunks.current = [];
        if (!blob.size) return resolve(null);
        void isSilent(blob).then((silent) => resolve({ blob, contentType, durationS, silent }));
      };
      r.onstop = finish; // the last dataavailable always comes first
      r.onerror = finish;
      window.setTimeout(finish, 3000); // a recorder that never says it stopped
      try {
        r.stop();
      } catch {
        finish();
      }
    });
  }, [clearTimers, maxMs]);

  /** Stop without keeping anything. */
  const cancel = useCallback(() => {
    const r = recorder.current;
    recorder.current = null;
    clearTimers();
    setRecording(false);
    chunks.current = [];
    if (r && r.state !== 'inactive') {
      r.ondataavailable = null;
      r.onstop = null;
      try {
        r.stop();
      } catch {
        /* already stopped */
      }
    }
  }, [clearTimers]);

  useEffect(() => {
    alive.current = true;
    const away = () => {
      cancel();
      release();
    };
    window.addEventListener('pagehide', away);
    return () => {
      alive.current = false;
      window.removeEventListener('pagehide', away);
      away();
    };
  }, [cancel, release]);

  return { recording, elapsedMs, hasStream: live, open, begin, stop, cancel };
}

// homie's voice outside a live socket (docs/build/STACK.md "Voice service HTTP"): the pot's tap hints,
// a kid's question read to the cook in her language, "Sent to Shreya".
//
//   await speak('Tap Record to cook with me.', { translate: true })   in the person's language
//   await speak(question.textForCook, { lang: 'mr' })                  already in Marathi
//   stopSpeaking()
//
// POST <voice https base>/speak -> audio/wav, played on the app's one shared player under a 'say:'
// key, so useNowPlaying sees it: the pot lights, then speaks with its "AI voice" label, and the mic
// sends silence meanwhile (half duplex, lib/live/mic). Without the service (no URL, no Convex session,
// an error, or no audio within 8 s, session included), the phone's own voice (expo-speech) says the
// words. So does a phone that hasn't said yes to the AI companies yet (lib/aiConsent): nothing goes
// to the service until it has.
// homie never talks over a video (Caleb, Oct 24): while one plays, a line waits for it to stop, and a
// newer line replaces it. Only `answer` (a reply to the kid's own tap) speaks at once, and the video
// pauses for it (homie's voice pauses it on the shared player; the phone's voice pauses it first).
// Resolves once the voice starts (or didn't); never throws. A call from an effect right after sign-in passes `profileId` from useSession(): the
// module snapshot convexSession() falls back to isn't published yet then.
import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';

import { hasAiConsent } from '@/lib/aiConsent';
import { deviceVoiceLanguage, voiceHttpBase } from '@/lib/homie/logic';
import { doneSpeaking, LIT_BEAT_MS, setHomie } from '@/lib/homie/store';
import { onVideoChange, pauseAllVideos, playClip, stopAudio, videoPlaying, videoStopped } from '@/lib/media';

import { convexSession } from './convex';
import { SAY_KEY_PREFIX } from './say';

const BASE = voiceHttpBase(process.env.EXPO_PUBLIC_VOICE_URL ?? '');
const TIMEOUT_MS = 8000;
// WAV files kept in the cache. Each line gets a new file name: the shared player (lib/media) reuses
// a player whose URL hasn't changed, so writing a new line over an old name would replay the old one.
const SLOTS = 3;
let written = 0;

export type SpeakOptions = {
  /** Ink-style code ('mr', 'en'). Unset: the person's language (the service knows it). */
  lang?: string;
  /** `text` is English: say it in `lang` (or the person's language). */
  translate?: boolean;
  /** Under the pot while it speaks (default "AI voice"). */
  label?: string;
  profileId?: string;
  /** A reply to the kid's own tap (on homie, on Ask): said now, pausing any video. Else it waits for the video. */
  answer?: boolean;
};

/** What was said ('' if nothing), and by whom: homie's voice, the phone's voice, or nobody. */
export type Spoken = { text: string; via: 'homie' | 'phone' | 'none' };

let turn = 0;
let playing: string | null = null;
// The pot's lit / speaking beat is ours (not the live socket's), so stopSpeaking may end it.
let ownsBeat = false;

export async function speak(text: string, opts: SpeakOptions = {}): Promise<Spoken> {
  const words = text.trim();
  if (!words) return { text: '', via: 'none' };
  stopSpeaking();
  const mine = ++turn;
  const label = opts.label ?? 'AI voice';
  // Not over a video: the line waits for it (a newer line, or stopSpeaking, drops this one).
  const quiet = async () => {
    if (!opts.answer && videoPlaying()) await videoStopped();
    return mine === turn;
  };
  if (!(await quiet())) return { text: '', via: 'none' };
  const started = Date.now();
  ownsBeat = true;
  setHomie({ state: 'lit', label });
  try {
    const wav = await fetchSpeech(words, opts);
    // The lit beat before any voice.
    await wait(LIT_BEAT_MS - (Date.now() - started));
    // A video the kid started while the line was on its way: it still waits.
    if (!(await quiet())) return { text: '', via: 'none' };
    if (wav && play(wav.bytes, mine)) return { text: wav.spoken || words, via: 'homie' };
    if (opts.answer) pauseAllVideos();
    return sayOnPhone(words, opts.translate ? undefined : opts.lang, mine, label);
  } catch (e) {
    console.warn('[speak]', String(e).slice(0, 160));
    if (mine === turn) end();
    return { text: '', via: 'none' };
  }
}

function end() {
  if (ownsBeat) doneSpeaking();
  ownsBeat = false;
}

/** Stops what speak() is saying (not the cook's clips, not the live socket's says). */
export function stopSpeaking() {
  turn += 1;
  if (playing) stopAudio(playing);
  playing = null;
  Speech.stop().catch(() => {});
  end();
}

/**
 * homie's voice from the service, or null. One deadline (TIMEOUT_MS) covers all of it: the Convex
 * session (it waits while the phone is offline), the request and the body, so the pot is never left
 * lit and the phone's own voice still gets its turn.
 */
async function fetchSpeech(text: string, opts: SpeakOptions): Promise<{ bytes: Uint8Array; spoken: string } | null> {
  if (!BASE || !(await hasAiConsent())) return null;
  const deadline = Date.now() + TIMEOUT_MS;
  const sessionToken = await within(convexSession(opts.profileId).catch(() => null), TIMEOUT_MS);
  if (!sessionToken || sessionToken === 'stub') return null;
  const left = deadline - Date.now();
  if (left <= 0) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), left);
  try {
    const res = await fetch(`${BASE}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken, text, lang: opts.lang, translate: !!opts.translate }),
      signal: abort.signal,
    });
    if (!res.ok) {
      console.warn('[speak] the voice service said', res.status);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 64) return null;
    let spoken = '';
    try {
      spoken = decodeURIComponent(res.headers.get('x-spoken-text') ?? '');
    } catch {
      // a malformed header: show what we asked for
    }
    return { bytes, spoken };
  } catch (e) {
    console.warn('[speak] voice service unreachable', String(e).slice(0, 120));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function play(bytes: Uint8Array, mine: number): boolean {
  const n = ++written;
  const file = new File(Paths.cache, `homie-say-${n}.wav`);
  try {
    const old = new File(Paths.cache, `homie-say-${n - SLOTS}.wav`);
    if (n > SLOTS && old.exists) old.delete();
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
  } catch (e) {
    console.warn('[speak] could not write the audio', String(e));
    return false;
  }
  playing = `${SAY_KEY_PREFIX}homie:${mine}`;
  setHomie({ state: 'speaking' });
  playClip({ url: file.uri, key: playing });
  return true;
}

/**
 * The phone's own voice. Only for words we have in that language: a translation needs the service.
 * A video starting stops it (the shared player's lines stop on their own: lib/media).
 */
function sayOnPhone(words: string, lang: string | undefined, mine: number, label: string): Spoken {
  const off = onVideoChange(() => {
    if (videoPlaying()) Speech.stop().catch(() => {});
  });
  const finish = () => {
    off();
    if (mine === turn) end();
  };
  try {
    setHomie({ state: 'speaking', label });
    Speech.speak(words, { language: deviceVoiceLanguage(lang), onDone: finish, onStopped: finish, onError: finish });
    return { text: words, via: 'phone' };
  } catch {
    finish();
    return { text: '', via: 'none' };
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** `p`, or null once `ms` pass first. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

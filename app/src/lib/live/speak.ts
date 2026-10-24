// homie's voice outside a live socket (docs/build/STACK.md "Voice service HTTP"): the pot's tap hints,
// a kid's question read to the cook in her language, "Sent to Shreya".
//
//   await speak('Tap Record to cook with me.', { translate: true })   in the person's language
//   await speak(question.textForCook, { lang: 'mr' })                  already in Marathi
//   stopSpeaking()
//
// POST <voice https base>/speak -> audio/wav, played on the app's one shared player under a 'say:'
// key, so useNowPlaying sees it: the pot lights, then speaks with its "AI voice" label, and the mic
// sends nothing meanwhile (half duplex). Without the service (no URL, no Convex session, an error or
// a timeout), the phone's own voice (expo-speech) says the words; the screen shows them either way.
// Resolves once the voice starts (or didn't); never throws. A call from an effect right after sign-in passes `profileId` from useSession(): the
// module snapshot convexSession() falls back to isn't published yet then.
import { fetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';

import { deviceVoiceLanguage, voiceHttpBase } from '@/lib/homie/logic';
import { doneSpeaking, LIT_BEAT_MS, setHomie } from '@/lib/homie/store';
import { playClip, stopAudio } from '@/lib/media';

import { convexSession } from './convex';
import { SAY_KEY_PREFIX } from './say';

const BASE = voiceHttpBase(process.env.EXPO_PUBLIC_VOICE_URL ?? '');
const TIMEOUT_MS = 8000;
const SLOTS = 3; // WAV files in the cache, reused in turn (never the one the player has open)

export type SpeakOptions = {
  /** Ink-style code ('mr', 'en'). Unset: the person's language (the service knows it). */
  lang?: string;
  /** `text` is English: say it in `lang` (or the person's language). */
  translate?: boolean;
  /** Under the pot while it speaks (default "AI voice"). */
  label?: string;
  profileId?: string;
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
  const started = Date.now();
  ownsBeat = true;
  setHomie({ state: 'lit', label });
  try {
    const wav = await fetchSpeech(words, opts);
    // The lit beat before any voice.
    await wait(LIT_BEAT_MS - (Date.now() - started));
    if (mine !== turn) return { text: '', via: 'none' };
    if (wav && play(wav.bytes, mine)) return { text: wav.spoken || words, via: 'homie' };
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

async function fetchSpeech(text: string, opts: SpeakOptions): Promise<{ bytes: Uint8Array; spoken: string } | null> {
  if (!BASE) return null;
  const sessionToken = await convexSession(opts.profileId).catch(() => null);
  if (!sessionToken || sessionToken === 'stub') return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
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
  const file = new File(Paths.cache, `homie-say-${mine % SLOTS}.wav`);
  try {
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

/** The phone's own voice. Only for words we have in that language: a translation needs the service. */
function sayOnPhone(words: string, lang: string | undefined, mine: number, label: string): Spoken {
  const finish = () => {
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

// The voice service's spoken replies ({ type: "say" } + binary audio): written to a small WAV in the
// cache and played on the app's one shared player (lib/media), so it stops the step video and a
// story's voice, like any other voice. homie's overlay labels it "AI voice" under the pot while its key
// plays (lib/homie logic speakingLabel), or what lib/live/voice set ("Translated from Grandma").
// stopSay() cuts off the reply playing now (a tap on homie's offer answers it).
import { File, Paths } from 'expo-file-system';

import { playClip, stopAudio } from '@/lib/media';

export const SAY_KEY_PREFIX = 'say:';
export const TRANSLATION_KEY_PREFIX = 'say:translation:';

/** A 44-byte WAV header for mono 16-bit PCM. */
function wavHeader(bytes: number, sampleRate: number): Uint8Array {
  const h = new DataView(new ArrayBuffer(44));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => h.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF');
  h.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  h.setUint32(16, 16, true);
  h.setUint16(20, 1, true); // PCM
  h.setUint16(22, 1, true); // mono
  h.setUint32(24, sampleRate, true);
  h.setUint32(28, sampleRate * 2, true);
  h.setUint16(32, 2, true);
  h.setUint16(34, 16, true);
  ascii(36, 'data');
  h.setUint32(40, bytes, true);
  return new Uint8Array(h.buffer);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

let seq = 0;
let playing: string | null = null;

/** Plays one reply (false if it couldn't). A WAV from the server plays as is; raw PCM is s16le at `sampleRate`. */
export function playSay(chunks: ArrayBuffer[], sampleRate = 24000, translation = false): boolean {
  if (!chunks.length) return false;
  const body = concat(chunks.map((c) => new Uint8Array(c)));
  const isWav = body.length > 4 && String.fromCharCode(...body.slice(0, 4)) === 'RIFF';
  const bytes = isWav ? body : concat([wavHeader(body.length, sampleRate), body]);
  seq += 1;
  const file = new File(Paths.cache, `say-${seq % 4}.wav`); // a few slots, reused
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
  } catch (e) {
    console.warn('[say] could not write the reply', String(e));
    return false;
  }
  playing = `${translation ? TRANSLATION_KEY_PREFIX : SAY_KEY_PREFIX}${seq}`;
  playClip({ url: file.uri, key: playing });
  return true;
}

/** Stops the reply playing now, if one is (never the cook's clips or homie's other voice). */
export function stopSay(): void {
  if (playing) stopAudio(playing);
  playing = null;
}

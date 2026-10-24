// The voice service's spoken replies ({ type: "say" } + binary audio): written to a small WAV in the
// cache and played on the app's one shared player (lib/media), so it stops the step video and a
// story's voice, like any other voice. The cook screen labels it "AI voice" while its key plays, or
// "Translated from Grandma" for a translation of the clip that just played (its key: TRANSLATION_KEY_PREFIX).
import { File, Paths } from 'expo-file-system';

import { playClip } from '@/lib/media';

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

/** Plays one reply. A WAV from the server plays as is; raw PCM is s16le at `sampleRate`. */
export function playSay(chunks: ArrayBuffer[], sampleRate = 24000, translation = false): void {
  if (!chunks.length) return;
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
    return;
  }
  playClip({ url: file.uri, key: `${translation ? TRANSLATION_KEY_PREFIX : SAY_KEY_PREFIX}${seq}` });
}

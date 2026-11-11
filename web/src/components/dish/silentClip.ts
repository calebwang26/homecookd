// Whether one of Mom's answers has no sound in it, so it is never sent (useRecorder.ts). Pure, for its test.

/**
 * A clip this browser couldn't decode is "heard" unless it is smaller than this many bytes per recorded second.
 * Measured in Chrome on Nov 11: a live mic track that delivers no audio (an interruption, a stalled clock)
 * leaves a 110-byte webm with only its header, at any length; the thinnest clip with any sound in it was
 * 3,532 bytes a second (AAC, a −50 dBFS hiss: 3,547), and Opus clips with sound about 16,000.
 */
export const FLOOR_BYTES_PER_S = 250;

/**
 * `decoded`: what the clip itself showed when decoded (true: nothing in it louder than a faint hiss; false:
 * something was), or null when this browser couldn't decode it, or not within 2 s. A decoded clip keeps that
 * answer whatever its size. One that couldn't be decoded counts as heard, so a real answer is never refused for
 * the browser's sake, unless it is too small to hold any audio at all.
 */
export function silentClip(decoded: boolean | null, bytes: number, durationS: number): boolean {
  if (decoded !== null) return decoded;
  return bytes < FLOOR_BYTES_PER_S * durationS;
}

/** How long the clip's own decode may take before it counts as "couldn't tell" (a slow phone, a long answer). */
export const DECODE_MS = 2000;

/**
 * silentClip on a decode that may never finish: once `ms` pass, it counts as "couldn't tell" (null), so the size
 * floor decides, the same as a decode that failed.
 */
export function silentWithin(decoding: Promise<boolean | null>, bytes: number, durationS: number, ms = DECODE_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((r) => {
    timer = setTimeout(() => r(null), ms);
  });
  return Promise.race([decoding, late]).then((decoded) => {
    clearTimeout(timer);
    return silentClip(decoded, bytes, durationS);
  });
}

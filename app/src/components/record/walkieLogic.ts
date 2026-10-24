// The walkie-talkie's listening rules, pure (node scripts/test-recording-ui.mjs). After homie reads
// the kid's question, the recorder runs with metering, and these say when her answer is over (about
// 2 s quiet after at least ~1 s of talking: send it) and when nobody answered (~15 s with no talking:
// homie asks once more, then the screen closes with nothing sent).
//
//   let l = startListening(now);
//   l = hear(l, rec.level, now);          every meter reading (0..1)
//   verdict(l, now)                       'listening' | 'send' | 'no_answer'

/** The recorder's level (metering -60..0 dBFS as 0..1): above this (about -27 dBFS) is her voice. */
export const SPEECH_LEVEL = 0.55;
export const MIN_SPEECH_MS = 1000;
export const END_SILENCE_MS = 2000;
export const NO_ANSWER_MS = 15_000;
/** One reading counts for at most this long (a meter that stalls isn't a long word). */
const MAX_STEP_MS = 300;
/** The question is asked this many times in all before the screen gives up. */
export const ASKS = 2;

export type Listen = { startedAt: number; lastAt: number; speechMs: number; lastSpeechAt: number | null };

export function startListening(now: number): Listen {
  return { startedAt: now, lastAt: now, speechMs: 0, lastSpeechAt: null };
}

/** One meter reading. */
export function hear(l: Listen, level: number, now: number): Listen {
  const dt = Math.max(0, Math.min(MAX_STEP_MS, now - l.lastAt));
  if (!(level >= SPEECH_LEVEL)) return { ...l, lastAt: now };
  return { ...l, lastAt: now, speechMs: l.speechMs + dt, lastSpeechAt: now };
}

export function verdict(l: Listen, now: number): 'listening' | 'send' | 'no_answer' {
  const quietFor = l.lastSpeechAt == null ? now - l.startedAt : now - l.lastSpeechAt;
  if (l.speechMs >= MIN_SPEECH_MS) return quietFor >= END_SILENCE_MS ? 'send' : 'listening';
  // Never cut her off mid-word, even at 15 s.
  return now - l.startedAt >= NO_ANSWER_MS && quietFor >= END_SILENCE_MS ? 'no_answer' : 'listening';
}

/** After a time with no answer: ask again, or close. `asked` counts the times homie has read it. */
export function afterNoAnswer(asked: number): 'ask_again' | 'close' {
  return asked < ASKS ? 'ask_again' : 'close';
}

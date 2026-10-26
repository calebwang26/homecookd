// The walkie-talkie's rules, pure (node scripts/test-recording-ui.mjs). After homie reads the kid's
// question, the recorder runs with metering, and these say when her answer is over (about 2 s quiet
// after at least ~1 s of talking: send it) and when nobody answered (~15 s with no talking: homie asks
// once more, then the screen closes with nothing sent). A share ask (questions.kind 'share': someone
// wants her dish on the Community map) waits for a yes or no, so a short word is already an answer.
// Also how a question reads on her screens: her language first, the kid's English small under it.
//
//   let l = startListening(now, q.kind);
//   l = hear(l, rec.level, now);          every meter reading (0..1)
//   verdict(l, now)                       'listening' | 'send' | 'no_answer'
//   questionLines(q)                      { main, en }

/** The recorder's level (metering -60..0 dBFS as 0..1): above this (about -27 dBFS) is her voice. */
export const SPEECH_LEVEL = 0.55;
export const MIN_SPEECH_MS = 1000;
/** A yes or no ("हो", "नको") is short: enough for a share ask. */
export const MIN_YES_NO_MS = 300;
export const END_SILENCE_MS = 2000;
export const NO_ANSWER_MS = 15_000;
/** One reading counts for at most this long (a meter that stalls isn't a long word). */
const MAX_STEP_MS = 300;
/** The question is asked this many times in all before the screen gives up. */
export const ASKS = 2;

export type Listen = { startedAt: number; lastAt: number; speechMs: number; lastSpeechAt: number | null; minSpeechMs: number };

/**
 * `kind`: the question's kind (unset for a kid's cooking question; 'share' for a share ask; 'followUp' for
 * homie's own question, often "did you add …?"). The last two take a short yes or no.
 */
export function startListening(now: number, kind?: string | null): Listen {
  const yesNo = kind === 'share' || kind === 'followUp';
  return { startedAt: now, lastAt: now, speechMs: 0, lastSpeechAt: null, minSpeechMs: yesNo ? MIN_YES_NO_MS : MIN_SPEECH_MS };
}

/** One meter reading. */
export function hear(l: Listen, level: number, now: number): Listen {
  const dt = Math.max(0, Math.min(MAX_STEP_MS, now - l.lastAt));
  if (!(level >= SPEECH_LEVEL)) return { ...l, lastAt: now };
  return { ...l, lastAt: now, speechMs: l.speechMs + dt, lastSpeechAt: now };
}

export function verdict(l: Listen, now: number): 'listening' | 'send' | 'no_answer' {
  const quietFor = l.lastSpeechAt == null ? now - l.startedAt : now - l.lastSpeechAt;
  if (l.speechMs >= l.minSpeechMs) return quietFor >= END_SILENCE_MS ? 'send' : 'listening';
  // Never cut her off mid-word, even at 15 s.
  return now - l.startedAt >= NO_ANSWER_MS && quietFor >= END_SILENCE_MS ? 'no_answer' : 'listening';
}

/** After a time with no answer: ask again, or close. `asked` counts the times homie has read it. */
export function afterNoAnswer(asked: number): 'ask_again' | 'close' {
  return asked < ASKS ? 'ask_again' : 'close';
}

/**
 * A question on her screens (Parent Home's rows, the walkie-talkie): `main` in her language (Track F's
 * `textForCook`, else what homie said when it translated it), and `en`, the kid's own English, small
 * under it and marked translated (null when `main` is already the kid's words).
 */
export function questionLines(q: { text: string; textForCook?: string | null }, spoken?: string | null): { main: string; en: string | null } {
  const theirs = q.text.trim();
  const main = q.textForCook?.trim() || spoken?.trim() || theirs;
  return { main, en: main !== theirs ? theirs : null };
}

/**
 * The walkie's question type and homie, so a long one (a share ask is a paragraph) still fits a phone.
 * `compact`: the column may use the room under it too, instead of staying centred on the screen.
 */
export function questionFit(main: string): { font: number; homie: number; compact: boolean } {
  const n = main.trim().length;
  if (n <= 60) return { font: 36, homie: 200, compact: false };
  if (n <= 120) return { font: 30, homie: 200, compact: false };
  return { font: 24, homie: 150, compact: true };
}

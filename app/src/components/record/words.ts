// The cook's words on the recording screen v3, homie's questions while she records, the walkie-talkie
// v2 and the done screen, in English (here) and the other languages a cook can pick (wordsByLanguage.ts,
// Oct 24). She sees her language big with the English small under it; a language with no words yet gets the
// English alone (homie still speaks to her in her language). Marathi was dropped (Oct 26): a cook who saved it
// reads Hindi (lib/languages activeLanguage). A `hint` is a small English line under the words in every
// language ("Tap when you're done"). Pure TS (node scripts/test-recording-ui.mjs).
//
//   const w = recordWords('hi');
//   w.line('stop')                        -> { text: 'मेरा हो गया', en: 'Tap when you’re done' }
//   w.line('doneSending', { kid })        -> { text: 'हो गया! Shreya को भेजा जा रहा है', en: 'Done! Sending it to Shreya' }
//   w.text('sentTo', { kid })             -> 'Shreya को भेजा गया'

import { activeLanguage } from '../../lib/languages';

import { OTHER_WORDS } from './wordsByLanguage';

/** A line in her language, and the small English under it (null when there is none). */
export type Line = { text: string; en: string | null };

type Words = { en: string; hint?: string };

const WORDS = {
  gettingReady: { en: 'homie is getting ready' },
  sayingHello: { en: 'homie is saying hello' },
  stop: { en: 'I’m done', hint: 'Tap when you’re done' },
  wrappingUp: { en: 'Almost done' },
  listening: { en: 'Go ahead, I’m listening', hint: 'Just answer out loud' },
  tapToClose: { en: 'Tap anywhere to close' },
  kidAsked: { en: '{kid} asked' },
  sentTo: { en: 'Sent to {kid}' },
  answered: { en: 'This question has its answer' },
  doneSending: { en: 'Done! Sending it to {kid}' },
  doneSendingAll: { en: 'Done! Sending it to your family' },
  doneSaving: { en: 'Done! Saving it to your recipes' },
  sendingNow: { en: 'Sending…' },
  couldntSend: { en: 'That didn’t send. Say it again.' },
  micOff: { en: 'homie can’t hear you. Turn on the microphone in Settings.' },
  noMicHere: { en: 'homie can’t hear you here. Open homecookd on your phone.' },
  lostConnection: { en: 'Lost homie’s connection.' },
  signedOut: { en: 'Signed out. Open homecookd again to sign in.' },
  ended: { en: 'This recording has ended.' },
  elsewhere: { en: 'This recording is open on another phone.' },
  tryAgain: { en: 'Try again' },
  filmWithoutHomie: { en: 'Film without homie' },
  skipIntro: { en: 'Skip, start filming' },
  tapToStart: { en: 'Tap to start', hint: 'Starts recording from your glasses' },
  leave: { en: 'Leave' },
  // Filming in the app (components/record/useInAppCamera, PlateMoment).
  stopped: { en: 'Recording stopped while you were away', hint: 'Your video so far is saved' },
  keepFilming: { en: 'Keep filming' },
  imDone: { en: 'I’m done' },
  takePhoto: { en: 'Take the photo' },
  notNow: { en: 'Not now' },
  plateGot: { en: 'Got it! That’s the cover.' },
  cameraTrouble: { en: 'The camera stopped. Your video so far is saved.' },
  // The flip button under the icon (FlipCameraButton).
  flipCamera: { en: 'Flip camera' },
} as const satisfies Record<string, Words>;

export type RecordWordKey = keyof typeof WORDS;

/** Words for a cook who speaks `lang` (an ISO 639-1 code; unset = English). */
export function recordWords(lang: string | null | undefined) {
  const other = OTHER_WORDS[(activeLanguage(lang) ?? 'en').toLowerCase()];
  const line = (key: RecordWordKey, vars: { kid?: string } = {}): Line => {
    const w: Words = WORDS[key];
    const kid = vars.kid?.trim();
    const en = w.en.replace(/\{kid\}/g, kid || 'your family');
    if (!other) return { text: en, en: w.hint ?? null };
    return { text: other[key].replace(/\{kid\}/g, kid || other.family), en: w.hint ?? en };
  };
  return { line, text: (key: RecordWordKey, vars: { kid?: string } = {}) => line(key, vars).text };
}

export type RecordWords = ReturnType<typeof recordWords>;

/** "Done! Sending it to Shreya" / "…to your family" / "…to your recipes" (nobody else in the family). */
export function doneLine(w: RecordWords, to: { kid: string | null; everyone: boolean; nobody: boolean }): Line {
  if (to.nobody) return w.line('doneSaving');
  if (to.everyone || !to.kid?.trim()) return w.line('doneSendingAll');
  return w.line('doneSending', { kid: to.kid });
}

/** Every key's English (the test reads this). */
export function recordWordTable(): Record<string, Words> {
  return WORDS;
}

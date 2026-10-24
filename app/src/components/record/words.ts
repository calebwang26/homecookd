// More of the cook's words, for the recording screen v3, homie's questions while she records, the
// walkie-talkie v2 and the done screen (the rest are in lib/homie/strings). Same shape: a Marathi cook
// sees the Marathi big with English small under it. A `hint` is a small English line under the words
// in every language ("Tap when you're done"). Pure TS (node scripts/test-recording-ui.mjs).
//
//   const w = recordWords('mr');
//   w.line('stop')                        -> { text: 'माझं झालं', en: 'Tap when you’re done' }
//   w.line('doneSending', { kid })        -> { text: 'झालं! Shreya ला पाठवतोय', en: 'Done! Sending it to Shreya' }
//
// TODO(caleb): native check of every Marathi line (drafts). A Latin name is followed by a space and
// the Marathi ending ("Shreya ला"), as lib/homie/strings does.
import type { Line } from '@/lib/homie/strings';

type Words = { en: string; mr: string; hint?: string };

const WORDS = {
  stop: { en: 'I’m done', mr: 'माझं झालं', hint: 'Tap when you’re done' },
  listening: { en: 'Go ahead, I’m listening', mr: 'बोला, मी ऐकतोय', hint: 'Just answer out loud' },
  tapToClose: { en: 'Tap anywhere to close', mr: 'बंद करायला कुठेही टॅप करा' },
  doneSending: { en: 'Done! Sending it to {kid}', mr: 'झालं! {kid} ला पाठवतोय' },
  doneSendingAll: { en: 'Done! Sending it to your family', mr: 'झालं! घरच्यांना पाठवतोय' },
  doneSaving: { en: 'Done! Saving it to your recipes', mr: 'झालं! तुमच्या रेसिपीत ठेवतोय' },
  sendingNow: { en: 'Sending…', mr: 'पाठवतोय…' },
  couldntSend: { en: 'That didn’t send. Say it again.', mr: 'पाठवता आलं नाही. पुन्हा बोला.' },
  micOff: { en: 'homie can’t hear you. Turn on the microphone in Settings.', mr: 'homie ला तुमचं ऐकू येत नाही. Settings मध्ये मायक्रोफोन चालू करा.' },
  noMicHere: { en: 'homie can’t hear you here. Open homecookd on your phone.', mr: 'इथे homie ला ऐकू येत नाही. फोनवर homecookd उघडा.' },
  lostConnection: { en: 'Lost homie’s connection.', mr: 'homie शी संपर्क तुटला.' },
  signedOut: { en: 'Signed out. Open homecookd again to sign in.', mr: 'साइन आउट झालं. homecookd पुन्हा उघडा.' },
  ended: { en: 'This recording has ended.', mr: 'हे रेकॉर्डिंग संपलं आहे.' },
  elsewhere: { en: 'This recording is open on another phone.', mr: 'हे रेकॉर्डिंग दुसऱ्या फोनवर उघडलं आहे.' },
  filmWithoutHomie: { en: 'Film without homie', mr: 'homie शिवाय रेकॉर्ड करा' },
  leave: { en: 'Leave', mr: 'बाहेर पडा' },
} as const satisfies Record<string, Words>;

export type RecordWordKey = keyof typeof WORDS;

/** Words for a cook who speaks `lang` (an ISO 639-1 code; unset = English). */
export function recordWords(lang: string | null | undefined) {
  const own = (lang ?? 'en').toLowerCase() === 'mr';
  const line = (key: RecordWordKey, vars: { kid?: string } = {}): Line => {
    const w: Words = WORDS[key];
    const kid = vars.kid?.trim();
    const en = w.en.replace(/\{kid\}/g, kid || 'your family');
    if (!own) return { text: en, en: w.hint ?? null };
    return { text: w.mr.replace(/\{kid\}/g, kid || 'घरच्यां'), en: w.hint ?? en };
  };
  return { line };
}

export type RecordWords = ReturnType<typeof recordWords>;

/** "Done! Sending it to Shreya" / "…to your family" / "…to your recipes" (nobody else in the family). */
export function doneLine(w: RecordWords, to: { kid: string | null; everyone: boolean; nobody: boolean }): Line {
  if (to.nobody) return w.line('doneSaving');
  if (to.everyone || !to.kid?.trim()) return w.line('doneSendingAll');
  return w.line('doneSending', { kid: to.kid });
}

/** Every key has both languages (the test reads this). */
export function recordWordTable(): Record<string, Words> {
  return WORDS;
}

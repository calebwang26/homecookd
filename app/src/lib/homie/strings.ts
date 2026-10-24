// The words on the cook's recording and walkie-talkie screens, in English and Marathi. A Marathi cook
// sees the Marathi big with the English small under it; every other language gets the English alone
// (homie still speaks to her in her language). Pure TS (node scripts/test-recording-ui.mjs).
//
//   const s = cookWords('mr');
//   s.line('imDone')               -> { text: 'माझं झालं', en: 'I’m done' }
//   s.line('forKid', { kid })      -> { text: 'Shreya साठी', en: 'for Shreya' }
//
// TODO(caleb): native check of every Marathi line (drafts). A Latin name is followed by a space and
// the Marathi ending ("Shreya ला"), as homie's own lines do.

export type WordKey = keyof typeof WORDS;
export type Line = { text: string; en: string | null };
type Vars = { kid?: string; n?: number | string; language?: string };

const WORDS = {
  recording: { en: 'Recording', mr: 'रेकॉर्डिंग चालू आहे' },
  recordingGlasses: { en: 'Recording from the glasses', mr: 'चष्म्यातून रेकॉर्डिंग चालू आहे' },
  recordingPhone: { en: 'Recording on the phone', mr: 'फोनवर रेकॉर्डिंग चालू आहे' },
  gettingReady: { en: 'homie is getting ready', mr: 'homie तयार होतोय' },
  sayingHello: { en: 'homie is saying hello', mr: 'homie नमस्कार करतोय' },
  wrappingUp: { en: 'Almost done', mr: 'जवळजवळ झालं' },
  imDone: { en: 'I’m done', mr: 'माझं झालं' },
  startCooking: { en: 'Start cooking', mr: 'स्वयंपाक सुरू करा' },
  forKid: { en: 'for {kid}', mr: '{kid} साठी' },
  cookAsAlways: { en: 'Cook the way you always do. homie will ask a question now and then.', mr: 'नेहमीसारखं स्वयंपाक करा. homie मधूनच एखादा प्रश्न विचारेल.' },
  justSayIt: { en: 'Just say it, I’m listening', mr: 'बोला, मी ऐकतोय' },
  sayItAgain: { en: 'Say it again', mr: 'पुन्हा सांग' },
  notNow: { en: 'Not now', mr: 'आत्ता नको' },
  yes: { en: 'Yes', mr: 'हो' },
  doneAsk: { en: 'Done cooking?', mr: 'स्वयंपाक झाला?' },
  yesDone: { en: 'Yes, I’m done', mr: 'हो, झालं' },
  notYet: { en: 'Not yet', mr: 'अजून नाही' },
  onItsWay: { en: 'Your recording is on its way', mr: 'तुमचं रेकॉर्डिंग पाठवलं जातंय' },
  hearAgain: { en: 'Hear again', mr: 'पुन्हा ऐका' },
  holdAndTalk: { en: 'Hold and talk', mr: 'दाबून धरा, बोला' },
  letGoToSend: { en: 'Let go to send', mr: 'सोडल्यावर {kid} ला जाईल' },
  sending: { en: 'Sending… Undo', mr: 'पाठवतोय… रद्द करा' },
  sentTo: { en: 'Sent to {kid}', mr: '{kid} ला पाठवलं' },
  notSent: { en: 'Not sent', mr: 'पाठवलं नाही' },
  holdLonger: { en: 'Hold longer', mr: 'जरा जास्त वेळ दाबून धरा' },
  tryAgain: { en: 'Try again', mr: 'पुन्हा प्रयत्न करा' },
  kidAsked: { en: '{kid} asked', mr: '{kid} ने विचारलं' },
  step: { en: 'Step {n}', mr: 'पायरी {n}' },
  readToYou: { en: 'homie read it to you in {language}', mr: 'homie ने तुम्हाला वाचून दाखवलं' },
  answered: { en: 'This question has its answer', mr: 'या प्रश्नाचं उत्तर दिलंय' },
} as const satisfies Record<string, { en: string; mr: string }>;

/** The languages these screens are written in. Anything else reads English. */
export const WRITTEN = ['en', 'mr'] as const;

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/** Digits in the language's own script ("३" in Marathi). */
export function localDigits(n: number | string, lang: string): string {
  const s = String(n);
  return lang === 'mr' ? s.replace(/[0-9]/g, (d) => DEVANAGARI_DIGITS[Number(d)]) : s;
}

function fill(template: string, vars: Vars, lang: string): string {
  return template
    .replace(/\{kid\}/g, vars.kid?.trim() || (lang === 'mr' ? 'घरच्यां' : 'your family'))
    .replace(/\{n\}/g, vars.n == null ? '' : localDigits(vars.n, lang))
    .replace(/\{language\}/g, vars.language ?? '');
}

/** Words for a cook who speaks `lang` (an ISO 639-1 code; unset = English). */
export function cookWords(lang: string | null | undefined) {
  const code = (lang ?? 'en').toLowerCase();
  const own = code === 'mr';
  /** Marathi first, English small under it (null when the line is already English). */
  const line = (key: WordKey, vars: Vars = {}): Line => {
    const w = WORDS[key];
    const en = fill(w.en, vars, 'en');
    return own ? { text: fill(w.mr, vars, 'mr'), en } : { text: en, en: null };
  };
  return { lang: code, line, text: (key: WordKey, vars: Vars = {}) => line(key, vars).text };
}

export type CookWords = ReturnType<typeof cookWords>;

/** Every key has both languages (the test reads this). */
export function wordTable(): Record<string, { en: string; mr: string }> {
  return WORDS;
}

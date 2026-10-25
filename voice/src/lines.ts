// homie's fixed lines while a cook records, in English and hand-written Marathi. Other languages get a
// strict translation of the English (homie.ts translate). The intro here is only the fallback for when
// Claude can't write one. homie talks like a warm older cousin: short sentences, a comma after the cook's name.
// TODO(caleb): a native Marathi speaker still has to check these Marathi lines. Oct 24 changed only their
// punctuation and sentence breaks (a comma after the name, long sentences split), no words. `introAgain`'s
// "पुन्हा भेटून छान वाटलं." (good to see you again) is new; the rest of it is the intro's own sentences.
import { translate, type AskKind, type Line, type Who } from "./homie.js";

type Fixed = (w: Who) => { en: string; mr: string };

/**
 * "You're making Varan Bhaat for Shreya today. How lovely." Who it's for is the kid's name, or "your family" when
 * it's for more than one person: never a guessed "your son" or "your grandchild" (Caleb, Oct 24).
 * TODO(caleb): "घरच्यांसाठी" (for your family) is new Marathi, like `introAgain`'s line below.
 */
const forToday = (w: Who) => {
  const en = w.kid ?? "your family";
  const mr = w.kid ? `${w.kid} साठी` : "घरच्यांसाठी";
  return w.dish
    ? { en: `You're making ${w.dish} for ${en} today. How lovely. `, mr: `आज तुम्ही ${mr} ${w.dish} करताय. किती छान. ` }
    : { en: `You're cooking for ${en} today. How lovely. `, mr: `आज तुम्ही ${mr} स्वयंपाक करताय. किती छान. ` };
};

const FIXED = {
  intro: (w) => ({
    en: `Hi, ${w.call}. I'm homie. ${forToday(w).en}Being filmed while you cook can feel a little strange, I know. Now and then, I'll ask a little question. And it's okay to ignore me. Set the phone near the stove. Start whenever you're ready.`,
    mr: `नमस्कार, ${w.call}! मी homie. ${forToday(w).mr}स्वयंपाक करताना कोणी शूट करतंय, हे जरा विचित्र वाटतं, माहितीये. मी मधूनच एखादा छोटा प्रश्न विचारेन. उत्तर नाही दिलं तरी चालेल. फोन गॅसजवळ ठेवा, आणि तयार झालात की सुरू करा.`,
  }),
  // homie has recorded with this cook before: no introduction, no explaining (Caleb, Oct 24).
  introAgain: (w) => ({
    en: `Hi, ${w.call}. Good to see you again. ${forToday(w).en}Start whenever you're ready.`,
    mr: `नमस्कार, ${w.call}! पुन्हा भेटून छान वाटलं. ${forToday(w).mr}तयार झालात की सुरू करा.`,
  }),
  beforeYouGo2: () => ({ en: "Before you go, two quick ones.", mr: "जाण्याआधी दोन छोटे प्रश्न." }),
  beforeYouGo1: () => ({ en: "Before you go, one quick one.", mr: "जाण्याआधी एक छोटा प्रश्न." }),
  // Filmed in the app: the last thing homie asks for is a photo of the plate (the recipe's cover).
  // TODO(caleb): native Marathi check, like the lines above.
  plate: (w) => ({
    en: `Last thing, ${w.call}. Hold the plate up to the camera, so ${w.kid ?? "your family"} can see how it looks.`,
    mr: `शेवटचं, ${w.call}. ताट कॅमेऱ्यासमोर धरा, म्हणजे ${w.kid ? `${w.kid} ला` : "घरच्यांना"} दिसेल ते कसं दिसतं.`,
  }),
  plateThanks: () => ({ en: "Got it. Thank you!", mr: "मिळालं. धन्यवाद!" }),
  optIn: (w) => ({
    en: w.kid ? `Can ${w.kid} hear your stories too?` : "Can your family hear your stories too?",
    mr: w.kid ? `${w.kid} ला तुमच्या गोष्टी पण ऐकू द्यायच्या का?` : "घरच्यांना तुमच्या गोष्टी पण ऐकू द्यायच्या का?",
  }),
  closing: (w) => ({
    en: `That's a wrap! ${w.kid ?? "Your family"} is going to hear every bit of this. Thank you for sharing it.`,
    mr: `झालं! ${w.kid ? `${w.kid} हे सगळं ऐकणार आहे.` : "घरचे हे सगळं ऐकणार आहेत."} हे शेअर केल्याबद्दल खूप खूप धन्यवाद.`,
  }),
} satisfies Record<string, Fixed>;

export type FixedLine = keyof typeof FIXED;

/** A fixed line in the cook's language, with its English. `latin` has the names as written in English. */
export async function fixedLine(name: FixedLine, w: Who, latin: Who = w): Promise<Line> {
  const { mr } = FIXED[name](w);
  const { en } = FIXED[name](latin);
  if (w.language === "en") return { text: en, textEn: en };
  if (w.language === "mr") return { text: mr, textEn: en };
  const text = await translate(FIXED[name](w).en, w.language, "homie").catch(() => "");
  return { text: text || en, textEn: en };
}

/**
 * HOMIE_SCRIPTED=1 (the filmed demo): homie asks these in turn, one every 5 minutes, without deciding
 * anything from what it hears. Generic on purpose, so they fit any moment of any dish; her answers are
 * logged like any question's and reach the recipe through homieLog.
 * TODO(caleb): a native Marathi speaker still has to check these, like the lines above.
 */
const SCRIPTED: { kind: AskKind; line: Fixed }[] = [
  { kind: "amount", line: (w) => ({ en: `${w.call}, what did you just add, and about how much?`, mr: `${w.call}, आत्ता काय घातलं, आणि साधारण किती?` }) },
  { kind: "story", line: (w) => ({ en: `${w.call}, is there a story behind this dish? Who taught you?`, mr: `${w.call}, या पदार्थामागे काही गोष्ट आहे का? तुम्हाला कोणी शिकवलं?` }) },
  { kind: "cue", line: (w) => ({ en: `${w.call}, how do you know this part is ready?`, mr: `${w.call}, हे तयार झालं हे तुम्हाला कसं कळतं?` }) },
  { kind: "amount", line: (w) => ({ en: `${w.call}, in that last step, how much did you use?`, mr: `${w.call}, आत्ताच्या पायरीत तुम्ही किती घातलं?` }) },
  { kind: "story", line: (w) => ({ en: `${w.call}, what's the story behind that last ingredient?`, mr: `${w.call}, त्या शेवटच्या पदार्थामागची गोष्ट काय आहे?` }) },
  { kind: "substitution", line: (w) => ({ en: `${w.call}, if someone can't find one of these ingredients, what could they use instead?`, mr: `${w.call}, यातलं एखादं साहित्य मिळालं नाही, तर त्याऐवजी काय वापरता येईल?` }) },
];

/** The nth scripted question (it wraps around), in the cook's language, with its English. */
export async function scriptedQuestion(n: number, w: Who, latin: Who = w): Promise<{ kind: AskKind; line: Line }> {
  const q = SCRIPTED[n % SCRIPTED.length];
  const { mr } = q.line(w);
  const { en } = q.line(latin);
  if (w.language === "en") return { kind: q.kind, line: { text: en, textEn: en } };
  if (w.language === "mr") return { kind: q.kind, line: { text: mr, textEn: en } };
  const text = await translate(q.line(w).en, w.language, "homie").catch(() => "");
  return { kind: q.kind, line: { text: text || en, textEn: en } };
}

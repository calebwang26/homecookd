// homie's fixed lines while a cook records, in English and hand-written Marathi. Other languages get a
// strict translation of the English (homie.ts translate). The intro here is only the fallback for when
// Claude can't write one.
import { translate, type Line, type Who } from "./homie.js";

type Fixed = (w: Who) => { en: string; mr: string };

const FIXED = {
  intro: (w) => ({
    en: `Hello ${w.call}! I'm homie. ${w.kid && w.dish ? `You're making ${w.dish} for ${w.kid} today. How lovely. ` : w.kid ? `You're cooking for ${w.kid} today. How lovely. ` : ""}Being filmed while you cook can feel a little strange, I know. I may ask a small question now and then, and it's fine to ignore me. Set the phone near the stove, and start whenever you're ready.`,
    mr: `नमस्कार ${w.call}! मी homie. ${w.kid && w.dish ? `आज तुम्ही ${w.kid} साठी ${w.dish} करताय, किती छान. ` : w.kid ? `आज तुम्ही ${w.kid} साठी स्वयंपाक करताय, किती छान. ` : ""}स्वयंपाक करताना कोणी शूट करतंय, हे जरा विचित्र वाटतं, माहितीये. मी मधूनच एखादा छोटा प्रश्न विचारेन, उत्तर नाही दिलं तरी चालेल. फोन गॅसजवळ ठेवा, आणि तयार झालात की सुरू करा.`,
  }),
  beforeYouGo2: () => ({ en: "Before you go, two quick ones.", mr: "जाण्याआधी दोन छोटे प्रश्न." }),
  beforeYouGo1: () => ({ en: "Before you go, one quick one.", mr: "जाण्याआधी एक छोटा प्रश्न." }),
  optIn: (w) => ({
    en: w.kid ? `Can ${w.kid} hear your stories too?` : "Can your family hear your stories too?",
    mr: w.kid ? `${w.kid} ला तुमच्या गोष्टी पण ऐकू द्यायच्या का?` : "घरच्यांना तुमच्या गोष्टी पण ऐकू द्यायच्या का?",
  }),
  closing: (w) => ({
    en: `That's a wrap. ${w.kid ?? "Your family"} is going to hear every bit of this. Thank you for sharing it.`,
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
  const text = await translate(FIXED[name](w).en, w.language).catch(() => "");
  return { text: text || en, textEn: en };
}

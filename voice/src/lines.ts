// homie's fixed lines while a cook records, in English. Every other language gets a strict translation of the
// English (homie.ts translate); the hand-written Marathi left with Marathi on Oct 26 (memory marathi-dropped), and a
// cook who picked Marathi before gets Claude's Marathi like any other language. The intro here is only the fallback
// for when Claude can't write one. homie talks like a warm older cousin: short sentences, a comma after the cook's name.
import { translate, type AskKind, type Line, type Who } from "./homie.js";

type Fixed = (w: Who) => string;
/** How a line reaches her language: homie.ts translate, or a test's fake. */
type Translate = (text: string, to: string, as: "homie") => Promise<string>;

/**
 * "You're making Varan Bhaat for Shreya today. How lovely." Who it's for is the kid's name, or "your family" when
 * it's for more than one person: never a guessed "your son" or "your grandchild" (Caleb, Oct 24).
 */
const forToday = (w: Who) => {
  const who = w.kid ?? "your family";
  return w.dish ? `You're making ${w.dish} for ${who} today. How lovely. ` : `You're cooking for ${who} today. How lovely. `;
};

const FIXED = {
  intro: (w) =>
    `Hi, ${w.call}. I'm homie. ${forToday(w)}Being filmed while you cook can feel a little strange, I know. Now and then, I'll ask a little question. And it's okay to ignore me. Set the phone near the stove. Start whenever you're ready.`,
  // homie has recorded with this cook before: no introduction, no explaining (Caleb, Oct 24).
  introAgain: (w) => `Hi, ${w.call}. Good to see you again. ${forToday(w)}Start whenever you're ready.`,
  // Filmed in the app: the last thing homie asks for is a photo of the plate (the recipe's cover).
  plate: (w) => `Last thing, ${w.call}. Hold the plate up to the camera, so ${w.kid ?? "your family"} can see how it looks.`,
  plateThanks: () => "Got it. Thank you!",
  optIn: (w) => (w.kid ? `Can ${w.kid} hear your stories too?` : "Can your family hear your stories too?"),
  // A wrap-up question she hasn't answered after 5 s: homie checks she's still there, with no hurry (Caleb, Oct 24:
  // "Are you still there? Can you answer the question?"). Still quiet 5 s later: homie lets her off kindly and wraps
  // up ("That's okay. It seems like you don't want to answer today. All good, we can wrap up the dish"), never a
  // guilt trip.
  stillThere: (w) => `Still there, ${w.call}? Take your time. I'm listening.`,
  letOff: (w) => `That's okay, ${w.call}. No need to answer today. All good, let's finish up.`,
  closing: (w) => `That's a wrap! ${w.kid ?? "Your family"} is going to hear every bit of this. Thank you for sharing it.`,
} satisfies Record<string, Fixed>;

export type FixedLine = keyof typeof FIXED;

/** A written line in the cook's language, with its English. `latin` has the names as written in English. */
async function lineOf(line: Fixed, w: Who, latin: Who, tr: Translate): Promise<Line> {
  const en = line(latin);
  if (w.language === "en") return { text: en, textEn: en };
  const text = await tr(line(w), w.language, "homie").catch(() => "");
  return { text: text || en, textEn: en };
}

/** A fixed line in the cook's language, with its English. */
export const fixedLine = (name: FixedLine, w: Who, latin: Who = w, tr: Translate = translate): Promise<Line> => lineOf(FIXED[name], w, latin, tr);

const NUMBERS = ["", "one", "two", "three"];

/**
 * The wrap-up's first line: how many questions homie has left and whether a plate photo comes, so she knows how long
 * to stay (Caleb, Oct 25: "homie should specify the number of questions it has for the parent"). Nothing to count
 * (no question, no photo): null. Nothing homie says later may contradict it ("one more", "last question").
 */
const COUNT: (questions: number, photo: boolean) => Fixed = (n, photo) => () => {
  if (!n) return "Before we send it, one photo of your plate.";
  const qs = `${NUMBERS[n] ?? n} quick question${n === 1 ? "" : "s"}`;
  return photo ? `Before we send it, ${qs} and a photo of your plate.` : `Just ${qs} before we send it.`;
};

/** The count line for `questions` spoken questions (and the plate photo, if `photo`), or null when there's neither. */
export async function countLine(questions: number, photo: boolean, w: Who, latin: Who = w, tr: Translate = translate): Promise<Line | null> {
  return questions > 0 || photo ? lineOf(COUNT(questions, photo), w, latin, tr) : null;
}

/**
 * HOMIE_SCRIPTED=1 (the filmed demo): homie asks these in turn, one every 5 minutes, without deciding
 * anything from what it hears. Generic on purpose, so they fit any moment of any dish; the cook's answers are
 * logged like any question's and reach the recipe through homieLog.
 */
const SCRIPTED: { kind: AskKind; line: Fixed }[] = [
  { kind: "amount", line: (w) => `${w.call}, what did you just add, and about how much?` },
  { kind: "story", line: (w) => `${w.call}, is there a story behind this dish? Who taught you?` },
  { kind: "cue", line: (w) => `${w.call}, how do you know this part is ready?` },
  { kind: "amount", line: (w) => `${w.call}, in that last step, how much did you use?` },
  { kind: "story", line: (w) => `${w.call}, what's the story behind that last ingredient?` },
  { kind: "substitution", line: (w) => `${w.call}, if someone can't find one of these ingredients, what could they use instead?` },
];

/** The nth scripted question (it wraps around), in the cook's language, with its English. */
export async function scriptedQuestion(n: number, w: Who, latin: Who = w, tr: Translate = translate): Promise<{ kind: AskKind; line: Line }> {
  const q = SCRIPTED[n % SCRIPTED.length];
  return { kind: q.kind, line: await lineOf(q.line, w, latin, tr) };
}

/**
 * A scripted question of this kind that hasn't been asked (`asked`: the English of what was), or null. homie asks
 * it when Claude's question guessed a family role (homie.ts guessesFamily). There's none for "show".
 */
export async function scriptedOf(kind: AskKind, asked: readonly string[], w: Who, latin: Who = w): Promise<{ kind: AskKind; line: Line } | null> {
  const q = SCRIPTED.find((s) => s.kind === kind && !asked.includes(s.line(latin)));
  return q ? { kind, line: await lineOf(q.line, w, latin, translate) } : null;
}

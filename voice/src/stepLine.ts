// What homie says when the kid lands on a step: "Step 3. Splash in the Shaoxing wine, then the soy sauce." Short and
// spoken (about 20 words at most), cut from the step's own text with plain rules and no Claude call, so every
// step's line is known (and its audio made, lineCache.ts) the moment the recipe opens (Caleb, Oct 24). The screen
// shows the whole step; the line only says what it is.
import type { Step } from "./convex.js";

/** Words after "Step N.", so the whole line stays at about 20. */
export const LINE_WORDS = 18;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** A new sentence starts after . ! ? and a capital ("approx. 5 min" stays one). */
const SENTENCE = /(?<=[.!?])\s+(?=["'“(]?[A-Z])/;
/** Where a sentence can be cut: "; ", ", then ", " and then ", " – ". */
const JOINT = /;\s|,?\s(?:and\s)?then\s|\s[–—]\s/g;
/** A head that can't stand alone: "If it's dry, then add water." */
const DEPENDENT = /^(if|when|once|while|as|until|after|before|because)\b/i;

/** Ends like a sentence: no dangling comma, and a full stop if it has none. */
const sentence = (s: string) => s.replace(/[\s,;:–—-]+$/, "").replace(/([^.!?…])$/, "$1.");

/** The step's text, shortened to at most LINE_WORDS words. */
export function shortStep(text: string, title = ""): string {
  const sentences = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().split(SENTENCE).filter(Boolean);
  // 1. Whole sentences from the first, as many as fit.
  let body = "";
  for (const s of sentences) {
    const more = body ? `${body} ${s}` : s;
    if (words(more) > LINE_WORDS) break;
    body = more;
  }
  if (body) return sentence(body);
  // 2. The first sentence up to its last joint that fits: "Lay the fish on the grate…, then flip once…".
  const first = sentences[0] ?? "";
  let head = "";
  for (const m of first.matchAll(JOINT)) {
    const piece = first.slice(0, m.index);
    if (words(piece) > LINE_WORDS) break;
    if (words(piece) >= 3 && !DEPENDENT.test(piece)) head = piece;
  }
  if (head) return sentence(head);
  // 3. The step's title ("Melt the sugar to amber"), unless it's only a number.
  const name = title.replace(/\s+/g, " ").trim();
  if (name && !/^step \d+$/i.test(name)) return sentence(name.split(" ").slice(0, LINE_WORDS).join(" "));
  // 4. The first words of the step.
  return sentence(first.split(" ").slice(0, LINE_WORDS).join(" "));
}

/** "Step N. <the step, shortened>": the line homie says on every step change. */
export const stepLine = (step: Pick<Step, "order" | "title" | "text">) => `Step ${step.order}. ${shortStep(step.text, step.title)}`;

// Reads the pipeline's recipe.json (docs/HACKATHON-SPEC.md, section 4) into the fields Convex keeps.
// The full file stays in GCS; Convex keeps what the app lists, the voice service reads aloud, and Moss
// indexes: the steps and the stories and tips, each with its moment in the video. A memory also keeps where
// it sits in recipe.json (its step, id, title, why), because the public copy of the file leaves it out.
// Every text field is English; a step's quoteOriginal keeps the cook's own words (quote_original, e.g. her
// Marathi) for the caption, and `language` is what she spoke (an ISO 639-1 code).
type Moment = { startS: number; endS: number };
export type ParsedRecipe = {
  title: string;
  libraryId?: string;
  coverUrl?: string;
  language?: string;
  steps: { order: number; title: string; text: string; quote?: string; quoteOriginal?: string; moment: Moment }[];
  memories: {
    kind: "story" | "tip";
    text: string;
    moment: Moment;
    step?: number;
    id?: string;
    title?: string;
    why?: string;
  }[];
  /** recipe.json's follow_up_questions; `ingredient` marks a "did you add …?" one (pipeline/seen.py). */
  followUps: FollowUp[];
};
export type FollowUp = { id: string; step?: number; question: string; ingredient?: string };
/** At most this many questions reach the cook from one recipe. */
export const MAX_FOLLOW_UPS = 5;

const str = (x: unknown, max = 4000) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : undefined);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const url = (x: unknown) => {
  const s = str(x, 2000);
  return s && /^https:\/\//.test(s) ? s : undefined;
};
const moment = (o: Record<string, unknown>, fallback?: Moment): Moment => {
  const startS = num(o.start_s) ?? fallback?.startS ?? 0;
  return { startS, endS: Math.max(startS, num(o.end_s) ?? fallback?.endS ?? startS) };
};
const objects = (x: unknown, max: number) =>
  (Array.isArray(x) ? x : []).filter((o): o is Record<string, unknown> => !!o && typeof o === "object").slice(0, max);

/** The recipe, or the reason it can't be used. */
export function parseRecipeJson(raw: unknown): ParsedRecipe | string {
  if (!raw || typeof raw !== "object") return "recipe must be an object";
  const r = raw as Record<string, unknown>;
  const title = str(r.title, 200);
  if (!title) return "recipe.title is missing";

  const steps: ParsedRecipe["steps"] = [];
  for (const [i, s] of objects(r.steps, 100).entries()) {
    const text = str(s.instruction);
    if (!text) return `recipe.steps[${i}].instruction is missing`;
    steps.push({
      order: num(s.order) ?? i + 1,
      title: str(s.title, 200) ?? `Step ${i + 1}`,
      text,
      quote: str(s.quote, 1000),
      quoteOriginal: str(s.quote_original, 1000),
      moment: moment(s),
    });
  }
  if (!steps.length) return "recipe.steps is empty";
  steps.sort((a, b) => a.order - b.order);

  const stepOrder = (n: unknown) => steps.find((s) => s.order === n)?.order;
  const stepMoment = (n: unknown) => steps.find((s) => s.order === n)?.moment;
  const memories: ParsedRecipe["memories"] = [];
  for (const s of objects(r.stories, 50)) {
    const text = str(s.text);
    if (text) {
      const at = { step: stepOrder(s.step), id: str(s.id, 200), title: str(s.title, 200) };
      memories.push({ kind: "story", text, moment: moment(s, stepMoment(s.step)), ...at });
    }
  }
  for (const x of objects(r.special, 50)) {
    const text = str(x.text);
    if (text) {
      const at = { step: stepOrder(x.step), id: str(x.id, 200), why: str(x.why, 1000) };
      memories.push({ kind: "tip", text, moment: moment(x, stepMoment(x.step)), ...at });
    }
  }
  for (const [i, s] of objects(r.steps, 100).entries()) {
    const text = str(s.tip);
    if (text) memories.push({ kind: "tip", text, moment: moment(s), step: num(s.order) ?? i + 1 });
  }

  const followUps: FollowUp[] = [];
  for (const q of objects(r.follow_up_questions, 20)) {
    const id = str(q.id, 100);
    const question = str(q.question, 500);
    if (!id || !question || followUps.some((f) => f.id === id)) continue;
    followUps.push({ id, question, step: stepOrder(q.about_step), ingredient: str(q.ingredient, 100) });
    if (followUps.length === MAX_FOLLOW_UPS) break;
  }
  const media = r.media && typeof r.media === "object" ? (r.media as Record<string, unknown>) : {};
  const language = str(r.language, 10)?.toLowerCase();
  return {
    title,
    libraryId: str(r.id, 200),
    coverUrl: url(media.poster_url),
    language: language && /^[a-z]{2}$/.test(language) ? language : undefined,
    steps,
    memories,
    followUps,
  };
}

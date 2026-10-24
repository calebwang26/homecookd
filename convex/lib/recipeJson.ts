// Reads the pipeline's recipe.json (docs/HACKATHON-SPEC.md, section 4) into the fields Convex keeps.
// The full file stays in GCS; Convex keeps what the app lists, the voice service reads aloud, and Moss
// indexes: the steps and the stories and tips, each with its moment in the video.
// Every text field is English; a step's quote_original (the cook's Marathi) stays in the GCS file only.
type Moment = { startS: number; endS: number };
export type ParsedRecipe = {
  title: string;
  libraryId?: string;
  coverUrl?: string;
  steps: { order: number; title: string; text: string; quote?: string; moment: Moment }[];
  memories: { kind: "story" | "tip"; text: string; moment: Moment }[];
};

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
      moment: moment(s),
    });
  }
  if (!steps.length) return "recipe.steps is empty";
  steps.sort((a, b) => a.order - b.order);

  const stepMoment = (n: unknown) => steps.find((s) => s.order === n)?.moment;
  const memories: ParsedRecipe["memories"] = [];
  for (const s of objects(r.stories, 50)) {
    const text = str(s.text);
    if (text) memories.push({ kind: "story", text, moment: moment(s, stepMoment(s.step)) });
  }
  for (const x of objects(r.special, 50)) {
    const text = str(x.text);
    if (text) memories.push({ kind: "tip", text, moment: moment(x, stepMoment(x.step)) });
  }
  for (const s of objects(r.steps, 100)) {
    const text = str(s.tip);
    if (text) memories.push({ kind: "tip", text, moment: moment(s) });
  }

  const media = r.media && typeof r.media === "object" ? (r.media as Record<string, unknown>) : {};
  return { title, libraryId: str(r.id, 200), coverUrl: url(media.poster_url), steps, memories };
}

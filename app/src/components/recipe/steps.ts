// Cook mode's short step words (kid QA round 2, Oct 22): substeps and "Ingredients" for one step.
// Pure (no React), so scripts/test-steps.mjs runs it in Node.
//   stepSubsteps(step)          step.substeps (pipeline/shorten.py), else the instruction split at
//                               sentence ends, "; " and ", then <verb>", plus the sensory cue as a last
//                               "**Ready when** …" line (only a real test, never the cook's chatter, and
//                               not when the instruction already says it). Amounts, heat and times in
//                               the split text are bolded.
//   stepUses(step, ings, fallback)  step.uses, else `fallback` (lib/recipes stepIngredients), as
//                               Ingredients for the overview's own "amount + name" line (text.ts), so
//                               a step reads its ingredients exactly as the overview does.
//   wordAmount(ing)             an amount in words ("half of the garlic") as its own line.
//   parseBold(text)             "**bold**" spans for <Txt>; a stray "**" never shows.
//   lineStarts(lines)           each line's start on the recording (the bar's chapters), when timed.
//   activeLine(lines, at, step) the line being said at `at` (Hear or the video playing), else -1.
import type { Ingredient, Step } from '@/lib/types';

/** `start_s`: seconds on the recording where the line starts (the recipe's own substeps only). */
export type SubstepLine = { text: string; detail: string | null; start_s: number | null };
export type BoldPart = { text: string; bold: boolean };

/** Splits `**bold**` spans out of a line. */
export function parseBold(text: string | null | undefined): BoldPart[] {
  const s = text ?? '';
  const out: BoldPart[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false });
  return out.map((p) => ({ ...p, text: p.text.replace(/\*\*/g, '') })).filter((p) => p.text);
}

/** The line without its bold marks (screen reader labels). */
export function plainText(text: string | null | undefined): string {
  return parseBold(text).map((p) => p.text).join('');
}

/** The step's short substeps: the recipe's own, else split from the instruction (+ "Ready when"). */
export function stepSubsteps(step: Pick<Step, 'substeps' | 'instruction' | 'sensory_cue'>): SubstepLine[] {
  const own = (step.substeps ?? [])
    .map((x) => ({ text: (x?.text ?? '').trim(), detail: x?.detail?.trim() || null, start_s: timed(x?.start_s) }))
    .filter((x) => x.text);
  if (own.length) return own;
  const lines: SubstepLine[] = splitInstruction(step.instruction).map((s) => ({ text: boldAmounts(s), detail: null, start_s: null }));
  const ready = readyLine(step.sensory_cue, step.instruction);
  if (ready) lines.push({ text: ready, detail: null, start_s: null });
  return lines;
}

const timed = (t: number | null | undefined) => (typeof t === 'number' && Number.isFinite(t) ? t : null);

/** Every line's start, for the bar's chapters; null unless at least two lines are timed. */
export function lineStarts(lines: Pick<SubstepLine, 'start_s'>[]): number[] | null {
  const starts = lines.map((l) => l.start_s).filter((t): t is number => t != null);
  return starts.length >= 2 ? starts : null;
}

/**
 * The line being said at `at` (seconds on the recording): the one with the greatest start at or
 * before it, inside the step's range. -1 when nothing plays, `at` is outside the step (a story's
 * voice), or fewer than two lines are timed.
 */
export function activeLine(lines: Pick<SubstepLine, 'start_s'>[], at: number | null | undefined, step: { start_s: number; end_s: number }): number {
  if (at == null || !Number.isFinite(at) || !lineStarts(lines)) return -1;
  if (at < Math.floor(step.start_s) || at > step.end_s) return -1;
  let best = -1;
  lines.forEach((l, i) => {
    if (l.start_s != null && l.start_s <= at && (best < 0 || l.start_s >= (lines[best].start_s ?? -Infinity))) best = i;
  });
  return best;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const stop = (s: string) => (/[.!?…]["”’)]*$/.test(s) ? s : `${s}.`);
// After ", then" a new action starts with a verb, not "the garlic" (one action, two things).
const NOT_A_VERB = /^(the|a|an|some|more|your|its|their|his|her|this|that|these|those|both|all|another|any)\b/i;
// "If it's too thick, then add water" is one step.
const CONDITION = /^(if|when|once|until|as|after|before|while)\b/i;

/** Sentences, "; " parts and ", then <verb>" parts, each capitalized and ending in a stop. */
export function splitInstruction(instruction: string | null | undefined): string[] {
  const text = (instruction ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  // A sentence ends at . ! ? … followed by a space and a capital ("1.5 cups" never splits).
  const sentences = text.replace(/([.!?…]+["”’)]*)\s+(?=["“(]?[A-Z])/g, '$1\n').split('\n');
  const out: string[] = [];
  for (const sentence of sentences) {
    for (const part of sentence.split(/;\s+/)) {
      const pieces = part.split(/,?\s+(?:and\s+)?then\s+(?=\S)/i);
      let cur = pieces[0];
      for (const next of pieces.slice(1)) {
        if (NOT_A_VERB.test(next) || CONDITION.test(cur) || !cur.trim()) cur = `${cur}, then ${next}`;
        else {
          out.push(cur);
          cur = next;
        }
      }
      out.push(cur);
    }
  }
  return out
    .map((s) => s.trim().replace(/^[,;:\s]+/, '').replace(/[,;:\s]+$/, ''))
    .filter(Boolean)
    .map((s) => stop(cap(s)));
}

const NUM = String.raw`(?:\d+(?:[.,/]\d+)?|[¼½¾⅓⅔⅛]|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|a few|a couple of)`;
const UNITS = String.raw`(?:cups?|tbsp|tsp|tablespoons?|teaspoons?|minutes?|mins?|seconds?|secs?|hours?|hrs?|lbs?|pounds?|oz|ounces?|grams?|g|kg|ml|liters?|litres?|quarts?|inch(?:es)?|cm|degrees|°\s?[CF]?)`;
const AMOUNT = new RegExp(String.raw`\b${NUM}(?:\s*(?:-|–|to)\s*${NUM})?\s*${UNITS}(?![a-z])`, 'gi');
const HEAT = /\b(?:(?:low|medium|high|medium[- ]high|medium[- ]low)\s+heat|medium[- ](?:high|low))\b/gi;

/** Bolds amounts ("10 minutes", "1.5 cups", "350°F") and heat ("medium-high") in a split line. */
export function boldAmounts(line: string): string {
  if (line.includes('**')) return line;
  return line.replace(AMOUNT, (m) => `**${m}**`).replace(HEAT, (m) => `**${m}**`).replace(/\*\*\*\*/g, '');
}

const FIRST_PERSON = /\b(i|i'm|i’m|i'll|i’ll|i've|i’ve|i'd|me|my|we|we're|we’re|we'll|us|our)\b/i;
// The cook reacting, or hoping, rather than saying what to look for.
const CHATTER = /^(that|that's|that’s|thats|it's|it’s|its|it is|this is|wow|oh|ok(ay)?|yeah|hmm+)\b|\b(should|would|could|might|pretty good|not great|actually)\b/i;
const LEAD = /^(so|and|um+|uh+|ok(ay)?|you know( that)?|ideally|basically)[,\s]+/i;
// A cue that starts with a verb reads "Ready when it smells …".
const VERB_FIRST = /^(smells?|looks?|sounds?|feels?|turns?|tastes?|starts?|stops?|becomes?|is|has|gets?)\b/i;
const STOPWORDS = new Set(['the', 'and', 'with', 'into', 'until', 'when', 'once', 'that', 'this', 'than', 'then', 'your', 'from', 'over', 'they', 'them', 'there', 'still', 'just', 'very', 'each', 'about', 'more', 'some']);

function contentWords(s: string): string[] {
  return s.toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length > 3 && !STOPWORDS.has(w)).map((w) => w.replace(/(es|s|ed|ing)$/, '')) ?? [];
}

/**
 * The sensory cue as one "**Ready when** …" line, or null: a cue in the cook's first person, her
 * reactions ("That's pretty good"), or one the instruction already says (60%+ of its words) is
 * left out. A cue joined from several remarks (" / ") keeps its first real test.
 */
export function readyLine(cue: string | null | undefined, instruction?: string | null): string | null {
  const parts = (cue ?? '')
    .split(/\s+\/\s+|;\s*/)
    .map((p) =>
      p
        .trim()
        .replace(LEAD, '')
        .replace(/\b(is|was|are) like\b/gi, '$1')
        .replace(/,\s*which\b.*$/i, '')
        .replace(/[.\s]+$/, '')
        .trim(),
    )
    .filter(Boolean);
  const pick = parts.find((p) => !FIRST_PERSON.test(p) && !CHATTER.test(p));
  if (!pick) return null;
  const words = contentWords(pick);
  if (instruction && words.length) {
    const have = new Set(contentWords(instruction));
    if (words.filter((w) => have.has(w)).length / words.length >= 0.6) return null;
  }
  const lower = pick.charAt(0).toLowerCase() + pick.slice(1);
  const body = /^(when|once|until)\s+/i.test(pick)
    ? lower.replace(/^(when|once|until)\s+/i, '')
    : / when /i.test(pick)
      ? null // already a whole test ("the soju is done when you can't smell alcohol")
      : VERB_FIRST.test(pick)
        ? `it ${lower}`
        : lower;
  return body == null ? stop(cap(pick)) : stop(`**Ready when** ${body}`);
}

const bare = (name: string) => name.replace(/\s*\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
// Two waters ("water (for the glaze)", "water (for the pan)") are two ingredients: the whole name counts.
const norm = (name: string | null | undefined) => (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * What this step needs, as Ingredients whose `estimate` is the amount this step uses, so the
 * overview's ingredientLine (text.ts) reads them the same way: the recipe's `uses` (each matched to
 * its ingredient by name; a null amount is "unknown"), else `fallback()` (lib/recipes
 * stepIngredients). Each ingredient once.
 */
export function stepUses(step: Pick<Step, 'uses'>, ingredients: Ingredient[], fallback: () => Ingredient[]): Ingredient[] {
  const own = (step.uses ?? []).filter((u) => u?.name?.trim());
  const rows: Ingredient[] = own.length
    ? own.map((u) => {
        const name = u.name.trim();
        const base = ingredients.find((i) => i.name === name) ?? ingredients.find((i) => norm(i.name) === norm(name));
        const estimate = u.amount?.trim() || 'unknown';
        return base ? { ...base, estimate } : { name, feel: '', estimate, confidence: 'medium', first_seen_s: null };
      })
    : fallback().filter((i) => i.name?.trim());
  const seen = new Set<string>();
  return rows.filter((i) => {
    const k = norm(i.name);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * An amount in words from the step's own text ("half of the garlic", "a splash"), which the
 * overview's measure parser would misread: "Half of the garlic" whole when it names the ingredient,
 * else "**a splash** of water". Null for a measure ("~1 tbsp") or no amount.
 */
export function wordAmount(ing: Pick<Ingredient, 'name' | 'estimate'>): { amount: string | null; name: string } | null {
  const a = (ing.estimate ?? '').trim().replace(/^~\s*/, '');
  if (!a || /^unknown$/i.test(a) || /[\d¼½¾⅓⅔⅛]/.test(a)) return null;
  const name = bare(ing.name);
  const head = (name.split(/\s+/).pop() ?? '').toLowerCase().replace(/(es|s)$/, '');
  if (head && a.toLowerCase().includes(head)) return { amount: null, name: cap(a) };
  return { amount: a, name: /\bof$/i.test(a) ? name : `of ${name}` };
}

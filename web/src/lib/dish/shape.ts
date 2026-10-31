// How the kid shapes the card (DISH-ASK-SPEC §10): which parts of the guess to ask about, and which to correct.
// Pure, so the page and the tests share them. A part is an ingredient or one line of a step; `keyOf` names it.
import { plain } from './text';
import type { AskItem, Card, Edit, Ingredient, Line, PartRef, Question, Recipe } from './types';

/** DISH-ASK-SPEC §4 cards/ask: at most 3 questions open at a time, and 6 in all. */
export const ASK_OPEN_MAX = 3;
export const ASK_TOTAL_MAX = 6;
/** DISH-ASK-SPEC §10 cards/update edits. */
export const EDIT_LIMITS = { name: 80, amount: 40, line: 80 } as const;

export const ingredientRef = (index: number): PartRef => ({ kind: 'ingredient', index });
export const lineRef = (step: number, line: number): PartRef => ({ kind: 'line', step, line });

/** `i3` for ingredient 3, `l2.1` for line 1 of step 2. */
export const keyOf = (r: PartRef) => (r.kind === 'ingredient' ? `i${r.index}` : `l${r.step}.${r.line}`);

export function refOf(key: string): PartRef | null {
  const i = /^i(\d+)$/.exec(key);
  if (i) return ingredientRef(Number(i[1]));
  const l = /^l(\d+)\.(\d+)$/.exec(key);
  return l ? lineRef(Number(l[1]), Number(l[2])) : null;
}

export function partOf(recipe: Recipe, ref: PartRef): Ingredient | Line | null {
  return ref.kind === 'ingredient' ? (recipe.ingredients[ref.index] ?? null) : (recipe.steps[ref.step]?.lines[ref.line] ?? null);
}

/** How many more questions may be open now: 3 open at a time, 6 in all (her answered ones count in the 6). */
export function openCap(card: Pick<Card, 'answers'>): number {
  return Math.max(0, Math.min(ASK_OPEN_MAX, ASK_TOTAL_MAX - card.answers.length));
}

/**
 * What the kid chooses to ask is a list of units, never a part counted twice: a question's id ("q1"), or a part's key
 * ("i0", "l2.1") for a part with no question (the server writes one, `about`). Several parts can point at the same
 * question (`ask`): they all stand for that one question.
 */
export function knownQuestions(card: Pick<Card, 'guess' | 'asked'>): Question[] {
  const seen = new Set<string>();
  return [...card.asked, ...card.guess.questions].filter((q) => !seen.has(q.id) && !!seen.add(q.id));
}

/** The question a part carries (a suggestion or one asked before), else null. */
function questionOf(card: Pick<Card, 'guess' | 'asked'>, part: Ingredient | Line): Question | null {
  return part.ask ? (knownQuestions(card).find((q) => q.id === part.ask) ?? null) : null;
}

/** What a part stands for when chosen: the question it carries, else the part itself. */
export function unitOf(card: Pick<Card, 'guess' | 'asked'>, guess: Recipe, ref: PartRef): string {
  const part = partOf(guess, ref);
  return (part && questionOf(card, part)?.id) || keyOf(ref);
}

/** What starts chosen: the questions already asked and not answered yet. A new card starts empty (Caleb, Oct 31): the suggested ones stay hidden, see `withDefaults`. */
export function initialPicked(card: Pick<Card, 'asked' | 'answers'>): string[] {
  const answered = new Set(card.answers.map((a) => a.id));
  return card.asked.filter((q) => !answered.has(q.id)).map((q) => q.id);
}

/** A question in the kid's own words, as a unit. */
const OWN = 't:';
export const ownUnit = (text: string) => `${OWN}${text.trim()}`;
/** DISH-ASK-SPEC §4 cards/ask: a question's text. */
export const QUESTION_LIMITS = { min: 3, max: 120 } as const;

/** What goes to Mom: what the kid chose, then suggested questions he never sees, up to the cap (Caleb, Oct 31: she always gets 3). */
export function withDefaults(card: Pick<Card, 'guess' | 'asked' | 'answers'>, units: string[], cap: number): string[] {
  const answered = new Set<string>(card.answers.map((a) => a.id));
  const out = [...units];
  for (const q of knownQuestions(card)) {
    if (out.length >= cap) break;
    if (!answered.has(q.id) && !out.includes(q.id)) out.push(q.id);
  }
  return out;
}

/** The chosen units as they stand now: a part that has gained a question becomes that question, no repeats, none answered or gone. */
export function cleanPicked(card: Pick<Card, 'guess' | 'asked' | 'answers'>, guess: Recipe, picked: string[]): string[] {
  const known = new Set<string>(knownQuestions(card).map((q) => q.id));
  const answered = new Set<string>(card.answers.map((a) => a.id));
  const out: string[] = [];
  for (const key of picked) {
    if (key.startsWith(OWN)) {
      // Once it was sent, his question has an id.
      const sent = knownQuestions(card).find((q) => q.text === key.slice(OWN.length))?.id;
      const unit = sent ?? key;
      if (!answered.has(unit) && !out.includes(unit)) out.push(unit);
      continue;
    }
    const ref = refOf(key);
    if (ref ? !partOf(guess, ref) : !known.has(key)) continue;
    const unit = ref ? unitOf(card, guess, ref) : key;
    if (!answered.has(unit) && !out.includes(unit)) out.push(unit);
  }
  return out;
}

/** The question as it would be asked: the question's own words, else the server's template for the part (§10). */
export function unitText(card: Pick<Card, 'guess' | 'asked'>, guess: Recipe, unit: string): string {
  const own = knownQuestions(card).find((q) => q.id === unit);
  if (own) return own.text;
  if (unit.startsWith(OWN)) return unit.slice(OWN.length);
  const ref = refOf(unit);
  const part = ref && partOf(guess, ref);
  if (!ref || !part) return '';
  if (ref.kind === 'ingredient') return `How much ${(part as Ingredient).name.split(',')[0].trim()} do you use?`;
  return `How do you do this part: ${plain((part as Line).text).slice(0, 60)}?`;
}

/** As POST /dish/cards/ask takes them, one per unit: a question keeps its id and words, a part goes as `about`. */
export function askItems(card: Pick<Card, 'guess' | 'asked'>, guess: Recipe, units: string[]): AskItem[] {
  const known = knownQuestions(card);
  return units.flatMap((unit): AskItem[] => {
    const q = known.find((k) => k.id === unit);
    if (q) return [{ id: q.id, text: q.text }];
    if (unit.startsWith(OWN)) return [{ text: unit.slice(OWN.length) }];
    const ref = refOf(unit);
    return ref && partOf(guess, ref) ? [{ about: ref }] : [];
  });
}

/** The guess with the kid's corrections in: each edited part is `stated` (his own), a guess no more. */
export function applyEdits(recipe: Recipe, edits: Edit[]): Recipe {
  if (!edits.length) return recipe;
  const out = structuredClone(recipe);
  for (const e of edits) {
    if (e.kind === 'ingredient') {
      const ing = out.ingredients[e.index];
      if (!ing) continue;
      if (e.name !== undefined) ing.name = e.name;
      if (e.amount !== undefined) ing.amount = e.amount;
      Object.assign(ing, { status: 'stated', isGuess: false });
    } else {
      const line = out.steps[e.step]?.lines[e.line];
      if (!line) continue;
      if (e.text !== undefined) Object.assign(line, { text: e.text, detail: null, short: null });
      Object.assign(line, { status: 'stated', isGuess: false });
    }
  }
  return out;
}

/** An edit replaces the earlier one for the same part. */
export function withEdit(edits: Edit[], edit: Edit): Edit[] {
  const same = (a: Edit) => (a.kind === 'ingredient' ? edit.kind === 'ingredient' && edit.index === a.index : edit.kind === 'line' && edit.step === a.step && edit.line === a.line);
  return [...edits.filter((e) => !same(e)), edit];
}

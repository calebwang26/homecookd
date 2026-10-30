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

/** What starts chosen: the questions already asked and not answered yet, else the 3 suggested gaps. */
export function initialPicked(card: Pick<Card, 'guess' | 'asked' | 'answers'>): string[] {
  const answered = new Set(card.answers.map((a) => a.id));
  const ids = new Set((card.asked.length ? card.asked : card.guess.questions).filter((q) => !answered.has(q.id)).map((q) => q.id));
  const out: string[] = [];
  card.guess.ingredients.forEach((ing, i) => ing.ask && ids.has(ing.ask) && out.push(keyOf(ingredientRef(i))));
  card.guess.steps.forEach((st, si) => st.lines.forEach((l, li) => l.ask && ids.has(l.ask) && out.push(keyOf(lineRef(si, li)))));
  return out;
}

/** The question a part carries (a suggestion or one asked before), else null. */
function questionOf(card: Pick<Card, 'guess' | 'asked'>, part: Ingredient | Line): Question | null {
  if (!part.ask) return null;
  return card.asked.find((q) => q.id === part.ask) ?? card.guess.questions.find((q) => q.id === part.ask) ?? null;
}

/** The question as it would be asked: the part's own question, else the server's template (§10). */
export function questionText(card: Pick<Card, 'guess' | 'asked'>, guess: Recipe, ref: PartRef): string {
  const part = partOf(guess, ref);
  if (!part) return '';
  const own = questionOf(card, part);
  if (own) return own.text;
  if (ref.kind === 'ingredient') return `How much ${(part as Ingredient).name.split(',')[0].trim()} do you use?`;
  return `How do you do this part: ${plain((part as Line).text).slice(0, 60)}?`;
}

/** As POST /dish/cards/ask takes them: a part that has a question keeps its id and words, any other goes as `about`. */
export function askItems(card: Pick<Card, 'guess' | 'asked'>, guess: Recipe, picked: string[]): AskItem[] {
  return picked.flatMap((key): AskItem[] => {
    const ref = refOf(key);
    const part = ref && partOf(guess, ref);
    if (!ref || !part) return [];
    const q = questionOf(card, part);
    return [q ? { id: q.id, text: q.text } : { about: ref }];
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

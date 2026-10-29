// What /dish/[id] shows of a dish-ask card (docs/design/phase5-cold-parents, artboards 11–13;
// docs/build/DISH-ASK-SPEC.md §3 and §9). Pure, so scripts/test-dish.mjs runs it in Node.
//   shownRecipe(card)        Mom's version once it's written, else the kid's guess
//   ingredientTag(ing)       'mom' (her answer settled it), 'guess' (ours, or nobody knows yet) or null (the kid said it)
//   amountText(ing)          "~3 tbsp" -> "about 3 tbsp"; her words as they are
//   boldParts(text)          "Fry on **medium-high**" -> [{ text: 'Fry on ', bold: false }, { text: 'medium-high', bold: true }]
//   firstClip(card)          her first answer with a recording (played first on the kid's side)
//   clipFor(card, id)        the answer whose clip backs a line or a tip
//   relationLabel(relation)  "Mom", "Grandma"… (the kid side stays English)

export type DishStatus = 'stated' | 'guessed' | 'unknown' | 'mom';
export type DishQuote = { words: string; english: string | null };
export type DishIngredient = { name: string; amount: string; status: DishStatus; clip: string | null; quote?: DishQuote | null };
export type DishLine = { text: string; detail: string | null; status: DishStatus; clip: string | null };
export type DishTip = { words: string; english: string | null; clip: string };
export type DishStep = { title: string; lines: DishLine[]; tip: DishTip | null };
export type DishRecipe = {
  dish: string;
  servings: string | null;
  time: string | null;
  cost: string | null;
  ingredients: DishIngredient[];
  steps: DishStep[];
};
export type DishAnswer = { id: string; words: string; english: string | null; audioUrl: string | null; durationS: number };

/** dishAsks.get / forMe (§9): the web's Card plus its id and which side this person is on. */
export type MyCard = {
  id: string;
  side: 'kid' | 'cook';
  dish: string;
  relation: string;
  /** "" once the kid deleted their account. */
  kidName: string | null;
  status: 'draft' | 'asked' | 'answered';
  guess: DishRecipe;
  version: DishRecipe | null;
  answers: DishAnswer[];
  /** Her answers are being merged into her version (about 10–20 s). */
  merging?: boolean;
  /** The day she films it (0 = Sunday … 6), or null. */
  filmingDay: number | null;
  photoUrls: string[];
  createdAt: number;
};

export const shownRecipe = (card: Pick<MyCard, 'guess' | 'version'>): DishRecipe => card.version ?? card.guess;

export function ingredientTag(ing: Pick<DishIngredient, 'status'>): 'mom' | 'guess' | null {
  if (ing.status === 'mom') return 'mom';
  return ing.status === 'guessed' || ing.status === 'unknown' ? 'guess' : null;
}

export function amountText(ing: Pick<DishIngredient, 'amount' | 'status'>): string {
  const a = (ing.amount ?? '').trim();
  if (ing.status === 'mom') return a;
  return a.startsWith('~') ? `about ${a.slice(1).trim()}` : a;
}

export function boldParts(text: string): { text: string; bold: boolean }[] {
  return (text ?? '')
    .split('**')
    .map((t, i) => ({ text: t, bold: i % 2 === 1 }))
    .filter((p) => p.text);
}

export function firstClip(card: Pick<MyCard, 'answers'>): DishAnswer | null {
  return card.answers.find((a) => !!a.audioUrl) ?? null;
}

export function clipFor(card: Pick<MyCard, 'answers'>, id: string | null | undefined): DishAnswer | null {
  if (!id) return null;
  const a = card.answers.find((x) => x.id === id);
  return a?.audioUrl ? a : null;
}

const RELATIONS: Record<string, string> = { mom: 'Mom', dad: 'Dad', grandma: 'Grandma', grandpa: 'Grandpa', auntie: 'Auntie', uncle: 'Uncle' };

export const relationLabel = (relation: string | null | undefined) => RELATIONS[(relation ?? '').toLowerCase()] ?? 'Mom';

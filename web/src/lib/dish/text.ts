// Words both dish pages build from a card or an ask. Pure, so pages and tests can share them.
// Ported from the MVP's lib/miss/text.ts (calebwang26/homecookd PR #40).
import { possessive } from '@/lib/recipe-web/recipe';
import { labelOf, type Relation as KinRelation } from '@/lib/relation';
import type { Card, Ingredient, Line, Question, QuestionId, Recipe, Relation } from './types';

export { labelOf, possessive };

const WHOSE = /^\s*(?:my\s+|our\s+)?(mom|mum|mommy|mama|mother|dad|daddy|papa|father|grandma|granny|nana|grandmother|grandpa|grandfather|auntie|aunt|uncle)['’]?s\b/i;
const RELATION_OF: Record<string, KinRelation> = {
  mom: 'mom', mum: 'mom', mommy: 'mom', mama: 'mom', mother: 'mom',
  dad: 'dad', daddy: 'dad', papa: 'dad', father: 'dad',
  grandma: 'grandma', granny: 'grandma', nana: 'grandma', grandmother: 'grandma',
  grandpa: 'grandpa', grandfather: 'grandpa',
  auntie: 'auntie', aunt: 'auntie',
  uncle: 'uncle',
};

/** "dad's beef stew" → 'dad', "beef stew" → null. */
export function relationFromText(text: string): KinRelation | null {
  const m = WHOSE.exec(text);
  return m ? (RELATION_OF[m[1].toLowerCase()] ?? null) : null;
}

/** What the kid typed in the Other field: "grandpa", "my aunt" → a relation, else null. */
export function relationFromWord(word: string): KinRelation | null {
  const w = word.trim().toLowerCase().replace(/^(my|our)\s+/, '');
  return RELATION_OF[w] ?? null;
}

/** "Mom's tomato egg"; with no one in particular, just the dish: "Tomato egg" */
export function cardTitle(rel: Relation, dish: string): string {
  const name = dish.trim() || 'dish';
  return rel === 'none' ? name.charAt(0).toUpperCase() + name.slice(1) : `${possessive(labelOf(rel))} ${name}`;
}

/** "Mom, how do you make your tomato egg? I'm trying to make it here." (the server's default too) */
export function defaultMessage(rel: KinRelation, dish: string): string {
  return `${labelOf(rel)}, how do you make your ${dish.trim() || 'dish'}? I'm trying to make it here.`;
}

/** Who reads the line under the message: "She'll see…" only when the relation says she or he. */
export function pronounOf(rel: Relation): 'she' | 'he' | null {
  if (rel === 'mom' || rel === 'grandma' || rel === 'auntie') return 'she';
  if (rel === 'dad' || rel === 'grandpa' || rel === 'uncle') return 'he';
  return null;
}

/** "**1 tbsp** oil" → runs; only balanced pairs count. */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/\*\*(.+?)\*\*/)
    .map((run, i) => ({ text: i % 2 ? run : run.replaceAll('**', ''), bold: i % 2 === 1 }))
    .filter((run) => run.text);
}

export const plain = (text: string) => text.replaceAll('**', '');

/** A step as one sentence: its lines joined. */
export function stepText(lines: Pick<Line, 'text'>[]): string {
  return lines.map((l) => l.text.trim()).filter(Boolean).join(' ');
}

/** 0:04 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The questions she hasn't answered yet. */
export function openQuestions(card: Pick<Card, 'asked' | 'answers'>): Question[] {
  const answered = new Set(card.answers.map((a) => a.id));
  return card.asked.filter((q) => !answered.has(q.id));
}

/** What the asked questions would settle on the guess: the ingredient or line each one points at. */
export type Asked = { id: QuestionId; ingredient: Ingredient | null; line: Line | null };

export function askedItems(recipe: Recipe, ids: QuestionId[]): Asked[] {
  return ids.map((id) => ({
    id,
    ingredient: recipe.ingredients.find((i) => i.ask === id) ?? null,
    line: recipe.steps.flatMap((s) => s.lines).find((l) => l.ask === id) ?? null,
  }));
}

/** "~1 tbsp ketchup" as the kid guessed it, for "Caleb guessed ~1 tbsp". */
export function guessOf(item: Asked): string | null {
  if (item.ingredient) return item.ingredient.amount.trim() || null;
  return null;
}

/**
 * The bits Mom's headline marks: "1 tbsp ketchup", "no sugar" (no "~"). The amounts he is asked about, and the ones he
 * stated himself (`stated`: what he fixed or knew), so "Caleb thinks it's 2 tsp sugar and 1 tbsp ketchup." An empty
 * amount ("sugar") or a step reads wrong in "Caleb thinks it's …"; the list marks those with "?".
 */
export function guessedBits(recipe: Recipe, ids: QuestionId[]): string[] {
  const asked = new Set(ids);
  return recipe.ingredients
    .filter((i) => (i.ask && asked.has(i.ask)) || i.status === 'stated')
    .map((i) => {
      const amount = i.amount.replace(/^~\s*/, '').trim();
      return { bit: amount ? `${amount} ${i.name.split(',')[0]}` : '', stated: i.status === 'stated' };
    })
    .filter((b) => b.bit)
    .sort((a, b) => Number(b.stated) - Number(a.stated)) // what he stated first, then what he is asked
    .map((b) => b.bit)
    .slice(0, 2);
}

export const initialOf = (name: string | null) => (name?.trim()[0] ?? '').toUpperCase();

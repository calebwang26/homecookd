// Words for the recipe flow (overview, cook steps), built only from real recipe data. Nothing here
// invents a fact: when the data is missing the helper returns null and the screen hides that piece.
import { mmss } from '@/lib/format';
import type { Ingredient } from '@/lib/types';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** "serves 4", "serves 4 to 6", "makes 8 generous bowls", "makes 4 pancakes". */
export function servingsLabel(servings: string | null | undefined): string | null {
  const s = (servings ?? '').trim();
  if (!s) return null;
  if (/^\d+(\s*(-|–|to)\s*\d+)?$/i.test(s)) return `serves ${s.replace(/\s*-\s*/, ' to ')}`;
  const serv = /^(\d+(?:\s*(?:-|–|to)\s*\d+)?)\s+servings?$/i.exec(s);
  if (serv) return `serves ${serv[1]}`;
  if (/^serves\b/i.test(s)) return s.toLowerCase();
  return `makes ${s}`;
}

/** The recipe's total time as the bible writes it: "~4 hrs", "~30 min", "~1 hr 15 min". */
export function timeLabel(total: string | null | undefined): string | null {
  let t = (total ?? '').trim();
  if (!t) return null;
  t = t
    .replace(/\bminutes?\b|\bmins\b/gi, 'min')
    .replace(/\bhours\b/gi, 'hrs')
    .replace(/\bhour\b/gi, 'hr');
  return t.startsWith('~') ? t : `~${t}`;
}

/** An ingredient name without its parenthetical ("soju (for deglazing)" -> "soju"). */
function bareName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s*\(.*?\)/g, '').trim();
}

/**
 * An ingredient as one line: `amount` (bold, null when unknown) + `name`; `note` tells repeats apart, or is
 * the cook's own words for one she confirmed after the video ("Cumin seeds · a handful, at the start").
 */
export type IngredientLine = { amount: string | null; name: string; note: string | null };

const NUM = String.raw`\d+(?:\s+\d+\/\d+|[.,/]\d+)?(?:\s*(?:-|–|to)\s*\d+(?:[./]\d+)?)?`;
const UNIT = String.raw`(?:lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|litres?|quarts?|qts?|pints?|cups?|tbsp|tsp|tablespoons?|teaspoons?|pinch(?:es)?|dash(?:es)?|handfuls?|cloves?|slices?|pieces?|stalks?|sprigs?|leaf|leaves|heads?|bunch(?:es)?|sticks?|cans?|strands?|strips?|pods?|bowls?|knobs?|drops?|splash(?:es)?|scoops?|cubes?)`;
const SIZE = String.raw`(?:(?:thin|thick|small|medium|large|big|whole|heaping|heaped|level)\s+)?`;
// "~2 tbsp minced" -> 2 | " tbsp" | "" | "minced"; "~3 thin slices" and "~2 cans (15 oz each)" stay whole.
const AMOUNT = new RegExp(String.raw`^~?\s*(${NUM})(\s*${SIZE}${UNIT}\b)?(\s*\([^)]*\))?[\s,]*(.*)$`, 'i');
const UNIT_ONLY = new RegExp(String.raw`^${UNIT}$`, 'i');
const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean);
/** "onion" / "onions", "potato" / "potatoes". */
const same = (a: string, b: string) => a === b || `${a}s` === b || `${b}s` === a || `${a}es` === b || `${b}es` === a;

/**
 * Amount + name, the overview's ingredient row (kid QA round 2, notes 2 and 3: "just the measurement
 * and the ingredient", never the cook's words). The estimate's own words win when they name the thing
 * ("~6 scallions", "~1 apple", "~2 lb whole branzino"); describing words stay in front ("~2 tbsp
 * minced ginger"); an unknown amount leaves the name alone ("Onions").
 */
export function ingredientLine(ing: Ingredient): Omit<IngredientLine, 'note'> {
  const name = bareName(ing.name) || 'Something';
  const est = (ing.estimate ?? '').trim();
  if (!est || /^~?\s*unknown$/i.test(est)) return { amount: null, name: cap(name) };
  const m = AMOUNT.exec(est);
  if (!m) return { amount: est.startsWith('~') ? est : `~${est}`, name };
  const [, num, unit = '', paren = ''] = m;
  let rest = m[4].trim().replace(/^(in )?total$|^each$/i, '');
  const amount = `~${num}${unit}${paren}`;
  const nameWords = words(name);
  const head = nameWords[nameWords.length - 1] ?? '';
  // "~1 clove" garlic clove -> "~1 garlic clove"
  if (!rest && unit && same(words(unit).pop() ?? '', head)) return { amount: `~${num}${paren}`, name };
  if (!rest) return { amount, name };
  const restWords = words(rest);
  if (nameWords.every((w) => restWords.some((r) => same(r, w)))) return { amount, name: rest }; // "scallions"
  // "~2 large onions" yellow onion -> "large yellow onions"; "~1/2 lime" fresh lime -> "fresh lime"
  const [lead, ...after] = rest.split(',');
  const tokens = lead.trim().split(/\s+/);
  const last = tokens[tokens.length - 1].toLowerCase();
  if (head && same(last, head)) {
    const headless = name.split(/\s+/).slice(0, -1).join(' ');
    const phrase = [...tokens.slice(0, -1), headless, tokens[tokens.length - 1]].filter(Boolean).join(' ');
    return { amount, name: after.length ? `${phrase},${after.join(',')}` : phrase };
  }
  if (UNIT_ONLY.test(rest)) return { amount, name: `${name} ${rest}` }; // "~1/4 cup garlic cloves"
  if (restWords.some((r) => r.length > 2 && nameWords.includes(r))) return { amount, name: rest }; // "whole branzino"
  rest = rest.replace(/[\s,]+$/, '');
  return { amount, name: `${rest} ${name}` };
}

/** Every ingredient's line; a name that repeats ("water" x3) keeps its "(for the glaze)" as a note. */
export function ingredientLines(ingredients: Ingredient[]): IngredientLine[] {
  const count = new Map<string, number>();
  for (const ing of ingredients) {
    const k = norm(bareName(ing.name));
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return ingredients.map((ing) => {
    if (ing.confirmed) return { amount: null, name: cap(bareName(ing.name) || ing.name), note: ing.confirmed.said };
    const paren = /\(([^)]*)\)/.exec(ing.name ?? '')?.[1]?.trim() || null;
    return { ...ingredientLine(ing), note: (count.get(norm(bareName(ing.name))) ?? 0) > 1 ? paren : null };
  });
}

/** How a screen reader says a line: "about 1 tbsp kosher salt". */
export function spokenIngredient(line: IngredientLine): string {
  const amount = line.amount ? `${line.amount.replace(/^~/, 'about ')} ` : '';
  return `${amount}${line.name}${line.note ? `, ${line.note}` : ''}`;
}

export function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "Full video · 51:43": the whole recording, never one step (the label on the overview's photo). */
export function fullVideoLabel(seconds: number): string {
  return seconds > 0 ? `Full video · ${mmss(seconds)}` : 'Full video';
}

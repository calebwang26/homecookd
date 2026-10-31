// Words for the step screens, ported 1:1 from the app (app/src/components/recipe/text.ts,
// lib/media.ts splitSentences / subtitleAt, lib/recipes.ts stepIngredients) so the web reads the
// same. Built only from the recipe's own data: an empty result means "hide that bit".
// (hearLabel, the ingredient rows and the sentence helpers live in @/lib/recipe-web/recipe, shared
// with the recipe page.)
import { bestLines, capitalize as cap, cut, FILLER, mmss, splitSentences } from '@/lib/recipe-web/recipe';
import type { Ingredient, Recipe, Step } from '@/lib/recipe-web/types';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** The sentence roughly playing at `progress` (proportional by length; no per-line timestamps). */
export function subtitleAt(quote: string | null | undefined, progress: number): string | null {
  const lines = splitSentences(quote);
  if (!lines.length) return null;
  if (lines.length === 1) return lines[0];
  const total = lines.reduce((n, l) => n + l.length, 0) || 1;
  let acc = 0;
  for (const line of lines) {
    acc += line.length;
    if (progress < acc / total) return line;
  }
  return lines[lines.length - 1];
}

/** Like cut(), but ends at the last whole sentence when one closes past half of `max`. */
export function cutSentence(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const m = /^[\s\S]*[.!?](?=\s)/.exec(head);
  return m && m[0].length >= max * 0.5 ? `${m[0]}…` : cut(t, max);
}

/**
 * The cook's line for one step (the "More from" bubble): 1 to 2 sentences of this step's quote with
 * the least filler, at most `maxLen` chars. Falls back to the quote cut at a word.
 */
export function bestStepQuote(step: Step, maxLen = 110): string | null {
  const q = step.quote?.trim();
  if (!q) return null;
  if (q.length <= maxLen && !(q.match(FILLER) ?? []).length) return cap(q);
  return cap(bestLines(q, maxLen, 16)?.text ?? cut(q, maxLen));
}

// A part of a sensory_cue that says what to look, listen, smell or feel for.
const CUE = /\b(when|until|once|smells?|smelling|looks?|see|sounds?|hear|turns?|sizzl\w*|bubbl\w*|float\w*|curl\w*|golden|brown|crisp\w*|soft\w*|smooth|thick\w*|shin\w*|glossy|clear|steam\w*|fragrant|tender|bounce\w*)\b/i;
// The cook reacting rather than describing a cue ("That looks pretty good", "It's a little salty").
const COMMENTARY = /^(that|that's|thats|it's|its|it is|this is|wow|oh|ok(ay)?|yeah|hmm+)\b|\b(i thought|i think|actually|not great|pretty good)\b/i;
const LEAD_FILLER = /^(so|and|um+|uh+|ok(ay)?|you know( that)?)[,\s]+/i;

/**
 * A sensory cue as the "Look for" box reads it (the eye icon already says "look for"). Only
 * "when / once / until" cues get a lead-in ("Ready when it can move."). A cue joined with " / "
 * keeps its first part that reads as a cue; plain commentary is dropped (null hides the box).
 */
export function lookFor(cue: string | null | undefined): string | null {
  const parts = (cue ?? '')
    .split(/\s+\/\s+|;\s*/)
    .map((p) =>
      p
        .trim()
        .replace(LEAD_FILLER, '')
        .replace(/\b(is|was|are) like\b/gi, '$1')
        .replace(/,\s*which\b.*$/i, '')
        .replace(/[.\s]+$/, '')
        .trim(),
    )
    .filter(Boolean);
  if (!parts.length) return null;
  const pick = parts.length === 1 && !COMMENTARY.test(parts[0]) ? parts[0] : parts.find((p) => CUE.test(p) && !COMMENTARY.test(p));
  if (!pick) return null;
  let text = /^(when|once)\b/i.test(pick) && !/\bthen\b|,\s*(it|you|that)\b/i.test(pick)
    ? `Ready ${pick.charAt(0).toLowerCase()}${pick.slice(1)}`
    : /^until\b/i.test(pick)
      ? `Keep going ${pick.charAt(0).toLowerCase()}${pick.slice(1)}`
      : cap(pick);
  text = cut(text, 80);
  return text.endsWith('…') || /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Ingredients first seen during this step's range; else the ones its title / instruction names. */
export function stepIngredients(recipe: Recipe, step: Step): Ingredient[] {
  const byTime = recipe.ingredients.filter((i) => i.first_seen_s != null && i.first_seen_s >= step.start_s && i.first_seen_s < step.end_s);
  if (byTime.length) return byTime;
  const text = norm(`${step.title} ${step.instruction}`);
  return recipe.ingredients.filter((i) => {
    const name = norm(i.name);
    if (!name) return false;
    if (text.includes(name)) return true;
    // "green onions" matches "onion"; "garlic cloves" matches "garlic".
    const head = name.split(/\s+/).filter((w) => w.length > 3).pop();
    return !!head && text.includes(head.replace(/s$/, ''));
  });
}

/** "Watch · 0:48" (no time when there is no video). */
export function watchLabel(seconds: number): string {
  return seconds > 0 ? `Watch · ${mmss(seconds)}` : 'Watch';
}

// A dish card's step (DISH-ASK-SPEC §10): the guess writes its doneness cue as the last line, "Ready when **…**",
// and bolds its times. A cue she changed keeps its struck guess, so it stays with the actions.
const READY = /^\s*ready when\b/i;
const BOLD_TIME = /\*\*[^*]*?(\d+(?:\s*(?:-|to|–)\s*\d+)?)\s*(sec|second|min|minute|hr|hour)s?\b[^*]*?\*\*/gi;

export function splitCue<L extends { text: string; was?: string | null }>(lines: L[]): { actions: L[]; cue: L | null } {
  const last = lines[lines.length - 1];
  return last && lines.length > 1 && READY.test(last.text) && !last.was ? { actions: lines.slice(0, -1), cue: last } : { actions: lines, cue: null };
}

/** The step's time, when its lines bold exactly one ("**5 min**"), for the chip under the title; more than one reads in the lines. */
export function stepTime(lines: { text: string }[]): string | null {
  const found = lines.flatMap((l) => [...l.text.matchAll(BOLD_TIME)]);
  return found.length === 1 ? found[0][0].replaceAll('*', '').trim() : null;
}

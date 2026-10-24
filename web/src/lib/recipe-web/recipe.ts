// Pure helpers that turn a recipe into the words the screens show. Everything here derives from
// the recipe's own data; nothing is invented (an empty result means "hide that bit").
import type { Ingredient, Recipe, Step } from './types';

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** "serves 4", "serves 4 to 6", "makes 8 generous bowls" (the app's servingsLabel). */
export function servingsLabel(servings: string | null | undefined): string | null {
  const s = (servings ?? '').trim();
  if (!s) return null;
  if (/^\d+(\s*(-|–|to)\s*\d+)?$/i.test(s)) return `serves ${s.replace(/\s*-\s*/, ' to ')}`;
  const serv = /^(\d+(?:\s*(?:-|–|to)\s*\d+)?)\s+servings?$/i.exec(s);
  if (serv) return `serves ${serv[1]}`;
  if (/^serves\b/i.test(s)) return s.toLowerCase();
  return `makes ${s}`;
}

/** The total time as the app writes it: "~4 hrs", "~30 min", "~1 hr 15 min". */
export function timeLabel(total: string | null | undefined): string | null {
  let t = (total ?? '').trim();
  if (!t) return null;
  t = t
    .replace(/\bminutes?\b|\bmins\b/gi, 'min')
    .replace(/\bhours\b/gi, 'hrs')
    .replace(/\bhour\b/gi, 'hr');
  return t.startsWith('~') ? t : `~${t}`;
}

/** "by Dad · ~4 hrs · makes 8 generous bowls" (each part only when known). */
export function metaLine(r: Recipe): string {
  return [`by ${r.cook.name}`, timeLabel(r.total_time), servingsLabel(r.servings)].filter(Boolean).join(' · ');
}

/** Splits a quote into sentences ("…" and "..." count as sentence ends), as the app does. */
export function splitSentences(quote: string | null | undefined): string[] {
  if (!quote) return [];
  const parts = quote.match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)/g) ?? [quote];
  const lines = parts.map((p) => p.trim()).filter(Boolean);
  return lines.length ? lines : [quote.trim()];
}

/** Cuts text at a word boundary, adding an ellipsis. */
export function cut(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max - 1);
  const at = c.lastIndexOf(' ');
  return `${(at > max * 0.5 ? c.slice(0, at) : c).replace(/[\s,;:.–—-]+$/, '')}…`;
}

export const FILLER = /\b(um+|uh+|like|kind of|you know|gonna)\b/gi;

type Scored = { text: string; score: number };

/** One to three consecutive sentences of a quote, scored: least filler, 40 to 80 chars ideal. */
export function bestLines(quote: string | null | undefined, maxLen: number, minLen = 24): Scored | null {
  const lines = splitSentences(quote)
    .map((l) => l.replace(/\.{3}$/, '.').replace(/^\.+\s*/, '').trim())
    .filter(Boolean);
  let best: Scored | null = null;
  for (let i = 0; i < lines.length; i++) {
    let text = '';
    for (let j = i; j < Math.min(lines.length, i + 3); j++) {
      text = text ? `${text} ${lines[j]}` : lines[j];
      if (text.length > maxLen) break;
      if (text.length < minLen) continue;
      const filler = (text.match(FILLER) ?? []).length + (text.match(/\.{2,}|…/g) ?? []).length;
      const ideal = text.length >= 40 && text.length <= 80 ? 0 : 1;
      const lead = /^(yeah|oh|okay|ok|so|and|um+|uh+|ooh)\b/i.test(text) ? 5 : 0;
      const score = filler * 10 + ideal * 3 + lead + (/^[a-z]/.test(text) ? 4 : 0) + i * 0.05;
      if (!best || score < best.score) best = { text, score };
    }
  }
  return best;
}

/**
 * The recipe's quote card, the app's bestQuote: one to three consecutive sentences of a step's
 * quote, 24 to 96 characters, with as little filler as possible (earlier steps win ties), plus the
 * step it was said in (Hear plays that step's range). Falls back to the shortest quote, cut at a word.
 */
export function bestQuote(r: Recipe, maxLen = 96): { text: string; step: Step } | null {
  let best: { text: string; step: Step; score: number } | null = null;
  for (const step of r.steps) {
    const b = bestLines(step.quote, maxLen);
    if (b && (!best || b.score + step.order * 0.2 < best.score)) best = { text: b.text, step, score: b.score + step.order * 0.2 };
  }
  if (best) return { text: best.text, step: best.step };
  const withQuote = r.steps.filter((s) => s.quote && s.quote.trim());
  if (!withQuote.length) return null;
  const step = withQuote.reduce((a, b) => (a.quote!.length <= b.quote!.length ? a : b));
  return { text: cut(step.quote!.trim(), maxLen), step };
}

/** "Hear Dad · 4:20" / "Hear Miles · 3:10"; a longer name gives "Hear · 4:20" so the time stays. */
export function hearLabel(cook: string, seconds: number): string {
  if (!(seconds > 0)) return `Hear ${cook}`;
  const full = `Hear ${cook} · ${mmss(seconds)}`;
  return full.length <= 17 ? full : `Hear · ${mmss(seconds)}`;
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const UNIT_WORD = /^(cloves?|slices?|pieces?|stalks?|sprigs?|leaf|leaves|heads?|bunch(es)?|cups?|sticks?|cans?|pinch(es)?|steaks?|fillets?|breasts?|thighs?)$/;

/** True when the words already name the ingredient (same rule as the app's recipe/text.ts). */
function names(words: string, name: string): boolean {
  const f = lower(words);
  const base = lower(name).replace(/\s*\(.*?\)\s*/g, ' ').trim();
  if (!base) return true;
  if (f.includes(base)) return true;
  const parts = base.split(/\s+/).filter((w) => w.length > 2);
  const has = (w: string) => f.includes(w.replace(/(es|s)$/, ''));
  const head = parts[parts.length - 1];
  if (!head) return false;
  if (!UNIT_WORD.test(head) && has(head)) return true;
  return parts.every(has);
}

const feelOf = (i: Ingredient) => (i.feel ?? '').trim().replace(/^["“”]+|["“”]+$/g, '');

/** The small line under an ingredient: "~2 lb", or "Amount not shown" (the app's estimateLine). */
export function estimateLine(i: Ingredient): string {
  const est = (i.estimate ?? '').trim();
  if (!est || est.toLowerCase() === 'unknown') return 'Amount not shown';
  return est.startsWith('~') ? est : `~${est}`;
}

/**
 * The two lines of an ingredient row, the app's Kid-Ingredients rule (checklistWords): the cook's
 * words (big, in quotes; the name in front when her words don't say what it is) and the amount
 * (small; the name after it only when the estimate doesn't already say it).
 */
export function ingredientLines(i: Ingredient): { words: string; amount: string; quoted: boolean } {
  const feel = feelOf(i);
  const name = (i.name ?? '').replace(/\s*\(.*?\)/g, '').trim();
  const est = estimateLine(i);
  const known = est !== 'Amount not shown';
  if (!feel) return { words: capitalize((i.name ?? '').trim()) || 'Something', amount: est, quoted: false };
  if (name && !names(feel, name)) return { words: `${capitalize(name)}, “${feel}”`, amount: est, quoted: false };
  const amount = !known ? (name ? `${capitalize(name)}, amount not shown` : est) : !name || names(est, name) ? est : `${est} ${name}`;
  return { words: `“${feel}”`, amount, quoted: true };
}

/**
 * An ingredient in the "Not sure how much?" list (the app's ingredientWords): the cook's words in
 * quotes, with the name in front when her words don't say what it is; the name alone without words.
 */
export function ingredientWords(i: Ingredient): string {
  const feel = feelOf(i);
  const name = capitalize((i.name ?? '').trim());
  if (!feel) return name || 'Something';
  if (names(feel, i.name ?? '')) return `“${feel}”`;
  return `${name}, “${feel}”`;
}

/** Ingredients whose amount the cook only hinted at (low confidence, or no estimate). */
export function unsureIngredients(r: Recipe): Ingredient[] {
  return r.ingredients.filter((i) => i.confidence === 'low' || lower(i.estimate) === 'unknown' || !lower(i.estimate));
}

export function hasVideo(r: Recipe): boolean {
  return !!r.media.video_url;
}

export function hasAudio(r: Recipe): boolean {
  return !!(r.media.audio_url || r.media.video_url);
}

/** Possessive for headings: "Dad’s", "Miles’" (typographic apostrophe, like the rest of the copy). */
export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** A family name as it reads mid-sentence: "Our family" -> "our family", "The Wangs" -> "the Wangs". */
export function midSentence(family: string): string {
  return family.replace(/^(Our|The)\b/, (w) => w.toLowerCase());
}

/**
 * The invite headline: the family's own name, never the inviter's (QA B28), so every invite into one
 * family reads the same whoever sent it, and matches the app's "Join Test family?" and /r's sheet.
 * "Test family" -> "Join Test family on homecookd", "Our family" -> "Join our family on homecookd",
 * no name -> "Join your family on homecookd".
 */
export function joinFamilyTitle(family: string | null | undefined): string {
  const name = family?.trim();
  return `Join ${name ? midSentence(name).replace(/'/g, '’') : 'your family'} on homecookd`;
}

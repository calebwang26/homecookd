// The Community story card's pure rules: the cook's quotes a card may show, and what a Muse answer
// may put on the card. A quote is always one of her own step quotes (the recipe text she chose to
// share), never a story and never written by Muse: Muse only picks one by its number.
import { flagged } from "./moderation";

export const STORY_WORDS = 25;
export const QUOTE_WORDS = 20;
const MAX_QUOTES = 12;

export type Card = { text: string; culture: string | null; quote: string | null };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** Trimmed, without wrapping double quotation marks. */
export const unquote = (s: string) => s.trim().replace(/^["“]+|["”]+$/g, "").trim();

/**
 * Her English step quotes, in step order, each at most 20 words (a longer one gives its sentences).
 * One the word filter catches (lib/moderation.ts) is never a choice, so it never reaches a card.
 */
export function quoteChoices(steps: readonly { order: number; quote?: string }[]): string[] {
  const out: string[] = [];
  for (const s of [...steps].sort((a, b) => a.order - b.order)) {
    const q = unquote(s.quote ?? "");
    if (!q) continue;
    const parts = words(q) <= QUOTE_WORDS ? [q] : q.split(/(?<=[.!?])\s+/).map(unquote);
    for (const p of parts) {
      const n = words(p);
      if (n >= 2 && n <= QUOTE_WORDS && !out.includes(p) && !flagged(p)) out.push(p);
    }
  }
  return out.slice(0, MAX_QUOTES);
}

/** "Maharashtrian", "Filipino", "Polish American"; anything else (long, vague, odd characters) is null. */
export function cleanCulture(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const c = s.trim().replace(/\s+/g, " ");
  if (!c || c.length > 40 || words(c) > 3 || !/^\p{L}[\p{L}' -]*$/u.test(c)) return null;
  return /^(unknown|none|other|various|home|family)$/i.test(c) ? null : c;
}

/** One sentence of at most 25 words, without wrapping quotation marks; else null (also for stray JSON). */
export function cleanStory(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = unquote(s);
  const n = words(t);
  return n > 0 && n <= STORY_WORDS && !/[{}]/.test(t) ? t : null;
}

/**
 * Muse's answer (JSON { story, culture, quote: number }, or a bare sentence) as a card, or null when
 * the sentence isn't usable. A quote number that isn't on the list gives her first quote.
 */
export function parseMuseCard(content: string, quotes: readonly string[]): Card | null {
  const raw = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let reply: unknown = raw;
  try {
    reply = JSON.parse(raw);
  } catch {
    // a bare sentence
  }
  const o = reply && typeof reply === "object" ? (reply as Record<string, unknown>) : { story: reply };
  const text = cleanStory(o.story);
  if (!text) return null;
  const n = o.quote;
  const picked = typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= quotes.length ? quotes[n - 1] : null;
  return { text, culture: cleanCulture(o.culture), quote: picked ?? quotes[0] ?? null };
}

/** Without Muse: the plain line, no culture, and her first quote if she has one. */
export function fallbackCard(text: string, quotes: readonly string[]): Card {
  return { text, culture: null, quote: quotes[0] ?? null };
}

/** "Rajani's Kanda Poha, from the Pawar family." when Muse isn't set up or doesn't answer. */
export function plainStory(f: { cookName: string; dish: string; publicName: string | null }): string {
  const whose = f.cookName ? `${f.cookName}'s ${f.dish}` : f.dish;
  return f.publicName ? `${whose}, from the ${f.publicName} family.` : `${whose}.`;
}

/** The cook's stories Muse may use: only if she said yes to sharing them. */
export function storiesFor(r: { memoriesOptIn: boolean; memories: readonly { kind: string; text: string }[] }): string[] {
  return r.memoriesOptIn ? r.memories.filter((m) => m.kind === "story").slice(0, 3).map((m) => m.text) : [];
}

/**
 * True when the card's quote is the English of words she said in another language: its step has her
 * original words (quoteOriginal). The app tags it "Translated".
 */
export function quoteTranslated(steps: readonly { order: number; quote?: string; quoteOriginal?: string }[], quote: string | null): boolean {
  if (!quote) return false;
  const step = [...steps]
    .sort((a, b) => a.order - b.order)
    .find((s) => {
      const q = unquote(s.quote ?? "");
      return q === quote || q.split(/(?<=[.!?])\s+/).map(unquote).includes(quote);
    });
  return !!step?.quoteOriginal?.trim();
}

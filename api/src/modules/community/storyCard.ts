// The story card's pure rules (convex/lib/storyCard.ts): what neighbors read of a card, and what a model's answer may put on one. The writer is
// messages/storyCards.ts. A quote is always one of her own step quotes, never a story, and the model only picks one by its number.
import { flagged } from "../dish/moderation.js";
import type { FamilyRow } from "../people/service.js";
import type { RecipeRow, RecipeStep } from "../recipes/service.js";

export const STORY_WORDS = 25;
const QUOTE_WORDS = 20;
const MAX_QUOTES = 12;

export type Card = { text: string; culture: string | null; quote: string | null };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** Trimmed, without wrapping double quotation marks. */
const unquote = (s: string) => s.trim().replace(/^["“]+|["”]+$/g, "").trim();

/**
 * Her English step quotes, in step order, each at most 20 words (a longer one gives its sentences). One the word filter catches is never a choice, so it
 * never reaches a card.
 */
export function quoteChoices(steps: readonly Pick<RecipeStep, "order" | "quote">[]): string[] {
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
 * The model's answer (JSON { story, culture, quote: number }, or a bare sentence) as a card, or null when the sentence isn't usable. A quote number that isn't
 * on the list gives her first quote. Convex's parseMuseCard.
 */
export function parseCard(content: string, quotes: readonly string[]): Card | null {
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

/** Without the model: the plain line, no culture, and her first quote if she has one. */
export function fallbackCard(text: string, quotes: readonly string[]): Card {
  return { text, culture: null, quote: quotes[0] ?? null };
}

/** The cook's stories the model may use: only if she said yes to sharing them. */
export function storiesFor(r: { memoriesOptIn: boolean; memories: readonly { kind: string; text: string }[] }): string[] {
  return r.memoriesOptIn ? r.memories.filter((m) => m.kind === "story").slice(0, 3).map((m) => m.text) : [];
}

/** True when the card's quote is the English of words she said in another language. The app tags it "Translated". */
export function quoteTranslated(steps: readonly Pick<RecipeStep, "order" | "quote" | "quoteOriginal">[], quote: string | null): boolean {
  if (!quote) return false;
  const step = [...steps]
    .sort((a, b) => a.order - b.order)
    .find((s) => {
      const q = unquote(s.quote ?? "");
      return q === quote || q.split(/(?<=[.!?])\s+/).map(unquote).includes(quote);
    });
  return !!step?.quoteOriginal?.trim();
}

/** "Rajani's Kanda Poha, from the Pawar family." Never the family's private name. */
export function plainStory(f: { cookName: string; dish: string; publicName: string | null }): string {
  const whose = f.cookName ? `${f.cookName}'s ${f.dish}` : f.dish;
  return f.publicName ? `${whose}, from the ${f.publicName} family.` : `${whose}.`;
}

/** "The Pawar family", or "Rajani's family" when the family has no public name. Never `families.name`. */
export function familyLabel(family: Pick<FamilyRow, "public_name"> | null | undefined, cookName: string): string {
  if (family?.public_name) return `The ${family.public_name} family`;
  return `${cookName.split(/\s+/)[0] || "A"}'s family`;
}

/**
 * What neighbors see of the card. Once she says no to the stories it was written from, the plain line instead, and no culture (the model may have read it
 * in a story). A card that doesn't record whether stories went in counts as written from them. The quote shows only while it's still one of her step quotes.
 */
export function publicCard(r: RecipeRow, cookName: string, family: FamilyRow | null | undefined) {
  if (r.story_card_text === null) return { text: null, culture: null, quote: null };
  const quote = r.story_card_quote && quoteChoices(r.steps).includes(r.story_card_quote) ? r.story_card_quote : null;
  if (r.story_card_used_stories !== false && !r.memories_opt_in) {
    return { text: plainStory({ cookName, dish: r.title, publicName: family?.public_name ?? null }), culture: null, quote };
  }
  return { text: r.story_card_text, culture: r.story_card_culture, quote };
}

/** What other families read of a shared recipe: its name, its steps and the story card. A filtered step quote never reaches the card. */
export function recipeWords(r: Pick<RecipeRow, "title" | "steps" | "story_card_text" | "story_card_culture">): string[] {
  return [r.title, ...r.steps.flatMap((s) => [s.title, s.text]), r.story_card_text ?? "", r.story_card_culture ?? ""];
}

/** Only our own stock and cover photos, by construction: a family's poster is a video frame, and lives in another column. */
export const coverUrl = (r: Pick<RecipeRow, "cover_stock_path">) => (r.cover_stock_path ? `https://homecookd.app/media/${r.cover_stock_path}` : null);

// What neighbors read of a story card (convex/lib/storyCard.ts, the reading half). Writing a card waits with sharing, because it writes `recipes`
// (COMMUNITY-MIGRATION.md). A quote is always one of her own step quotes, never a story.
import { flagged } from "../dish/moderation.js";
import type { FamilyRow } from "../people/service.js";
import type { RecipeRow, RecipeStep } from "../recipes/service.js";

const QUOTE_WORDS = 20;
const MAX_QUOTES = 12;

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
function plainStory(f: { cookName: string; dish: string; publicName: string | null }): string {
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
export function recipeWords(r: RecipeRow): string[] {
  return [r.title, ...r.steps.flatMap((s) => [s.title, s.text]), r.story_card_text ?? "", r.story_card_culture ?? ""];
}

/** Only our own stock and cover photos, by construction: a family's poster is a video frame, and lives in another column. */
export const coverUrl = (r: Pick<RecipeRow, "cover_stock_path">) => (r.cover_stock_path ? `https://homecookd.app/media/${r.cover_stock_path}` : null);

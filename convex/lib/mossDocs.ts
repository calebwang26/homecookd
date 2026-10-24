// What goes into a family's Moss index (`family-<familyId>`): one doc per step (with the cook's own
// words) and one per story or tip the cook agreed to share, each pointing at its moment in the video.
// The voice service searches it and plays the clip at startS..endS. Metadata values are strings (Moss).
// The index model (moss-minilm) is English-only and kids ask in English, so the pipeline writes every
// field in English (the cook's Marathi stays in recipe.json's quote_original); Devanagari text that still
// slips through is left out of the searched text, where it would only blur the match.
import type { Doc } from "../_generated/dataModel";

export type MossDoc = { id: string; text: string; metadata: Record<string, string> };

export const mossIndexName = (familyId: string) => `family-${familyId}`;

const devanagari = /[\u0900-\u097F]/;
const english = (s?: string) => (s && !devanagari.test(s) ? s : undefined);

export function stepDocs(recipe: Doc<"recipes">): MossDoc[] {
  return recipe.steps.map((s) => ({
    id: `${recipe._id}:step:${s.order}`,
    text: [`Step ${s.order}: ${s.title}.`, s.text, english(s.quote) && `The cook said: "${s.quote}"`].filter(Boolean).join(" "),
    metadata: {
      recipeId: recipe._id,
      recipeTitle: recipe.title,
      kind: "step",
      stepOrder: String(s.order),
      startS: String(s.moment.startS),
      endS: String(s.moment.endS),
      quote: s.quote ?? "",
    },
  }));
}

export function memoryDocs(recipe: Doc<"recipes">): MossDoc[] {
  return recipe.memories.flatMap((m, i) => (english(m.text) ? [{
    id: `${recipe._id}:${m.kind}:${i}`,
    text: m.text,
    metadata: {
      recipeId: recipe._id,
      recipeTitle: recipe.title,
      kind: m.kind,
      startS: String(m.moment.startS),
      endS: String(m.moment.endS),
      quote: m.text,
    },
  }] : []));
}

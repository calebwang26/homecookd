// The signed-in person, and the language they speak: an ISO 639-1 code like Ink's ("mr" for Marathi).
// Unset means English. homie, the pipeline and voice-note transcription all read it.
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSession } from "./lib/auth";

/** A two-letter language code, lowercased, or null. */
export function languageCode(raw: string): string | null {
  const code = raw.trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
}

export const me = query({
  args: { sessionToken: v.string() },
  returns: v.object({
    personId: v.id("people"),
    name: v.string(),
    role: v.union(v.literal("cook"), v.literal("kid")),
    language: v.string(),
    relation: v.optional(v.string()),
  }),
  handler: async (ctx, { sessionToken }) => {
    const { person } = await requireSession(ctx, sessionToken);
    return {
      personId: person._id,
      name: person.name,
      role: person.role,
      language: person.language ?? "en",
      relation: person.relation,
    };
  },
});

export const setLanguage = mutation({
  args: { sessionToken: v.string(), language: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken, language }) => {
    const { person } = await requireSession(ctx, sessionToken);
    const code = languageCode(language);
    if (!code) throw new ConvexError("Pick a language from the list.");
    await ctx.db.patch("people", person._id, { language: code });
    return null;
  },
});

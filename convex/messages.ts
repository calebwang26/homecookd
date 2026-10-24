// Family messages: text, voice notes, and the photo of the finished dish with the note Muse Spark
// drafted for it (sharePhoto). An AI-drafted note keeps its label after the kid edits it.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { findSession, requireSession, SIGNED_OUT } from "./lib/auth";
import { familyRecipe } from "./recipes";
import schema from "./schema";

const MAX_TEXT = 2000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const messageView = schema.doc("messages").extend({
  fromName: v.string(),
  fileUrl: v.union(v.null(), v.string()),
});

/** The family's messages to everyone, plus the ones to or from me. Newest first. */
export const list = query({
  args: { sessionToken: v.string() },
  returns: v.array(messageView),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const me = signed.person._id;
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_familyId", (q) => q.eq("familyId", signed.family._id))
      .order("desc")
      .take(200);
    const names = new Map<Id<"people">, string>();
    const out = [];
    for (const m of recent) {
      if (m.to && m.to !== me && m.from !== me) continue;
      if (!names.has(m.from)) names.set(m.from, (await ctx.db.get("people", m.from))?.name ?? "");
      out.push({
        ...m,
        fromName: names.get(m.from) ?? "",
        fileUrl: m.fileId ? await ctx.storage.getUrl(m.fileId) : null,
      });
      if (out.length === 100) break;
    }
    return out;
  },
});

export const send = mutation({
  args: {
    sessionToken: v.string(),
    kind: v.union(v.literal("text"), v.literal("voice"), v.literal("photo")),
    text: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    to: v.optional(v.id("people")),
    recipeId: v.optional(v.id("recipes")),
    // true when the text started as a Muse Spark draft (sharePhoto), even after the kid edited it.
    aiDrafted: v.optional(v.boolean()),
  },
  returns: v.id("messages"),
  handler: async (ctx, args) => {
    const signed = await requireSession(ctx, args.sessionToken);
    const text = args.text?.trim() || undefined;
    if (text && text.length > MAX_TEXT) throw new ConvexError("That message is too long.");
    if (args.kind === "text" && !text) throw new ConvexError("Write something first.");
    if (args.kind !== "text") {
      if (!args.fileId) throw new ConvexError("Upload it before sending it.");
      const file = await ctx.db.system.get("_storage", args.fileId);
      if (!file) throw new ConvexError("Upload it before sending it.");
      if (file.size > MAX_FILE_BYTES) throw new ConvexError("That file is too big.");
    } else if (args.fileId) {
      throw new ConvexError("A text message has no file.");
    }
    if (args.to) {
      const to = await ctx.db.get("people", args.to);
      if (!to || to.familyId !== signed.family._id) throw new ConvexError("They aren't in this family.");
    }
    if (args.recipeId && !(await familyRecipe(ctx, signed, args.recipeId))) {
      throw new ConvexError("That recipe isn't here anymore.");
    }
    return await ctx.db.insert("messages", {
      familyId: signed.family._id,
      from: signed.person._id,
      to: args.to,
      kind: args.kind,
      text,
      fileId: args.fileId,
      recipeId: args.recipeId,
      aiDrafted: args.aiDrafted ?? false,
    });
  },
});

// ---- The finished-dish photo and Muse Spark's draft note (Meta Model API, OpenAI-compatible) ----

const MUSE_URL = "https://api.meta.ai/v1/chat/completions";
const MUSE_MODEL = "muse-spark-1.3"; // pinned; not a "-contributor" model, which may train on family data

export const photoContext = internalQuery({
  args: { sessionToken: v.string(), recipeId: v.id("recipes"), fileId: v.id("_storage") },
  returns: v.union(
    v.object({ error: v.string() }),
    v.object({ kidName: v.string(), cookName: v.string(), recipeTitle: v.string(), photoUrl: v.string() }),
  ),
  handler: async (ctx, { sessionToken, recipeId, fileId }) => {
    const signed = await findSession(ctx, sessionToken);
    if (!signed) return { error: SIGNED_OUT };
    const recipe = await familyRecipe(ctx, signed, recipeId);
    if (!recipe) return { error: "That recipe isn't here anymore." };
    const file = await ctx.db.system.get("_storage", fileId);
    const photoUrl = await ctx.storage.getUrl(fileId);
    if (!file || !photoUrl) return { error: "Upload the photo before sharing it." };
    if (file.contentType && !file.contentType.startsWith("image/")) return { error: "That isn't a photo." };
    if (file.size > MAX_FILE_BYTES) return { error: "That photo is too big." };
    const cook = await ctx.db.get("people", recipe.cookId);
    return { kidName: signed.person.name, cookName: cook?.name ?? "", recipeTitle: recipe.title, photoUrl };
  },
});

/**
 * Muse Spark drafts a short note from the kid to the cook about the photo. Nothing is sent: the app
 * shows the draft for the kid to edit, then calls messages.send with `aiDrafted: true`.
 */
export const sharePhoto = action({
  args: { sessionToken: v.string(), recipeId: v.id("recipes"), fileId: v.id("_storage") },
  returns: v.object({ draft: v.string(), aiDrafted: v.literal(true) }),
  handler: async (ctx, args) => {
    const c = await ctx.runQuery(internal.messages.photoContext, args);
    if ("error" in c) throw new ConvexError(c.error ?? "Try again.");
    const apiKey = process.env.MUSE_API_KEY;
    if (!apiKey) throw new ConvexError("The note writer isn't set up yet. Write your own for now.");
    const cook = c.cookName || "the cook";
    const res = await fetch(MUSE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MUSE_MODEL,
        reasoning_effort: "low",
        max_completion_tokens: 1500, // reasoning shares this budget
        messages: [
          {
            role: "system",
            content:
              "You draft a short note a grown kid sends to the family member who taught them a dish, " +
              "with a photo of the dish they just cooked. Write in the kid's voice: warm, casual, one or " +
              "two sentences, no hashtags. Only mention what the photo or the facts given show; never " +
              "invent memories, people or how it tasted. Reply with the note only.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${c.kidName} just cooked "${c.recipeTitle}", the recipe ${cook} taught them, and is sending ${cook} this photo.`,
              },
              { type: "image_url", image_url: { url: c.photoUrl } },
            ],
          },
        ],
      }),
    });
    const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
    const draft = body?.choices?.[0]?.message?.content;
    if (!res.ok || typeof draft !== "string" || !draft.trim()) {
      console.error("Muse Spark failed", res.status);
      throw new ConvexError("Couldn't draft a note just now. Write your own, or try again.");
    }
    return { draft: draft.trim().replace(/^"|"$/g, "").slice(0, MAX_TEXT), aiDrafted: true as const };
  },
});

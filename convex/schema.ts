// The hackathon data model (docs/build/STACK.md). Families and people mirror the Supabase ones, so
// today's sign-in keeps working: sessions.start checks a phone's device key against Supabase once,
// then the phone uses a Convex session token. Big videos and clips stay in the GCS buckets; Convex
// holds everything else and keeps both phones updated live.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** A span of the cook's video, in seconds. Every step, memory and found answer points at one. */
const moment = v.object({ startS: v.number(), endS: v.number() });

export default defineSchema({
  families: defineTable({
    name: v.string(),
    supabaseFamilyId: v.string(),
  }).index("by_supabaseFamilyId", ["supabaseFamilyId"]),

  people: defineTable({
    familyId: v.id("families"),
    supabaseProfileId: v.string(),
    name: v.string(),
    role: v.union(v.literal("cook"), v.literal("kid")),
    // Opt-in only (PLAN principles): a cloned voice exists only after this person said yes.
    voiceClone: v.optional(v.object({ consentedAt: v.number(), cartesiaVoiceId: v.optional(v.string()) })),
  })
    .index("by_familyId", ["familyId"])
    .index("by_supabaseProfileId", ["supabaseProfileId"]),

  /** One per signed-in phone. Only a hash of the token is stored. */
  sessions: defineTable({
    tokenHash: v.string(),
    familyId: v.id("families"),
    personId: v.id("people"),
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_expiresAt", ["expiresAt"]),

  /** A dish being processed or ready to cook. The full recipe.json stays in GCS (recipeJsonUrl). */
  recipes: defineTable({
    familyId: v.id("families"),
    cookId: v.id("people"),
    title: v.string(),
    status: v.union(v.literal("processing"), v.literal("ready"), v.literal("failed")),
    libraryId: v.optional(v.string()),
    recipeJsonUrl: v.optional(v.string()),
    coverUrl: v.optional(v.string()),
    steps: v.array(
      v.object({
        order: v.number(),
        title: v.string(),
        text: v.string(),
        quote: v.optional(v.string()), // the cook's own words for this step, from the video
        moment,
      }),
    ),
    // Stories and tips Muse Spark kept from the video; shown only if the cook opted in.
    memories: v.array(v.object({ kind: v.union(v.literal("story"), v.literal("tip")), text: v.string(), moment })),
    memoriesOptIn: v.boolean(),
    mossIndexedAt: v.optional(v.number()),
  }).index("by_familyId", ["familyId"]),

  /** One upload going through the pipeline. The worker claims it and reports each stage. */
  jobs: defineTable({
    familyId: v.id("families"),
    cookId: v.id("people"),
    recipeId: v.optional(v.id("recipes")),
    uploadPath: v.string(), // the raw video in the GCS uploads bucket
    source: v.union(v.literal("phone"), v.literal("glasses")),
    stage: v.union(
      v.literal("queued"),
      v.literal("preparing"),
      v.literal("understanding"), // Gemini
      v.literal("writing"), // Muse Spark
      v.literal("indexing"), // Moss
      v.literal("done"),
      v.literal("failed"),
    ),
    progress: v.number(), // 0..1 across the whole job
    error: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
  })
    .index("by_familyId", ["familyId"])
    .index("by_stage", ["stage"]),

  /** What the kid is cooking right now, so the cook's phone can show "Leo is on step 3". */
  cookingSessions: defineTable({
    familyId: v.id("families"),
    recipeId: v.id("recipes"),
    kidId: v.id("people"),
    stepOrder: v.number(),
    updatedAt: v.number(), // so a forgotten session stops showing after a while
    endedAt: v.optional(v.number()),
  }).index("by_familyId", ["familyId"]),

  /**
   * A kid's question while cooking. The video answers it when Moss finds the moment; otherwise it
   * goes to the cook, never to an AI guess (PLAN principles).
   */
  questions: defineTable({
    familyId: v.id("families"),
    recipeId: v.id("recipes"),
    stepOrder: v.optional(v.number()),
    askedBy: v.id("people"),
    text: v.string(),
    status: v.union(v.literal("found_in_video"), v.literal("asked_cook"), v.literal("answered")),
    found: v.optional(v.object({ moment, quote: v.string() })),
    answer: v.optional(
      v.object({
        by: v.id("people"),
        text: v.optional(v.string()),
        audioId: v.optional(v.id("_storage")),
        transcript: v.optional(v.string()), // Cartesia Ink
      }),
    ),
  })
    .index("by_recipeId", ["recipeId"])
    .index("by_familyId_and_status", ["familyId", "status"]),

  /** Family messages, including the finished-dish photo and the note Muse drafted for it. */
  messages: defineTable({
    familyId: v.id("families"),
    from: v.id("people"),
    to: v.optional(v.id("people")),
    kind: v.union(v.literal("text"), v.literal("voice"), v.literal("photo")),
    text: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    recipeId: v.optional(v.id("recipes")),
    aiDrafted: v.boolean(), // shown with an "AI-drafted" label (PLAN principles)
  }).index("by_familyId", ["familyId"]),
});

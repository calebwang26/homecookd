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
    // Community cards say "the Pawar family"; unset means the family isn't shown by name.
    publicName: v.optional(v.string()),
    // Moss rebuilds a whole index on every write, so two writes at once lose one. One sync runs per
    // family at a time (worker.requestMossSync); `again` means a recipe changed while it ran.
    mossSync: v.optional(v.object({ startedAt: v.number(), again: v.boolean() })),
  }).index("by_supabaseFamilyId", ["supabaseFamilyId"]),

  people: defineTable({
    familyId: v.id("families"),
    supabaseProfileId: v.string(),
    name: v.string(),
    role: v.union(v.literal("cook"), v.literal("kid")),
    // Opt-in only (PLAN principles): a cloned voice exists only after this person said yes.
    voiceClone: v.optional(v.object({ consentedAt: v.number(), cartesiaVoiceId: v.optional(v.string()) })),
    // The language this person speaks, as an Ink code ("mr" for Marathi). Unset means English.
    language: v.optional(v.string()),
    // What the family calls them ("Grandma", "Aaji"), when it differs from their name. homie uses it.
    relation: v.optional(v.string()),
    // Community: where they are, rounded to about 1 km before it's stored (lib/geo.ts). Never shown.
    approx: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    campus: v.optional(v.string()),
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
        quote: v.optional(v.string()), // the cook's own words for this step, from the video (English)
        quoteOriginal: v.optional(v.string()), // the same words as she said them, when that wasn't English
        moment,
      }),
    ),
    // Stories and tips Muse Spark kept from the video; shown only if the cook opted in.
    memories: v.array(v.object({ kind: v.union(v.literal("story"), v.literal("tip")), text: v.string(), moment })),
    memoriesOptIn: v.boolean(),
    mossIndexedAt: v.optional(v.number()),
    language: v.optional(v.string()), // what the cook spoke in the video (Ink code); unset means English
    // Community (cook-only switch, off by default). Set = shared with people nearby as a story card
    // plus the recipe's text; the video and voice never leave the family.
    sharedAt: v.optional(v.number()),
    storyCard: v.optional(v.object({ text: v.string(), writtenAt: v.number() })), // Muse Spark, labelled AI
  })
    .index("by_familyId", ["familyId"])
    .index("by_sharedAt", ["sharedAt"]),

  /** One upload going through the pipeline. The worker claims it and reports each stage. */
  jobs: defineTable({
    familyId: v.id("families"),
    cookId: v.id("people"),
    recipeId: v.optional(v.id("recipes")),
    uploadPath: v.string(), // the raw video in the GCS uploads bucket
    source: v.union(v.literal("phone"), v.literal("glasses")),
    title: v.optional(v.string()), // the dish the cook named before or after recording
    language: v.optional(v.string()), // what the cook speaks in the video (Ink code)
    forKidId: v.optional(v.id("people")),
    recordingId: v.optional(v.id("recordings")), // homie's live session, when there was one
    stage: v.union(
      v.literal("uploading"), // the worker found the upload incomplete and handed it back
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
    textForCook: v.optional(v.string()), // the question in the cook's language, when it isn't English
    status: v.union(v.literal("found_in_video"), v.literal("asked_cook"), v.literal("answered")),
    found: v.optional(v.object({ moment, quote: v.string() })),
    answer: v.optional(
      v.object({
        by: v.id("people"),
        text: v.optional(v.string()),
        audioId: v.optional(v.id("_storage")),
        transcript: v.optional(v.string()), // Cartesia Ink, in the cook's own language and script
        translation: v.optional(v.string()), // Gemini's English, when the cook doesn't speak English; label it translated
      }),
    ),
  })
    .index("by_recipeId", ["recipeId"])
    .index("by_familyId_and_status", ["familyId", "status"]),

  /**
   * homie's live session while a cook records (voice service /record). `startedAt` is t0 for every
   * homiePrompts.atS; the glasses VM sets `videoStartedAt` (its first frame), so the worker can put
   * homie's questions on the video's own clock.
   */
  recordings: defineTable({
    familyId: v.id("families"),
    cookId: v.id("people"),
    forKidId: v.optional(v.id("people")),
    dish: v.optional(v.string()),
    language: v.string(), // Ink code; "en" by default
    source: v.union(v.literal("phone"), v.literal("glasses")),
    status: v.union(
      v.literal("intro"), // homie is saying hello; nothing is being filmed yet
      v.literal("recording"),
      v.literal("wrapping_up"), // "I'm done": the last questions and the goodbye
      v.literal("ended"),
      v.literal("abandoned"),
    ),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    videoStartedAt: v.optional(v.number()),
    memoriesOptIn: v.optional(v.boolean()), // her answer to "Can <kid> hear your stories too?"
    jobId: v.optional(v.id("jobs")),
    updatedAt: v.number(),
  })
    .index("by_familyId", ["familyId"])
    .index("by_status", ["status"]),

  /** Everything homie said during a recording, and what the cook answered. */
  homiePrompts: defineTable({
    recordingId: v.id("recordings"),
    familyId: v.id("families"),
    kind: v.union(
      v.literal("intro"),
      v.literal("amount"),
      v.literal("cue"),
      v.literal("substitution"),
      v.literal("story"),
      v.literal("reaction"),
      v.literal("end"),
      v.literal("closing"),
      v.literal("optin"),
    ),
    text: v.string(), // what homie said, in the cook's language
    textEn: v.string(),
    atS: v.number(), // seconds after recordings.startedAt (negative: before filming started)
    status: v.union(v.literal("spoken"), v.literal("answered"), v.literal("ignored"), v.literal("not_now")),
    answer: v.optional(
      v.object({ transcript: v.string(), transcriptEn: v.optional(v.string()), atS: v.number(), endS: v.number() }),
    ),
  }).index("by_recordingId", ["recordingId"]),

  /** Community: a dinner hosted around one shared recipe. The address is private until the host accepts. */
  dinners: defineTable({
    hostId: v.id("people"),
    hostFamilyId: v.id("families"),
    recipeId: v.id("recipes"),
    dish: v.string(),
    startsAt: v.number(),
    placeKind: v.union(v.literal("campus_kitchen"), v.literal("community_center"), v.literal("cafe"), v.literal("home")),
    placeName: v.string(), // public ("Baker House kitchen")
    address: v.string(), // shown only to the host and accepted guests
    approx: v.object({ lat: v.number(), lng: v.number() }), // rounded to ~1 km
    seats: v.number(),
    status: v.union(v.literal("open"), v.literal("full"), v.literal("cancelled")),
  })
    .index("by_status", ["status"])
    .index("by_hostId", ["hostId"]),

  dinnerRequests: defineTable({
    dinnerId: v.id("dinners"),
    guestId: v.id("people"),
    guestFamilyId: v.id("families"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
  })
    .index("by_dinnerId", ["dinnerId"])
    .index("by_guestId", ["guestId"]),

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

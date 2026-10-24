// The hackathon data model (docs/build/STACK.md). Families and people mirror the Supabase ones, so
// today's sign-in keeps working: sessions.start checks a phone's device key against Supabase once,
// then the phone uses a Convex session token. Big videos and clips stay in the GCS buckets; Convex
// holds everything else and keeps both phones updated live.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** A span of the cook's video, in seconds. Every step, memory and found answer points at one. */
const moment = v.object({ startS: v.number(), endS: v.number() });

/**
 * A story or tip from the video. Where it sits in recipe.json, so the app can put it back (the public
 * recipe.json leaves these out): `step` is its step's order; a story and a special moment have their `id`,
 * a story its `title`, a special moment its `why`. A tip with no id is its step's own tip. Older
 * recipes have only kind, text and moment.
 */
export const memory = v.object({
  kind: v.union(v.literal("story"), v.literal("tip")),
  text: v.string(),
  moment,
  step: v.optional(v.number()),
  id: v.optional(v.string()),
  title: v.optional(v.string()),
  why: v.optional(v.string()),
});

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

  /** A dish being processed or ready to cook. Its recipe.json is in GCS (recipeJsonUrl), without the memories (older files still have them). */
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
    // Stories and tips Muse Spark kept from the video; shown only to the cook until she opts in.
    memories: v.array(memory),
    memoriesOptIn: v.boolean(),
    mossIndexedAt: v.optional(v.number()),
    language: v.optional(v.string()), // what the cook spoke in the video (Ink code); unset means English
    // Community (cook-only switch, off by default). Set = shared with people nearby as a story card
    // plus the recipe's text; the video and voice never leave the family.
    sharedAt: v.optional(v.number()),
    // Muse Spark, labelled AI. usedStories: her stories went into it (only shown while she still says yes).
    // culture: Muse's label for the dish ("Maharashtrian"). quote: one of her own step quotes, picked, never written.
    storyCard: v.optional(
      v.object({
        text: v.string(),
        writtenAt: v.number(),
        usedStories: v.optional(v.boolean()),
        culture: v.optional(v.string()),
        quote: v.optional(v.string()),
      }),
    ),
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
    forKidId: v.optional(v.id("people")), // the one kid it's for (lib/forKids.ts)
    forKidIds: v.optional(v.array(v.id("people"))), // every kid it's for (Oct 24); read both
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
    // Glasses: spans of the video with no footage even in the laptop's full backup (seconds from
    // recordings.videoStartedAt). The worker tells Gemini not to invent steps there.
    videoGaps: v.optional(v.array(moment)),
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
    // "share": not about cooking. Someone in the family asked the cook to put shareRecipeId (this
    // recipe) on the Community map; only her clear yes shares it (convex/shareRequests.ts).
    kind: v.optional(v.literal("share")),
    shareRecipeId: v.optional(v.id("recipes")),
    // How homie read her answer to a share ask (lib/yesNo.ts), and when. After a no or an unclear
    // answer the family can't ask her again for a day.
    shareDecision: v.optional(
      v.object({ said: v.union(v.literal("yes"), v.literal("no"), v.literal("unclear")), at: v.number() }),
    ),
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
    forKidId: v.optional(v.id("people")), // the one kid it's for (lib/forKids.ts)
    forKidIds: v.optional(v.array(v.id("people"))), // every kid it's for (Oct 24); read both
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
    // Glasses through the laptop bridge: the full video it built from its backup, for the cook to save to
    // Photos and send through the app herself (glasses/BRIDGE.md). Public, unguessable URL.
    videoUrl: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_familyId", ["familyId"])
    .index("by_status", ["status"])
    .index("by_cookId_and_startedAt", ["cookId", "startedAt"]),

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

  /**
   * What the glasses' live analysis saw while the cook cooked (the laptop bridge, glasses/BRIDGE.md):
   * steps, ingredients, cues, quotes and stories from Gemini, 30 s at a time, plus the cook's button
   * taps. Hints for the app's live view and for the final recipe; the full video is still the source.
   * atS is seconds on the glasses session's clock, which started at sessionStartedAt (epoch ms).
   */
  liveEvents: defineTable({
    recordingId: v.id("recordings"),
    familyId: v.id("families"),
    sessionId: v.string(), // the glasses' own session id (a reboot mid-cook starts a new one)
    sessionStartedAt: v.number(),
    kind: v.union(
      v.literal("step"),
      v.literal("ingredient"),
      v.literal("cue"),
      v.literal("quote"),
      v.literal("story"),
      v.literal("marker"),
    ),
    atS: v.number(),
    endS: v.optional(v.number()),
    title: v.string(),
    text: v.string(),
    saidAs: v.optional(v.string()), // the cook's own words for an amount
    quoteOriginal: v.optional(v.string()),
    confidence: v.number(),
  }).index("by_recordingId", ["recordingId"]),

  /** The newest glasses frame of a live recording (one row each, replaced about once a second by the laptop
   *  bridge), so the cook's phone can show what the glasses see. Older frames' files are deleted. */
  liveFrames: defineTable({
    recordingId: v.id("recordings"),
    storageId: v.id("_storage"),
    at: v.number(), // when Convex got it (epoch ms)
    // When the glasses took it (ms on the glasses session's clock): several uploads are in flight at once,
    // so an older frame that lands late must not replace a newer one.
    sessionId: v.optional(v.string()),
    t: v.optional(v.number()),
  }).index("by_recordingId", ["recordingId"]),

  /** Each window the live analysis tried, so a hole in liveEvents reads as "not analysed", not "nothing happened". */
  liveWindows: defineTable({
    recordingId: v.id("recordings"),
    familyId: v.id("families"),
    sessionId: v.string(),
    sessionStartedAt: v.number(),
    startS: v.number(),
    endS: v.number(),
    ok: v.boolean(),
    reason: v.optional(v.string()), // why it failed: no footage, analysis behind, a Gemini error
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
    // "Invite friends": one random token per dinner, made the first time the host or a guest asks
    // for the link (dinners.inviteLink). It opens homecookd.app/d, which shows only the dish, the
    // host's name and when.
    inviteToken: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_hostId", ["hostId"])
    .index("by_inviteToken", ["inviteToken"]),

  /** One per phone or browser that opened a dinner's invite link (POST /invite/open): "X going" counts them. */
  dinnerInviteOpens: defineTable({
    dinnerId: v.id("dinners"),
    deviceId: v.string(), // made up by the opening phone or browser, kept on it
  }).index("by_dinnerId_and_deviceId", ["dinnerId", "deviceId"]),

  dinnerRequests: defineTable({
    dinnerId: v.id("dinners"),
    guestId: v.id("people"),
    guestFamilyId: v.id("families"),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
  })
    .index("by_dinnerId", ["dinnerId"])
    .index("by_guestId", ["guestId"]),

  /**
   * Community: one family asks another to swap recipes, or (kind "cook") to cook the other family's
   * dish together. Every recipe in one is already shared, so it shows no recipe text that neighbors
   * couldn't already see.
   */
  swapRequests: defineTable({
    requesterId: v.id("people"),
    requesterFamilyId: v.id("families"),
    theirRecipeId: v.id("recipes"), // the other family's shared recipe
    myRecipeId: v.optional(v.id("recipes")), // one of the requester family's shared recipes, offered back (swaps only)
    otherFamilyId: v.id("families"),
    kind: v.optional(v.literal("cook")), // unset: a swap
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
  })
    .index("by_requesterFamilyId", ["requesterFamilyId"])
    .index("by_otherFamilyId", ["otherFamilyId"]),

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

// The hackathon data model (docs/build/STACK.md). Families and people mirror the Supabase ones, so
// today's sign-in keeps working: sessions.start checks a phone's device key against Supabase once,
// then the phone uses a Convex session token. Big videos and clips stay in the GCS buckets; Convex
// holds everything else and keeps both phones updated live.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { cardStatusV, questionIdV, questionV, recipeV, relationV, viaV } from "./lib/dishAskValues";

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
    // They deleted their account (account.deleteMe): the row stays as a blank tombstone, since other
    // rows may still point at it, and no session or sign-in works as them again.
    deletedAt: v.optional(v.number()),
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
    .index("by_expiresAt", ["expiresAt"])
    .index("by_personId", ["personId"]),

  /**
   * One per deleted account (account.deleteMe). Convex rows are purged right away (`purgedAt` once the
   * last batch ran); the rest is for a later purge outside Convex: their Supabase rows and their media
   * in GCS (the privacy policy promises it within 30 days). The pipeline worker does that one
   * (pipeline/account_purge.py, through /worker/deletions/*): `externalPurgedAt` once it's done.
   */
  accountDeletions: defineTable({
    familyId: v.id("families"),
    personId: v.id("people"),
    supabaseProfileId: v.string(),
    requestedAt: v.number(),
    recipeIds: v.array(v.id("recipes")), // the recipes they cooked (gone from Convex)
    jobIds: v.array(v.id("jobs")), // their uploads' jobs: the worker names each recipe's GCS folder after one
    uploadPaths: v.array(v.string()), // their raw videos in the GCS uploads bucket
    mediaUrls: v.array(v.string()), // recipe.json files, covers and glasses videos in GCS
    voiceCloneId: v.optional(v.string()), // her Cartesia voice clone, to delete there
    purgedAt: v.optional(v.number()),
    purgeRunAt: v.optional(v.number()), // the last purge batch; the restart cron goes by it
    purgeRestarts: v.optional(v.number()),
    externalPurgedAt: v.optional(v.number()),
    externalAttempts: v.optional(v.number()), // failed tries; the worker stops at worker.MAX_PURGE_ATTEMPTS
    externalTriedAt: v.optional(v.number()),
    externalError: v.optional(v.string()), // the last failure, short and without secrets
    externalCounts: v.optional(v.record(v.string(), v.number())), // what the worker deleted, per kind
  })
    .index("by_purgedAt", ["purgedAt"])
    .index("by_externalPurgedAt", ["externalPurgedAt"]),

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
    // Reports from two families hid it from every other family until the team looks (lib/safety.ts).
    hiddenAt: v.optional(v.number()),
    // Ingredients the cook confirmed after a follow-up question (convex/followUps.ts). recipe.json in GCS doesn't
    // have them: the app shows them beside its ingredient list, with her own words for how much.
    addedIngredients: v.optional(
      v.array(
        v.object({
          name: v.string(),
          said: v.optional(v.string()), // her answer, in English when there is one ("a handful, at the start")
          step: v.optional(v.number()),
          questionId: v.id("questions"),
        }),
      ),
    ),
  })
    .index("by_familyId", ["familyId"])
    .index("by_sharedAt", ["sharedAt"])
    .index("by_cookId", ["cookId"]),

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
    .index("by_stage", ["stage"])
    .index("by_uploadPath", ["uploadPath"])
    .index("by_cookId", ["cookId"]),

  /** What the kid is cooking right now, so the cook's phone can show "Leo is on step 3". */
  cookingSessions: defineTable({
    familyId: v.id("families"),
    recipeId: v.id("recipes"),
    kidId: v.id("people"),
    stepOrder: v.number(),
    updatedAt: v.number(), // so a forgotten session stops showing after a while
    endedAt: v.optional(v.number()),
  })
    .index("by_familyId", ["familyId"])
    .index("by_kidId", ["kidId"])
    .index("by_recipeId", ["recipeId"]),

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
    // "followUp": the pipeline's own question about the recipe (recipe.json follow_up_questions, e.g. an ingredient
    // the video's frames showed but nobody named). Asked of the recipe's cook (askedBy is the cook; the app shows
    // "homie"), and her yes to an ingredient one adds it to recipes.addedIngredients (convex/followUps.ts).
    kind: v.optional(v.union(v.literal("share"), v.literal("followUp"))),
    followUp: v.optional(
      v.object({
        id: v.string(), // recipe.json's follow_up_questions[].id, so a re-published recipe doesn't ask twice
        ingredient: v.optional(v.string()), // set on "did you add …?" questions
        said: v.optional(v.union(v.literal("yes"), v.literal("no"), v.literal("unclear"))), // how her answer read
      }),
    ),
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
    .index("by_familyId_and_status", ["familyId", "status"])
    .index("by_askedBy", ["askedBy"])
    .index("by_answer_by", ["answer.by"]),

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
    // A phone recording filmed in the app: the photo of the finished plate homie asked for at the end,
    // for the recipe's cover (the worker's claim hands its URL to the pipeline).
    coverStorageId: v.optional(v.id("_storage")),
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
      v.literal("show"), // homie asks her to show or hold something up for the camera (in-app filming)
      v.literal("reaction"),
      v.literal("end"),
      v.literal("plate"), // "show me the plate": the app takes the cover photo
      v.literal("closing"),
      v.literal("optin"),
    ),
    text: v.string(), // what homie said, in the cook's language
    textEn: v.string(),
    atS: v.number(), // seconds after recordings.startedAt (negative: before filming started)
    // When homie's voice played on the phone (same clock as atS). Its voice is in the phone's video too, so
    // the pipeline can lower or cut these spans.
    said: v.optional(v.object({ atS: v.number(), endS: v.number() })),
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
    hiddenAt: v.optional(v.number()), // as recipes.hiddenAt
  })
    .index("by_status", ["status"])
    .index("by_hostId", ["hostId"])
    .index("by_inviteToken", ["inviteToken"])
    .index("by_recipeId", ["recipeId"]),

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
    .index("by_otherFamilyId", ["otherFamilyId"])
    .index("by_requesterId", ["requesterId"])
    .index("by_theirRecipeId", ["theirRecipeId"])
    .index("by_myRecipeId", ["myRecipeId"]),

  /**
   * Community: someone reported another family's recipe or dinner ("Report or block"), or blocked that
   * family (kind "family"). It hides the item from the reporter's family at once; open reports from two
   * families hide it from everyone else (hiddenAt) until the team reviews it (reports.ts).
   */
  reports: defineTable({
    reporterFamilyId: v.id("families"),
    reporterPersonId: v.id("people"),
    kind: v.union(v.literal("recipe"), v.literal("dinner"), v.literal("family")),
    targetId: v.string(), // the recipe's, dinner's or family's id
    targetFamilyId: v.id("families"),
    reason: v.optional(v.union(v.literal("not_food"), v.literal("rude"), v.literal("other"))),
    createdAt: v.number(),
    status: v.union(v.literal("open"), v.literal("resolved")),
  })
    .index("by_reporterFamilyId_and_kind_and_targetId", ["reporterFamilyId", "kind", "targetId"])
    .index("by_kind_and_targetId", ["kind", "targetId"])
    .index("by_status", ["status"]),

  /** Community: one family blocked another. Both ways: neither sees the other's dishes, dinners or asks. */
  blocks: defineTable({
    familyId: v.id("families"),
    blockedFamilyId: v.id("families"),
    label: v.string(), // how the blocked family's cards named it, for the unblock list
    createdAt: v.number(),
  })
    .index("by_familyId_and_blockedFamilyId", ["familyId", "blockedFamilyId"])
    .index("by_blockedFamilyId_and_familyId", ["blockedFamilyId", "familyId"]),

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
  })
    .index("by_familyId", ["familyId"])
    .index("by_from", ["from"]),

  // --- Pushes from Convex (docs/build/V2-LINKING.md §1; Notifications & linking). Supabase still sends today's.
  /** One phone's Expo push token, moved to whoever signed in on it last. */
  pushTokens: defineTable({
    token: v.string(),
    personId: v.id("people"),
    familyId: v.id("families"),
    platform: v.union(v.literal("ios"), v.literal("android")),
    tz: v.optional(v.string()), // IANA zone from the phone, for quiet hours
    updatedAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_personId", ["personId"]),

  /** Every push decided on, sent or not: dedupe, the daily limits, receipts. Pruned after 40 days. */
  pushLog: defineTable({
    personId: v.id("people"),
    kind: v.union(v.literal("answered"), v.literal("craving"), v.literal("joined"), v.literal("filmed")),
    dedupeKey: v.string(),
    status: v.union(v.literal("queued"), v.literal("sent"), v.literal("failed"), v.literal("none"), v.literal("capped")),
    title: v.string(),
    body: v.string(),
    url: v.string(), // an in-app path, e.g. /dish/<id>
    sendAt: v.number(),
    tickets: v.optional(v.array(v.object({ id: v.string(), token: v.string() }))), // for the receipts check
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_personId_and_dedupeKey", ["personId", "dedupeKey"])
    .index("by_personId_and_createdAt", ["personId", "createdAt"])
    .index("by_createdAt", ["createdAt"]),
  // ---- Dish ask (docs/build/DISH-ASK-SPEC.md): the web's "what dish do you miss?" and Mom's answers ----

  /**
   * One card: a kid's guess at a dish from home (no account), and what Mom answered. Both links' tokens are
   * stored only as sha256. Kept forever for now (Caleb, Oct 29); account deletion takes a signed-in family's.
   */
  dishAsks: defineTable({
    kidTokenHash: v.string(),
    askTokenHash: v.string(),
    dish: v.string(), // as the kid typed it, trimmed ("" when they gave only a photo or a voice note)
    relation: relationV,
    kidName: v.optional(v.string()),
    photos: v.array(v.id("_storage")), // the photos the card was made from (0–3)
    // The kid's voice note about the dish, that the guess was written from. Private: never on Mom's page or the card.
    dishVoiceNote: v.optional(v.id("_storage")),
    kidVoiceNote: v.optional(v.id("_storage")), // the kid's voice note to Mom (never sent to a model)
    guess: recipeV, // tonight's version: the kid's guess
    message: v.string(), // the Ask Mom text, in the kid's voice
    asked: v.array(questionV), // what Mom is asked: her answered questions first (0–6)
    // Mom's page in her language (peek's `lang`): the guess, the asked questions and the message, one entry per
    // language, kept while `key` (the asked questions and the message) still matches.
    momLang: v.optional(
      v.array(v.object({ lang: v.string(), key: v.string(), guess: recipeV, questions: v.array(questionV), message: v.string() })),
    ),
    version: v.optional(recipeV), // Mom's version, once her answers are merged
    status: cardStatusV, // as stored; the pages get it worked out from the answers too (dishAsks.ts)
    mergeTries: v.number(), // this round of new answers (a new answer starts it again at 0)
    mergeStartedAt: v.optional(v.number()), // the last try; one started under 3 minutes ago is still running
    mergedAt: v.optional(v.number()),
    askedAt: v.optional(v.number()),
    askedVia: v.optional(viaV),
    openedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()), // Mom pressed Send (or her answers were left 20 minutes)
    questionsAt: v.optional(v.number()), // the kid's last /dish/cards/ask
    genMs: v.number(),
    createdAt: v.number(),
    ipKey: v.string(), // HMAC of the maker's IP (lib/rateLimit.ts), never the IP
    // Phase 4 (docs/build/V2-LINKING.md): the kid and Mom in the app, once each claims the card.
    familyId: v.optional(v.id("families")),
    personId: v.optional(v.id("people")), // the kid
    requestedOf: v.optional(v.id("people")), // Mom
    kidClaimedAt: v.optional(v.number()),
    cookClaimedAt: v.optional(v.number()),
    // Phase 5 (DISH-ASK-SPEC.md §8): the craving link the card was made from (familyId and requestedOf come with it),
    // the day Mom plans to film it (0 = Sunday … 6), and the question her voice recipe from the app answers.
    cravingId: v.optional(v.id("cravingLinks")),
    filmingDay: v.optional(v.number()),
    voiceRecipeQ: v.optional(questionIdV),
  })
    .index("by_kid_token", ["kidTokenHash"])
    .index("by_ask_token", ["askTokenHash"])
    .index("by_family", ["familyId"])
    .index("by_person", ["personId"])
    .index("by_requested_of", ["requestedOf"])
    .index("by_craving_created", ["cravingId", "createdAt"]),

  /**
   * A parent's "what do you miss?" link (DISH-ASK-SPEC.md §8): one live link per person, reused, with caps per link
   * (lib/cravingLinks.ts). The token is stored as-is so her own link can be shown to her again; it's never returned
   * to anyone else. A stopped link makes no new cards; the cards it made stay.
   */
  cravingLinks: defineTable({
    familyId: v.id("families"),
    personId: v.id("people"), // who made it: the cards from it are asked of them
    token: v.string(),
    message: v.string(), // her line on the kid's page, in her voice
    uses: v.number(), // cards made from it
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_person", ["personId"]),

  /** One of Mom's voice answers to a card's question. Re-recording replaces it (and deletes the old clip). */
  dishAnswers: defineTable({
    askId: v.id("dishAsks"),
    questionId: questionIdV,
    audio: v.id("_storage"),
    durationS: v.number(),
    language: v.string(), // what she speaks, for Ink ("en" by default)
    words: v.optional(v.string()), // Ink's transcript, in her language; "" = no words; unset = not heard yet
    english: v.optional(v.union(v.string(), v.null())), // null: English, or no translation; unset = not yet
    merged: v.boolean(), // her version was made with this clip
    createdAt: v.number(),
  })
    .index("by_ask_question", ["askId", "questionId"])
    .index("by_audio", ["audio"]),

  /** A kid's upload (POST /dish/files): a photo or a voice note, until it's on a card (else deleted after an hour). */
  dishFiles: defineTable({
    fileIdHash: v.string(),
    storageId: v.id("_storage"),
    kind: v.union(v.literal("photo"), v.literal("voice")),
    contentType: v.string(),
    size: v.number(),
    ipKey: v.string(),
    askId: v.optional(v.id("dishAsks")), // set once it's attached to a card
    createdAt: v.number(),
  })
    .index("by_file_id", ["fileIdHash"])
    .index("by_unattached_created", ["askId", "createdAt"])
    .index("by_storage", ["storageId"]),

  /** The dish ask's model spend, one row per UTC day (the $10 daily budget, lib/dishAskValues.ts). */
  dishSpend: defineTable({
    day: v.string(), // "2026-10-29"
    usd: v.number(),
    alertedAt: v.optional(v.number()), // the team was told this day reached the budget
  }).index("by_day", ["day"]),

  /** The public routes' fixed-window limiter (lib/rateLimit.ts): a bucket plus an HMAC of the IP. */
  rateHits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  })
    .index("by_key_window", ["key", "windowStart"])
    .index("by_window", ["windowStart"]),
});

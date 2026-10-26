// Community dinners: someone hosts a dinner around one of their family's shared recipes (or another
// family's shared dish that family agreed to cook with them) and neighbors ask to join. The address
// stays private: only the host and the guests they accepted ever see it.
// "Invite friends": the host and accepted guests share one link per dinner (inviteLink); whoever opens
// it (homecookd.app/d or the app's /d screen, through POST /invite/open in lib/inviteRoutes.ts) sees
// only the dish, the host's name and when, and counts once per phone or browser in "X going".
// Reports and blocks (lib/safety.ts) hide a dinner and refuse asks the way they do for recipes.
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { acceptedCount, cookingTogether, familyLabel, PUBLIC_COVER } from "./community";
import { newToken, requireSession, type Signed } from "./lib/auth";
import { distanceLabel, milesBetween, placeOf, roundToGrid } from "./lib/geo";
import { flagged, NOT_POSTABLE } from "./lib/moderation";
import { type Shield, seesDinner, seesRecipe, shieldFor } from "./lib/safety";
import { familyRecipe } from "./recipes";
import schema from "./schema";

/** Invite links open the website's /d page (or the app, where it's installed). */
export const INVITE_ORIGIN = "https://homecookd.app";
/** A dinner's "going" count stops growing from link opens here. */
export const MAX_OPENS = 300;
/** At most this many new phones count per dinner in OPEN_BURST_MS; past it, the page still opens, uncounted. */
export const OPEN_BURST = 60;
export const OPEN_BURST_MS = 10 * 60_000;

async function inviteOpens(ctx: QueryCtx, dinnerId: Id<"dinners">) {
  return await ctx.db
    .query("dinnerInviteOpens")
    .withIndex("by_dinnerId_and_deviceId", (q) => q.eq("dinnerId", dinnerId))
    .take(MAX_OPENS);
}

const placeKind = schema.tables.dinners.validator.fields.placeKind;
const requestStatus = schema.tables.dinnerRequests.validator.fields.status;

const dinnerView = v.object({
  dinnerId: v.id("dinners"),
  dish: v.string(),
  // Set only when the recipe's text can be opened (community.recipe): shared, or the host's family.
  recipeId: v.union(v.null(), v.id("recipes")),
  coverUrl: v.union(v.null(), v.string()), // our stock photo of the dish, when the recipe opens and has one
  hostName: v.string(),
  familyName: v.string(), // the host's family, named the way its cards name it
  ours: v.boolean(), // my own family's dinner: nothing to report
  placeKind,
  placeName: v.string(),
  startsAt: v.number(),
  seats: v.number(),
  seatsLeft: v.number(),
  inviteOpens: v.number(), // phones and browsers that opened the invite link, once each
  status: schema.tables.dinners.validator.fields.status,
  distanceLabel: v.string(),
  isHost: v.boolean(),
  myRequest: v.union(v.null(), v.object({ requestId: v.id("dinnerRequests"), status: requestStatus })),
  address: v.union(v.null(), v.string()),
  requests: v.union(
    v.null(),
    v.array(v.object({ requestId: v.id("dinnerRequests"), guestName: v.string(), status: requestStatus })),
  ),
});

async function view(ctx: QueryCtx, signed: Signed, shield: Shield, d: Doc<"dinners">) {
  const all = await ctx.db
    .query("dinnerRequests")
    .withIndex("by_dinnerId", (q) => q.eq("dinnerId", d._id))
    .take(200);
  const isHost = d.hostId === signed.person._id;
  const mine = all.find((r) => r.guestId === signed.person._id) ?? null;
  const recipe = await ctx.db.get("recipes", d.recipeId);
  const canOpen = !!recipe && (!!recipe.sharedAt || recipe.familyId === signed.family._id) && seesRecipe(shield, recipe);
  const hostName = (await ctx.db.get("people", d.hostId))?.name ?? "";
  const requests = [];
  if (isHost) {
    for (const r of all) {
      if (shield.blocked.has(r.guestFamilyId)) continue;
      requests.push({ requestId: r._id, guestName: (await ctx.db.get("people", r.guestId))?.name ?? "", status: r.status });
    }
  }
  return {
    dinnerId: d._id,
    dish: d.dish,
    recipeId: canOpen ? d.recipeId : null,
    coverUrl: canOpen && recipe?.coverUrl && PUBLIC_COVER.test(recipe.coverUrl) ? recipe.coverUrl : null,
    hostName,
    familyName: familyLabel(await ctx.db.get("families", d.hostFamilyId), hostName),
    ours: d.hostFamilyId === signed.family._id,
    placeKind: d.placeKind,
    placeName: d.placeName,
    startsAt: d.startsAt,
    seats: d.seats,
    seatsLeft: Math.max(0, d.seats - all.filter((r) => r.status === "accepted").length),
    inviteOpens: (await inviteOpens(ctx, d._id)).length,
    status: d.status,
    distanceLabel: distanceLabel(milesBetween(placeOf(signed.person), d.approx)),
    isHost,
    myRequest: mine && { requestId: mine._id, status: mine.status },
    address: isHost || mine?.status === "accepted" ? d.address : null,
    requests: isHost ? requests : null,
  };
}

/**
 * A dish my family may host: one of our own ready recipes, once its cook shared it (the dish name
 * reaches every neighbor's feed, so only her share switch lets it out), or another family's shared
 * dish they agreed to cook with us ("Cook together").
 */
async function hostable(ctx: QueryCtx, signed: Signed, recipeId: Id<"recipes">): Promise<Doc<"recipes">> {
  const own = await familyRecipe(ctx, signed, recipeId);
  if (own) {
    if (own.status !== "ready") throw new ConvexError("Pick one of your family's recipes.");
    if (!own.sharedAt) throw new ConvexError("Share this recipe first.");
    return own;
  }
  const theirs = await ctx.db.get("recipes", recipeId);
  const visible = !!theirs && seesRecipe(await shieldFor(ctx, signed.family._id), theirs);
  if (visible && theirs?.status === "ready" && theirs.sharedAt && (await cookingTogether(ctx, signed.family._id, recipeId))) return theirs;
  throw new ConvexError("Pick one of your family's recipes.");
}

const text = (s: string, what: string) => {
  const t = s.trim();
  if (!t || t.length > 200) throw new ConvexError(`Add the ${what}.`);
  return t;
};

export const create = mutation({
  args: {
    sessionToken: v.string(),
    recipeId: v.id("recipes"),
    startsAt: v.number(),
    placeKind: v.optional(placeKind),
    placeName: v.string(),
    address: v.string(),
    seats: v.number(),
  },
  returns: v.id("dinners"),
  handler: async (ctx, args) => {
    const signed = await requireSession(ctx, args.sessionToken);
    const recipe = await hostable(ctx, signed, args.recipeId);
    if (args.startsAt <= Date.now()) throw new ConvexError("Pick a time that hasn't passed.");
    if (!Number.isInteger(args.seats) || args.seats < 1 || args.seats > 20) throw new ConvexError("Seats go from 1 to 20.");
    if (flagged(recipe.title, args.placeName, args.address)) throw new ConvexError(NOT_POSTABLE);
    return await ctx.db.insert("dinners", {
      hostId: signed.person._id,
      hostFamilyId: signed.family._id,
      recipeId: recipe._id,
      dish: recipe.title,
      startsAt: args.startsAt,
      placeKind: args.placeKind ?? "campus_kitchen",
      placeName: text(args.placeName, "place's name"),
      address: text(args.address, "address"),
      approx: roundToGrid(placeOf(signed.person)),
      seats: args.seats,
      status: "open",
    });
  },
});

export const get = query({
  args: { sessionToken: v.string(), dinnerId: v.id("dinners") },
  returns: v.union(v.null(), dinnerView),
  handler: async (ctx, { sessionToken, dinnerId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const shield = await shieldFor(ctx, signed.family._id);
    const d = await ctx.db.get("dinners", dinnerId);
    return d && seesDinner(shield, d) ? await view(ctx, signed, shield, d) : null;
  },
});

/** Dinners I host, then the ones I asked to join; soonest first. */
export const mine = query({
  args: { sessionToken: v.string() },
  returns: v.array(dinnerView),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const shield = await shieldFor(ctx, signed.family._id);
    const hosting = await ctx.db
      .query("dinners")
      .withIndex("by_hostId", (q) => q.eq("hostId", signed.person._id))
      .take(50);
    const asked = await ctx.db
      .query("dinnerRequests")
      .withIndex("by_guestId", (q) => q.eq("guestId", signed.person._id))
      .take(50);
    const out = [];
    for (const d of hosting.sort((a, b) => a.startsAt - b.startsAt)) out.push(await view(ctx, signed, shield, d));
    const joined = [];
    for (const r of asked) {
      const d = await ctx.db.get("dinners", r.dinnerId);
      if (d && seesDinner(shield, d)) joined.push(d);
    }
    for (const d of joined.sort((a, b) => a.startsAt - b.startsAt)) out.push(await view(ctx, signed, shield, d));
    return out;
  },
});

export const requestJoin = mutation({
  args: { sessionToken: v.string(), dinnerId: v.id("dinners") },
  returns: v.id("dinnerRequests"),
  handler: async (ctx, { sessionToken, dinnerId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const d = await ctx.db.get("dinners", dinnerId);
    const visible = !!d && seesDinner(await shieldFor(ctx, signed.family._id), d);
    if (!d || !visible || d.status === "cancelled" || d.startsAt <= Date.now()) throw new ConvexError("That dinner isn't happening anymore.");
    if (d.hostFamilyId === signed.family._id) throw new ConvexError("This is your family's dinner.");
    const asked = await ctx.db
      .query("dinnerRequests")
      .withIndex("by_guestId", (q) => q.eq("guestId", signed.person._id))
      .take(200);
    if (asked.some((r) => r.dinnerId === dinnerId)) throw new ConvexError("You already asked to join.");
    if (d.status === "full" || (await acceptedCount(ctx, dinnerId)) >= d.seats) throw new ConvexError("That dinner is full.");
    return await ctx.db.insert("dinnerRequests", {
      dinnerId,
      guestId: signed.person._id,
      guestFamilyId: signed.family._id,
      status: "pending",
    });
  },
});

/** The host says yes or no. The dinner is full once every seat has an accepted guest. */
export const respond = mutation({
  args: { sessionToken: v.string(), requestId: v.id("dinnerRequests"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { sessionToken, requestId, accept }) => {
    const signed = await requireSession(ctx, sessionToken);
    const r = await ctx.db.get("dinnerRequests", requestId);
    const d = r && (await ctx.db.get("dinners", r.dinnerId));
    if (!r || !d || d.hostId !== signed.person._id) throw new ConvexError("Only the host can answer.");
    if (r.status !== "pending") throw new ConvexError("You already answered.");
    if (accept && (await shieldFor(ctx, signed.family._id)).blocked.has(r.guestFamilyId)) throw new ConvexError("That ask isn't open anymore.");
    if (!accept) {
      await ctx.db.patch("dinnerRequests", requestId, { status: "declined" });
      return null;
    }
    const accepted = await acceptedCount(ctx, d._id);
    if (accepted >= d.seats) throw new ConvexError("Every seat is taken.");
    await ctx.db.patch("dinnerRequests", requestId, { status: "accepted" });
    if (accepted + 1 >= d.seats && d.status === "open") await ctx.db.patch("dinners", d._id, { status: "full" });
    return null;
  },
});

// ---- "Invite friends" ----

/** The dinner's one invite link, for the host or a guest they said yes to. The same link every time. */
export const inviteLink = action({
  args: { sessionToken: v.string(), dinnerId: v.id("dinners") },
  returns: v.object({ token: v.string(), url: v.string() }),
  handler: async (ctx, { sessionToken, dinnerId }): Promise<{ token: string; url: string }> => {
    // A fresh random token in case the dinner has none yet (an action's randomness is real); the
    // mutation keeps the first one ever stored.
    const token: string = await ctx.runMutation(internal.dinners.inviteToken, { sessionToken, dinnerId, fresh: newToken() });
    return { token, url: `${INVITE_ORIGIN}/d?t=${token}` };
  },
});

export const inviteToken = internalMutation({
  args: { sessionToken: v.string(), dinnerId: v.id("dinners"), fresh: v.string() },
  returns: v.string(),
  handler: async (ctx, { sessionToken, dinnerId, fresh }) => {
    const signed = await requireSession(ctx, sessionToken);
    const d = await ctx.db.get("dinners", dinnerId);
    if (!d || d.status === "cancelled") throw new ConvexError("That dinner isn't happening anymore.");
    if (d.hostId !== signed.person._id) {
      const requests = await ctx.db
        .query("dinnerRequests")
        .withIndex("by_dinnerId", (q) => q.eq("dinnerId", dinnerId))
        .take(200);
      if (!requests.some((r) => r.guestId === signed.person._id && r.status === "accepted")) {
        throw new ConvexError("Only the host and their guests can invite friends.");
      }
    }
    if (d.inviteToken) return d.inviteToken;
    await ctx.db.patch("dinners", dinnerId, { inviteToken: fresh });
    return fresh;
  },
});

/**
 * Someone opened an invite link (POST /invite/open). Counts this phone or browser once per dinner, while
 * the dinner is still ahead, up to MAX_OPENS and OPEN_BURST per OPEN_BURST_MS. The reply is all the
 * opener ever sees: the dish, the host's name and when. Never the place, the address or any id. The name
 * is the one the invite text ("Come to Kanda Poha Night with Grandma Rajani") and the dinner page's
 * "Hosted by" pill show, so /d says the same "Hosted by Grandma Rajani".
 * TODO(caleb): this is the host's whole display name; if families put surnames in it, decide whether a
 * link anyone can forward should show less.
 */
export const openInvite = internalMutation({
  args: { token: v.string(), deviceId: v.string() },
  returns: v.union(v.null(), v.object({ dish: v.string(), hostName: v.string(), startsAt: v.number() })),
  handler: async (ctx, { token, deviceId }) => {
    const d = await ctx.db
      .query("dinners")
      .withIndex("by_inviteToken", (q) => q.eq("inviteToken", token))
      .unique();
    if (!d || d.status === "cancelled" || d.hiddenAt) return null;
    const hostName = ((await ctx.db.get("people", d.hostId))?.name ?? "").trim();
    const reply = { dish: d.dish, hostName, startsAt: d.startsAt };
    const now = Date.now();
    if (d.startsAt <= now) return reply;
    const opens = await inviteOpens(ctx, d._id);
    const recent = opens.filter((o) => o._creationTime > now - OPEN_BURST_MS).length;
    if (opens.length >= MAX_OPENS || recent >= OPEN_BURST || opens.some((o) => o.deviceId === deviceId)) return reply;
    await ctx.db.insert("dinnerInviteOpens", { dinnerId: d._id, deviceId });
    return reply;
  },
});

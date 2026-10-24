// Community dinners: someone hosts a dinner around one of their family's recipes and neighbors ask to
// join. The address stays private: only the host and the guests they accepted ever see it.
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { acceptedCount } from "./community";
import { requireSession, type Signed } from "./lib/auth";
import { distanceLabel, milesBetween, placeOf, roundToGrid } from "./lib/geo";
import { familyRecipe } from "./recipes";
import schema from "./schema";

const placeKind = schema.tables.dinners.validator.fields.placeKind;
const requestStatus = schema.tables.dinnerRequests.validator.fields.status;

const dinnerView = v.object({
  dinnerId: v.id("dinners"),
  dish: v.string(),
  // Set only when the recipe's text can be opened (community.recipe): shared, or the host's family.
  recipeId: v.union(v.null(), v.id("recipes")),
  hostName: v.string(),
  placeKind,
  placeName: v.string(),
  startsAt: v.number(),
  seats: v.number(),
  seatsLeft: v.number(),
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

async function view(ctx: QueryCtx, signed: Signed, d: Doc<"dinners">) {
  const all = await ctx.db
    .query("dinnerRequests")
    .withIndex("by_dinnerId", (q) => q.eq("dinnerId", d._id))
    .take(200);
  const isHost = d.hostId === signed.person._id;
  const mine = all.find((r) => r.guestId === signed.person._id) ?? null;
  const recipe = await ctx.db.get("recipes", d.recipeId);
  const canOpen = !!recipe && (!!recipe.sharedAt || recipe.familyId === signed.family._id);
  const requests = [];
  if (isHost) {
    for (const r of all) {
      requests.push({ requestId: r._id, guestName: (await ctx.db.get("people", r.guestId))?.name ?? "", status: r.status });
    }
  }
  return {
    dinnerId: d._id,
    dish: d.dish,
    recipeId: canOpen ? d.recipeId : null,
    hostName: (await ctx.db.get("people", d.hostId))?.name ?? "",
    placeKind: d.placeKind,
    placeName: d.placeName,
    startsAt: d.startsAt,
    seats: d.seats,
    seatsLeft: Math.max(0, d.seats - all.filter((r) => r.status === "accepted").length),
    status: d.status,
    distanceLabel: distanceLabel(milesBetween(placeOf(signed.person), d.approx)),
    isHost,
    myRequest: mine && { requestId: mine._id, status: mine.status },
    address: isHost || mine?.status === "accepted" ? d.address : null,
    requests: isHost ? requests : null,
  };
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
    const recipe = await familyRecipe(ctx, signed, args.recipeId);
    if (!recipe || recipe.status !== "ready") throw new ConvexError("Pick one of your family's recipes.");
    if (args.startsAt <= Date.now()) throw new ConvexError("Pick a time that hasn't passed.");
    if (!Number.isInteger(args.seats) || args.seats < 1 || args.seats > 20) throw new ConvexError("Seats go from 1 to 20.");
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
    const d = await ctx.db.get("dinners", dinnerId);
    return d ? await view(ctx, signed, d) : null;
  },
});

/** Dinners I host, then the ones I asked to join; soonest first. */
export const mine = query({
  args: { sessionToken: v.string() },
  returns: v.array(dinnerView),
  handler: async (ctx, { sessionToken }) => {
    const signed = await requireSession(ctx, sessionToken);
    const hosting = await ctx.db
      .query("dinners")
      .withIndex("by_hostId", (q) => q.eq("hostId", signed.person._id))
      .take(50);
    const asked = await ctx.db
      .query("dinnerRequests")
      .withIndex("by_guestId", (q) => q.eq("guestId", signed.person._id))
      .take(50);
    const out = [];
    for (const d of hosting.sort((a, b) => a.startsAt - b.startsAt)) out.push(await view(ctx, signed, d));
    const joined = [];
    for (const r of asked) {
      const d = await ctx.db.get("dinners", r.dinnerId);
      if (d) joined.push(d);
    }
    for (const d of joined.sort((a, b) => a.startsAt - b.startsAt)) out.push(await view(ctx, signed, d));
    return out;
  },
});

export const requestJoin = mutation({
  args: { sessionToken: v.string(), dinnerId: v.id("dinners") },
  returns: v.id("dinnerRequests"),
  handler: async (ctx, { sessionToken, dinnerId }) => {
    const signed = await requireSession(ctx, sessionToken);
    const d = await ctx.db.get("dinners", dinnerId);
    if (!d || d.status === "cancelled" || d.startsAt <= Date.now()) throw new ConvexError("That dinner isn't happening anymore.");
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

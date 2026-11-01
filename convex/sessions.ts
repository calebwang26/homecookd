// Sign-in bridge (STACK.md, change 3). The phone already has a Supabase device key; we check it once
// against Supabase `GET /family`, copy the family and its people into Convex, and hand back a Convex
// session token. Every other function then takes that token (lib/auth.ts).
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation } from "./_generated/server";
import { ACCOUNT_DELETED, findSession, hashToken, newToken, SESSION_DAYS } from "./lib/auth";
import { fetchFamily } from "./lib/supabase";

const role = v.union(v.literal("cook"), v.literal("kid"));

export const start = action({
  args: { deviceKey: v.string(), profileId: v.string() },
  returns: v.object({ sessionToken: v.string(), familyId: v.id("families"), personId: v.id("people"), role }),
  handler: async (ctx, { deviceKey, profileId }) => {
    if (!deviceKey || deviceKey.length > 200 || !profileId || profileId.length > 100) {
      throw new ConvexError("Sign in again.");
    }
    const { family, profiles, needsPerson, devicePersonId } = await fetchFamily(deviceKey, profileId);
    // Supabase lets a phone with nobody read as a phone-less person, but a session can write, even
    // delete the account. Whoever opened a forwarded family invite adds themselves first. A family-code
    // phone with nobody follows the same rule once SESSIONS_NEED_OWN_PERSON=1: unset until 1.1 is in
    // the store, because 1.0's only sign-in for the TEST family is a code (Caleb, Nov 1).
    const noPersonYet = process.env.SESSIONS_NEED_OWN_PERSON === "1" && !devicePersonId;
    if (needsPerson || noPersonYet) throw new ConvexError("Add yourself first.");
    const me = profiles.find((p) => p.id === profileId);
    if (!me) throw new ConvexError("That person isn't in this family anymore.");
    if (me.invited) throw new ConvexError("They haven't joined yet.");
    if (me.locked) throw new ConvexError(`${me.name} uses their own phone.`);

    const sessionToken = newToken();
    const ids: { familyId: Id<"families">; personId: Id<"people"> } = await ctx.runMutation(internal.sessions.mirror, {
      supabaseFamilyId: family.id,
      familyName: family.name,
      people: profiles.map((p) => ({
        supabaseProfileId: p.id,
        name: p.name,
        role: p.role === "cook" ? ("cook" as const) : ("kid" as const),
      })),
      profileId,
      tokenHash: await hashToken(sessionToken),
    });
    return { sessionToken, ...ids, role: me.role === "cook" ? ("cook" as const) : ("kid" as const) };
  },
});

/** Upserts the family and its people, then stores the new session. Seeded people (seed.ts) are
 *  matched by name the first time a real phone signs in, so the demo recipes stay theirs. */
export const mirror = internalMutation({
  args: {
    supabaseFamilyId: v.string(),
    familyName: v.string(),
    people: v.array(v.object({ supabaseProfileId: v.string(), name: v.string(), role })),
    profileId: v.string(),
    tokenHash: v.string(),
  },
  returns: v.object({ familyId: v.id("families"), personId: v.id("people") }),
  handler: async (ctx, args) => {
    const found = await ctx.db
      .query("families")
      .withIndex("by_supabaseFamilyId", (q) => q.eq("supabaseFamilyId", args.supabaseFamilyId))
      .unique();
    let familyId: Id<"families">;
    if (found) {
      familyId = found._id;
      if (found.name !== args.familyName) await ctx.db.patch("families", familyId, { name: args.familyName });
    } else {
      familyId = await ctx.db.insert("families", { name: args.familyName, supabaseFamilyId: args.supabaseFamilyId });
    }

    const existing = await ctx.db
      .query("people")
      .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
      .take(200);
    let personId: Id<"people"> | null = null;
    for (const p of args.people.slice(0, 50)) {
      const match =
        existing.find((e) => e.supabaseProfileId === p.supabaseProfileId) ??
        existing.find((e) => e.supabaseProfileId.startsWith("seed:") && e.name === p.name);
      // A deleted account stays deleted, even while Supabase still lists them (its removal failed).
      if (match?.deletedAt !== undefined) {
        if (p.supabaseProfileId === args.profileId) throw new ConvexError(ACCOUNT_DELETED);
        continue;
      }
      let id: Id<"people">;
      if (match) {
        id = match._id;
        if (match.supabaseProfileId !== p.supabaseProfileId || match.name !== p.name || match.role !== p.role) {
          await ctx.db.patch("people", id, { supabaseProfileId: p.supabaseProfileId, name: p.name, role: p.role });
        }
      } else {
        id = await ctx.db.insert("people", { familyId, ...p });
      }
      if (p.supabaseProfileId === args.profileId) personId = id;
    }
    if (!personId) throw new ConvexError("That person isn't in this family anymore.");

    await ctx.db.insert("sessions", {
      tokenHash: args.tokenHash,
      familyId,
      personId,
      expiresAt: Date.now() + SESSION_DAYS * 24 * 3600 * 1000,
    });
    return { familyId, personId };
  },
});

/** Sign this phone out of Convex. */
export const end = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const signed = await findSession(ctx, sessionToken);
    if (signed) await ctx.db.delete("sessions", signed.session._id);
    return null;
  },
});

/** For HTTP actions and actions, which have no ctx.db. */
export const resolve = internalQuery({
  args: { sessionToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({ familyId: v.id("families"), personId: v.id("people"), name: v.string(), role }),
  ),
  handler: async (ctx, { sessionToken }) => {
    const signed = await findSession(ctx, sessionToken);
    if (!signed) return null;
    const { person } = signed;
    return { familyId: person.familyId, personId: person._id, name: person.name, role: person.role };
  },
});

export const purgeExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("sessions")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(500);
    for (const s of expired) await ctx.db.delete("sessions", s._id);
    return null;
  },
});

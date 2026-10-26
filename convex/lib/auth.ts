// The one session check every public function and voice route goes through. A phone holds a random
// session token from sessions.start; only its SHA-256 is stored, so a leaked table can't sign anyone in.
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const SESSION_DAYS = 30;
export const SIGNED_OUT = "This phone was signed out.";
/** sessions.start for someone who deleted their account (account.deleteMe). The app matches these words. */
export const ACCOUNT_DELETED = "This account was deleted.";

export type Signed = { session: Doc<"sessions">; person: Doc<"people">; family: Doc<"families"> };

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes, base64url (43 characters). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The session behind a token, or null. Queries can't read the clock, so expiry is enforced by the
 *  hourly purge (crons.ts) and by `requireSession` in mutations. */
export async function findSession(ctx: QueryCtx, sessionToken: string): Promise<Signed | null> {
  if (sessionToken.length < 20 || sessionToken.length > 200) return null;
  const tokenHash = await hashToken(sessionToken);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!session) return null;
  const person = await ctx.db.get("people", session.personId);
  const family = await ctx.db.get("families", session.familyId);
  if (!person || !family || person.familyId !== family._id || person.deletedAt !== undefined) return null;
  return { session, person, family };
}

export async function requireSession(ctx: QueryCtx | MutationCtx, sessionToken: string): Promise<Signed> {
  const signed = await findSession(ctx, sessionToken);
  // Mutations may read the clock; queries rely on the purge.
  const expired = signed && "scheduler" in ctx && signed.session.expiresAt < Date.now();
  if (!signed || expired) throw new ConvexError(SIGNED_OUT);
  return signed;
}

export function requireCook(signed: Signed): void {
  if (signed.person.role !== "cook") throw new ConvexError("Only the cook can do that.");
}

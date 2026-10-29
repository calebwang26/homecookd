// Craving links (docs/build/DISH-ASK-SPEC.md §8): what convex/cravings.ts, the card's create (dishAsks.ts) and the
// /dish/* routes share. A link is reusable and can be forwarded, so each one has caps of its own.
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { Relation } from "./dishAsk/types";
import { isRelation } from "./dishAsk/validate";
import { fail, notFound } from "./dishAskValues";
import { webOrigin } from "./webOrigin";

export const DEFAULT_CRAVING_MESSAGE = "What do you miss from home? Tell me and I'll make it for you.";
export const CRAVING_MESSAGE_CHARS = 300;
/** TODO(caleb): cards one link may make in 24 hours. */
export const CRAVING_PER_DAY = 5;
/** TODO(caleb): cards one link may make in all; then createLink makes her a new one. */
export const CRAVING_TOTAL = 20;
export const LINK_BUSY = "This link has had a lot of requests. Ask for a new one.";

const DAY_MS = 24 * 60 * 60_000;

export const cravingUrl = (token: string) => `${webOrigin()}/miss?c=${token}`;
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Who the kid is asking, from what the family calls her: one of the six when it's that word ("Mom"), else mom. */
export function relationFrom(called: string | undefined): Relation {
  const word = called?.trim().toLowerCase();
  return isRelation(word) ? word : "mom";
}

/** Her newest link: the only one that can be live (createLink makes a new one only when this one isn't). */
export const newestLink = (ctx: QueryCtx, personId: Id<"people">) =>
  ctx.db.query("cravingLinks").withIndex("by_person", (q) => q.eq("personId", personId)).order("desc").first();

/** A link she can hand out again: not stopped and not used up. */
export const isLive = (link: Doc<"cravingLinks">) => link.revokedAt === undefined && link.uses < CRAVING_TOTAL;

/** A link that isn't stopped, and whose maker is still here: 404 otherwise (a bad token for the IP's count). */
export async function openLink(ctx: QueryCtx, token: string): Promise<{ link: Doc<"cravingLinks">; maker: Doc<"people"> }> {
  const link = await ctx.db.query("cravingLinks").withIndex("by_token", (q) => q.eq("token", token)).unique();
  if (!link || link.revokedAt !== undefined) throw notFound();
  const maker = await ctx.db.get("people", link.personId);
  if (!maker || maker.deletedAt !== undefined || maker.familyId !== link.familyId) throw notFound();
  return { link, maker };
}

/** The link's caps: 429 once it made CRAVING_TOTAL cards, or CRAVING_PER_DAY in the last 24 hours. */
export async function checkLinkCaps(ctx: QueryCtx, link: Doc<"cravingLinks">, now: number): Promise<void> {
  if (link.uses >= CRAVING_TOTAL) throw fail(429, "rate", LINK_BUSY);
  const today = await ctx.db
    .query("dishAsks")
    .withIndex("by_craving_created", (q) => q.eq("cravingId", link._id).gt("createdAt", now - DAY_MS))
    .take(CRAVING_PER_DAY);
  if (today.length >= CRAVING_PER_DAY) throw fail(429, "rate", LINK_BUSY);
}

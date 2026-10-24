// Who a recording or job is for: one kid, several, or nobody named (the whole family). `forKidIds`
// holds the list; the older single `forKidId` is still read (rows from before Oct 24) and is still
// written when there is exactly one kid, so code that only knows `forKidId` keeps working.
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const forKidArgs = {
  forKidId: v.optional(v.id("people")),
  forKidIds: v.optional(v.array(v.id("people"))),
};

type ForKids = { forKidId?: Id<"people">; forKidIds?: Id<"people">[] };

/** The kids a row (or a call's args) names, in order, without repeats. */
export function forKids(row: ForKids): Id<"people">[] {
  return [...new Set(row.forKidIds ?? (row.forKidId ? [row.forKidId] : []))];
}

/** The stored fields for these kids. */
export function forKidFields(ids: Id<"people">[]): ForKids {
  return { forKidId: ids.length === 1 ? ids[0] : undefined, forKidIds: ids.length ? ids : undefined };
}

const MAX_KIDS = 20;

/** The args' kids, each checked to be a kid in this family; `refusal` is the error when one isn't. */
export async function familyKids(ctx: QueryCtx, familyId: Id<"families">, args: ForKids, refusal: string): Promise<Id<"people">[]> {
  const ids = forKids(args);
  if (ids.length > MAX_KIDS) throw new ConvexError(refusal);
  for (const id of ids) {
    const kid = await ctx.db.get("people", id);
    if (!kid || kid.familyId !== familyId || kid.role !== "kid") throw new ConvexError(refusal);
  }
  return ids;
}

/** Their names, in order (unknown ids are skipped). */
export async function kidNames(ctx: QueryCtx, row: ForKids): Promise<string[]> {
  const names: string[] = [];
  for (const id of forKids(row)) {
    const kid = await ctx.db.get("people", id);
    if (kid) names.push(kid.name);
  }
  return names;
}

// Community reports and blocks ("Report or block"). A report hides the recipe or dinner from the
// reporter's family at once; open reports from HIDE_AFTER different families hide it from every other
// family too (hiddenAt) until the team reviews it (reports.ts). A block works both ways: neither family
// sees the other's dishes, dinners or asks, and new asks between them are refused. Our own family's
// things always show to us.
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const HIDE_AFTER = 2;
const MAX_ROWS = 500;

export type Reportable = "recipe" | "dinner";
export type Shield = { familyId: Id<"families">; reported: Set<string>; blocked: Set<Id<"families">> };

const key = (kind: string, id: string) => `${kind}:${id}`;

/** What a family reported, and every family it blocked or that blocked it. */
export async function shieldFor(ctx: QueryCtx, familyId: Id<"families">): Promise<Shield> {
  const reports = await ctx.db
    .query("reports")
    .withIndex("by_reporterFamilyId_and_kind_and_targetId", (q) => q.eq("reporterFamilyId", familyId))
    .take(MAX_ROWS);
  const theyBlocked = await ctx.db
    .query("blocks")
    .withIndex("by_familyId_and_blockedFamilyId", (q) => q.eq("familyId", familyId))
    .take(MAX_ROWS);
  const blockedUs = await ctx.db
    .query("blocks")
    .withIndex("by_blockedFamilyId_and_familyId", (q) => q.eq("blockedFamilyId", familyId))
    .take(MAX_ROWS);
  return {
    familyId,
    reported: new Set(reports.map((r) => key(r.kind, r.targetId))),
    blocked: new Set([...theyBlocked.map((b) => b.blockedFamilyId), ...blockedUs.map((b) => b.familyId)]),
  };
}

export function seesRecipe(s: Shield, r: Doc<"recipes">): boolean {
  if (r.familyId === s.familyId) return true;
  return !r.hiddenAt && !s.blocked.has(r.familyId) && !s.reported.has(key("recipe", r._id));
}

/**
 * A dinner goes with its dish: one we reported, one reports hid or the team took down, or one from a
 * family we blocked (a "cook together" dinner of another family's dish). A dinner whose dish its cook
 * later unshared keeps going (dinners.ts), so `sharedAt` isn't asked for here.
 */
export function seesDinner(s: Shield, d: Doc<"dinners">, recipe: Doc<"recipes"> | null): boolean {
  if (d.hostFamilyId === s.familyId) return true;
  if (d.hiddenAt || s.blocked.has(d.hostFamilyId) || s.reported.has(key("dinner", d._id))) return false;
  return !s.reported.has(key("recipe", d.recipeId)) && (!recipe || seesRecipe(s, recipe));
}

/** seesDinner with the dinner's recipe read. */
export async function dinnerVisible(ctx: QueryCtx, s: Shield, d: Doc<"dinners">): Promise<boolean> {
  return seesDinner(s, d, await ctx.db.get("recipes", d.recipeId));
}

/** Whether this family already reported it (a second report changes nothing, so it isn't refused). */
export const reportedBy = (s: Shield, kind: Reportable, id: string) => s.reported.has(key(kind, id));

/** One report per family and item; a second one from the same family changes nothing. */
export async function fileReport(
  ctx: MutationCtx,
  by: { familyId: Id<"families">; personId: Id<"people"> },
  target: { kind: Reportable | "family"; id: string; familyId: Id<"families"> },
  reason?: "not_food" | "rude" | "other",
): Promise<void> {
  const before = await ctx.db
    .query("reports")
    .withIndex("by_reporterFamilyId_and_kind_and_targetId", (q) =>
      q.eq("reporterFamilyId", by.familyId).eq("kind", target.kind).eq("targetId", target.id),
    )
    .first();
  if (before) return;
  await ctx.db.insert("reports", {
    reporterFamilyId: by.familyId,
    reporterPersonId: by.personId,
    kind: target.kind,
    targetId: target.id,
    targetFamilyId: target.familyId,
    reason,
    createdAt: Date.now(),
    status: "open",
  });
  console.log(`community report: ${target.kind} ${target.id} (${reason ?? "no reason"})`);
  await ctx.scheduler.runAfter(0, internal.alerts.reportFiled, { kind: target.kind, reason });
  if (target.kind === "family") return;
  const all = await ctx.db
    .query("reports")
    .withIndex("by_kind_and_targetId", (q) => q.eq("kind", target.kind).eq("targetId", target.id))
    .take(MAX_ROWS);
  const families = new Set(all.filter((r) => r.status === "open").map((r) => r.reporterFamilyId));
  if (families.size < HIDE_AFTER) return;
  const hiddenAt = Date.now();
  if (target.kind === "recipe") {
    const id = ctx.db.normalizeId("recipes", target.id);
    if (id) await ctx.db.patch("recipes", id, { hiddenAt });
  } else {
    const id = ctx.db.normalizeId("dinners", target.id);
    if (id) await ctx.db.patch("dinners", id, { hiddenAt });
  }
}

// Reports and blocks ("Report or block", convex/lib/safety.ts). A report hides a recipe or dinner from the reporter's family at once; open reports from HIDE_AFTER
// different families hide it from every other family too until the team reviews it (reports.ts). A block works both ways: neither family sees the other's dishes,
// dinners or asks, and new asks between them are refused. Our own family's things always show to us.
//
// A recipe's two-family hide is worked out from `reports` when it's read. `recipes` is read-only here (SCHEMA.md, M1), so recipes.hidden_at can't be written:
// COMMUNITY-MIGRATION.md, blockers. A dinner is ours, so its hide is stored, as on Convex.
import type { Queryable } from "../../db.js";
import { enqueue } from "../../outbox.js";
import { type RecipeRow, recipesByIds } from "../recipes/service.js";
import * as data from "./data.js";
import type { DinnerRow, ReportKind, ReportReason } from "./data.js";

export const HIDE_AFTER = 2;

export type Reportable = "recipe" | "dinner";
export type Shield = { familyId: string; reported: Set<string>; blocked: Set<string> };
/** A recipe with its two-family hide worked out. */
export type SeenRecipe = RecipeRow & { hidden: boolean };

const key = (kind: string, id: string | null) => `${kind}:${id}`;

/** What a family reported, and every family it blocked or that blocked it. */
export async function shieldFor(q: Queryable, familyId: string): Promise<Shield> {
  const reports = await data.reportedByFamily(q, familyId);
  const blocked = await data.blockedFamilies(q, familyId);
  return { familyId, reported: new Set(reports.map((r) => key(r.kind, r.target_id))), blocked: new Set(blocked) };
}

/** These recipes, each with its two-family hide worked out. */
export async function seenRecipes(q: Queryable, ids: string[]): Promise<Map<string, SeenRecipe>> {
  const recipes = await recipesByIds(q, ids);
  const over = await data.recipesOverThreshold(q, [...recipes.keys()], HIDE_AFTER);
  return new Map([...recipes].map(([id, r]) => [id, { ...r, hidden: !!r.hidden_at || over.has(id) }]));
}

export function seesRecipe(s: Shield, r: SeenRecipe): boolean {
  if (r.family_id === s.familyId) return true;
  return !r.hidden && !s.blocked.has(r.family_id) && !s.reported.has(key("recipe", r.id));
}

/**
 * A dinner goes with its dish: one we reported, one reports hid or the team took down, or one from a family we blocked (a "cook together" dinner of another
 * family's dish). A dinner whose dish its cook later unshared keeps going, so `shared_at` isn't asked for here.
 */
export function seesDinner(s: Shield, d: DinnerRow, recipe: SeenRecipe | null | undefined): boolean {
  if (d.host_family_id === s.familyId) return true;
  if (d.hidden_at || s.blocked.has(d.host_family_id) || s.reported.has(key("dinner", d.id))) return false;
  return !s.reported.has(key("recipe", d.recipe_id)) && (!recipe || seesRecipe(s, recipe));
}

/** Whether this family already reported it (a second report changes nothing, so it isn't refused). */
export const reportedBy = (s: Shield, kind: Reportable, id: string) => s.reported.has(key(kind, id));

/**
 * One report per family and item; a second one from the same family changes nothing. Inside tx(). For a dinner the caller holds its row lock, so two families
 * reporting at the same moment each see the other's report: without it, each would count one and the dinner would never hide.
 */
export async function fileReport(
  q: Queryable,
  by: { familyId: string; personId: string },
  target: { kind: ReportKind; id: string; familyId: string },
  reason: ReportReason | null,
  requestId?: string,
): Promise<void> {
  const added = await data.insertReport(q, { ...by, kind: target.kind, targetId: target.id, targetFamilyId: target.familyId, reason });
  if (!added) return;
  // Ids only: the alert's log line names the item by its id, so the team can review it (tasks.ts).
  await enqueue(q, { queue: "scheduled", payload: { task: "community.report_alert", kind: target.kind, targetId: target.id, reason }, requestId });
  if (target.kind === "dinner" && (await data.openReportFamilies(q, "dinner", target.id)) >= HIDE_AFTER) await data.hideDinner(q, target.id);
}

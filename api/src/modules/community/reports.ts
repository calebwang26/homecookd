// The team's side of "Report or block" (convex/reports.ts): what's open, and a review that settles it. No route: these answer only to the team, as Convex's internal
// functions did. keep: it's fine, so it shows again for everyone but the families that reported it. Otherwise it leaves Community: a dinner is called off. Either way
// every open report on it is resolved. A "family" report (a block) only gets resolved.
//
// A recipe's review can't write `recipes`, which is read-only until the jobs area moves (COMMUNITY-MIGRATION.md, blockers). So Convex's own review changes the recipe first, the
// sync brings that here, and this resolves the reports only once the copy says so. Refused before that, nothing changes, and a recipe two families reported stays hidden.
import { db, tx } from "../../db.js";
import { ApiError } from "../../errors.js";
import { familiesByIds } from "../people/service.js";
import { recipesByIds } from "../recipes/service.js";
import * as data from "./data.js";
import type { ReportKind } from "./data.js";
import { seenRecipes } from "./safety.js";

/** Open reports, one row per item, oldest first, with what it is and how many families reported it. */
export async function openReports() {
  const rows = await data.openReports(db());
  const items = new Map<string, data.OpenReport[]>();
  for (const r of rows) items.set(`${r.kind}:${r.target_id}`, [...(items.get(`${r.kind}:${r.target_id}`) ?? []), r]);
  const of = (kind: ReportKind) => rows.filter((r) => r.kind === kind).map((r) => r.target_id);
  const recipes = await seenRecipes(db(), of("recipe"));
  const dinners = await data.dinnersByIds(db(), of("dinner"));
  const families = await familiesByIds(db(), of("family"));
  const out = [...items.values()].map((group) => {
    const { kind, target_id: targetId } = group[0];
    const recipe = recipes.get(targetId);
    const dinner = dinners.get(targetId);
    return {
      kind,
      targetId,
      what:
        kind === "recipe"
          ? (recipe?.title ?? "(gone)")
          : kind === "dinner"
            ? (dinner ? `${dinner.dish} dinner` : "(gone)")
            : (families.get(targetId)?.name ?? "(gone)"),
      families: new Set(group.map((r) => r.reporter_family_id)).size,
      reasons: group.map((r) => r.reason ?? "none"),
      firstAt: Math.min(...group.map((r) => r.created_at.getTime())),
      hidden: kind === "recipe" ? !!recipe?.hidden : kind === "dinner" ? !!dinner?.hidden_at : false,
    };
  });
  return out.sort((a, b) => a.firstAt - b.firstAt);
}

/** How many reports it resolved. */
export async function reviewReport(kind: ReportKind, targetId: string, keep: boolean): Promise<number> {
  return await tx(async (c) => {
    if (kind === "recipe") {
      const r = (await recipesByIds(c, [targetId])).get(targetId);
      const settled = !r || (keep ? r.hidden_at === null : r.hidden_at !== null && r.shared_at === null);
      if (!settled) throw new ApiError(409, "recipes_read_only");
    }
    if (kind === "dinner" && (await data.dinnerById(c, targetId, true))) await data.reviewDinner(c, targetId, keep);
    return await data.resolveReports(c, kind, targetId);
  });
}

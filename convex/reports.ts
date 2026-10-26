// The team's side of "Report or block" (lib/safety.ts): what's open, and a review that settles it.
//   npx convex run reports:open
//   npx convex run reports:review '{"kind": "recipe", "targetId": "<id>", "keep": true}'
// keep: it's fine, so it shows again for everyone but the families that reported it. Otherwise it
// leaves Community: a recipe is unshared, a dinner called off, and both stay hidden if shared again.
// Either way every open report on it is resolved. A "family" report (a block) only gets resolved.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import schema from "./schema";

const kind = schema.tables.reports.validator.fields.kind;

/** Open reports, one row per item, oldest first, with what it is and how many families reported it. */
export const open = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      kind,
      targetId: v.string(),
      what: v.string(), // the dish, or the family's name for a block
      families: v.number(),
      reasons: v.array(v.string()),
      firstAt: v.number(),
      hidden: v.boolean(), // hidden from everyone until this review
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(500);
    const items = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.kind}:${r.targetId}`;
      items.set(key, [...(items.get(key) ?? []), r]);
    }
    const out = [];
    for (const group of items.values()) {
      const { kind, targetId } = group[0];
      let what = "";
      let hidden = false;
      if (kind === "recipe") {
        const id = ctx.db.normalizeId("recipes", targetId);
        const r = id && (await ctx.db.get("recipes", id));
        what = r ? r.title : "(gone)";
        hidden = !!r?.hiddenAt;
      } else if (kind === "dinner") {
        const id = ctx.db.normalizeId("dinners", targetId);
        const d = id && (await ctx.db.get("dinners", id));
        what = d ? `${d.dish} dinner` : "(gone)";
        hidden = !!d?.hiddenAt;
      } else {
        const id = ctx.db.normalizeId("families", targetId);
        what = (id && (await ctx.db.get("families", id))?.name) || "(gone)";
      }
      out.push({
        kind,
        targetId,
        what,
        families: new Set(group.map((r) => r.reporterFamilyId)).size,
        reasons: group.map((r) => r.reason ?? "none"),
        firstAt: Math.min(...group.map((r) => r.createdAt)),
        hidden,
      });
    }
    return out.sort((a, b) => a.firstAt - b.firstAt);
  },
});

export const review = internalMutation({
  args: { kind, targetId: v.string(), keep: v.boolean() },
  returns: v.number(), // reports resolved
  handler: async (ctx, { kind, targetId, keep }) => {
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_kind_and_targetId", (q) => q.eq("kind", kind).eq("targetId", targetId))
      .take(500);
    const opened = rows.filter((r) => r.status === "open");
    for (const r of opened) await ctx.db.patch("reports", r._id, { status: "resolved" });
    const hiddenAt = Date.now();
    if (kind === "recipe") {
      const id = ctx.db.normalizeId("recipes", targetId);
      const r = id && (await ctx.db.get("recipes", id));
      if (r) await ctx.db.patch("recipes", r._id, keep ? { hiddenAt: undefined } : { sharedAt: undefined, hiddenAt: r.hiddenAt ?? hiddenAt });
    } else if (kind === "dinner") {
      const id = ctx.db.normalizeId("dinners", targetId);
      const d = id && (await ctx.db.get("dinners", id));
      if (d) await ctx.db.patch("dinners", d._id, keep ? { hiddenAt: undefined } : { status: "cancelled", hiddenAt: d.hiddenAt ?? hiddenAt });
    }
    return opened.length;
  },
});

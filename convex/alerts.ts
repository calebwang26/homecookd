// Tells the team when someone uses "Report or block" (lib/safety.ts fileReport), so the promise on
// homecookd.app/terms ("we look at every report within a day") doesn't depend on someone remembering to
// run `npx convex run reports:open`. REPORT_ALERT_URL (Convex env) is any webhook:
//   ntfy (https://ntfy.sh/<topic>)               plain text with a Title header, a push on the team's phones;
//                                                with REPORT_ALERT_EMAIL set, ntfy also emails it there (Caleb, Oct 26)
//   Slack (hooks.slack.com), Discord (discord.com) JSON
// Unset means no alert (tests, dev). Nothing personal leaves Convex: what kind of thing was reported, why,
// and how many reports are open. While any report stays open past 12 hours, a daily reminder repeats it.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import schema from "./schema";

const STALE_MS = 12 * 60 * 60 * 1000;
const REVIEW = "Review: npx convex run reports:open";
const WHAT = { recipe: "a recipe", dinner: "a dinner", family: "a family (blocked)" } as const;
const WHY = { not_food: "not about food", rude: "rude or hurtful", other: "something else" } as const;

/** Open reports, or only those filed before `before`. */
export const openCount = internalQuery({
  args: { before: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, { before }) => {
    const rows = await ctx.db
      .query("reports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(500);
    return rows.filter((r) => before === undefined || r.createdAt <= before).length;
  },
});

export const reportFiled = internalAction({
  args: {
    kind: schema.tables.reports.validator.fields.kind,
    reason: v.optional(v.union(v.literal("not_food"), v.literal("rude"), v.literal("other"))),
  },
  returns: v.null(),
  handler: async (ctx, { kind, reason }) => {
    const open = await ctx.runQuery(internal.alerts.openCount, {});
    const why = reason ? ` (${WHY[reason]})` : "";
    await send("homecookd: new Community report", `Someone reported ${WHAT[kind]}${why}. ${open} open. ${REVIEW}`);
    return null;
  },
});

export const remindOpen = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.runQuery(internal.alerts.openCount, { before: Date.now() - STALE_MS });
    if (stale > 0) {
      await send("homecookd: reports waiting", `${stale} Community report${stale === 1 ? " is" : "s are"} open for over 12 hours. ${REVIEW}`);
    }
    return null;
  },
});

/** ntfy's Email header: ntfy also sends the alert to this inbox (REPORT_ALERT_EMAIL; one address, else none). */
function emailHeader(): Record<string, string> {
  const email = process.env.REPORT_ALERT_EMAIL?.trim();
  return email && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) ? { Email: email } : {};
}

/** Never throws: a failed alert is logged, and the report itself is already saved. */
export async function send(title: string, text: string): Promise<void> {
  const url = process.env.REPORT_ALERT_URL?.trim();
  if (!url) return;
  const slack = url.includes("hooks.slack.com");
  const discord = /discord(app)?\.com\/api\/webhooks/.test(url);
  if (slack || discord) {
    const body = JSON.stringify(slack ? { text: `*${title}*\n${text}` } : { content: `**${title}**\n${text}` });
    await post(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    return;
  }
  const push = { Title: title, Priority: "high", Tags: "rotating_light" };
  const email = emailHeader();
  // ntfy refuses the whole message when it won't email (e.g. "anonymous email sending is not allowed"),
  // so a 4xx with the Email header is sent again without it: the push to the team's phones always goes.
  const status = await post(url, { method: "POST", headers: { ...push, ...email }, body: text });
  if (email.Email && status !== undefined && status >= 400 && status < 500) {
    console.error(`report alert email refused (HTTP ${status}); sending the push without it`);
    await post(url, { method: "POST", headers: push, body: text });
  }
}

/** One webhook call: its HTTP status, or undefined when it never got one. Logs failures, never throws. */
async function post(url: string, init: RequestInit): Promise<number | undefined> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) console.error(`report alert failed: HTTP ${res.status}`);
    return res.status;
  } catch (e) {
    console.error(`report alert failed: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

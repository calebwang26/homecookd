// Tells the team when someone uses "Report or block" (lib/safety.ts fileReport), so the promise on
// homecookd.app/terms ("we look at every report within a day") doesn't depend on someone remembering to
// run `npx convex run reports:open`. REPORT_ALERT_URL (Convex env) is any webhook:
//   ntfy (https://ntfy.sh/<topic>)               plain text with a Title header, a push on the team's phones;
//                                                with REPORT_ALERT_EMAIL and REPORT_ALERT_TOKEN (an ntfy.sh account's
//                                                access token, tk_…) set, ntfy also emails it there (Caleb, Oct 26).
//                                                ntfy.sh refuses email from anonymous senders, so no token = push only
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
  if (!ntfyToken() || !email || !/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email)) return {};
  return { Email: email };
}

/** An ntfy.sh access token (REPORT_ALERT_TOKEN, "tk_…"), or undefined. It signs the push in as that account. */
function ntfyToken(): string | undefined {
  const token = process.env.REPORT_ALERT_TOKEN?.trim();
  return token && /^tk_[A-Za-z0-9]{8,}$/.test(token) ? token : undefined;
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
  const token = ntfyToken();
  const extra = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...emailHeader() };
  // ntfy refuses the whole message when it won't email ("anonymous email sending is not allowed") or the token is
  // wrong or expired (401), so a 4xx with the token or Email is sent again without both: the push always goes.
  const status = await post(url, { method: "POST", headers: { ...push, ...extra }, body: text });
  if (Object.keys(extra).length && status !== undefined && status >= 400 && status < 500) {
    console.error(`report alert refused with the email or token (HTTP ${status}); sending the plain push`);
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

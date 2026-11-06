// Community's work on the `scheduled` queue (convex/alerts.ts). Nothing personal leaves: what kind of thing was reported, why, and how many reports are open. Each can arrive
// twice, and a repeat only tells the team twice. A task that throws stays on the queue, and after 3 tries goes to the dead-letter queue, which raises an alert.
//
// On AWS REPORT_ALERT_URL is unset, so the team hears through the log: each task logs one "ALERT …" line that a log alarm counts and emails (infra/modules/env/alerts.tf),
// as the dish budget's does. Ids and counts only, never what the item is or who reported it (COMMUNITY-MIGRATION.md, "What the log keeps").
import { sendAlert } from "../../alerts.js";
import { db } from "../../db.js";
import type { Trace } from "../dish/budget.js";
import * as data from "./data.js";
import type { ReportKind } from "./data.js";

const STALE_MS = 12 * 60 * 60 * 1000;
const REVIEW = "Review: docs/build/COMMUNITY-MIGRATION.md, the team's reports.";
const WHAT: Record<string, string> = { recipe: "a recipe", dinner: "a dinner", family: "a family (blocked)" };
const WHY: Record<string, string> = { not_food: "not about food", rude: "rude or hurtful", other: "something else" };

async function reportAlert(payload: Record<string, unknown>, trace: Trace): Promise<void> {
  const kind = String(payload.kind);
  const what = WHAT[kind];
  if (!what) throw new Error("a report alert with no known kind");
  const why = typeof payload.reason === "string" && WHY[payload.reason] ? ` (${WHY[payload.reason]})` : "";
  // A message queued before targetId was added has none: it still alarms, with the kind alone.
  const targetId = typeof payload.targetId === "string" ? payload.targetId : null;
  const families = targetId ? await data.openReportFamilies(db(), kind as ReportKind, targetId) : null;
  const open = await data.countOpenReports(db());
  trace.log.error({ kind, targetId, families, open }, "ALERT community report needs review");
  await sendAlert("homecookd: new Community report", `Someone reported ${what}${why}. ${open} open. ${REVIEW}`);
}

/** A schedule's daily reminder, while any report stays open past 12 hours. */
async function remindOpen(_payload: Record<string, unknown>, trace: Trace): Promise<void> {
  const stale = await data.countOpenReports(db(), new Date(Date.now() - STALE_MS));
  if (stale === 0) return;
  trace.log.error({ open: stale }, "ALERT community reports still open");
  await sendAlert("homecookd: reports waiting", `${stale} Community report${stale === 1 ? " is" : "s are"} open for over 12 hours. ${REVIEW}`);
}

export const communityTasks: Record<string, (payload: Record<string, unknown>, trace: Trace) => Promise<void>> = {
  "community.report_alert": reportAlert,
  "community.remind_open": remindOpen,
};

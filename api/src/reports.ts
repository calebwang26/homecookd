// The team acting on a report: Convex's `npx convex run reports:open` and `reports:review`, run as a one-off task with the api's image and task definition
// (COMMUNITY-MIGRATION.md, "The team's reports"). No route, so nothing outside the team can reach it.
//   node dist/reports.js open
//   node dist/reports.js review <recipe|dinner|family> <targetId> <keep|remove>
// Exit 0: done. 1: refused or failed, with the reason on the first line. 2: wrong arguments, and the database wasn't touched.
// Everything printed lands in the task's CloudWatch log: what each item is, as Convex's listing showed, and never who reported it.
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { ApiError } from "./errors.js";
import type { ReportKind } from "./modules/community/data.js";
import { hasOpenReport, openReports, reviewReport } from "./modules/community/reports.js";

const KINDS: readonly string[] = ["recipe", "dinner", "family"] satisfies ReportKind[];
// Convex's ids and Postgres's uuids. Nothing else is an id, and a stray quote or space never reaches the database or Convex's command below.
const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** openReports() reads this many rows at most. */
const READ_AT_MOST = 500;

export const USAGE = ["Usage:", "  node dist/reports.js open", "  node dist/reports.js review <recipe|dinner|family> <targetId> <keep|remove>"];

type Command = { action: "open" } | { action: "review"; kind: ReportKind; targetId: string; keep: boolean };
export type Io = { out: (line: string) => void; err: (line: string) => void };

/** The command, or what's wrong with it. Exact words only: a typo must not take anything down. */
export function parse(args: string[]): Command | string {
  if (args[0] === "open") return args.length === 1 ? { action: "open" } : "open takes nothing after it";
  if (args[0] !== "review") return "the first word must be open or review";
  if (args.length !== 4) return "review takes a kind, an id, and keep or remove";
  const [, kind, targetId, decision] = args;
  if (!KINDS.includes(kind)) return "the kind must be recipe, dinner or family";
  if (!ID.test(targetId)) return "an id is 1 to 100 letters, digits, - or _";
  if (decision !== "keep" && decision !== "remove") return "the last word must be keep or remove";
  return { action: "review", kind: kind as ReportKind, targetId, keep: decision === "keep" };
}

/** What the team runs on Convex first, while `recipes` is read-only here (COMMUNITY-MIGRATION.md, blockers, 5). */
function convexFirst(targetId: string, keep: boolean): string[] {
  const again = `node dist/reports.js review recipe ${targetId} ${keep ? "keep" : "remove"}`;
  return [
    keep
      ? `Refused: recipe ${targetId} is hidden in the copy here, so keeping it starts on Convex. Nothing changed.`
      : `Refused: recipe ${targetId} is still shared in the copy here, so taking it down starts on Convex. Nothing changed.`,
    `  1. From the repo root, with the team token: npx convex run --deployment grand-dragon-649 reports:review '{"kind": "recipe", "targetId": "${targetId}", "keep": ${keep}}'`,
    `  2. Wait for the sync to copy the recipe ${keep ? "with its hide lifted" : "hidden and unshared"}. Until then this is refused again and changes nothing.`,
    `  3. Run this again: ${again}`,
  ];
}

export async function run(args: string[], io: Io = { out: console.log, err: console.error }): Promise<number> {
  const command = parse(args);
  if (typeof command === "string") {
    io.err(`Wrong arguments: ${command}. Nothing ran.`);
    for (const line of USAGE) io.err(line);
    return 2;
  }
  const log = (level: string, msg: string, fields: object) => io.out(JSON.stringify({ level, msg, ...fields }));
  const fields =
    command.action === "open" ? { action: "open" } : { action: "review", kind: command.kind, targetId: command.targetId, decision: command.keep ? "keep" : "remove" };
  try {
    if (command.action === "open") {
      const items = await openReports();
      for (const item of items) io.out(JSON.stringify({ ...item, firstAt: new Date(item.firstAt).toISOString() }));
      const read = items.reduce((n, item) => n + item.reasons.length, 0);
      if (items.length === 0) io.out("No open reports.");
      if (read >= READ_AT_MOST) io.out(`Only the oldest ${READ_AT_MOST} open reports were read. Review these, then list again.`);
      log("info", "reports listed", { ...fields, items: items.length });
      return 0;
    }
    const { kind, targetId, keep } = command;
    if (!(await hasOpenReport(kind, targetId))) {
      io.err(`Refused: ${kind} ${targetId} has no open report, so nothing changed. Check the kind and id against: node dist/reports.js open`);
      log("warn", "report review refused", { ...fields, code: "nothing_open" });
      return 1;
    }
    const resolved = await reviewReport(kind, targetId, keep);
    io.out(`Resolved ${resolved} report${resolved === 1 ? "" : "s"} on ${kind} ${targetId}.${kind === "family" ? " A block's review changes nothing else." : ""}`);
    log("info", "reports reviewed", { ...fields, resolved });
    return 0;
  } catch (error) {
    if (command.action === "review" && error instanceof ApiError && error.code === "recipes_read_only") {
      for (const line of convexFirst(command.targetId, command.keep)) io.err(line);
      log("warn", "report review refused", { ...fields, code: "recipes_read_only" });
      return 1;
    }
    // Postgres's own error text can hold row values ("Key (x)=(...)"), so from the server only its type and code. Ours and the driver's say what's wrong.
    const e = error as Error & { code?: string; severity?: string };
    const err = { type: e?.name ?? "unknown", code: e?.code, message: e?.severity ? undefined : e?.message };
    const after = command.action === "open" ? "Nothing changed." : "A review is one transaction, so list again to see where it stands.";
    io.err(`Failed: ${[err.type, err.code, err.message].filter(Boolean).join(", ")}. ${after}`);
    log("error", "reports task failed", { ...fields, err });
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = await run(process.argv.slice(2));
  if (code !== 2) await Promise.resolve().then(() => db().end()).catch(() => {}); // no settings at all: run() already said so
  process.exitCode = code;
}

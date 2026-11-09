// The team restarting an account deletion that stopped (Caleb, Nov 8: decision 7; accounts/deletion.ts has the stages), run as a one-off task with the api's
// image and task definition, as reports.ts is (ACCOUNTS-MIGRATION.md, "A deletion that stopped"). No route, so nothing outside the team can reach it.
//   node dist/deletions.js stalled              purging with no batch for an hour, or given up outside: the deletion_stalled invariant's rows
//   node dist/deletions.js retry <deletionId>   starts it again now; one that's done is left alone. Safe to run twice
// Exit 0: done. 1: refused or failed, with the reason on the first line. 2: wrong arguments, and the database wasn't touched.
// Everything printed lands in the task's CloudWatch log for 30 days, so it's ids, stages, counts, times and the short reason the purge wrote: never a name.
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { retryDeletion, stalledDeletions } from "./modules/accounts/deletion.js";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
/** stalledDeletions() reads this many at most. */
const READ_AT_MOST = 100;

export const USAGE = ["Usage:", "  node dist/deletions.js stalled", "  node dist/deletions.js retry <deletionId>"];

type Command = { action: "stalled" } | { action: "retry"; deletionId: string };
export type Io = { out: (line: string) => void; err: (line: string) => void };

/** The command, or what's wrong with it. Exact words only. */
export function parse(args: string[]): Command | string {
  if (args[0] === "stalled") return args.length === 1 ? { action: "stalled" } : "stalled takes nothing after it";
  if (args[0] !== "retry") return "the first word must be stalled or retry";
  if (args.length !== 2) return "retry takes one deletion id";
  if (!ID.test(args[1])) return "an id is 1 to 100 letters, digits, - or _";
  return { action: "retry", deletionId: args[1] };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function run(args: string[], io: Io = { out: console.log, err: console.error }): Promise<number> {
  const command = parse(args);
  if (typeof command === "string") {
    io.err(`Wrong arguments: ${command}. Nothing ran.`);
    for (const line of USAGE) io.err(line);
    return 2;
  }
  const log = (level: string, msg: string, fields: object) => io.out(JSON.stringify({ level, msg, ...fields }));
  try {
    if (command.action === "stalled") {
      const rows = await stalledDeletions(READ_AT_MOST);
      for (const d of rows) {
        io.out(
          JSON.stringify({
            id: d.id,
            stage: d.stage,
            requestedAt: iso(d.requested_at),
            purgeRestarts: d.purge_restarts,
            outsideAttempts: d.external_attempts,
            outsideTriedAt: iso(d.external_tried_at),
            outsideError: d.external_error,
          }),
        );
      }
      if (rows.length === 0) io.out("No deletion has stopped.");
      if (rows.length >= READ_AT_MOST) io.out(`Only the oldest ${READ_AT_MOST} were read. Retry these, then list again.`);
      log("info", "deletions listed", { action: "stalled", items: rows.length });
      return 0;
    }
    const { deletionId } = command;
    const stage = await retryDeletion(deletionId);
    if (stage === "missing") {
      io.err(`Refused: there's no deletion ${deletionId}, so nothing changed. Check the id against: node dist/deletions.js stalled`);
      log("warn", "deletion retry refused", { action: "retry", deletionId, code: "missing" });
      return 1;
    }
    if (stage === "done") {
      io.out(`Deletion ${deletionId} is already done. Nothing changed.`);
    } else if (stage === "purging") {
      io.out(`Deletion ${deletionId}: its purge inside the database starts again now.`);
    } else {
      io.out(`Deletion ${deletionId}: its purge outside the database starts again now, with a fresh count of attempts.`);
    }
    log("info", "deletion retried", { action: "retry", deletionId, stage });
    return 0;
  } catch (error) {
    // Postgres's own error text can hold row values, so from the server only its type and code.
    const e = error as Error & { code?: string; severity?: string };
    const err = { type: e?.name ?? "unknown", code: e?.code, message: e?.severity ? undefined : e?.message };
    io.err(`Failed: ${[err.type, err.code, err.message].filter(Boolean).join(", ")}. A retry is one transaction, so list again to see where it stands.`);
    log("error", "deletions task failed", { action: command.action, err });
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = await run(process.argv.slice(2));
  if (code !== 2) await Promise.resolve().then(() => db().end()).catch(() => {});
  process.exitCode = code;
}

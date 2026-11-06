// The TEST family's join link with no expiry, for Apple's reviewer: what scripts/test-family-link.mjs did on Supabase, run as a one-off task with the api's image and
// task definition (infra/README.md, "Production before launch", 8.3). No route, so nothing outside the team can make one.
//   node dist/reviewerLink.js make <familyId>      the family's link, the same one on every run while it's on
//   node dist/reviewerLink.js revoke <familyId>    turns it off for good; the next make is a new link
// Exit 0: done. 1: refused or failed, with the reason on the first line. 2: wrong arguments, and the database wasn't touched.
// The link is printed once, on its own line, and never in the JSON line: it lands in the task's CloudWatch log for 30 days like everything else printed here. That log
// is readable only by the team, who can run this again and see the same link (it's sealed in join_links.token_enc), and the link goes into Apple's reviewer notes
// anyway. A leaked one is killed with revoke. Nothing else printed is a secret or a family's content: ids, a count of people, the link's id.
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { operatorLink, revokeOperatorLink } from "./modules/accounts/invites.js";

// A family's id as a phone holds it (GET /family's family.id: a Postgres or Supabase uuid). Nothing else is an id, so a stray quote or space never reaches the database.
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const SCRIPT = "node dist/reviewerLink.js";

export const USAGE = ["Usage:", `  ${SCRIPT} make <familyId>`, `  ${SCRIPT} revoke <familyId>`];

type Command = { action: "make" | "revoke"; familyId: string };
export type Io = { out: (line: string) => void; err: (line: string) => void };

/** The command, or what's wrong with it. Exact words only: a typo must not make or turn off anything. */
export function parse(args: string[]): Command | string {
  const [action, familyId] = args;
  if (action !== "make" && action !== "revoke") return "the first word must be make or revoke";
  if (args.length !== 2) return `${action} takes one family id`;
  if (!ID.test(familyId)) return "a family id is 1 to 100 letters, digits, - or _";
  return { action, familyId };
}

export async function run(args: string[], io: Io = { out: console.log, err: console.error }): Promise<number> {
  const command = parse(args);
  if (typeof command === "string") {
    io.err(`Wrong arguments: ${command}. Nothing ran.`);
    for (const line of USAGE) io.err(line);
    return 2;
  }
  const { action, familyId } = command;
  const log = (level: string, msg: string, fields: object) => io.out(JSON.stringify({ level, msg, action, familyId, ...fields }));
  const refuse = (lines: string[], code: string, fields: object = {}) => {
    for (const line of lines) io.err(line);
    log("warn", `operator link ${action} refused`, { code, ...fields });
    return 1;
  };
  try {
    if (action === "revoke") {
      const off = await revokeOperatorLink(familyId);
      if (off === null) return refuse([`Refused: no family has the id ${familyId}. Nothing changed.`], "no_family");
      if (off === 0) return refuse([`Refused: family ${familyId} has no link with no expiry on, so nothing changed.`], "nothing_on");
      io.out(`Turned off family ${familyId}'s link with no expiry. It stops working now; the family's own 7-day links still work.`);
      io.out(`  A new one: ${SCRIPT} make ${familyId}, then put it in the reviewer notes in place of the old one.`);
      log("info", "operator link revoked", { revoked: off });
      return 0;
    }
    const link = await operatorLink(familyId);
    if (!link.ok) {
      const lines: Record<typeof link.code, string[]> = {
        no_family: [`Refused: no family has the id ${familyId}. Nothing changed.`],
        family_gone: [`Refused: family ${familyId} was deleted, so it takes nobody in. Nothing changed.`],
        other_family: [
          `Refused: family ${link.otherFamilyId} already has a link with no expiry, and only the TEST family gets one, so check the id. Nothing changed.`,
          `  To move it: ${SCRIPT} revoke ${link.otherFamilyId}, then make again.`,
        ],
        cant_open: [
          `Refused: family ${familyId}'s link with no expiry (${link.linkId}) can't be opened with this EDIBLE_CODE_KEY, so it can't be shown again. Nothing changed.`,
          `  To replace it: ${SCRIPT} revoke ${familyId}, then make, and put the new link in the reviewer notes.`,
        ],
      };
      return refuse(lines[link.code], link.code, link.linkId ? { linkId: link.linkId } : {});
    }
    const people = `${link.people} ${link.people === 1 ? "person" : "people"}`;
    io.out(link.made ? `Made family ${familyId}'s link with no expiry (the family has ${people}):` : `Family ${familyId}'s link with no expiry is already on, the same as before (the family has ${people}):`);
    io.out(`  ${link.url}`);
    io.out(`  Anyone with it can join this family until it's revoked: put it only in the reviewer notes. This task's log keeps it 30 days. To turn it off: ${SCRIPT} revoke ${familyId}`);
    log("info", link.made ? "operator link made" : "operator link shown", { linkId: link.linkId, made: link.made, people: link.people });
    return 0;
  } catch (error) {
    // Postgres's own error text can hold row values ("Key (x)=(...)"), so from the server only its type and code. Ours and the driver's say what's wrong.
    const e = error as Error & { code?: string; severity?: string };
    const err = { type: e?.name ?? "unknown", code: e?.code, message: e?.severity ? undefined : e?.message };
    io.err(`Failed: ${[err.type, err.code, err.message].filter(Boolean).join(", ")}. It's one transaction, so nothing changed.`);
    log("error", "operator link task failed", { err });
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = await run(process.argv.slice(2));
  if (code !== 2) await Promise.resolve().then(() => db().end()).catch(() => {}); // no settings at all: run() already said so
  process.exitCode = code;
}

// The TEST family's join link that never expires, for Apple's reviewer (docs/build/JOIN-SIMPLE.md §5). The 1.1
// reviewer notes give this link: the reviewer taps it, types a name and signs in with their own Apple ID.
//
//   node scripts/test-family-link.mjs
//
// It makes a fresh 22-character token, writes the link to docs/build/.test-family-link (gitignored, next to
// .test-family-code) and prints the one SQL insert that turns it on, for whoever runs the api deploy after Apple
// approves 1.0 (migration 20261029100000_join_links.sql must be applied first). It touches no database itself
// and never prints the family code. Only the TEST family can get a link: the insert finds the family by its
// code's hash. Run it again to replace the link (revoke the old row with the second statement it prints).
import { execSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Gitignored files live in the main checkout, not in a worktree (as the root .env does).
const main = dirname(execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim());
const here = new URL("../", import.meta.url).pathname;
const root = existsSync(join(here, "docs/build/.test-family-code")) ? here : main;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

let code;
try {
  code = readFileSync(join(root, "docs/build/.test-family-code"), "utf8").trim().toUpperCase();
} catch {
  console.error("docs/build/.test-family-code is missing: ask Caleb for the TEST family's code.");
  process.exit(1);
}
if (!code) {
  console.error("docs/build/.test-family-code is empty.");
  process.exit(1);
}

const token = Array.from({ length: 22 }, () => BASE62[randomInt(62)]).join("");
const link = `https://homecookd.app/i?t=${token}`;
writeFileSync(join(root, "docs/build/.test-family-link"), `${link}\n`);

const family = `(select id from public.families where code_hash = '${sha256(code)}')`;
console.log(`The reviewer's link (also in docs/build/.test-family-link):\n  ${link}\n`);
console.log("Turn off an older reviewer link (optional):");
console.log(`  update public.join_links set revoked_at = now() where family_id = ${family} and expires_at is null and revoked_at is null;\n`);
console.log("Turn it on (Supabase SQL, after the join_links migration; it inserts nothing if the code matches no family):");
console.log(`  insert into public.join_links (family_id, token_hash, expires_at) select id, '${sha256(token)}', null from ${family} f returning id;`);

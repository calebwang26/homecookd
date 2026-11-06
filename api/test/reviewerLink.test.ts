// The reviewer's link with no expiry (src/reviewerLink.ts), on real Postgres: make gives one link and the same one on every run, the reviewer joins by it, revoke kills
// it, a wrong family or a wrong word refuses and changes nothing, and the link is printed once and never in the JSON line. The last test runs the real entry point.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, beforeEach, test } from "node:test";
import { hashToken } from "../src/auth.js";
import { db } from "../src/db.js";
import { run } from "../src/reviewerLink.js";
import { Api, appleToken, count, freshDatabase, hasDatabase, type Keys, makeFamily, makeJoinLink, makePerson, row, said, setup } from "./accountsHelpers.js";

const skip = !hasDatabase;
let api: Api;
let keys: Keys;
let subs = 0;
const newSub = () => `reviewer-sub-${(subs += 1)}`;

before(async () => {
  if (skip) return;
  await freshDatabase();
  keys = await setup();
  api = new Api();
});

// Only one family may have a link on at a time, so each test starts with none.
beforeEach(async () => {
  if (!skip) await db().query(`update join_links set revoked_at = now() where expires_at is null and revoked_at is null`);
});

after(async () => {
  if (!skip) await db().end();
});

async function cli(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (line) => void out.push(line), err: (line) => void err.push(line) });
  const urls = out.map((line) => line.trim()).filter((line) => /^https?:\/\/\S+\/i\?t=/.test(line));
  return { code, out, err, urls, log: JSON.parse(out.at(-1) ?? "null") };
}

const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;
const linksNow = async () => (await db().query(`select id, family_id, inviter_id, token_hash, token_enc, expires_at, revoked_at from join_links order by id`)).rows;

/** The TEST family as production has it: the faces, one signed-in cook, and her own 7-day link. */
async function testFamily() {
  const f = await makeFamily("The Testers");
  const mom = await makePerson(f.id, "Mom");
  for (const name of ["Dad", "Grandma", "Leo", "Maya"]) await makePerson(f.id, name);
  const gone = await makePerson(f.id, "Removed one");
  await db().query(`update people set removed_at = now() where id = $1`, [gone]);
  const weekly = await makeJoinLink(f.id, mom);
  return { f, mom, weekly };
}

const withWebUrl = async <T>(value: string | undefined, fn: () => Promise<T>): Promise<T> => {
  const before = process.env.EDIBLE_WEB_URL;
  if (value === undefined) delete process.env.EDIBLE_WEB_URL;
  else process.env.EDIBLE_WEB_URL = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.EDIBLE_WEB_URL;
    else process.env.EDIBLE_WEB_URL = before;
  }
};

test("make: one link with no expiry, printed once on its own line, never in the JSON line, and the reviewer joins by it", { skip }, async () => {
  const { f } = await testFamily();
  const made = await withWebUrl(undefined, () => cli("make", f.id));
  assert.equal(made.code, 0, made.err.join("\n"));
  assert.deepEqual(made.err, []);
  assert.equal(made.out[0], `Made family ${f.id}'s link with no expiry (the family has 5 people):`);
  assert.equal(made.urls.length, 1);
  const url = made.urls[0];
  assert.match(url, /^https:\/\/homecookd\.app\/i\?t=[0-9A-Za-z]{22}$/, "the same address a family's own link has");
  assert.equal(made.out.filter((line) => line.includes(tokenOf(url))).length, 1, "the token is printed once");
  assert.match(made.out[2], /This task's log keeps it 30 days\. To turn it off: node dist\/reviewerLink\.js revoke /);
  assert.equal(made.log.level, "info");
  assert.equal(made.log.msg, "operator link made");
  assert.deepEqual(Object.keys(made.log).sort(), ["action", "familyId", "level", "linkId", "made", "msg", "people"]);
  assert.deepEqual([made.log.action, made.log.familyId, made.log.made, made.log.people], ["make", f.id, true, 5]);
  assert.ok(!JSON.stringify(made.log).includes(tokenOf(url)));
  for (const word of ["Testers", "Mom", "Grandma"]) assert.ok(!made.out.join("\n").includes(word), `a family's content: ${word}`);

  // The row: no expiry, no inviter, only the hash looked up, the token sealed.
  const link = await row("join_links", "id = $1", [made.log.linkId]);
  assert.deepEqual([link.family_id, link.inviter_id, link.expires_at, link.revoked_at], [f.id, null, null, null]);
  assert.equal(link.token_hash, hashToken(tokenOf(url)));
  assert.match(link.token_enc, /^v1:/);
  assert.ok(!link.token_enc.includes(tokenOf(url)));

  // What the reviewer sees: the family, no end date. Then their own Apple ID joins, and the link still works for the next review.
  const peek = await api.post("/invites/peek", { token: tokenOf(url) });
  assert.deepEqual([peek.status, peek.data.status, peek.data.family_name, peek.data.expires_at, peek.data.inviter], [200, "pending", "The Testers", null, null]);
  const joined = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: tokenOf(url), name: "Reviewer", role: "learner" });
  assert.equal(joined.status, 200, JSON.stringify(joined.data));
  assert.equal((await row("people", "id = $1", [joined.data.profile_id])).family_id, f.id);
  const next = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: tokenOf(url), name: "Second reviewer", role: "learner" });
  assert.equal(next.status, 200, JSON.stringify(next.data));
});

test("make again: the same link, nothing new written, by either id the family has; EDIBLE_WEB_URL sets the address", { skip }, async () => {
  const { f } = await testFamily();
  const first = await withWebUrl("https://staging-site.example/", () => cli("make", f.id));
  assert.equal(first.code, 0, first.err.join("\n"));
  assert.match(first.urls[0], /^https:\/\/staging-site\.example\/i\?t=[0-9A-Za-z]{22}$/);
  const rows = await linksNow();

  const again = await withWebUrl("https://staging-site.example/", () => cli("make", f.id));
  assert.equal(again.code, 0, again.err.join("\n"));
  assert.equal(again.out[0], `Family ${f.id}'s link with no expiry is already on, the same as before (the family has 5 people):`);
  assert.deepEqual(again.urls, first.urls);
  assert.deepEqual([again.log.msg, again.log.made, again.log.linkId], ["operator link shown", false, first.log.linkId]);
  assert.deepEqual(await linksNow(), rows);

  // A family copied from Supabase is known to phones by its Supabase id (GET /family's family.id): that finds the same link.
  const supabaseId = "11111111-2222-4333-8444-555555555555";
  await db().query(`update families set supabase_id = $2 where id = $1`, [f.id, supabaseId]);
  const byOld = await withWebUrl("https://staging-site.example/", () => cli("make", supabaseId));
  assert.equal(byOld.code, 0, byOld.err.join("\n"));
  assert.deepEqual(byOld.urls, first.urls);
  assert.deepEqual(await linksNow(), rows);
});

test("revoke: the link stops at once, the family's 7-day link stays, a second revoke is refused, and make then gives a new one", { skip }, async () => {
  const { f, weekly } = await testFamily();
  const made = await cli("make", f.id);
  const token = tokenOf(made.urls[0]);

  const off = await cli("revoke", f.id);
  assert.equal(off.code, 0, off.err.join("\n"));
  assert.equal(off.out[0], `Turned off family ${f.id}'s link with no expiry. It stops working now; the family's own 7-day links still work.`);
  assert.deepEqual(off.urls, []);
  assert.deepEqual(off.log, { level: "info", msg: "operator link revoked", action: "revoke", familyId: f.id, revoked: 1 });
  assert.equal((await api.post("/invites/peek", { token })).data.status, "revoked");
  const late = await api.apple({ id_token: await appleToken(keys, newSub()), join_token: token, name: "Stranger", role: "learner" });
  assert.deepEqual([late.status, ...said(late)], [410, "gone", "This link was turned off."]);
  assert.equal(await count("people", "family_id = $1 and name = 'Stranger'", [f.id]), 0);
  assert.equal((await row("join_links", "id = $1", [weekly.id])).revoked_at, null);
  assert.equal((await api.post("/invites/peek", { token: weekly.token })).data.status, "pending");

  const twice = await cli("revoke", f.id);
  assert.equal(twice.code, 1);
  assert.equal(twice.err[0], `Refused: family ${f.id} has no link with no expiry on, so nothing changed.`);
  assert.deepEqual(twice.log, { level: "warn", msg: "operator link revoke refused", action: "revoke", familyId: f.id, code: "nothing_on" });

  const fresh = await cli("make", f.id);
  assert.equal(fresh.code, 0, fresh.err.join("\n"));
  assert.equal(fresh.log.made, true);
  assert.notEqual(tokenOf(fresh.urls[0]), token);
  assert.equal((await api.post("/invites/peek", { token })).data.status, "revoked", "the old one stays off");
});

test("refused, with nothing changed: no such family, a deleted family, a second family, and a link that can't be opened", { skip }, async () => {
  const { f } = await testFamily();
  const real = await makeFamily("A real family");
  await makePerson(real.id, "Somebody");
  const blanked = await makeFamily("Gone");
  await db().query(`update families set blanked_at = now() where id = $1`, [blanked.id]);
  const before = await linksNow();

  const missing = await cli("make", "no-such-family");
  assert.equal(missing.code, 1);
  assert.equal(missing.err[0], "Refused: no family has the id no-such-family. Nothing changed.");
  assert.deepEqual(missing.log, { level: "warn", msg: "operator link make refused", action: "make", familyId: "no-such-family", code: "no_family" });
  const missingOff = await cli("revoke", "no-such-family");
  assert.deepEqual([missingOff.code, missingOff.log.code], [1, "no_family"]);

  const gone = await cli("make", blanked.id);
  assert.equal(gone.code, 1);
  assert.equal(gone.err[0], `Refused: family ${blanked.id} was deleted, so it takes nobody in. Nothing changed.`);
  assert.equal(gone.log.code, "family_gone");
  assert.deepEqual(await linksNow(), before);

  // The TEST family has one, so any other id is a mistake: a real family must never get a link that doesn't expire by a wrong id.
  const testLink = await cli("make", f.id);
  assert.equal(testLink.code, 0);
  const withOne = await linksNow();
  const second = await cli("make", real.id);
  assert.equal(second.code, 1);
  assert.equal(second.err[0], `Refused: family ${f.id} already has a link with no expiry, and only the TEST family gets one, so check the id. Nothing changed.`);
  assert.equal(second.err[1], `  To move it: node dist/reviewerLink.js revoke ${f.id}, then make again.`);
  assert.deepEqual(second.urls, []);
  assert.ok(!JSON.stringify(second).includes(tokenOf(testLink.urls[0])), "a refusal never shows the other family's link");
  assert.deepEqual([second.log.code, second.log.linkId], ["other_family", testLink.log.linkId]);
  assert.equal((await cli("revoke", real.id)).code, 1, "nothing of the real family's to turn off");
  assert.deepEqual(await linksNow(), withOne);

  // A link sealed with another key, or one put in by hand with no sealed token (as the old Supabase SQL did): it can't be shown, so only revoke fixes it.
  for (const tokenEnc of ["v1:AAAA.AAAA", null]) {
    await db().query(`update join_links set token_enc = $2 where id = $1`, [testLink.log.linkId, tokenEnc]);
    const stuck = await linksNow();
    const shut = await cli("make", f.id);
    assert.equal(shut.code, 1);
    assert.equal(shut.err[0], `Refused: family ${f.id}'s link with no expiry (${testLink.log.linkId}) can't be opened with this EDIBLE_CODE_KEY, so it can't be shown again. Nothing changed.`);
    assert.deepEqual([shut.log.code, shut.log.linkId], ["cant_open", testLink.log.linkId]);
    assert.deepEqual(await linksNow(), stuck);
  }
  assert.equal((await cli("revoke", f.id)).code, 0);
  const replaced = await cli("make", f.id);
  assert.equal(replaced.code, 0, replaced.err.join("\n"));
  assert.equal(replaced.log.made, true);
});

test("without EDIBLE_CODE_KEY nothing is made: the token couldn't be shown again", { skip }, async () => {
  const { f } = await testFamily();
  const before = await linksNow();
  const key = process.env.EDIBLE_CODE_KEY;
  delete process.env.EDIBLE_CODE_KEY;
  try {
    const r = await cli("make", f.id);
    assert.equal(r.code, 1);
    assert.equal(r.err[0], "Failed: Error, EDIBLE_CODE_KEY isn't set. It's one transaction, so nothing changed.");
    assert.deepEqual(r.urls, []);
    assert.deepEqual([r.log.level, r.log.msg, r.log.err.message], ["error", "operator link task failed", "EDIBLE_CODE_KEY isn't set"]);
  } finally {
    process.env.EDIBLE_CODE_KEY = key;
  }
  assert.deepEqual(await linksNow(), before);
});

test("wrong words or a wrong id refuse with exit 2, and nothing changes", { skip }, async () => {
  const { f } = await testFamily();
  await cli("make", f.id);
  const before = await linksNow();
  const wrong: string[][] = [
    [],
    ["mak"],
    ["Make", f.id],
    ["make"],
    ["make", f.id, "now"],
    ["--help"],
    ["show", f.id],
    ["revoke"],
    ["revok", f.id],
    ["Revoke", f.id],
    ["revoke", f.id, f.id],
    [f.id, "make"],
    ["make", ` ${f.id}`],
    ["make", `${f.id}'`],
    ["make", `${f.id}; drop table join_links`],
    ["make", ""],
    ["make", "x".repeat(101)],
    ["revoke", "https://homecookd.app/i?t=abc"],
  ];
  for (const args of wrong) {
    const r = await cli(...args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.err[0], /^Wrong arguments: .+\. Nothing ran\.$/, JSON.stringify(args));
    assert.deepEqual(r.err.slice(1), ["Usage:", "  node dist/reviewerLink.js make <familyId>", "  node dist/reviewerLink.js revoke <familyId>"]);
    assert.deepEqual(r.out, [], JSON.stringify(args));
  }
  assert.deepEqual(await linksNow(), before);
});

test("the task's command runs: wrong arguments never reach the database, make and revoke exit 0, a refusal 1", { skip }, async () => {
  const apiDir = fileURLToPath(new URL("..", import.meta.url));
  const node = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/reviewerLink.ts", ...args], { cwd: apiDir, env, encoding: "utf8", timeout: 60_000 });
  const { DATABASE_URL: _url, DB_HOST: _host, DB_CREDENTIALS: _login, ...noDatabase } = process.env;

  const typo = node(["revok", "abc"], noDatabase);
  assert.equal(typo.status, 2, typo.stderr);
  assert.equal(typo.stderr.split("\n")[0], "Wrong arguments: the first word must be make or revoke. Nothing ran.");

  const { f } = await testFamily();
  const env = { ...process.env, EDIBLE_WEB_URL: "https://homecookd.app" };
  const made = node(["make", f.id], env);
  assert.equal(made.status, 0, made.stderr);
  const lines = made.stdout.trim().split("\n");
  assert.match(lines[1], /^ {2}https:\/\/homecookd\.app\/i\?t=[0-9A-Za-z]{22}$/);
  const log = JSON.parse(lines.at(-1)!);
  assert.deepEqual([log.msg, log.familyId, log.made], ["operator link made", f.id, true]);
  assert.equal(node(["make", f.id], env).stdout.split("\n")[1], lines[1], "the same link on the next run");

  assert.equal(node(["make", "no-such-family"], env).status, 1);
  const off = node(["revoke", f.id], env);
  assert.equal(off.status, 0, off.stderr);
  assert.equal((await row("join_links", "id = $1", [log.linkId])).revoked_at instanceof Date, true);

  // No database to reach: one line saying so, and still a clean exit.
  const away = node(["make", f.id], { ...noDatabase, DATABASE_URL: "postgres://nobody:none@127.0.0.1:1/none" });
  assert.equal(away.status, 1, away.stderr);
  assert.match(away.stderr.split("\n")[0], /^Failed: Error, ECONNREFUSED, .+\. It's one transaction, so nothing changed\.$/);
});

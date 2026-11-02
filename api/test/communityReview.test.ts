// The team's script for reports (src/reports.ts), on real Postgres: `open` lists what Convex's reports:open listed, `review` does what reviewReport does, and a wrong
// word or id refuses and changes nothing. The last test runs the real entry point, as the task does.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { db } from "../src/db.js";
import { openReports } from "../src/modules/community/reports.js";
import { run } from "../src/reports.js";
import { block, dishes, family, feed, host, ok, person, recipe, report, world } from "./communityHelpers.js";
import { hasDatabase, like } from "./dishHelpers.js";

const skip = !hasDatabase;

async function cli(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (line) => void out.push(line), err: (line) => void err.push(line) });
  return { code, out, err, items: out.filter((line) => line.startsWith('{"kind"')).map((line) => JSON.parse(line)), log: JSON.parse(out.at(-1) ?? "null") };
}

const reportsNow = async () => (await db().query("select id, kind, target_id, status, reason from reports order by id")).rows;
const dinnerRow = async (id: string) => (await db().query("select status, hidden_at from dinners where id = $1", [id])).rows[0];
const recipeRow = async (id: string) => (await db().query("select shared_at, hidden_at from recipes where id = $1", [id])).rows[0];

/** The Pawars' poha reported by two families, so it's hidden, and a dinner of it reported by two others. */
async function reported() {
  const w = await world();
  const salik = await person(await family("Mian home"), "Salik", "kid");
  const ngozi = await person(await family("Okafor home", "Okafor"), "Ngozi", "cook");
  const rey = await person(await family("Santos home", "Santos"), "Rey", "cook");
  const poha = await recipe(w.rajani, { sharedAt: 1 });
  const night = await host(w.t, w.rajani, poha);
  const later = await host(w.t, w.rajani, poha, { startsAt: Date.now() + 7_200_000 }); // nobody reports this one
  for (const who of [salik, ngozi]) await ok(report(w.t, who, "dinner", night, "other"));
  await ok(report(w.t, w.serene, "recipe", poha, "not_food"));
  await ok(report(w.t, w.caleb, "recipe", poha, "rude"));
  return { ...w, salik, ngozi, rey, poha, night, later };
}

test("open lists each reported item once, oldest first, by id: no dish, no family's name, and nothing about who reported", { skip }, async () => {
  const { t, serene, caleb, salik, ngozi, rey, poha, night } = await reported();
  const kim = await person(await family("Kim home"), "Jun", "cook");
  await ok(block(t, rey, "recipe", await recipe(kim, { title: "Kimchi jjigae", sharedAt: 2 }))); // a block tells the team too: a "family" report
  // The dinner's reports came first. Make the recipe's the oldest, so the order is by time, not by when rows were written.
  await db().query("update reports set created_at = created_at - interval '2 days' where kind = 'recipe'");

  const { code, items, log, err } = await cli("open");
  assert.equal(code, 0);
  assert.deepEqual(err, []);
  like(items, [
    { kind: "recipe", targetId: poha, families: 2, hidden: true },
    { kind: "dinner", targetId: night, families: 2, reasons: ["other", "other"], hidden: true },
    { kind: "family", targetId: kim.familyId, families: 1, reasons: ["none"], hidden: false },
  ]);
  assert.deepEqual([...items[0].reasons].sort(), ["not_food", "rude"]);
  const times = items.map((i) => i.firstAt);
  assert.ok(times.every((at) => new Date(at).toISOString() === at), times.join());
  assert.deepEqual([...times].sort(), times);
  // The same as the service's, but for the time's format and without what each item is: a log keeps it 30 days.
  assert.deepEqual(items, (await openReports()).map(({ what: _what, ...i }) => ({ ...i, firstAt: new Date(i.firstAt).toISOString() })));
  like(log, { level: "info", msg: "reports listed", action: "open", items: 3 });

  // Who reported is never printed: no reporter's id or name, and no reporter field at all.
  const printed = JSON.stringify(await cli("open"));
  for (const who of [serene, caleb, salik, ngozi, rey]) {
    for (const id of [who.personId, who.familyId]) assert.ok(!printed.includes(id), `a reporter's id ${id}`);
  }
  for (const word of ["Serene", "Caleb", "Salik", "Ngozi", "Rey", "Zhang", "Wang", "Mian", "Okafor", "Santos", "reporter"]) assert.ok(!printed.includes(word), word);

  // Nothing open: an empty list says so.
  await db().query("update reports set status = 'resolved'");
  const none = await cli("open");
  assert.equal(none.code, 0);
  assert.deepEqual(none.items, []);
  assert.ok(none.out.includes("No open reports."));
  like(none.log, { action: "open", items: 0 });
});

test("review keep and remove resolve the reports and do what reviewReport does", { skip }, async () => {
  const { t, rajani, rey, poha, night, later } = await reported();
  const third = rey; // reported nothing yet, so sees what everyone else does

  // A dinner taken down: called off and stays hidden. The one nobody reported is untouched.
  const down = await cli("review", "dinner", night, "remove");
  assert.equal(down.code, 0, down.err.join("\n"));
  assert.deepEqual(down.out[0], `Resolved 2 reports on dinner ${night}.`);
  like(down.log, { level: "info", msg: "reports reviewed", action: "review", kind: "dinner", targetId: night, decision: "remove", resolved: 2 });
  like(await dinnerRow(night), { status: "cancelled", hidden_at: (v: unknown) => v instanceof Date });
  like(await dinnerRow(later), { status: "open", hidden_at: null });

  // The recipe kept: its hide lifts for everyone but the families that reported it, and nothing here wrote `recipes`.
  assert.deepEqual(await dishes(t, third), []);
  const kept = await cli("review", "recipe", poha, "keep");
  assert.equal(kept.code, 0, kept.err.join("\n"));
  like(kept.log, { kind: "recipe", targetId: poha, decision: "keep", resolved: 2 });
  assert.deepEqual(await dishes(t, third), ["Kanda Poha"]);
  like(await recipeRow(poha), { shared_at: (v: unknown) => v instanceof Date, hidden_at: null });

  // A dinner kept: hidden by two families' reports, back for everyone else.
  const lee = await person(await family("Lee home"), "Min", "kid");
  const diaz = await person(await family("Diaz home"), "Ana", "cook");
  for (const who of [lee, diaz]) await ok(report(t, who, "dinner", later, "rude"));
  assert.deepEqual((await feed(t, third)).dinners, []);
  const back = await cli("review", "dinner", later, "keep");
  assert.equal(back.code, 0, back.err.join("\n"));
  like(back.log, { decision: "keep", resolved: 2 });
  like(await dinnerRow(later), { status: "open", hidden_at: null });
  assert.deepEqual((await feed(t, third)).dinners.map((d: { dinnerId: string }) => d.dinnerId), [later]);

  // A block's report only gets resolved: the block stays.
  await ok(block(t, third, "recipe", poha));
  const blockReview = await cli("review", "family", rajani.familyId, "remove");
  assert.equal(blockReview.code, 0, blockReview.err.join("\n"));
  assert.equal(blockReview.out[0], `Resolved 1 report on family ${rajani.familyId}. A block's review changes nothing else.`);
  assert.equal((await db().query("select count(*)::int as n from blocks where family_id = $1", [third.familyId])).rows[0].n, 1);
  assert.deepEqual(await dishes(t, third), []);
  assert.deepEqual((await cli("open")).items, []);
});

test("a recipe's review prints Convex's step first, changes nothing, and goes through once the copy shows it", { skip }, async () => {
  const { poha } = await reported();
  const before = await reportsNow();

  // A take-down while the copy is still shared.
  const early = await cli("review", "recipe", poha, "remove");
  assert.equal(early.code, 1);
  assert.equal(early.err[0], `Refused: recipe ${poha} is still shared in the copy here, so taking it down starts on Convex. Nothing changed.`);
  assert.ok(early.err[1].endsWith(`npx convex run --deployment grand-dragon-649 reports:review '{"kind": "recipe", "targetId": "${poha}", "keep": false}'`), early.err[1]);
  assert.equal(early.err.at(-1), `  3. Run this again: node dist/reports.js review recipe ${poha} remove`);
  like(early.log, { level: "warn", msg: "report review refused", kind: "recipe", targetId: poha, decision: "remove", code: "recipes_read_only" });
  assert.deepEqual(await reportsNow(), before);

  // Hidden on Convex before the move: keeping it starts there too.
  await db().query("update recipes set hidden_at = now() where id = $1", [poha]);
  const hidden = await cli("review", "recipe", poha, "keep");
  assert.equal(hidden.code, 1);
  assert.match(hidden.err[0], /^Refused: recipe \S+ is hidden in the copy here, so keeping it starts on Convex\. Nothing changed\.$/);
  assert.ok(hidden.err[1].includes(`"keep": true}'`), hidden.err[1]);
  assert.deepEqual(await reportsNow(), before);

  // Convex's review ran and the sync copied it (SQL stands in for both): now it goes through.
  await db().query("update recipes set shared_at = null, hidden_at = now() where id = $1", [poha]);
  const done = await cli("review", "recipe", poha, "remove");
  assert.equal(done.code, 0, done.err.join("\n"));
  like(done.log, { decision: "remove", resolved: 2 });
});

test("wrong words or a wrong id refuse, and nothing changes", { skip }, async () => {
  const { poha, night, later } = await reported();
  const before = { reports: await reportsNow(), night: await dinnerRow(night), later: await dinnerRow(later), poha: await recipeRow(poha) };

  const wrong: string[][] = [
    [],
    ["opn"],
    ["Open"],
    ["open", "now"],
    ["--help"],
    ["review"],
    ["review", "dinner", night],
    ["review", "dinner", night, "remvoe"],
    ["review", "dinner", night, "Remove"],
    ["review", "dinner", night, "true"],
    ["review", "dinner", night, "false"],
    ["review", "dinner", night, "remove", "now"],
    ["review", "dinners", night, "remove"],
    ["review", "Dinner", night, "remove"],
    ["review", "remove", "dinner", night],
    ["review", "dinner", "remove", night],
    ["review", "dinner", ` ${night}`, "remove"],
    ["review", "dinner", `${night}'`, "remove"],
    ["review", "dinner", `${night}","keep":true`, "remove"],
    ["review", "dinner", "", "remove"],
    ["review", "dinner", "x".repeat(101), "remove"],
  ];
  for (const args of wrong) {
    const r = await cli(...args);
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.err[0], /^Wrong arguments: .+\. Nothing ran\.$/, JSON.stringify(args));
    assert.deepEqual(r.out, [], JSON.stringify(args));
  }

  // The right words for something with no open report: a real dinner nobody reported, a dinner's id given as a recipe, an id that's no row, a block that never was.
  for (const args of [
    ["review", "dinner", later, "remove"],
    ["review", "recipe", night, "remove"],
    ["review", "dinner", poha, "remove"],
    ["review", "dinner", "no-such-dinner", "remove"],
    ["review", "family", "no-such-family", "keep"],
  ]) {
    const r = await cli(...args);
    assert.equal(r.code, 1, JSON.stringify(args));
    assert.equal(r.err[0], `Refused: ${args[1]} ${args[2]} has no open report, so nothing changed. Check the kind and id against: node dist/reports.js open`);
    like(r.log, { level: "warn", msg: "report review refused", action: "review", kind: args[1], targetId: args[2], code: "nothing_open" });
  }
  assert.deepEqual({ reports: await reportsNow(), night: await dinnerRow(night), later: await dinnerRow(later), poha: await recipeRow(poha) }, before);

  // Run twice: the second finds nothing open, so a kept dinner can't be called off by repeating the wrong line.
  assert.equal((await cli("review", "dinner", night, "keep")).code, 0);
  const again = await cli("review", "dinner", night, "remove");
  assert.equal(again.code, 1);
  like(await dinnerRow(night), { status: "open", hidden_at: null });
});

test("the task's command runs: wrong arguments never reach the database, and open exits 0", { skip }, async () => {
  const apiDir = fileURLToPath(new URL("..", import.meta.url));
  const node = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/reports.ts", ...args], { cwd: apiDir, env, encoding: "utf8", timeout: 60_000 });
  const { DATABASE_URL: _url, DB_HOST: _host, DB_CREDENTIALS: _login, ...noDatabase } = process.env;

  const typo = node(["review", "dinner", "abc", "remvoe"], noDatabase);
  assert.equal(typo.status, 2, typo.stderr);
  assert.equal(typo.stderr.split("\n")[0], "Wrong arguments: the last word must be keep or remove. Nothing ran.");

  const { night } = await reported();
  const listed = node(["open"], process.env);
  assert.equal(listed.status, 0, listed.stderr);
  const lines = listed.stdout.trim().split("\n");
  like(JSON.parse(lines[0]), { kind: "dinner", targetId: night });
  like(JSON.parse(lines.at(-1)!), { level: "info", msg: "reports listed", action: "open", items: 2 });

  const refused = node(["review", "dinner", "no-such-dinner", "remove"], process.env);
  assert.equal(refused.status, 1, refused.stderr);

  // No database to reach: one line saying so, and still a clean exit.
  const away = node(["open"], { ...noDatabase, DATABASE_URL: "postgres://nobody:none@127.0.0.1:1/none" });
  assert.equal(away.status, 1, away.stderr);
  assert.match(away.stderr.split("\n")[0], /^Failed: Error, ECONNREFUSED, .+\. Nothing changed\.$/);
});

after(async () => {
  if (hasDatabase) await db().end();
});


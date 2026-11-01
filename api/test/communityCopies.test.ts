// Community's rules here are a copy of Convex's while both are live (AWS-MIGRATION requires the same behavior on old and new). When Convex's change, this fails, so the fix reaches both.
// It comes off with Convex. Skipped where convex/ isn't there, such as in the api's image.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_OPENS, OPEN_BURST, OPEN_BURST_MS } from "../src/modules/community/dinners.js";
import { HIDE_AFTER } from "../src/modules/community/safety.js";
import { CRAVING_MESSAGE_CHARS, CRAVING_TOTAL, DEFAULT_CRAVING_MESSAGE, VOICE_RECIPE_QUESTION } from "../src/modules/dish/cravings.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const convex = (path: string) => readFileSync(join(root, "convex", path), "utf8");
const here = (path: string) => readFileSync(join(root, "api", "src", "modules", path), "utf8");
const skip = !existsSync(join(root, "convex", "lib", "geo.ts"));

/** A function's body: from its first line's end to its closing brace. Signatures differ only in their types. */
function body(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const open = source.indexOf("{\n", start);
  return source.slice(open, source.indexOf("\n}\n", open));
}

for (const name of ["roundToGrid", "milesBetween", "distanceLabel"]) {
  test(`geo: ${name} is Convex's`, { skip }, () => assert.equal(body(here("community/geo.ts"), name), body(convex("lib/geo.ts"), name)));
}

test("the feed's shared recipes come with the same story card rules", { skip }, () => {
  for (const name of ["quoteChoices", "quoteTranslated"]) assert.equal(body(here("community/storyCard.ts"), name), body(convex("lib/storyCard.ts"), name));
});

test("the numbers and words are Convex's", { skip }, () => {
  assert.ok(convex("lib/safety.ts").includes(`HIDE_AFTER = ${HIDE_AFTER};`));
  const dinners = convex("dinners.ts");
  assert.ok(dinners.includes(`MAX_OPENS = ${MAX_OPENS};`));
  assert.ok(dinners.includes(`OPEN_BURST = ${OPEN_BURST};`));
  assert.equal(OPEN_BURST_MS, 600_000);
  assert.ok(dinners.includes("OPEN_BURST_MS = 10 * 60_000;"));
  const cravingLinks = convex("lib/cravingLinks.ts");
  assert.ok(cravingLinks.includes(`CRAVING_TOTAL = ${CRAVING_TOTAL};`));
  assert.ok(cravingLinks.includes(`CRAVING_MESSAGE_CHARS = ${CRAVING_MESSAGE_CHARS};`));
  assert.ok(cravingLinks.includes(JSON.stringify(DEFAULT_CRAVING_MESSAGE)));
  assert.ok(convex("cravings.ts").includes(JSON.stringify(VOICE_RECIPE_QUESTION)));
});

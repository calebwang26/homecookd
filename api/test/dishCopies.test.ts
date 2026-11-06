// The recipe code here is a copy of Convex's while both are live (AWS-MIGRATION requires the same behavior on old and new). When Convex's
// changes, this fails, so the fix reaches both. It comes off with Convex. Skipped where convex/ isn't there, such as in the api's image.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { askTokenFor } from "../src/modules/dish/values.js";
import { TRANSLATE_INSTRUCTIONS, TRANSLATE_MODEL } from "../src/modules/dish/model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const convex = (path: string) => join(root, "convex", path);
const here = (path: string) => join(root, "api", "src", "modules", "dish", path);
const skip = !existsSync(convex("lib/dishAsk/validate.ts"));
const imports = (s: string) => s.replaceAll(/from "\.\/(\w+)\.js"/g, 'from "./$1"');

for (const file of ["types.ts", "validate.ts", "prompts.ts"]) {
  test(`recipe/${file} is Convex's copy`, { skip }, () => {
    assert.equal(imports(readFileSync(here(`recipe/${file}`), "utf8")), readFileSync(convex(`lib/dishAsk/${file}`), "utf8"));
  });
}

test("the word filter holds Convex's list", { skip }, () => {
  const terms = (s: string) => s.slice(s.indexOf("const TERMS"), s.indexOf("const PATTERNS"));
  assert.equal(terms(readFileSync(here("moderation.ts"), "utf8")), terms(readFileSync(convex("lib/moderation.ts"), "utf8")));
});

test("the translation's model and instructions are Convex's", { skip }, () => {
  const translate = readFileSync(convex("lib/translate.ts"), "utf8");
  for (const line of TRANSLATE_INSTRUCTIONS.match(/.{1,60}/g)!) assert.ok(translate.replaceAll(/"\s*\+\s*"/g, "").includes(line), line);
  assert.ok(readFileSync(convex("lib/textModel.ts"), "utf8").includes(`TRANSLATE_MODEL = "${TRANSLATE_MODEL}"`));
});

test("the ask token is worked out from the kid token as Convex's is, so old links carry over", { skip }, () => {
  const source = readFileSync(convex("lib/dishAskRoutes.ts"), "utf8");
  assert.ok(source.includes('sha256Hex(`ask:${kidToken}`)'));
  assert.ok(source.includes('digits.padStart(43, "0").slice(0, 22)'));
  assert.match(askTokenFor("A".repeat(22)), /^[0-9A-Za-z]{22}$/);
});

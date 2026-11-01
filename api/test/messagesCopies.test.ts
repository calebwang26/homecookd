// The pure rules here are copies of Supabase's and Convex's while they're live (AWS-MIGRATION requires the same behavior on old and new). When an original changes, this
// fails, so the fix reaches both. It comes off with them. Skipped where those folders aren't there, such as in the api's image.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { forCookPrompt, YES_NO_INSTRUCTIONS, NOTE_SYSTEM } from "../src/modules/messages/models.js";
import { CAPS } from "../src/modules/messages/pushRules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = (path: string) => join(root, "api", "src", "modules", "messages", path);
const skip = !existsSync(join(root, "supabase", "functions", "api", "table.ts")) || !existsSync(join(root, "convex", "lib", "pushWords.ts"));
const tsImports = (s: string) => s.replaceAll(/from "\.\/(\w+)\.js"/g, 'from "./$1.ts"');
const flat = (s: string) => s.replaceAll(/"\s*\+\s*\n?\s*"/g, "").replaceAll(/\s+/g, " ");

for (const file of ["time.ts", "table.ts", "recap.ts"]) {
  test(`${file} is Supabase's copy`, { skip }, () => {
    assert.equal(tsImports(readFileSync(here(file), "utf8")), readFileSync(join(root, "supabase", "functions", "api", file), "utf8"));
  });
}

test("pushWords.ts is Convex's copy", { skip }, () => {
  assert.equal(readFileSync(here("pushWords.ts"), "utf8"), readFileSync(join(root, "convex", "lib", "pushWords.ts"), "utf8"));
});

test("the caps are Supabase's", { skip }, () => {
  const plumbing = readFileSync(join(root, "supabase", "functions", "api", "plumbing.ts"), "utf8");
  assert.ok(plumbing.includes(`learnerPerDay: ${CAPS.learnerPerDay}, learnerPerWeek: ${CAPS.learnerPerWeek}, cookPerMonth: ${CAPS.cookPerMonth}`));
});

test("the prompts are Convex's", { skip }, () => {
  const translate = flat(readFileSync(join(root, "convex", "lib", "translate.ts"), "utf8"));
  const yesNo = flat(readFileSync(join(root, "convex", "lib", "yesNo.ts"), "utf8"));
  const messages = flat(readFileSync(join(root, "convex", "messages.ts"), "utf8"));
  const line = "they would say themselves; keep ingredient names they know. Keep the meaning; add nothing. Reply with the translation only.";
  assert.ok(translate.includes(line));
  assert.ok(forCookPrompt("mr").includes(line));
  assert.ok(yesNo.includes(YES_NO_INSTRUCTIONS.replaceAll('"', '\\"')));
  assert.ok(messages.includes(NOTE_SYSTEM));
});

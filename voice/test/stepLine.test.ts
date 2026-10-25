// The step's short line (stepLine.ts): "Step N." and the step cut to about 20 spoken words with plain rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { CookSession } from "../src/convex.js";
import { LINE_WORDS, shortStep, stepLine } from "../src/stepLine.js";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

test("the stub recipe's lines: whole sentences when they fit, else the title", () => {
  const stub: CookSession = JSON.parse(readFileSync(new URL("../fixtures/stub-session.json", import.meta.url), "utf8"));
  assert.deepEqual(stub.recipe.steps.map(stepLine), [
    "Step 1. Cut the pork belly into chunky cubes about the size of a mahjong tile.",
    "Step 2. Melt the sugar to amber.",
    "Step 3. Splash in the Shaoxing wine, then the light and dark soy sauce.",
    "Step 4. Pour in hot water until it just covers the pork and bring to a boil.",
    "Step 5. The next morning, warm the pork gently, then take off the lid and turn up the heat.",
    "Step 6. Plate and serve hot.",
  ]);
});

test("two short sentences both fit; a third that doesn't is left for the screen", () => {
  assert.equal(
    shortStep("Wash the rice. Drain it well. Then soak it in plenty of cold water for thirty minutes, or until the grains turn white."),
    "Wash the rice. Drain it well.",
  );
  assert.equal(stepLine({ order: 1, title: "Wash", text: "Wash the rice three times." }), "Step 1. Wash the rice three times.");
});

test("a long first sentence is cut at its last joint that fits: a semicolon or a then", () => {
  assert.equal(
    shortStep("Lay the fish on the grate and leave it alone for about 6 minutes a side, then flip once with two spatulas when the skin lets go on its own."),
    "Lay the fish on the grate and leave it alone for about 6 minutes a side.",
  );
  assert.equal(
    shortStep("Toast the cumin until it pops; add the onions and cook them slowly until they turn soft, sweet and deep golden brown all over."),
    "Toast the cumin until it pops.",
  );
  // A head that can't stand alone isn't a line.
  assert.equal(
    shortStep("If the dough feels dry and cracks when you press it with your thumb, then add a splash of cold water and knead it again.", "Fix the dough"),
    "Fix the dough.",
  );
});

test("nothing that fits: the title; a title that's only a number: the first words", () => {
  const text = "Put the rock sugar in a dry wok over low heat and stir until it melts into a deep amber caramel.";
  assert.equal(shortStep(text, "Melt the sugar to amber"), "Melt the sugar to amber.");
  assert.equal(shortStep(text, "Step 2"), "Put the rock sugar in a dry wok over low heat and stir until it melts into a.");
  assert.equal(shortStep("", "Rest the dough"), "Rest the dough.");
});

test("tidy for speech: no markdown bold, spaces squeezed, one end mark, never a dangling comma", () => {
  assert.equal(shortStep("Add **a pinch** of  salt,"), "Add a pinch of salt.");
  assert.equal(shortStep("Is it golden?"), "Is it golden?");
  assert.equal(shortStep("Simmer approx. 5 minutes."), "Simmer approx. 5 minutes.");
});

test("every bundled and synthetic step's line stays within about 20 words", () => {
  const dir = new URL("../../data/synthetic/", import.meta.url);
  const files = ["auntie-lin-scallion-pancakes", "dad-ginger-scallion-fish", "dad-sunday-chili", "grandma-hand-pulled-noodle-soup", "grandma-red-braised-pork"];
  for (const f of files) {
    const recipe = JSON.parse(readFileSync(new URL(`${f}.json`, dir), "utf8"));
    for (const s of recipe.steps) {
      const line = stepLine({ order: s.order, title: s.title, text: s.instruction ?? s.text });
      assert.ok(words(line) <= LINE_WORDS + 2, `${f} ${s.order}: ${line}`);
      assert.match(line, /^Step \d+\. \S.*[.!?]$/, `${f} ${s.order}`);
    }
  }
});

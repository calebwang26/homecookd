import { expect, test } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { memoryDocs, stepDocs } from "./lib/mossDocs";

const moment = { startS: 10, endS: 20 };
const recipe = {
  _id: "r1",
  title: "Poha",
  steps: [
    { order: 1, title: "Heat the oil", text: "Heat the oil until it shimmers.", quote: "Let the oil get really hot.", moment },
    { order: 2, title: "Add mustard seeds", text: "Add the mustard seeds.", quote: "मोहरी तडतडू दे.", moment },
  ],
  memories: [
    { kind: "story", text: "Aaji made this every Sunday.", moment },
    { kind: "story", text: "आजी दर रविवारी करायची.", moment },
  ],
} as unknown as Doc<"recipes">;

test("the searched text stays English: a Marathi quote or story is left out", () => {
  const [oil, seeds] = stepDocs(recipe);
  expect(oil.text).toBe('Step 1: Heat the oil. Heat the oil until it shimmers. The cook said: "Let the oil get really hot."');
  expect(seeds.text).toBe("Step 2: Add mustard seeds. Add the mustard seeds.");
  expect(memoryDocs(recipe).map((d) => d.id)).toEqual(["r1:story:0"]);
});

test("any non-Latin script is left out too (Tamil, Chinese, Arabic), but accented English words stay", () => {
  const steps = [
    { order: 1, title: "Temper", text: "Add mustard seeds.", quote: "கடுகு போடுங்க.", moment },
    { order: 2, title: "Ginger", text: "Add ginger.", quote: "放点姜。", moment },
    { order: 3, title: "Garlic", text: "Add garlic.", quote: "ضعي الثوم.", moment },
    { order: 4, title: "Sauté", text: "Sauté the onions.", quote: "Sauté them till they're golden, café-style.", moment },
  ];
  const docs = stepDocs({ ...recipe, steps } as unknown as Doc<"recipes">);
  expect(docs.slice(0, 3).map((d) => d.text.includes("The cook said"))).toEqual([false, false, false]);
  expect(docs[3].text).toContain('The cook said: "Sauté them');
});

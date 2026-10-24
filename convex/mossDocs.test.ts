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

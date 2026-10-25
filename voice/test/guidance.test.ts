// homie gives guidance, never cooking advice (homie.ts soundsLikeAdvice): the code check under the prompt.
import assert from "node:assert/strict";
import { test } from "node:test";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
const { soundsLikeAdvice } = await import("../src/homie.js");

test("guidance questions pass", () => {
  for (const q of [
    "How much salt was that?",
    "Can you tilt the pan toward me?",
    "Hold up the spice so Leo knows which one.",
    "Show me the plate when it's done.",
    "How do you know the onions are ready?",
    "If Shreya can't find curry leaves, what would you use instead?",
    "Who taught you this dish?",
    "Oh, I love that.",
  ])
    assert.equal(soundsLikeAdvice(q), false, q);
});

test("cooking advice is caught", () => {
  for (const q of [
    "You should lower the heat a little.",
    "Try adding a bit more salt.",
    "Be careful not to burn the garlic.",
    "Make sure the oil is hot first.",
    "That might be too much chili.",
    "You might want to stir it now.",
    "Turn the heat down so it doesn't stick.",
    "Add some lemon at the end.",
  ])
    assert.equal(soundsLikeAdvice(q), true, q);
});

// The kid's spoken yes or no (yesNo.ts): what counts, and what goes the usual way (a command, a question).
import assert from "node:assert/strict";
import { test } from "node:test";
import { yesNo } from "../src/yesNo.js";

const check = (expected: "yes" | "no" | null, replies: string[]) => {
  for (const reply of replies) assert.equal(yesNo(reply), expected, JSON.stringify(reply));
};

test("a reply that starts with a yes is a yes, whatever follows", () => {
  check("yes", [
    "Yes.", "Yes please.", "Yeah.", "Yep!", "Yup", "Sure.", "Okay.", "OK", "Alright.", "All right.", "Please.",
    "Of course.", "Go ahead.", "Do it.", "Play it.", "Read it.", "Let's hear it.", "Read it out loud.",
    "Sure, read it.", "Yeah, go ahead.", "Yes, play it.", "Yes, I want to hear it.", "Okay sure.", "Okay, yes please.",
    "Um, yes.", "Oh, okay.", "Okay, go ahead and read it.", "Please read it to me.", "Okay, thanks.",
    "Yes, but how much ginger?", // decided: a yes (the app takes it as its moment's yes too)
  ]);
});

test("a reply that starts with a no is a no, and a no wins", () => {
  check("no", [
    "No.", "No thanks.", "No, thank you.", "Nope.", "Nah.", "Don't.", "Dont", "Don’t.", "Not now.", "Not right now.",
    "No, not right now.", "Nah, I'm good.", "I'm good.", "Im good, thanks.", "No, I don't want that.", "Not really.",
    "Not yet.", "Later.", "Maybe later.", "Skip it.", "No, maybe later.", "Um, no.", "Well, not now.",
    "Okay, no.", "Okay, no thanks.", "Please don't.", "No no no.",
  ]);
});

test("commands and questions are not a yes or a no", () => {
  check(null, [
    "Next step.", "What's the next step?", "Okay, what's the next step?", "Okay, next step.", "Okay, next.", "Please go back.",
    "Wait, go back.", "Repeat that.", "Say that again.", "What?", "Now what?", "Okay, how much salt do I add?",
    "How hot should the oil be?", "Okay, set a timer for 5 minutes.", "Set a timer for five minutes.",
  ]);
});

test("words that only sound like a yes or a no don't count", () => {
  check(null, [
    "Know what?", "Nothing.", "Now.", "Nobody told me.", "Not yet sure how much salt.", "Later I'll add the ginger.",
    "Yesterday Grandma said so.", "Surely it's done.", "No problem.", "No worries.", "No idea how much ginger.",
    "Don't know how much salt.", "Don't understand step two.", "Oh no, I burned it!", "Thanks.", "Um", "", "...",
    "Okayish.", "I'm sure it's fine.",
  ]);
});

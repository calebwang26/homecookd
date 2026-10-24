// The kid's spoken yes or no (yesNo.ts): what counts, and what goes the usual way (a command, a question).
import assert from "node:assert/strict";
import { test } from "node:test";
import { afterNo, yesNo } from "../src/yesNo.js";

const check = (expected: "yes" | "no" | null, replies: string[]) => {
  for (const reply of replies) assert.equal(yesNo(reply), expected, JSON.stringify(reply));
};

test("a reply that starts with a yes is a yes, whatever follows", () => {
  check("yes", [
    "Yes.", "Yes please.", "Yeah.", "Yep!", "Yup", "Sure.", "Okay.", "OK", "Alright.", "All right.", "Please.",
    "Of course.", "Go ahead.", "Do it.", "Play it.", "Read it.", "Let's hear it.", "Read it out loud.", "Can do.",
    "Sure, read it.", "Yeah, go ahead.", "Yes, play it.", "Yes, I want to hear it.", "Okay sure.", "Okay, yes please.",
    "Um, yes.", "Oh, okay.", "Okay, go ahead and read it.", "Please read it to me.", "Okay, thanks.", "Okay?",
    "Yes, but how much ginger?", // decided: a yes (the app takes it as its moment's yes too)
    "Yes, no problem.", "Sure, no worries.",
  ]);
});

test("okay, alright or please with more words is a yes, as in the app (main's isYes too)", () => {
  check("yes", [
    "Please do.", "Okay, let's do it.", "Okay, sounds good.", "Okay cool.", "Ok go.", "Okay, I want to hear it.",
    "Please read the recipe.", "Alright, let's hear it.", "Okay, will do.",
  ]);
});

test("a reply that starts with a no is a no, and a no wins", () => {
  check("no", [
    "No.", "No thanks.", "No, thank you.", "Nope.", "Nah.", "Don't.", "Dont", "Don’t.", "Not now.", "Not right now.",
    "No, not right now.", "Nah, I'm good.", "I'm good.", "Im good, thanks.", "No, I don't want that.", "Not really.",
    "Not yet.", "Later.", "Maybe later.", "Skip it.", "No, maybe later.", "Um, no.", "Well, not now.",
    "Okay, no.", "Okay, no thanks.", "Please don't.", "No no no.", "Not now, thanks.", "Don't read it.",
    "Don't bother.", "Don't worry about it.", "Of course not.", "Not really, thanks.",
    "No, it's fine.", // decided: a no (to "read it out loud?" it means "no need")
  ]);
});

test("oh no is a no only when a no follows it, or nothing does", () => {
  check("no", ["Oh, no thanks.", "Oh no, not now.", "Oh, no.", "Oh no, I'm good.", "Oh no no, maybe later."]);
  check(null, ["Oh no, I burned it!", "Oh no, it's boiling over.", "Oh no no no, the rice!"]);
});

test("a no after a yes word wins too", () => {
  check("no", ["Yeah, no.", "Yeah no, I'm good.", "Yes, not now.", "Sure, but not right now."]);
});

test("commands and questions are not a yes or a no", () => {
  check(null, [
    "Next step.", "What's the next step?", "Okay, what's the next step?", "Okay, next step.", "Okay, next.", "Please go back.",
    "Wait, go back.", "Repeat that.", "Say that again.", "What?", "Now what?", "Okay, now what?", "Okay, how much salt do I add?",
    "How hot should the oil be?", "Okay, set a timer for 5 minutes.", "Set a timer for five minutes.", "Okay, go on.",
    "Okay, done.", "Okay, wait.", "Alright, is the oil hot enough?", "Please, a timer for 5 minutes.", "Okay, the rice is soft?",
    "Okay, do I add the salt now?", "Please say that again.",
  ]);
});

test("words that only sound like a yes or a no don't count", () => {
  check(null, [
    "Know what?", "Nothing.", "Now.", "Nobody told me.", "Not yet sure how much salt.", "Later I'll add the ginger.",
    "Yesterday Grandma said so.", "Surely it's done.", "No problem.", "No worries.", "No idea how much ginger.",
    "Don't know how much salt.", "Don't understand step two.", "Thanks.", "Um", "", "...", "Okayish.", "I'm sure it's fine.",
    "Not really sure how much salt.", "No clue how much ginger.", "No one told me how much salt.", "I'm good at this.",
    "Don't forget the timer.",
  ]);
});

test("afterNo: a plain command right after a no is the fast tail, so it still runs without Claude", () => {
  const cases: [string, string][] = [
    ["No, next step.", "next step"],
    ["No, go back.", "go back"],
    ["Nah, what's next?", "what's next"],
    ["No thanks, next step please.", "next step"],
    ["Not now, set a timer for 5 minutes.", "set a timer for 5 minutes"],
    ["Okay, no, go back.", "go back"],
    ["Nah, no need, next step.", "next step"],
    ["No, but repeat that.", "repeat that"],
  ];
  for (const [reply, fastTail] of cases) assert.deepEqual(afterNo(reply), { more: true, fastTail }, JSON.stringify(reply));
  check("no", cases.map(([reply]) => reply));
});

// The verifiers' replies (rounds 1 to 5): each is more than the no, and cook.ts gives Claude the whole sentence.
const MORE_AFTER_NO = [
  "No point in reading it.", "No, no point reading it out loud.", "No, no need at all to read it.", "No, no need of reading it.",
  "Nah, no need really to read it.", "No, I'm out of ginger. Can I skip it?", "No, it's burning, what do I do?",
  "No, the oil's too hot?", "No, too hot?", "No, go to step 3.", "No, play the video.", "No, tell me the story.",
  "Nah, show me the video.", "No, skip this step.", "No, why?", "No, but how much salt do I add?", "No, just read it.",
  "No? Fine.", "No, too salty.", "No, don't set a timer for 5 minutes.",
];

test("afterNo: anything more after a no is more, whatever it means", () => {
  for (const reply of MORE_AFTER_NO) {
    assert.equal(afterNo(reply).more, true, JSON.stringify(reply));
    assert.equal(yesNo(reply), "no", JSON.stringify(reply)); // still a no: the offer is declined first
  }
});

// Only the no: nothing goes on, to the fast path or to Claude.
const ONLY_NO = [
  "No.", "No, thanks.", "No thanks.", "No, not now.", "Nah, I'm good.", "No, maybe later.", "No, I'm good for now.",
  "Nah, that's okay.", "No, it's fine.", "No, don't read it.", "No, skip it.", "No, not today, thanks.", "No, I'm all good.",
  "No, no need.", "No, I don't want to hear it.", "No, I don't want that.",
  "No, no need to read it.", "Nope, no need to read it out loud.", "Nah, no need for that.", "No, no need to play it.",
  "No need to read it.", "No need.", "No, there's no need.", "No, no need to.", "Nah, no need for now.",
  "No, no need, I'm good.", "Oh no, no need to read it.", "No thanks, no need to read it.", "No point.",
  "No, I'm all right.", "No, I got it.", "No, I've got it.", "No, I can do it.", "No, I'm good on that.",
  "Nah, I'm fine with that.", "No, you don't have to.", "No, I'm good, thank you so much.",
];

test("afterNo: more no after a no is only the no", () => {
  for (const reply of ONLY_NO) {
    assert.deepEqual(afterNo(reply), { more: false, fastTail: "" }, JSON.stringify(reply));
    assert.equal(yesNo(reply), "no", JSON.stringify(reply));
  }
});

test("afterNo: a reply that isn't a no has nothing after a no", () => {
  for (const reply of ["Yes, next step.", "Next step.", "Oh no, go back!", "How much salt?"]) {
    assert.deepEqual(afterNo(reply), { more: false, fastTail: "" }, JSON.stringify(reply));
  }
});

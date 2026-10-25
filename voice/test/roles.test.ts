// homie never guesses a family role or a gender (Caleb, Oct 24: "the AI homie will always refer to me as like a
// mom"). The prompts speak of the cook by name or as "the cook", the written lines use the kid's name or "your
// family", and guessesFamily catches Claude's English when it says "your son" anyway.
import assert from "node:assert/strict";
import { test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { CookSession } from "../src/convex.js";
import type { Who } from "../src/homie.js";

process.env.CARTESIA_API_KEY = "test";
process.env.ANTHROPIC_API_KEY = "test";
const { SPEAKS_AS, decidePrompt, endPrompt, introPrompt, neverGuess } = await import("../src/homie.js");
const { callOf, guessesFamily } = await import("../src/family.js");
const { fixedLine, scriptedQuestion } = await import("../src/lines.js");
const { TurnAgent, cookCall } = await import("../src/agent.js");

const GENDERED = /\b(she|her|hers|herself|he|him|his|himself|mom|mother|dad|father|son|daughter|grandson|granddaughter|grandchild|grandma|grandpa|parent)\b/i;

const aaji: Who = { language: "mr", call: "Rajani Aaji", kid: "Shreya", dish: "Varan Bhaat" };
const dad: Who = { language: "en", call: "Dad", dish: "Dal Tadka" };
const whos = [aaji, dad, { language: "en", call: "Vijay" }];

/** A prompt without the rule that names the words to avoid, homie's own gender, and the cook's call ("Dad"). */
const rest = (prompt: string, w: Who) => prompt.replace(neverGuess(w), "").replace(SPEAKS_AS, "").replaceAll(w.call, "");

test("every recording prompt speaks of the cook without a gender, and carries the rule", () => {
  for (const w of whos) {
    const prompts = [
      introPrompt(w, false),
      introPrompt(w, true),
      decidePrompt(w, { frame: true, mayAsk: true, mayReact: true }),
      decidePrompt(w, { frame: false, mayAsk: false, mayReact: false }),
      endPrompt(w, 2),
    ];
    for (const p of prompts) {
      assert.ok(p.includes(neverGuess(w)), "the never-guess rule is in every prompt");
      assert.ok(p.includes("Never guess anyone's family role or gender"));
      assert.doesNotMatch(rest(p, w), GENDERED, p.slice(0, 120));
      for (const old of ["her phone films her", "She is the expert", "Speak to her", "her family"]) assert.ok(!p.includes(old), old);
    }
  }
});

test("homie's own gender stays; the cook's isn't assumed", () => {
  assert.match(SPEAKS_AS, /homie speaks of herself in the feminine/);
  assert.match(SPEAKS_AS, /Never assume the cook's gender/);
  assert.doesNotMatch(SPEAKS_AS.replace("homie speaks of herself", ""), /\b(she|her|herself)\b/);
});

test("with no kid name, the prompts say 'your family', never a guessed kid", () => {
  const p = introPrompt(dad, false);
  assert.match(p, /"your family" or "your loved ones"/);
  assert.match(neverGuess(dad), /never say "your son", "your daughter"/);
  assert.match(neverGuess(aaji), /say "Shreya"/);
});

test("the written lines for a cook called Dad, with no kid name: 'your family', never a son or a mom", async () => {
  const names = ["intro", "introAgain", "plate", "optIn", "closing", "plateThanks", "stillThere", "letOff"] as const;
  const all: string[] = [];
  for (const name of names) {
    const line = await fixedLine(name, dad);
    assert.equal(line.text, line.textEn);
    assert.doesNotMatch(line.textEn.replace(/\bDad\b/g, ""), GENDERED, `${name}: ${line.textEn}`);
    all.push(line.textEn);
  }
  for (let n = 0; n < 6; n++) all.push((await scriptedQuestion(n, dad)).line.textEn);
  const said = all.join(" ");
  assert.match(said, /Hi, Dad\./);
  assert.match(said, /You're making Dal Tadka for your family today/);
  assert.match(said, /Can your family hear your stories too\?/);
  assert.match(said, /Your family is going to hear every bit of this/);
  assert.doesNotMatch(said, /\bson\b|\bmom\b|\bgrand/i);
});

test("the written lines with a kid name use the name; Marathi says घरच्यां without one", async () => {
  const intro = await fixedLine("intro", aaji);
  assert.match(intro.textEn, /You're making Varan Bhaat for Shreya today/);
  assert.match(intro.text, /आज तुम्ही Shreya साठी Varan Bhaat करताय/);
  const ajoba: Who = { language: "mr", call: "Ramesh Ajoba", dish: "Varan Bhaat" };
  const forAll = await fixedLine("intro", ajoba);
  assert.match(forAll.text, /आज तुम्ही घरच्यांसाठी Varan Bhaat करताय/);
  assert.match(forAll.textEn, /for your family today/);
  assert.match((await fixedLine("closing", ajoba)).text, /घरचे/);
  assert.doesNotMatch([forAll.textEn, (await fixedLine("closing", ajoba)).textEn].join(" "), GENDERED);
});

const told = { names: ["Rajani Aaji", "Shreya", "Varan Bhaat"] };

test("guessesFamily catches a guessed role or gender", () => {
  for (const line of [
    "Your son really wants to see you cook.",
    "Hi, Mom. Start whenever you're ready.",
    "Shreya is going to love her grandma's dal.",
    "Hold it up so your grandchild can see.",
    "Your kids will love this.",
    "So Shreya can see what she's looking for.",
    "Is this how your mother made it?",
    // Oct 24 review: the words added to the guard.
    "Your nana would love this.",
    "Shreya's nani is proud.",
    "Your auntie taught you?",
    "Was it your aunt or your uncle?",
    "Thank you, ma'am.",
    "Yes, sir.",
    "Your granddad made it like this?",
    "Did your grandpa cook too?",
    "For your little one.",
    "Your brother will love it.",
    "Your sister asked for it.",
    "Your boy will love it.",
    "The girls will love it.",
  ])
    assert.equal(guessesFamily(line, told), true, line);
});

test("guessesFamily passes names, the dish, 'your family', and the cook's own recent words", () => {
  for (const line of [
    "Hi, Rajani Aaji. You're making Varan Bhaat for Shreya today.",
    "How much salt was that?",
    "Hold up the spice so Shreya knows which one.",
    "Can your family hear your stories too?",
    "Your loved ones will hear every bit of this.",
    "Who taught you this dish?",
    // "the" and "other" contain "he" and "her", which aren't words of their own.
    "Is there another way the family could tell it's done?",
    // Not about anyone.
    "Oh boy, that smells good.",
    "Oh, boy. That's a lot of chili.",
    "Is it kid-friendly spicy?",
  ])
    assert.equal(guessesFamily(line, told), false, line);
  assert.equal(guessesFamily("Hi, Dad. Good to see you again.", { names: ["Dad"] }), false, "the cook's own call");
  assert.equal(guessesFamily("Hi, Grandma.", { names: ["Grandma"] }), false);
  // The dish counts as given (finding 1): "Dad's Sunday Chili" for a cook called Vijay.
  assert.equal(guessesFamily("Hi, Vijay. Dad's Sunday Chili for your family today.", { names: ["Vijay", undefined, "Dad's Sunday Chili"] }), false);
  assert.equal(guessesFamily("Hi, Rajani Aaji. Grandma's Red-Braised Pork Belly, how lovely.", { names: ["Rajani Aaji", "Shreya", "Grandma's Red-Braised Pork Belly"] }), false);
  // The cook talked about their son: homie may say "son" back, never a pronoun.
  assert.equal(guessesFamily("Does your son like it spicy?", { names: ["Dad"], heard: ["My son loves this one."] }), false);
  assert.equal(guessesFamily("Does your son like it spicy?", { names: ["Dad"] }), true);
  assert.equal(guessesFamily("Does she like it spicy?", { names: ["Dad"], heard: ["She loves this one."] }), true);
});

test("guessesFamily's narrower checks: questions skip pronouns, reactions check only the kid's role", () => {
  assert.equal(guessesFamily("Who taught her this dish?", told, "roles"), false);
  assert.equal(guessesFamily("Who taught her this dish?", told, "all"), true);
  assert.equal(guessesFamily("Does your grandson like it?", told, "roles"), true);
  assert.equal(guessesFamily("Oh, your grandmother taught you? I love that.", told, "kid"), false);
  for (const line of ["Your son is lucky.", "Your granddaughter will love it.", "Your kids are lucky.", "Your little one will love it."])
    assert.equal(guessesFamily(line, told, "kid"), true, line);
});

test("callOf: the family's word, with the name only when it needs one", () => {
  // The relation already holds the name (convex/glasses.test.ts's data): no "Rajani Rajani Aaji".
  assert.equal(callOf("Rajani", "Rajani Aaji"), "Rajani Aaji");
  assert.equal(callOf("Rajani Pawar", "Rajani Aaji"), "Rajani Aaji");
  // A word on its own: no "Vijay Dad" or "Mary Grandma".
  assert.equal(callOf("Vijay", "Dad"), "Dad");
  assert.equal(callOf("Mary", "Grandma"), "Grandma");
  assert.equal(callOf("Ana", "Mom"), "Mom");
  assert.equal(callOf("Ramesh", "Uncle"), "Uncle");
  // A word that follows a name keeps it.
  assert.equal(callOf("Rajani", "Aaji"), "Rajani Aaji");
  assert.equal(callOf("Ramesh", "Ajoba"), "Ramesh Ajoba");
  assert.equal(callOf("Rajani Pawar", "Aaji"), "Rajani Aaji");
  // A profile already named for the family word; no relation; nothing at all.
  assert.equal(callOf("Grandma", "Aaji"), "Grandma");
  assert.equal(callOf("Dad", undefined), "Dad");
  assert.equal(callOf("Vijay", ""), "Vijay");
  assert.equal(callOf(undefined, undefined), undefined);
});

test("the kid's cooking prompt calls the cook by the family's word, with the rule", async () => {
  const session: CookSession = {
    familyId: "fam-1",
    mossIndex: "family-fam-1",
    kid: { id: "kid-1", name: "Shreya" },
    cook: { name: "Vijay", language: "mr", relation: "Dad" },
    recipe: { id: "r1", title: "Varan Bhaat", steps: [{ order: 1, title: "Wash", text: "Wash the rice.", moment: { startS: 0, endS: 30 } }], memories: [] },
  };
  assert.equal(cookCall(session), "Dad");
  assert.equal(cookCall({ ...session, cook: { name: "Rajani", relation: "Aaji" } }), "Rajani Aaji");
  assert.equal(cookCall({ ...session, cook: undefined }), "the cook");
  let system = "";
  const create = async (params: { system: string }) => ((system = params.system), { content: [{ type: "text", text: "" }], stop_reason: "end_turn" });
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  const actions = {
    currentStep: () => 1,
    goToStep: async () => {},
    findMoment: async () => [],
    playClip: async () => {},
    askCook: async () => {},
    giveHint: async () => {},
    setTimer: async () => {},
    say: async () => {},
  };
  const origLog = console.log;
  console.log = () => {};
  try {
    await new TurnAgent(session, actions, client).turn("what's next");
  } finally {
    console.log = origLog;
  }
  assert.match(system, /Shreya is cooking Dad's "Varan Bhaat"/);
  assert.match(system, /Dad's own clip comes first/);
  // The rule lets homie say the family's own word.
  assert.match(system, /unless that word is part of "Dad"/);
  const rule = system.slice(system.indexOf("Never guess"), system.indexOf("\n", system.indexOf("Never guess")));
  assert.doesNotMatch(system.replace(rule, "").replaceAll("Dad", ""), /\b(she|her|herself|he|his|mom|grandma|son|daughter)\b/i);
});

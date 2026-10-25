// One homie "should I speak?" decision with a picture, against real Claude: for checking the guidance prompt
// and comparing models. Prints the decision and the call's tokens (homie.ts logs them).
//   npx tsx scripts/try-decide.ts [photo.jpg] "what she said" ["what she said next" ...]
//   HOMIE_DECIDE_MODEL=claude-haiku-5-5 npx tsx scripts/try-decide.ts ...
import { readFileSync } from "node:fs";
import { HomieAgent } from "../src/homie.js";

const [photo, ...said] = process.argv.slice(2);
const agent = new HomieAgent({ language: "en", call: "Rajani Aaji", kid: "Shreya", dish: "Dal Tadka" });
const d = await agent.decide({
  heard: said.map((text, i) => ({ atS: 150 + i * 20, text })),
  asked: [],
  nowS: 200,
  mayAsk: true,
  mayReact: false,
  frame: photo && photo !== "-" ? readFileSync(photo) : undefined,
});
console.log(JSON.stringify(d));

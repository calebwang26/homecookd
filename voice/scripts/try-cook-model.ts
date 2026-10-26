// Cook mode's turn agent (agent.ts) against real Claude, scripted: for each line in fixtures/cook-eval.json (a Marathi
// grandma's Poha and an English uncle's Swordfish), a fresh agent hears it on its step, with the moments Moss would
// find, and the first thing it does is checked against the picks that are right. Lines it says (say, give_hint) are
// checked for a family role or he/she it wasn't given. Prints a score, the misses and the cost.
//   npx tsx scripts/try-cook-model.ts                      COOK_MODEL (default Sonnet), 3 runs of each line
//   COOK_MODEL=claude-opus-5-5 RUNS=1 npx tsx scripts/try-cook-model.ts
import { readFileSync } from "node:fs";
import type { Actions } from "../src/agent.js";
import type { CookSession } from "../src/convex.js";
import type { Hit } from "../src/moss.js";
import { env } from "../src/env.js";
import { guessesFamily } from "../src/family.js";
import { TurnAgent, cookCall } from "../src/agent.js";

type Case = { said: string; step: number; hits: number[]; ok: string[] };
const fixture = JSON.parse(readFileSync(new URL("../fixtures/cook-eval.json", import.meta.url), "utf8")) as {
  sessions: Record<string, CookSession>;
  cases: Record<string, Case[]>;
};
const RUNS = Number(process.env.RUNS) || 3;

/** Moss's answer for a case: the listed steps as moments, best first. */
const hitsOf = (s: CookSession, orders: number[]): Hit[] =>
  orders.map((o, i) => {
    const st = s.recipe.steps.find((x) => x.order === o)!;
    return { text: `${st.title}. ${st.text}`, quote: st.quote ?? "", kind: "step", startS: st.moment.startS, endS: st.moment.endS, stepOrder: o, score: 0.8 - i * 0.1 };
  });

// agent.ts logs each call ("claude cook <model> <ms>ms ... ~$0.00123"): keep the time and cost, print nothing else.
const print = console.log;
const times: number[] = [];
let usd = 0;
console.log = (...a: unknown[]) => {
  const m = /^claude cook \S+ (\d+)ms .*~\$([\d.]+)/.exec(a.join(" "));
  if (m) times.push(Number(m[1])), (usd += Number(m[2]));
};

/** What the agent did first, as "tool" or "tool:detail", and anything it said. */
async function once(s: CookSession, c: Case): Promise<{ did: string; words: string[] }> {
  let did = "none";
  const words: string[] = [];
  let step = c.step;
  const mark = (x: string) => {
    if (did === "none") did = x;
  };
  const clipStep = (startS: number) => s.recipe.steps.find((st) => Math.abs(st.moment.startS - startS) < 1)?.order;
  const actions: Actions = {
    currentStep: () => step,
    goToStep: async (n, repeat) => {
      mark(repeat ? "repeat_step" : n === c.step + 1 ? "next_step" : n === c.step - 1 ? "previous_step" : `go_to_step:${n}`);
      step = n;
    },
    findMoment: async () => hitsOf(s, c.hits),
    playClip: async (startS) => mark(`play_clip:${clipStep(startS) ?? "?"}`),
    askCook: async () => mark("ask_cook"),
    giveHint: async (hint) => (words.push(hint), mark("give_hint")),
    setTimer: async (seconds) => mark(`set_timer:${seconds}`),
    say: async (text) => (words.push(text), mark("say")),
  };
  await new TurnAgent(s, actions).turn(c.said);
  return { did, words };
}

let right = 0;
let total = 0;
const misses: string[] = [];
for (const [lang, cases] of Object.entries(fixture.cases)) {
  const s = fixture.sessions[lang];
  for (const c of cases) {
    const runs = await Promise.all(Array.from({ length: RUNS }, () => once(s, c)));
    for (const r of runs) {
      total++;
      const roleSlip = r.words.find((w) => guessesFamily(w, { names: [cookCall(s), s.kid.name] }));
      if (c.ok.includes(r.did) && !roleSlip) right++;
      else misses.push(`${lang} step ${c.step} "${c.said}" → ${r.did}${roleSlip ? ` (role/gender: "${roleSlip}")` : ""} [ok: ${c.ok.join(", ")}]`);
    }
    print(`${lang} ${c.said.padEnd(56)} ${runs.map((r) => r.did + (r.words.length ? ` "${r.words.join(" / ")}"` : "")).join(" | ")}`);
  }
}
times.sort((a, b) => a - b);
print(`\n${env.cookModel}: ${right}/${total} right; median ${times[Math.floor(times.length / 2)]} ms, p90 ${times[Math.floor(times.length * 0.9)]} ms; $${usd.toFixed(4)} in all, $${(usd / total).toFixed(5)} a turn (${times.length} calls)`);
for (const m of misses) print(`MISS ${m}`);

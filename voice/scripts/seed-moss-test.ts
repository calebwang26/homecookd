// Seeds the Moss test index family-voice-test (the stub family) from Grandma's red-braised pork:
// each step's quote, each story and each "special" tip, with its moment. Same doc shape Convex will
// write for real families (see src/moss.ts).   npm run seed-moss
import { readFileSync } from "node:fs";
import { MossClient } from "@moss-js/moss";
import { env } from "../src/env.js";

const r = JSON.parse(readFileSync(new URL("../../data/synthetic/grandma-red-braised-pork.json", import.meta.url), "utf8"));
const recipeId = r.id as string;
const meta = (kind: string, startS: number, endS: number, stepOrder?: number) => ({
  recipeId, kind, startS: String(startS), endS: String(endS), ...(stepOrder ? { stepOrder: String(stepOrder) } : {}),
});
const docs = [
  ...r.steps.map((s: any) => ({ id: `${recipeId}-step-${s.order}`, text: `${s.quote} (${s.sensory_cue})`, metadata: meta("step", s.start_s, s.end_s, s.order) })),
  ...r.stories.map((s: any) => ({ id: `${recipeId}-${s.id}`, text: s.text, metadata: meta("story", s.start_s, s.end_s, s.step) })),
  ...r.special.map((s: any) => ({ id: `${recipeId}-${s.id}`, text: `${s.text}. ${s.why}`, metadata: meta("tip", s.start_s, s.end_s, s.step) })),
];

const moss = new MossClient(env.mossProjectId, env.mossProjectKey);
const name = "family-voice-test";
const existing = await moss.listIndexes();
if (existing.some((i) => i.name === name)) await moss.addDocs(name, docs, { upsert: true });
else await moss.createIndex(name, docs);
console.log(`${name}: ${docs.length} docs written`);
await moss.loadIndex(name);
const res = await moss.query(name, "how do I know when the sugar is ready", { topK: 2 });
for (const d of res.docs) console.log(`  ${d.score.toFixed(2)} ${d.metadata?.startS}-${d.metadata?.endS}s  ${d.text.slice(0, 80)}`);
await moss.close();

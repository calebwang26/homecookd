// The per-call Claude cost line (claudeCost.ts): what homie's Claude calls cost, next to the pipeline's.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

const { claudeCost, logClaude } = await import("../src/claudeCost.js");

test("cost per call: input, cache reads at 0.1x, cache writes at 1.25x, output; an unknown model is priced as Opus", () => {
  const u = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0 };
  assert.equal(claudeCost("claude-haiku-5-5", u), 0.1 + 0.01 + 0.05);
  assert.equal(claudeCost("claude-opus-5-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }), 5);
  assert.equal(claudeCost("claude-future-9", { input_tokens: 1_000_000, output_tokens: 0 }), 4);
});

test("one line per call, starting \"claude \", with the model that answered", () => {
  const lines: string[] = [];
  mock.method(console, "log", (...a: unknown[]) => void lines.push(a.join(" ")));
  logClaude("homie", { model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 3000 } }, 812);
  mock.restoreAll();
  assert.deepEqual(lines, ["claude homie claude-sonnet-5-5 812ms stop=end_turn in=1200 cached=3000 out=80 ~$0.00380"]);
});

// One log line per Claude call, with what it cost, so homie's Claude spend shows next to the pipeline's
// (Cloud Run logs: lines starting "claude "). Prices: USD per 1M tokens (input, output), the claude-api skill's
// table (Oct 2026); cache reads cost 0.1x input and cache writes 1.25x. A model not listed is priced as Opus.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
};

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

/** The estimated cost in USD of one call's usage on `model`. */
export function claudeCost(model: string, u: Usage): number {
  const [input, output] = PRICES[model] ?? PRICES["claude-opus-5-5"];
  const read = u.cache_read_input_tokens ?? 0;
  const write = u.cache_creation_input_tokens ?? 0;
  return (u.input_tokens * input + read * input * 0.1 + write * input * 1.25 + u.output_tokens * output) / 1e6;
}

/** Logs one call: what it was for, the model that answered (a fallback's included), tokens, stop and cost. Never
 *  throws: a reply without usage (a test's fake) logs nothing. */
export function logClaude(what: string, res: { model?: string; stop_reason?: string | null; usage?: Usage }, ms?: number) {
  const u = res?.usage;
  if (!u || !res.model) return;
  const cached = (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  console.log(
    `claude ${what} ${res.model}${ms === undefined ? "" : ` ${ms}ms`} stop=${res.stop_reason} in=${u.input_tokens}` +
      `${cached ? ` cached=${cached}` : ""} out=${u.output_tokens} ~$${claudeCost(res.model, u).toFixed(5)}`,
  );
}

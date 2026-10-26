// Which model Convex's small text calls use (translate.ts, yesNo.ts). Gemini credits are nearly gone (Oct 24),
// so these move to Claude; TEXT_PROVIDER=claude turns that on, and unsetting it is the rollback to Gemini.
import Anthropic from "@anthropic-ai/sdk";

/** The yes/no read: Haiku got all of a hard set right (Oct 25). */
export const CLAUDE_MODEL = "claude-haiku-5-5";
/** Translations: on real Marathi lines Haiku wrote "half the rice" for "first wash the rice" every time and Sonnet
 *  garbled "jast tel nako"; Opus at medium effort got 12 of 12, at low 9 of 12 (Oct 25). About $0.003 a call. */
export const TRANSLATE_MODEL = "claude-opus-5-5";

export type TextModel = { provider: "gemini" | "claude"; apiKey: string };

function provider(): TextModel["provider"] {
  return process.env.TEXT_PROVIDER?.trim().toLowerCase() === "claude" ? "claude" : "gemini";
}

/** The env var the chosen provider needs, for "isn't set" warnings. */
export function textKeyName(): string {
  return provider() === "claude" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
}

/** The provider and its key, or null when that key isn't set. */
export function textModel(): TextModel | null {
  const apiKey = process.env[textKeyName()];
  return apiKey ? { provider: provider(), apiKey } : null;
}

/** One short Claude call held to `schema`: the reply's JSON text, or throws (a refusal or a cut-off reply
 *  included). Opus and Sonnet pass a refused request on to Anthropic's recommended fallback model. */
export async function claudeJson(
  apiKey: string,
  model: string,
  effort: "low" | "medium",
  system: string,
  text: string,
  schema: Record<string, unknown>,
): Promise<string> {
  const fallback =
    model === CLAUDE_MODEL ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  const res = await new Anthropic({ apiKey, maxRetries: 1 }).beta.messages.create({
    model,
    max_tokens: 4096,
    system,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: text }],
    ...fallback,
  });
  if (res.stop_reason !== "end_turn") throw new Error(`Claude stopped: ${res.stop_reason}`);
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

// Which model Convex's small text calls use (translate.ts, yesNo.ts). Gemini credits are nearly gone (Oct 24),
// so these move to Claude; TEXT_PROVIDER=claude turns that on, and unsetting it is the rollback to Gemini.
import Anthropic from "@anthropic-ai/sdk";

/** The yes/no read: Haiku got all of a hard set right (Oct 25). */
export const CLAUDE_MODEL = "claude-haiku-5-5";
/** Translations: on real Marathi lines Haiku wrote "half the rice" for "first wash the rice" every time and Sonnet
 *  garbled "jast tel nako"; Opus at medium effort got 12 of 12, at low 9 of 12 (Oct 25). About $0.003 a call. */
export const TRANSLATE_MODEL = "claude-opus-5-5";

/** The Community story card and the finished-dish photo note, instead of Muse Spark with WRITER_PROVIDER=claude.
 *  Side by side on Poha and Swordfish (Oct 26): Haiku still called the cook "his" and named the apple roses
 *  "zucchini"; Sonnet kept to the words, the names and the photo. About $0.002 a card or note. */
export const WRITER_MODEL = "claude-sonnet-5-5";

/** WRITER_PROVIDER=claude: the story card and the photo note on Claude (ANTHROPIC_API_KEY); else Muse Spark. */
export const writerOnClaude = () => process.env.WRITER_PROVIDER?.trim().toLowerCase() === "claude";

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
  return await claudeText(apiKey, model, effort, system, text, schema);
}

/** One short Claude call: the reply's text (JSON when `schema` is given), or throws (a refusal or a cut-off reply
 *  included). `content` may hold images, e.g. a photo by its URL. */
export async function claudeText(
  apiKey: string,
  model: string,
  effort: "low" | "medium",
  system: string,
  content: string | Anthropic.Beta.BetaContentBlockParam[],
  schema?: Record<string, unknown>,
): Promise<string> {
  const fallback =
    model === CLAUDE_MODEL ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
  const res = await new Anthropic({ apiKey, maxRetries: 1 }).beta.messages.create({
    model,
    max_tokens: 4096,
    system,
    output_config: { effort, ...(schema ? { format: { type: "json_schema" as const, schema } } : {}) },
    messages: [{ role: "user", content }],
    ...fallback,
  });
  if (res.stop_reason !== "end_turn") throw new Error(`Claude stopped: ${res.stop_reason}`);
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

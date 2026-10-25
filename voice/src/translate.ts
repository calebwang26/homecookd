// After the cook's clip plays, the kid hears a short English version of what the cook said in it,
// labeled as a translation. Claude sees only the cook's own words here, so nothing else can creep in.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";

const client = new Anthropic({ apiKey: env.anthropicKey });

// Who the cook is to the kid isn't known (a parent, a grandparent, an aunt), so the prompt names neither (Oct 24).
const SYSTEM = `You translate what a home cook said in a clip of their cooking video into short, natural English for someone in their family.
Rules:
- Use only the cook's words below. Add nothing: no advice, no explanation, no amounts or times the cook didn't say.
- The cook may speak their own language (Marathi, Tamil, Mandarin, Spanish, any), English or a mix. If it's already English,
  keep the cook's words and only drop filler.
- At most 30 words. Keep the cook's voice ("you", "I").
- Reply with the translation only, no quotes or labels. If there's nothing to translate, reply with nothing.`;

/** The cook's words in short English, or "" when there's nothing usable. */
export async function translateQuote(quote: string): Promise<string> {
  const res = await client.messages.create({
    model: env.claudeModel,
    max_tokens: 1024,
    system: SYSTEM,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: quote }],
  });
  if (res.stop_reason === "refusal") return "";
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return text.replace(/^["“]|["”]$/g, "");
}

// After the cook's clip plays, the kid hears a short English version of what she said in it,
// labeled as a translation. Claude sees only her own words here, so nothing else can creep in.
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";

const client = new Anthropic({ apiKey: env.anthropicKey });

const SYSTEM = `You translate what a home cook said in a clip of her cooking video into short, natural English for her grandchild.
Rules:
- Use only her words below. Add nothing: no advice, no explanation, no amounts or times she didn't say.
- She may speak her own language (Marathi, Tamil, Mandarin, Spanish, any), English or a mix. If it's already English,
  keep her words and only drop filler.
- At most 30 words. Keep her voice ("you", "I").
- Reply with the translation only, no quotes or labels. If there's nothing to translate, reply with nothing.`;

/** Her words in short English, or "" when there's nothing usable. */
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

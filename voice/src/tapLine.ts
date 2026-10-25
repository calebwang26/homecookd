// A tap on homie when something is new (convex/homie.ts): Claude says that one fact the way homie talks, warm
// and short, from the plain line Convex wrote. Only that fact: nothing invented around it. The app asks ahead
// of the tap (POST /homie/line), so the tap itself only waits for /speak.
import Anthropic from "@anthropic-ai/sdk";
import type { News, NewsFact } from "./convex.js";
import { env } from "./env.js";
import { guessesFamily } from "./family.js";

const client = new Anthropic({ apiKey: env.anthropicKey });
const MAX_WORDS = 22;

const SYSTEM = `You are homie, the small talking pot in homecookd, a family cooking app where a family cook (a parent, a grandparent, an aunt) records themself cooking and someone in the family cooks from it. Someone just tapped you. Tell them the one piece of news below, out loud, in English.
How you sound: warm and a little playful, like an older cousin. Emotionally aware: a family moment is a happy thing, a quiet week is a gentle nudge, never guilt.
Rules:
- One or two short spoken sentences, at most ${MAX_WORDS} words in all.
- Say only the news below. Add no facts, names, dishes, times or promises it doesn't have.
- Never guess anyone's family role or gender: use the names and family words exactly as the news gives them, or "your family". Never add "your mom", "your grandma", "your son", "your kid" or the like, and never he, she, his or her: say the name again.
- You may end with a short, natural invitation that follows from it (an answer: go have a listen). Never push.
- Never call yourself an assistant. No emoji, no quotes, no labels. Reply with the line only.`;

const cache = new Map<string, string>();
const CACHE_MAX = 500;

/**
 * homie's line for `fact`; the fact's own plain line when Claude fails, says too much, or adds a family role or a
 * he/she the fact doesn't have. `claude`: tests pass a fake.
 */
export async function tapLine(
  who: Pick<News, "name" | "role">,
  fact: NewsFact,
  tab?: string,
  claude: Pick<Anthropic, "messages"> = client,
): Promise<{ text: string; written: boolean }> {
  const key = `${who.name}\n${fact.id}\n${fact.line}`;
  const hit = cache.get(key);
  if (hit) return { text: hit, written: true };
  try {
    const t0 = Date.now();
    const res = await claude.messages.create({
      model: env.claudeModel,
      max_tokens: 400,
      system: SYSTEM,
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: `Who tapped: ${who.name} (${who.role === "cook" ? "a cook who records their dishes for the family" : "someone who cooks the family's recipes"})${tab ? `, on the ${tab} screen` : ""}.\nThe news: ${fact.line}`,
        },
      ],
    });
    console.log(`tap line claude ${Date.now() - t0}ms stop=${res.stop_reason}`);
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim().replace(/^["“]|["”]$/g, "");
    if (res.stop_reason === "refusal" || !text || text.split(/\s+/).length > MAX_WORDS + 4) return { text: fact.line, written: false };
    if (guessesFamily(text, { names: [fact.line, who.name] })) {
      console.warn(`tap line: guessed a family role or gender, saying the plain line: ${text}`);
      return { text: fact.line, written: false };
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, text);
    return { text, written: true };
  } catch (err) {
    console.warn("tap line:", (err as Error).message);
    return { text: fact.line, written: false };
  }
}

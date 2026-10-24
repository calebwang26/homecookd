// homie's judgment while a cook records (/record): the hello, whether to ask something right now, the
// last questions, and plain translation. When homie may ask at all is code, not the model (pacing.ts).
// Claude writes every line in the cook's language plus English, as JSON (structured outputs).
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";

export type AskKind = "amount" | "cue" | "substitution" | "story";
export type Line = { text: string; textEn: string };
/** Who homie is talking to. `call` is how homie addresses her ("Rajani Aaji"). */
export type Who = { language: string; call: string; kid?: string; dish?: string };
/** One finished turn of what the cook said, `atS` seconds into the recording. */
export type Heard = { atS: number; text: string };
export type Decision =
  | { action: "ask"; kind: AskKind; line: Line }
  | { action: "react"; line: Line }
  | { action: "quiet"; storyInProgress: boolean };

// The language's name in Claude's prompts. Intl names most codes; these say which variety homie speaks.
const NAMES: Record<string, string> = { zh: "Mandarin Chinese", tl: "Tagalog", pt: "Brazilian Portuguese", es: "Latin American Spanish" };
const DISPLAY = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
export const languageName = (code: string) => NAMES[code] ?? ((/^[a-z]{2,3}$/.test(code) && DISPLAY.of(code)) || code);

/**
 * homie's voice is a young woman's, and the cook is an elder: for the lines Claude writes and homie's fixed lines
 * (translate(…, "homie")).
 * Oct 24: Claude's Punjabi, Urdu and Portuguese spoke of homie as a man without it.
 */
const SPEAKS_AS = `homie's voice is a young woman's: in a language that marks gender (in verbs, adjectives or articles, like Marathi, Hindi, Gujarati, Punjabi, Urdu, Arabic, Spanish or Portuguese), homie speaks of herself in the feminine. Speak to her the way a respectful younger relative speaks to an elder in her language (its polite forms, like आप, usted, você or 요 endings). Chinese is written in simplified characters.`;

const client = new Anthropic({ apiKey: env.anthropicKey });

const str = { type: "string" };
const obj = (properties: Record<string, object>): Record<string, unknown> => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const KINDS = ["amount", "cue", "substitution", "story"];

/** One Claude call that must come back as JSON in `schema`. Null on refusal or bad JSON. */
async function json<T>(system: string, content: Anthropic.Beta.BetaContentBlockParam[] | string, schema: Record<string, unknown>): Promise<T | null> {
  const t0 = Date.now();
  const res = await client.beta.messages.create({
    model: env.claudeModel,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  console.log(`homie claude ${Date.now() - t0}ms stop=${res.stop_reason}`);
  if (res.stop_reason === "refusal") return null;
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function about(w: Who): string {
  const lang = languageName(w.language);
  const kid = w.kid ?? "her family";
  // How homie sounds (Caleb, Oct 24: "like your cousin translated between the kid and the mom").
  return `You are homie, the warm helper in homecookd, a family app. ${w.call} is cooking${w.dish ? ` ${w.dish}` : ""} while her phone films her, so ${kid} (a homesick college student far from home) can cook it later from her video. She speaks ${lang}. Everything you say is spoken aloud to her by a voice, in ${lang}; address her as "${w.call}" (her family's word for her), warmly and respectfully, never like a customer.
How homie sounds: warm, comfortable and a little playful, like a caring older cousin who passes words between the family. Short sentences, said the way people talk, with end punctuation. A comma after her name. At most one soft lead-in before a question (like "Quick one..."). Never robotic, never assistant-speak ("I'm your assistant", "How can I help"). ${SPEAKS_AS}`;
}

const LINE_RULES = `"text" is the line in her language, written the way it should be spoken (her script, no emoji, no brand names other than homie in lowercase). "text_en" is the same line in English, with people's names in Latin letters (Rajani Aaji, Shreya), never in her script.`;

const fmt = (t: number) => `${t < 0 ? "-" : ""}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, "0")}`;
const transcriptOf = (heard: Heard[]) => heard.slice(-40).map((h) => `[${fmt(h.atS)}] ${h.text}`).join("\n") || "(nothing yet)";

export class HomieAgent {
  constructor(private who: Who) {}

  /** The names may arrive in her script after the agent is made. */
  setWho(who: Who) {
    this.who = who;
  }

  /**
   * The hello before filming starts. `metBefore`: homie has recorded with her before, so a short welcome
   * back that never introduces homie again (Caleb, Oct 24). Null when the model fails (the caller has a
   * written one).
   */
  async intro(metBefore = false): Promise<Line | null> {
    const w = this.who;
    const system = metBefore
      ? `${about(w)}

Write homie's hello, said before she starts cooking. homie has cooked with her before, so this is a short welcome back, not an introduction. Rules:
- Short: at most 20 words, 2 or 3 short sentences. Warm, family first.
- Greet her by "${w.call}", glad to be with her again. Mention ${w.kid ?? "her family"}${w.dish ? ` and the ${w.dish}` : ""} so she knows who this is for.
- Never introduce homie or say homie's name. Don't explain the questions or the phone again.
- End by telling her to start whenever she's ready.
- No instructions about cooking, no praise of her technique.
${LINE_RULES}`
      : `${about(w)}

Write homie's hello, said once before she starts cooking. Rules:
- Short: at most 40 words, 3 or 4 short sentences. Warm, unhurried, family first.
- Greet her by "${w.call}". Mention ${w.kid ?? "her family"}${w.dish ? ` and the ${w.dish}` : ""} so she knows who this is for.
- Gently admit that being filmed while cooking can feel a little strange.
- Say homie may ask a small question now and then, and it's completely fine to ignore homie.
- Ask her to set the phone near the stove, and to start whenever she's ready.
- No instructions about cooking, no praise of her technique.
${LINE_RULES}`;
    const out = await json<{ text: string; text_en: string }>(system, "Write the hello.", obj({ text: str, text_en: str }));
    return out?.text ? { text: out.text, textEn: out.text_en } : null;
  }

  /** Called only when the pacing allows it and she's been quiet ~3 s. */
  async decide(input: { heard: Heard[]; asked: string[]; nowS: number; mayAsk: boolean; mayReact: boolean; frame?: Buffer }): Promise<Decision> {
    const w = this.who;
    const system = `${about(w)}

You hear a rolling transcript of what she says (in ${languageName(w.language)}, with transcription mistakes). Sometimes a photo from her glasses shows the stove. Decide what homie does right now: ask one short question, react, or stay quiet. Staying quiet is the usual answer.

Ask only something that will help ${w.kid ?? "her family"} cook this later, in this order of priority:
1. amount: she just used or said a vague amount ("a little", "andaz", "until it looks right", a handful) → ask how much, in a kitchen measure a student can follow.
2. cue: how she knows a stage is done ("how do you know it's ready?").
3. substitution: what to use in a small college kitchen if an ingredient or tool isn't there.
4. story: during a wait (simmering, resting), invite a memory about this dish.
Never correct her technique. Never judge, grade, praise her skill or give advice. Never repeat or rephrase a question already asked.
If she seems to be in the middle of telling a story or explaining something, stay quiet and set story_in_progress true.
React only when she has just finished telling a story or memory: one very short warm line (at most 8 words, like "Oh, I love that."). A reaction is not a question.
${input.mayAsk ? "" : "You may NOT ask a question right now: only react or stay quiet.\n"}${input.mayReact ? "" : "You may NOT react right now.\n"}A question is at most 18 words, gentle, one thing only. ${LINE_RULES}
For "quiet", leave text and text_en empty and kind "none".`;
    const already = input.asked.length ? input.asked.map((q) => `- ${q}`).join("\n") : "(none)";
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.frame) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.frame.toString("base64") } });
    content.push({
      type: "text",
      text: `Now: ${fmt(input.nowS)} into filming.\nAlready asked:\n${already}\n\nWhat she said:\n${transcriptOf(input.heard)}`,
    });
    const out = await json<{ action: string; kind: string; text: string; text_en: string; story_in_progress: boolean }>(
      system,
      content,
      obj({
        action: { type: "string", enum: ["ask", "react", "quiet"] },
        kind: { type: "string", enum: [...KINDS, "none"] },
        text: str,
        text_en: str,
        story_in_progress: { type: "boolean" },
      }),
    );
    if (!out || !out.text) return { action: "quiet", storyInProgress: !!out?.story_in_progress };
    const line = { text: out.text, textEn: out.text_en };
    if (out.action === "ask" && input.mayAsk && KINDS.includes(out.kind)) return { action: "ask", kind: out.kind as AskKind, line };
    if (out.action === "react" && input.mayReact) return { action: "react", line };
    return { action: "quiet", storyInProgress: out.story_in_progress };
  }

  /** Up to `max` last questions after "I'm done", about what she didn't explain. */
  async endQuestions(heard: Heard[], asked: string[], max: number): Promise<{ kind: AskKind; line: Line }[]> {
    if (max <= 0) return [];
    const system = `${about(this.who)}

She just said she's done cooking. Pick at most ${max} last short questions that would help ${this.who.kid ?? "her family"} most when cooking this alone: an amount she left vague, how she knew something was ready, a substitution for a small college kitchen, or a story about the dish. Only things she didn't already explain, and nothing already asked. Fewer is fine; none is fine.
Each question is at most 18 words, gentle, one thing only, with no lead-in of its own (homie leads in with "Before you go..." itself). Never correct, judge or grade. ${LINE_RULES}`;
    const out = await json<{ questions: { kind: string; text: string; text_en: string }[] }>(
      system,
      `Already asked:\n${asked.map((q) => `- ${q}`).join("\n") || "(none)"}\n\nWhat she said:\n${transcriptOf(heard)}`,
      obj({ questions: { type: "array", items: obj({ kind: { type: "string", enum: KINDS }, text: str, text_en: str }) } }),
    );
    return (out?.questions ?? [])
      .filter((q) => q.text && KINDS.includes(q.kind))
      .slice(0, max)
      .map((q) => ({ kind: q.kind as AskKind, line: { text: q.text, textEn: q.text_en } }));
  }

  /** Is this answer a yes (true), a no (false) or neither (null)? */
  async yesNo(answer: string): Promise<boolean | null> {
    const quick = yesNoWords(answer);
    if (quick !== null) return quick;
    const out = await json<{ answer: string }>(
      `homie asked a cook "Can your family hear your stories too?". Classify her reply (any language) as yes, no or unclear.`,
      answer,
      obj({ answer: { type: "string", enum: ["yes", "no", "unclear"] } }),
    );
    return out?.answer === "yes" ? true : out?.answer === "no" ? false : null;
  }
}

const cache = new Map<string, string>();

/** Strict translation: only `text`, into `to` (an Ink code). Empty when there's nothing to say. */
/** `as: "homie"` for homie's own lines (her gender and manners); the default for anyone's words, like a kid's question. */
export async function translate(text: string, to: string, as: "homie" | "anyone" = "anyone"): Promise<string> {
  const key = `${to}\n${as}\n${text}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const out = await json<{ translation: string }>(
    `Translate the user's text into natural spoken ${languageName(to)}, as it will be read aloud by a voice to a family member. Translate only: add nothing, drop nothing, no explanations. Keep names as they are, written in ${languageName(to)}'s usual script. Keep "homie" as is, lowercase.${as === "homie" && to !== "en" ? ` ${SPEAKS_AS}` : ""}`,
    text,
    obj({ translation: str }),
  );
  const result = out?.translation?.trim() ?? "";
  if (result) cache.set(key, result);
  return result;
}

const tokens = (t: string) => t.toLowerCase().split(/[\s,.!?।"'“”。，！？،؟]+/u).filter(Boolean);
// English and Marathi/Hindi, then (Oct 24) a few plain words in each language a cook can pick; anything else, or a
// sentence without spaces (Chinese), goes to Claude.
const YES = new Set([
  "yes", "yeah", "yep", "sure", "ok", "okay", "course", "हो", "होय", "हां", "हा", "चालेल", "नक्की", "हाँ",
  "હા", "હાં", "ஆமா", "ஆமாம்", "சரி", "అవును", "సరే", "ਹਾਂ", "ਹਾਂਜੀ", "ہاں", "好", "好的", "可以", "行", "네", "응", "좋아요",
  "sí", "si", "claro", "sim", "pode", "oo", "opo", "sige", "نعم", "أيوه", "ايوه", "أكيد",
]);
const NO = new Set([
  "no", "nope", "don't", "dont", "नाही", "नको", "नहीं",
  "ના", "નહીં", "இல்ல", "இல்லை", "வேண்டாம்", "లేదు", "వద్దు", "ਨਹੀਂ", "نہیں", "不", "不要", "不用", "不行", "아니", "아니요", "아뇨",
  "não", "hindi", "ayaw", "لا", "لأ",
]);

/** A quick yes/no from the words alone; null when it isn't clear (Claude decides then). */
export function yesNoWords(text: string): boolean | null {
  const words = tokens(text);
  const yes = words.some((w) => YES.has(w));
  const no = words.some((w) => NO.has(w));
  return yes === no ? null : yes;
}

const NOT_NOW = [
  /\bnot now\b/, /\blater\b/, /\bnot right now\b/, /\bstop asking\b/, /\bi'?m busy\b/,
  /आत्ता नाही/, /आता नाही/, /आत्ता नको/, /आता नको/, /नंतर/, /थांब/, // Marathi
  /अभी नहीं/, /बाद में/, /હમણાં નહીં/, /પછી/, /அப்புறம்/, /இப்ப(ோ)? வேண்டாம்/, /తర్వాత/, /ఇప్పుడు వద్దు/, /ਹੁਣ ਨਹੀਂ/, /ਬਾਅਦ ਵਿੱਚ/,
  /ابھی نہیں/, /بعد میں/, /等一下/, /以后再说/, /现在不/, /待会/, /나중에/, /지금은 안/, /\bahora no\b/, /\bmás tarde\b/, /\bdespués\b/,
  /\bagora não/, /\bmais tarde\b/, /\bdepois\b/, /\bmamaya\b/, /\bhindi muna\b/, /ليس الآن/, /مش دلوقتي/, /بعدين/, /لاحقا/,
];

/** "Not now" in English or her language. Only a short turn counts, so "नंतर" inside a sentence doesn't. */
export function isNotNow(text: string): boolean {
  const t = text.toLowerCase();
  return tokens(t).length <= 5 && NOT_NOW.some((re) => re.test(t));
}

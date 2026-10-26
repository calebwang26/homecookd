// homie's judgment while a cook records (/record): the hello, whether to ask something right now, the
// last questions, and plain translation. When homie may ask at all is code, not the model (pacing.ts).
// Claude writes every line in the cook's language plus English, as JSON (structured outputs).
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env.js";
import { guessesFamily } from "./family.js";
import { logClaude } from "./claudeCost.js";

export type AskKind = "amount" | "show" | "cue" | "substitution" | "story";
export type Line = { text: string; textEn: string };
/** Who homie is talking to. `call` is how homie addresses the cook ("Rajani Aaji"). `kid`: who it's for, when that's one person. */
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
 * homie's voice is a young woman's, and the cook is older: for the lines Claude writes and homie's fixed lines
 * (translate(…, "homie")). That's homie's own gender only. The cook's is never assumed (Oct 24: a cook can be a dad
 * or a grandpa), unless the family's word for them says it.
 * Oct 24: Claude's Punjabi, Urdu and Portuguese spoke of homie as a man without it.
 */
export const SPEAKS_AS = `homie's voice is a young woman's: in a language that marks gender (in verbs, adjectives or articles, like Marathi, Hindi, Gujarati, Punjabi, Urdu, Arabic, Spanish or Portuguese), homie speaks of herself in the feminine. That is homie's own gender only. Speak to the cook the way a respectful younger relative speaks to an older one in that language (its polite forms, like आप, तुम्ही, usted, você or 요 endings). Never assume the cook's gender: where even the polite forms mark it, choose wording that doesn't (Marathi's तुम्ही forms, "Empiece cuando quiera"), unless the family's word for the cook says it (like Aaji, Nani or Grandma; Ajoba, Nana or Dad). Chinese is written in simplified characters.`;

/**
 * The rule in every prompt that writes homie's words (Caleb, Oct 24: homie called every cook a mom, and the kid
 * "your son"). The app knows names and the family's word for the cook (people.relation, in `call`), never how the
 * kid is related to the cook, nor anyone's gender.
 */
export function neverGuess(w: Who): string {
  const kid = w.kid ? `"${w.kid}"` : `"your family" or "your loved ones"`;
  return `Never guess anyone's family role or gender: use the names given, or "your loved one" / "your family". Nobody told homie how ${w.kid ?? "the family"} is related to ${w.call}, so never say "your son", "your daughter", "your grandson", "your granddaughter", "your grandchild", "your kid" or "your child": say ${kid}. Call the cook only "${w.call}": never mom, mother, dad, grandma or grandpa unless that word is part of "${w.call}". In English, never he, she, his or her for ${w.call} or ${w.kid ?? "the family"}: use the name again.`;
}

const client = new Anthropic({ apiKey: env.anthropicKey });

const str = { type: "string" };
const obj = (properties: Record<string, object>): Record<string, unknown> => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const KINDS = ["amount", "show", "cue", "substitution", "story"];
/** The last questions come after filming stopped: nothing to show the camera then. */
const END_KINDS = KINDS.filter((k) => k !== "show");

/** One Claude call that must come back as JSON in `schema`. Null on refusal or bad JSON. */
async function json<T>(
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[] | string,
  schema: Record<string, unknown>,
  model = env.claudeModel,
  claude: Anthropic = client,
): Promise<T | null> {
  const t0 = Date.now();
  const res = await claude.beta.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  logClaude("homie", res, Date.now() - t0);
  if (res.stop_reason === "refusal") return null;
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Who it's for, in homie's instructions: the kid's name, else the family. */
const forWhom = (w: Who) => w.kid ?? "the family";

function about(w: Who): string {
  const lang = languageName(w.language);
  const kid = w.kid ? `${w.kid} (a homesick college student far from home)` : "the family (loved ones far from home)";
  // How homie sounds (Caleb, Oct 24: "like your cousin translated between the kid and the mom").
  return `You are homie, the warm helper in homecookd, a family app. ${w.call} is cooking${w.dish ? ` ${w.dish}` : ""} while a phone films the cooking, so ${kid} can cook it later from the video. ${w.call} speaks ${lang}. Everything you say is spoken aloud to the cook by a voice, in ${lang}; address the cook as "${w.call}" (the family's own word for them), warmly and respectfully, never like a customer.
How homie sounds: warm, comfortable and a little playful, like a caring older cousin who passes words between the family. Short sentences, said the way people talk, with end punctuation. A comma after the cook's name. At most one soft lead-in before a question (like "Quick one..."). Never robotic, never assistant-speak ("I'm your assistant", "How can I help"). ${SPEAKS_AS}
${neverGuess(w)}`;
}

const LINE_RULES = `"text" is the line in the cook's language, written the way it should be spoken (that language's script, no emoji, no brand names other than homie in lowercase). "text_en" is the same line in English, with people's names in Latin letters (Rajani Aaji, Shreya), never in another script.`;

/** homie's job while the cook films, for every prompt that writes a question. */
const GUIDANCE = (w: Who) => `homie gives GUIDANCE, never cooking advice. Guidance means helping the cook capture this recipe well on video, so ${forWhom(w)} can follow it later: asking how much went in, asking to show something to the camera, asking how the cook knows it's ready, inviting a story. homie never teaches, corrects or improves the cooking: never comment on technique, never suggest a change to the dish (an ingredient, an amount, the heat, a time, a tool), never warn, never say what to do. Never judge, grade or praise the cook's skill. ${w.call} is the expert; homie only asks.`;

const ADVICE = [
  /\byou (should|shouldn'?t|need to|have to|might want to|could try|may want to)\b/i,
  /\b(try|consider) (adding|using|cooking|lowering|raising|turning|reducing|stirring)\b/i,
  /\b(be careful|careful not|don'?t (forget|burn|overcook|let it))\b/i,
  /\bmake sure\b/i,
  /\b(too (much|little|hot|long|high|low)|not enough)\b/i,
  /\b(turn (the heat|it) (up|down)|lower the heat|add (a bit|some|more))\b/i,
];

/** A line (its English) that tells the cook how to cook instead of asking: homie never says it. */
export function soundsLikeAdvice(textEn: string): boolean {
  return ADVICE.some((re) => re.test(textEn));
}

/** "One more thing:", "Rajani Aaji, last question:", "Another quick one,", "And finally,": an opening that counts. */
const COUNTING_LEAD_IN =
  /^(?:[^,.?!:]{1,40},\s*)?(?:and\s+|just\s+)?(?:(?:one|two|three) (?:more|last)\b|last (?:quick )?(?:thing|question|one)\b|another (?:quick )?(?:thing|question|one)\b|finally\b|lastly\b)/i;

/**
 * An end question (its English) that opens by saying where it falls: homie has already told the cook how many
 * questions it has (record.ts, the count line), so this would contradict it.
 */
export function countsItself(textEn: string): boolean {
  return COUNTING_LEAD_IN.test(textEn.trim());
}

/** The cook's own words from the last few minutes may say a role homie can say back ("my son loves this"). */
const RECENT_S = 180;
const recent = (heard: Heard[], nowS: number) => heard.filter((h) => h.atS >= nowS - RECENT_S).map((h) => h.text);

/** A written question of this kind not asked yet (lines.ts scriptedOf), for when Claude's guessed a family role. */
export type Fallback = (kind: AskKind, asked: readonly string[], w: Who, latin: Who) => Promise<{ kind: AskKind; line: Line } | null>;

/** The hello's prompt. `metBefore`: a short welcome back. */
export function introPrompt(w: Who, metBefore: boolean): string {
  const mention = `Mention ${w.kid ?? `who it's for as "your family" or "your loved ones"`}${w.dish ? ` and the ${w.dish}` : ""}, so the cook knows who this is for.`;
  return metBefore
    ? `${about(w)}

Write homie's hello, said before the cook starts cooking. homie has recorded with ${w.call} before, so this is a short welcome back, not an introduction. Rules:
- Short: at most 20 words, 2 or 3 short sentences. Warm, family first.
- Greet the cook by "${w.call}", glad to be together again. ${mention}
- Never introduce homie or say homie's name. Don't explain the questions or the phone again.
- End by inviting the cook to start whenever ready.
- No instructions about cooking, no praise of the cook's technique.
${LINE_RULES}`
    : `${about(w)}

Write homie's hello, said once before the cook starts cooking. Rules:
- Short: at most 40 words, 3 or 4 short sentences. Warm, unhurried, family first.
- Greet the cook by "${w.call}". ${mention}
- Gently admit that being filmed while cooking can feel a little strange.
- Say homie may ask a small question now and then, and it's completely fine to ignore homie.
- Ask the cook to set the phone near the stove, and to start whenever ready.
- No instructions about cooking, no praise of the cook's technique.
${LINE_RULES}`;
}

/** The prompt for deciding, mid-filming, whether to ask, react or stay quiet. */
export function decidePrompt(w: Who, o: { frame: boolean; mayAsk: boolean; mayReact: boolean }): string {
  const kid = forWhom(w);
  return `${about(w)}

You hear a rolling transcript of what the cook says (in ${languageName(w.language)}, with transcription mistakes). ${o.frame ? "The photo is what the cook's camera sees right now." : "There is no photo right now."} Decide what homie does right now: ask one short question, react, or stay quiet. Staying quiet is the usual answer.

${GUIDANCE(w)}
Ask only one of these, in this order of priority:
1. amount: the cook just used or said a vague amount ("a little", "andaz", "until it looks right", a handful) → ask how much, in a kitchen measure a student can follow ("How much salt was that?").
2. show: ${kid} won't be able to see or tell apart something important in the photo: the pan is turned away, the spice or ingredient can't be read, the food is out of frame → ask the cook to show it to the camera ("Can you tilt the pan toward me?", "Hold up the spice so ${kid} knows which one."). Only with a photo, and only about what the photo shows or hides.
3. cue: how the cook knows a stage is done ("How do you know it's ready?").
4. substitution: what the cook would use in a small college kitchen if an ingredient or tool isn't there. Ask; never suggest one.
5. story: during a wait (simmering, resting), invite a memory about this dish.
Never repeat or rephrase a question already asked.
If the cook seems to be in the middle of telling a story or explaining something, stay quiet and set story_in_progress true.
React only when the cook has just finished telling a story or memory: one very short warm line (at most 8 words, like "Oh, I love that."). A reaction is not a question, and never comments on the cooking.
${o.mayAsk ? "" : "You may NOT ask a question right now: only react or stay quiet.\n"}${o.mayReact ? "" : "You may NOT react right now.\n"}A question is at most 18 words, gentle, one thing only. ${LINE_RULES}
For "quiet", leave text and text_en empty and kind "none".`;
}

/** The prompt for the last questions after "I'm done". */
export function endPrompt(w: Who, max: number): string {
  return `${about(w)}

The cook just said the cooking is done. Pick at most ${max} last short questions that would help ${forWhom(w)} most when cooking this alone: an amount left vague, how the cook knew something was ready, what the cook would use in a small college kitchen if an ingredient is missing (ask; never suggest one), or a story about the dish. Only things the cook didn't already explain, and nothing already asked. Fewer is fine; none is fine.
${GUIDANCE(w)}
Each question is at most 18 words, gentle, one thing only, with no lead-in of its own and no "one more", "another" or "last" (homie has already told the cook how many questions it has). ${LINE_RULES}`;
}

const fmt = (t: number) => `${t < 0 ? "-" : ""}${Math.floor(Math.abs(t) / 60)}:${String(Math.floor(Math.abs(t) % 60)).padStart(2, "0")}`;
const transcriptOf = (heard: Heard[]) => heard.slice(-40).map((h) => `[${fmt(h.atS)}] ${h.text}`).join("\n") || "(nothing yet)";

export class HomieAgent {
  /** The names as written in English, for guessesFamily (text_en has them in Latin letters). */
  private latin: Who;
  private client: Anthropic;
  private fallback?: Fallback;
  /** Claude's questions homie dropped, so Claude doesn't offer them again (they never reach `asked`). */
  private dropped: string[] = [];

  /** `client`: tests pass a fake. `fallback`: the written question for a dropped one (record.ts passes scriptedOf). */
  constructor(
    private who: Who,
    opts: { client?: Anthropic; fallback?: Fallback } = {},
  ) {
    this.latin = who;
    this.client = opts.client ?? client;
    this.fallback = opts.fallback;
  }

  /** The names may arrive in the cook's script after the agent is made. */
  setWho(who: Who) {
    this.who = who;
  }

  /** What homie was told (the names and the dish, in Latin letters), and the cook's recent words. */
  private given(heard: string[] = []) {
    const { call, kid, dish } = this.latin;
    return { names: [call, kid, dish], heard };
  }

  /** A question Claude wrote that homie can't say (`why`): the written one of its kind instead, or nothing. */
  private async instead(kind: AskKind, line: Line, asked: readonly string[], why = "guesses a family role or gender"): Promise<{ kind: AskKind; line: Line } | null> {
    console.warn(`homie: dropped a ${kind} question that ${why}: ${line.textEn}`);
    this.dropped.push(line.textEn);
    return (await this.fallback?.(kind, [...asked, ...this.dropped], this.who, this.latin).catch(() => null)) ?? null;
  }

  /**
   * The hello before filming starts. `metBefore`: homie has recorded with this cook before, so a short welcome
   * back that never introduces homie again (Caleb, Oct 24). Null when the model fails or guesses a family role
   * (the caller has a written one).
   */
  async intro(metBefore = false): Promise<Line | null> {
    const out = await json<{ text: string; text_en: string }>(introPrompt(this.who, metBefore), "Write the hello.", obj({ text: str, text_en: str }), env.claudeModel, this.client);
    if (!out?.text) return null;
    if (guessesFamily(out.text_en, this.given())) {
      console.warn(`homie: dropped a hello that guesses a family role or gender: ${out.text_en}`);
      return null;
    }
    return { text: out.text, textEn: out.text_en };
  }

  /** Called only when the pacing allows it and the cook has been quiet ~3 s. `frame`: what the phone (or glasses) sees. */
  async decide(input: { heard: Heard[]; asked: string[]; nowS: number; mayAsk: boolean; mayReact: boolean; frame?: Buffer }): Promise<Decision> {
    const system = decidePrompt(this.who, { frame: !!input.frame, mayAsk: input.mayAsk, mayReact: input.mayReact });
    const asked = [...input.asked, ...this.dropped];
    const already = asked.length ? asked.map((q) => `- ${q}`).join("\n") : "(none)";
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.frame) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: input.frame.toString("base64") } });
    content.push({
      type: "text",
      text: `Now: ${fmt(input.nowS)} into filming.\nAlready asked:\n${already}\n\nWhat the cook said:\n${transcriptOf(input.heard)}`,
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
      env.homieDecideModel,
      this.client,
    );
    if (!out || !out.text) return { action: "quiet", storyInProgress: !!out?.story_in_progress };
    const line = { text: out.text, textEn: out.text_en };
    if (soundsLikeAdvice(line.textEn)) {
      console.warn(`homie: dropped a line that reads as cooking advice: ${line.textEn}`);
      return { action: "quiet", storyInProgress: false };
    }
    const given = this.given(recent(input.heard, input.nowS));
    // A "show" needs a picture to be about.
    if (out.action === "ask" && input.mayAsk && KINDS.includes(out.kind) && (out.kind !== "show" || input.frame)) {
      const kind = out.kind as AskKind;
      // A role is checked; "she" mid-filming mostly echoes the cook ("she taught me"), so pronouns aren't.
      if (!guessesFamily(line.textEn, given, "roles")) return { action: "ask", kind, line };
      const written = await this.instead(kind, line, input.asked);
      return written ? { action: "ask", ...written } : { action: "quiet", storyInProgress: false };
    }
    if (out.action === "react" && input.mayReact) {
      // A reaction echoes the story just told ("your grandmother taught you?"), so only a guess about the kid counts.
      if (!guessesFamily(line.textEn, given, "kid")) return { action: "react", line };
      console.warn(`homie: dropped a reaction that guesses a family role: ${line.textEn}`);
      return { action: "quiet", storyInProgress: false };
    }
    return { action: "quiet", storyInProgress: out.story_in_progress };
  }

  /** Up to `max` last questions after "I'm done", about what the cook didn't explain. */
  async endQuestions(heard: Heard[], asked: string[], max: number): Promise<{ kind: AskKind; line: Line }[]> {
    if (max <= 0) return [];
    const out = await json<{ questions: { kind: string; text: string; text_en: string }[] }>(
      endPrompt(this.who, max),
      `Already asked:\n${asked.map((q) => `- ${q}`).join("\n") || "(none)"}\n\nWhat the cook said:\n${transcriptOf(heard)}`,
      obj({ questions: { type: "array", items: obj({ kind: { type: "string", enum: END_KINDS }, text: str, text_en: str }) } }),
      env.claudeModel,
      this.client,
    );
    const given = this.given(recent(heard, heard.at(-1)?.atS ?? 0));
    const picked: { kind: AskKind; line: Line }[] = [];
    for (const q of out?.questions ?? []) {
      if (picked.length >= max) break;
      if (!q.text || !END_KINDS.includes(q.kind) || soundsLikeAdvice(q.text_en)) continue;
      const kind = q.kind as AskKind;
      const line = { text: q.text, textEn: q.text_en };
      // A guess, or an opening that counts ("One more thing:"), gets the written question of its kind, so the end still
      // asks what Claude meant to.
      const why = guessesFamily(line.textEn, given) ? "guesses a family role or gender" : countsItself(line.textEn) ? "says where it falls" : "";
      const ok = why ? await this.instead(kind, line, [...asked, ...picked.map((p) => p.line.textEn)], why) : { kind, line };
      if (ok) picked.push(ok);
    }
    return picked;
  }

  /** Is this answer a yes (true), a no (false) or neither (null)? */
  async yesNo(answer: string): Promise<boolean | null> {
    const quick = yesNoWords(answer);
    if (quick !== null) return quick;
    const out = await json<{ answer: string }>(
      `homie asked a cook "Can your family hear your stories too?". Classify the cook's reply (any language) as yes, no or unclear.`,
      answer,
      obj({ answer: { type: "string", enum: ["yes", "no", "unclear"] } }),
      env.claudeModel,
      this.client,
    );
    return out?.answer === "yes" ? true : out?.answer === "no" ? false : null;
  }
}

const cache = new Map<string, string>();

/** Strict translation: only `text`, into `to` (an Ink code). Empty when there's nothing to say. */
/** `as: "homie"` for homie's own lines to the cook (homie's gender and manners); the default for anyone's words, like a kid's question. */
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

/** "Not now" in English or the cook's language. Only a short turn counts, so "नंतर" inside a sentence doesn't. */
export function isNotNow(text: string): boolean {
  const t = text.toLowerCase();
  return tokens(t).length <= 5 && NOT_NOW.some((re) => re.test(t));
}

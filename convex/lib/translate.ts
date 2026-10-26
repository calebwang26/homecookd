// Gemini (generateContent), or Claude with TEXT_PROVIDER=claude (lib/textModel.ts), between the cook's language
// and the kid's English: the cook's answer into English (shown labelled as a translation; her own words stay in
// the transcript), and the kid's question into the cook's language (questions.textForCook).
import { claudeJson, TRANSLATE_MODEL, type TextModel } from "./textModel";

const MODEL = "gemini-3.8-flash";
export const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const INSTRUCTIONS =
  "You translate a home cook's spoken answer, transcribed by speech-to-text, into plain English for their " +
  "grandchild. The transcript may have spelling slips; read it as speech. Keep the cook's meaning, amounts and " +
  "warmth; add nothing. If it is already English, return it unchanged. Reply with the translation only.";

/** "Marathi" for "mr"; the code itself when the runtime can't name it. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const forCook = (code: string) =>
  `You translate a question a grandchild asked while cooking their grandparent's recipe into ${languageName(code)} ` +
  `(language code "${code}"), in its usual script, for the grandparent to read. Use plain, warm, everyday words ` +
  "they would say themselves; keep ingredient names they know. Keep the meaning; add nothing. Reply with the translation only.";

/** English for the kid by default; `to` translates English into that language for the cook. */
export async function translate(text: string, model: TextModel, to?: string): Promise<string> {
  if (model.provider === "gemini") return await geminiTranslate(text, model.apiKey, to);
  // JSON keeps Claude's own notes ("the word is unclear to me...") out of what the family reads.
  const raw = await claudeJson(model.apiKey, process.env.CLAUDE_TRANSLATE_MODEL || TRANSLATE_MODEL, "medium",
    to ? forCook(to) : INSTRUCTIONS, text, TRANSLATION);
  const out = (JSON.parse(raw) as { translation?: unknown }).translation;
  if (typeof out !== "string" || !out.trim()) throw new Error("Claude translate gave no translation");
  return out.trim();
}

const TRANSLATION = {
  type: "object",
  properties: { translation: { type: "string" } },
  required: ["translation"],
  additionalProperties: false,
};

async function geminiTranslate(text: string, apiKey: string, to?: string): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: to ? forCook(to) : INSTRUCTIONS }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: "low" } },
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  const out = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!res.ok || !out) throw new Error(`Gemini translate ${res.status}`);
  return out;
}

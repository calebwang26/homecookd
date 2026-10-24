// Gemini (generateContent) between the cook's language and the kid's English: the cook's answer into
// English (shown labelled as a translation; her own words stay in the transcript), and the kid's question
// into the cook's language (questions.textForCook).
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
export async function geminiTranslate(text: string, apiKey: string, to?: string): Promise<string> {
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

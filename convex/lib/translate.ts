// English for the kid when the cook answered in another language (Gemini, generateContent).
// The cook's own words stay in the transcript; this is only shown labelled as a translation.
const MODEL = "gemini-3.8-flash";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const INSTRUCTIONS =
  "You translate a home cook's spoken answer, transcribed by speech-to-text, into plain English for their " +
  "grandchild. The transcript may have spelling slips; read it as speech. Keep the cook's meaning, amounts and " +
  "warmth; add nothing. If it is already English, return it unchanged. Reply with the translation only.";

export async function geminiTranslate(text: string, apiKey: string): Promise<string> {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
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

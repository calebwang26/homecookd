// Is the cook's answer a clear yes? One small, strict Gemini call that may only say yes, no or unclear
// (JSON with an enum). It reads her answer in English when there is one. Only "yes" counts: no,
// unclear, a reply that isn't one of the three, or any failure all mean no.
import { GEMINI_URL } from "./translate";

export type YesNo = "yes" | "no" | "unclear";

const INSTRUCTIONS =
  "A family member asked a home cook a yes-or-no question, and you read the cook's answer. It may be " +
  "speech-to-text with slips, a translation, or in another language. answer is \"yes\" only when it clearly " +
  "agrees, with no condition or doubt. \"no\" when it refuses. \"unclear\" for anything else: maybe, later, " +
  "a condition, a question back, a joke, or words about something else.";

const SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING", enum: ["yes", "no", "unclear"] } },
  required: ["answer"],
};

/** The model's JSON as yes, no or unclear; anything else is unclear. */
export function parseYesNo(raw: unknown): YesNo {
  if (typeof raw !== "string") return "unclear";
  let reply: unknown;
  try {
    reply = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return "unclear";
  }
  const answer = reply && typeof reply === "object" ? (reply as { answer?: unknown }).answer : null;
  return answer === "yes" || answer === "no" ? answer : "unclear";
}

export async function geminiYesNo(question: string, answer: string, apiKey: string): Promise<YesNo> {
  if (!answer.trim()) return "unclear";
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
      contents: [{ role: "user", parts: [{ text: `Question: ${question}\nAnswer: ${answer}` }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, thinkingConfig: { thinkingLevel: "low" } },
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  if (!res.ok) throw new Error(`Gemini yes/no ${res.status}`);
  return parseYesNo(body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(""));
}

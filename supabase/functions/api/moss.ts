/**
 * Moss (real-time semantic search, https://docs.moss.dev). The project id and key stay here on the
 * server, in the MOSS_PROJECT_ID and MOSS_PROJECT_KEY secrets. Moss's own query runs in-process in its
 * native SDKs, which can't load in an edge function or Expo Go, so the app asks through POST /moss/ask
 * and we call Moss Inference over plain HTTP: it searches the family's index and answers from it.
 * Docs: https://docs.moss.dev/docs/api-reference/v1/inference/chat-completions
 */

export const MOSS_INFERENCE_URL = "https://inference.moss.dev/v1";
/** Control plane (index admin: listIndexes, addDocs, getDocs…). Not called by the api yet. */
export const MOSS_MANAGE_URL = "https://service.usemoss.dev/v1/manage";

/** One index per family, so a family can only ever search its own recipes. */
export const mossIndexFor = (familyId: string) => `family-${familyId}`;

/** Moss refused the index (403): it isn't in the project, i.e. this family has nothing indexed yet. */
export class MossNoIndex extends Error {}

const SYSTEM =
  "You help someone cook their family's recipes. Answer in one or two short, plain sentences, " +
  "using only what the family's recipes say. If they don't say, say you don't know.";

/** POST /chat/completions with the `moss` model, retrieval on, over one index. Throws with Moss's message. */
export async function askMoss(
  projectId: string,
  projectKey: string,
  index: string,
  question: string,
): Promise<{ answer: string; request_id: string | null }> {
  const res = await fetch(`${MOSS_INFERENCE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${projectId}:${projectKey}`,
      "Content-Type": "application/json",
      "X-Moss-Indexes": index,
    },
    body: JSON.stringify({
      model: "moss",
      max_tokens: 300,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question }],
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 403) throw new MossNoIndex(out.error?.message ?? "index not in project");
  const answer = out.choices?.[0]?.message?.content;
  if (!res.ok || typeof answer !== "string") {
    throw new Error(`moss chat ${res.status}: ${out.error?.type ?? ""} ${out.error?.message ?? ""}`.trim());
  }
  return { answer: answer.trim(), request_id: res.headers.get("x-moss-request-id") };
}

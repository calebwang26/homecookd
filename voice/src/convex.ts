// Convex HTTP actions for the voice service (docs/build/STACK.md, "Voice service → Convex"), with the
// x-voice-secret header. Until Track A deploys them (CONVEX_SITE_URL unset), a stub serves
// fixtures/stub-session.json (Grandma's red-braised pork) and accepts any session token.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "./env.js";

export type Moment = { startS: number; endS: number };
export type Step = { order: number; title: string; text: string; moment: Moment };
export type CookSession = {
  familyId: string;
  kid: { id: string; name: string };
  cook?: { id: string; name: string };
  recipe: { id: string; title: string; steps: Step[] };
  stepOrder?: number;
};
export type QuestionResult = { status: "found_in_video" | "asked_cook"; questionId: string };

export class Unauthorized extends Error {}

export const usingStub = !env.convexSiteUrl;

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${env.convexSiteUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-voice-secret": env.voiceSecret },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Unauthorized(path);
  if (!res.ok) throw new Error(`convex ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const stubSession = (): CookSession =>
  JSON.parse(readFileSync(new URL("../fixtures/stub-session.json", import.meta.url), "utf8"));

export function startSession(sessionToken: string, recipeId: string): Promise<CookSession> {
  if (usingStub) return Promise.resolve(stubSession());
  return post("/voice/session", { sessionToken, recipeId });
}

export async function setStep(sessionToken: string, recipeId: string, stepOrder: number): Promise<void> {
  if (usingStub) return;
  await post("/voice/step", { sessionToken, recipeId, stepOrder });
}

export function logQuestion(
  sessionToken: string,
  recipeId: string,
  stepOrder: number,
  text: string,
  found?: { moment: Moment; quote: string },
): Promise<QuestionResult> {
  if (usingStub) {
    console.log(`[stub] question ${found ? "found_in_video" : "asked_cook"}: ${text}`);
    return Promise.resolve({ status: found ? "found_in_video" : "asked_cook", questionId: `stub-${randomUUID()}` });
  }
  return post("/voice/question", { sessionToken, recipeId, stepOrder, text, found });
}

// Convex HTTP actions for the voice service (docs/build/STACK.md, "Voice service → Convex"), with the
// x-voice-secret header. VOICE_STUB=1 (or no CONVEX_SITE_URL) uses a stub instead: it serves
// fixtures/stub-session.json (Grandma's red-braised pork) and accepts any session token.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "./env.js";

export type Moment = { startS: number; endS: number };
export type Step = { order: number; title: string; text: string; moment: Moment };
export type CookSession = {
  familyId: string;
  mossIndex: string;
  kid: { id: string; name: string };
  cook?: { name: string };
  recipe: { id: string; title: string; steps: Step[] };
  stepOrder?: number;
};
export type QuestionResult = { status: "found_in_video" | "asked_cook"; questionId: string };

/** What /voice/session returns (convex/voice.ts sessionView, plus the resumed step). */
type LiveSession = {
  kid: { personId: string; name: string; role: string };
  familyId: string;
  mossIndex: string;
  recipe: { recipeId: string; title: string; cookName: string; steps: Step[] };
  stepOrder?: number;
};

export class Unauthorized extends Error {}
export class NotFound extends Error {}

export const usingStub = env.voiceStub || !env.convexSiteUrl;

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${env.convexSiteUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-voice-secret": env.voiceSecret },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Unauthorized(path);
  if (res.status === 404) throw new NotFound(path);
  if (!res.ok) throw new Error(`convex ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

const stubSession = (): CookSession =>
  JSON.parse(readFileSync(new URL("../fixtures/stub-session.json", import.meta.url), "utf8"));

export async function startSession(sessionToken: string, recipeId: string): Promise<CookSession> {
  if (usingStub) return stubSession();
  const live = await post<LiveSession>("/voice/session", { sessionToken, recipeId });
  return {
    familyId: live.familyId,
    mossIndex: live.mossIndex,
    kid: { id: live.kid.personId, name: live.kid.name },
    cook: live.recipe.cookName ? { name: live.recipe.cookName } : undefined,
    recipe: { id: live.recipe.recipeId, title: live.recipe.title, steps: live.recipe.steps },
    stepOrder: live.stepOrder,
  };
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
  found?: { startS: number; endS: number; quote: string },
): Promise<QuestionResult> {
  if (usingStub) {
    console.log(`[stub] question ${found ? "found_in_video" : "asked_cook"}: ${text}`);
    return Promise.resolve({ status: found ? "found_in_video" : "asked_cook", questionId: `stub-${randomUUID()}` });
  }
  return post("/voice/question", { sessionToken, recipeId, stepOrder, text, found });
}

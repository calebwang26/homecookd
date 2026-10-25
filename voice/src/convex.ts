// Convex HTTP actions for the voice service (docs/build/STACK.md, "Voice service → Convex" and "Voice
// service → Convex for homie"), with the x-voice-secret header. VOICE_STUB=1 (or no CONVEX_SITE_URL)
// uses a stub instead: fixtures/stub-session.json (Grandma's red-braised pork, no Moss index) for /cook and
// fixtures/stub-recording.json (recording "stub-mr", "stub-en", "stub-ta" or "stub-zh") for /record. The stub
// accepts any session token.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "./env.js";

export type Moment = { startS: number; endS: number };
export type Step = { order: number; title: string; text: string; quote?: string; quoteOriginal?: string; moment: Moment };
export type Memory = { kind: "story" | "tip"; text: string; moment: Moment; stepOrder?: number };
export type CookSession = {
  familyId: string;
  mossIndex: string;
  kid: { id: string; name: string };
  /** `language` is undefined when Convex doesn't know it (most recipes made before languages were recorded). */
  cook?: { name: string; language?: string; relation?: string };
  recipe: { id: string; title: string; steps: Step[]; memories: Memory[] };
  stepOrder?: number;
};
export type QuestionResult = { status: "found_in_video" | "asked_cook"; questionId: string };

/** What /voice/session returns (convex/voice.ts sessionView, plus the resumed step). */
type LiveCookSession = {
  kid: { personId: string; name: string; role: string };
  familyId: string;
  mossIndex: string;
  recipe: {
    recipeId: string;
    title: string;
    cookName: string;
    cookLanguage?: string;
    cookRelation?: string;
    steps: Step[];
    memories?: Memory[];
  };
  stepOrder?: number;
};

export class Unauthorized extends Error {}
export class NotFound extends Error {}
/** A /live/* write refused because the recording is over (ended, maybe by the app's stop button, or abandoned). */
export class Ended extends Error {}
/** convex/lib/liveRoutes.ts answers this, with 400, for a recording that's over. */
const ENDED = "recording already ended";

export const usingStub = env.voiceStub || !env.convexSiteUrl;

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${env.convexSiteUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-voice-secret": env.voiceSecret },
    body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Unauthorized(path);
  if (res.status === 404) throw new NotFound(path);
  const text = await res.text();
  if (res.status === 400 && errorOf(text) === ENDED) throw new Ended(path);
  if (!res.ok) throw new Error(`convex ${path} ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function errorOf(body: string): unknown {
  try {
    return JSON.parse(body)?.error;
  } catch {
    return undefined;
  }
}

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

export async function startSession(sessionToken: string, recipeId: string): Promise<CookSession> {
  if (usingStub) return fixture<CookSession>("stub-session.json");
  const live = await post<LiveCookSession>("/voice/session", { sessionToken, recipeId });
  const r = live.recipe;
  return {
    familyId: live.familyId,
    mossIndex: live.mossIndex,
    kid: { id: live.kid.personId, name: live.kid.name },
    cook: r.cookName ? { name: r.cookName, language: r.cookLanguage, relation: r.cookRelation } : undefined,
    recipe: { id: r.recipeId, title: r.title, steps: r.steps, memories: r.memories ?? [] },
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

// ---- homie while a cook records ----

export type Person = { personId: string; familyId: string; name: string; role: "cook" | "kid"; language: string; relation?: string };
export type RecordingStatus = "intro" | "recording" | "wrapping_up" | "ended" | "abandoned";
export type RecordingSession = {
  recording: { _id: string; language: string; status: RecordingStatus; startedAt?: number; dish?: string };
  cook: { name: string; relation?: string; language: string };
  kid?: { name: string };
  dish?: string;
  /** homie has recorded with her before: a welcome back instead of the introduction. Missing (an older Convex) = no. */
  metBefore?: boolean;
};
export type PromptKind = "intro" | "amount" | "show" | "cue" | "substitution" | "story" | "reaction" | "end" | "plate" | "closing" | "optin";
/** When homie's voice played on the phone, on the recording's clock (seconds, like atS). */
export type Said = { atS: number; endS: number };
export type PromptStatus = "spoken" | "answered" | "ignored" | "not_now";
export type Answer = { transcript: string; transcriptEn?: string; atS: number; endS: number };

/** Stub recordings by language: "stub-mr", "stub-en", "stub-ta", "stub-zh", "stub-mr-ajoba", "stub-en-dad" (and "-again" for each). */
const stubRecordings = () => fixture<Record<string, RecordingSession>>("stub-recording.json");

export async function person(sessionToken: string): Promise<Person> {
  if (usingStub) {
    const { cook } = stubRecordings().mr;
    return { personId: "stub-cook", familyId: "voice-test", name: cook.name, role: "cook", language: cook.language, relation: cook.relation };
  }
  return post("/live/person", { sessionToken });
}

// ---- a tap on homie ----

/** One thing that's new for the person tapping homie (convex/homie.ts), with a line that says it plainly. */
export type NewsFact = { id: string; kind: "answer" | "asked" | "cooking" | "recipe" | "quiet"; line: string; at: number };
export type News = { name: string; role: "cook" | "kid"; facts: NewsFact[] };

export async function news(sessionToken: string): Promise<News> {
  if (usingStub) {
    return { name: "Shreya", role: "kid", facts: [{ id: "answer:stub", kind: "answer", line: "Aaji answered your question about the Varan Bhaat.", at: 0 }] };
  }
  return post("/homie/news", { sessionToken });
}

export async function recordingSession(sessionToken: string, recordingId: string): Promise<RecordingSession> {
  // "stub-mr-again" / "stub-en-again": a cook homie has recorded with before (the short hello).
  // "stub-mr-ajoba" (a grandfather, for the whole family) and "stub-en-dad" (Vijay, whom the family calls Dad): not every cook is a mom.
  if (usingStub) {
    const all = stubRecordings();
    const key = recordingId.replace(/^stub-/, "").replace(/-again$/, "");
    const lang = /^stub-([a-z]{2,3})\b/.exec(recordingId)?.[1] ?? "mr";
    return { ...(all[key] ?? all[lang] ?? all.mr), metBefore: recordingId.endsWith("-again") };
  }
  return post("/live/session", { sessionToken, recordingId });
}

export async function setRecordingStatus(
  sessionToken: string,
  recordingId: string,
  status: "recording" | "wrapping_up" | "ended",
): Promise<{ ok: true; startedAt?: number }> {
  if (usingStub) {
    console.log(`[stub] recording ${status}`);
    if (status === "recording") stubStarted.set(recordingId, Date.now());
    const startedAt = stubStarted.get(recordingId);
    if (status === "ended") stubStarted.delete(recordingId);
    return { ok: true, startedAt };
  }
  return post("/live/status", { sessionToken, recordingId, status });
}
const stubStarted = new Map<string, number>();

/** The heartbeat while her socket is open: marks the recording as in use, so the 2 h idle cleanup leaves it. */
export async function touchRecording(sessionToken: string, recordingId: string): Promise<void> {
  if (usingStub) return;
  await post("/live/status", { sessionToken, recordingId, touch: true });
}

export async function logPrompt(
  sessionToken: string,
  recordingId: string,
  prompt: { kind: PromptKind; text: string; textEn: string; atS: number; status: PromptStatus; said?: Said },
): Promise<{ promptId: string }> {
  if (usingStub) {
    console.log(`[stub] prompt ${prompt.kind} at ${prompt.atS.toFixed(1)}s: ${prompt.textEn}`);
    return { promptId: `stub-${randomUUID()}` };
  }
  return post("/live/prompt", { sessionToken, recordingId, ...prompt });
}

export async function updatePrompt(sessionToken: string, promptId: string, status: PromptStatus, answer?: Answer): Promise<void> {
  if (usingStub) return void console.log(`[stub] prompt ${status}${answer ? `: ${answer.transcriptEn ?? answer.transcript}` : ""}`);
  await post("/live/prompt-update", { sessionToken, promptId, status, answer });
}

/** A question's voice finished playing (it was saved before it was said). */
export async function promptSaid(sessionToken: string, promptId: string, said: Said): Promise<void> {
  if (usingStub) return void console.log(`[stub] prompt said ${said.atS.toFixed(1)}-${said.endS.toFixed(1)}s`);
  await post("/live/prompt-said", { sessionToken, promptId, said });
}

export async function setOptIn(sessionToken: string, recordingId: string, optIn: boolean): Promise<void> {
  if (usingStub) return void console.log(`[stub] optin ${optIn}`);
  await post("/live/optin", { sessionToken, recordingId, optIn });
}

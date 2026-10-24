// The cook's voice-note answer, written out by Cartesia Ink (batch STT: POST /stt, docs.cartesia.ai).
// The voice note itself is what the kid hears; the transcript is for reading and for search. Ink writes
// it in the cook's own language (people.language); when that isn't English, Gemini adds an English
// translation next to it.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { type ActionCtx, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { geminiTranslate } from "./lib/translate";

const STT_URL = "https://api.cartesia.ai/stt";
const CARTESIA_VERSION = "2026-08-14";
const MODEL = "ink-whisper"; // the only batch model; ink-2 is realtime-only

// Ink takes a file name; it reads the container from the bytes, but give it the right extension.
const EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
};

export const audioFor = internalQuery({
  args: { questionId: v.id("questions") },
  returns: v.union(v.null(), v.object({ audioId: v.id("_storage"), language: v.string(), share: v.boolean() })),
  handler: async (ctx, { questionId }) => {
    const q = await ctx.db.get("questions", questionId);
    const answer = q?.answer;
    if (!q || !answer?.audioId) return null;
    const cook = await ctx.db.get("people", answer.by);
    return { audioId: answer.audioId, language: cook?.language ?? "en", share: q.kind === "share" };
  },
});

export const saveTranscript = internalMutation({
  args: {
    questionId: v.id("questions"),
    audioId: v.id("_storage"),
    transcript: v.string(),
    translation: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { questionId, audioId, transcript, translation }) => {
    const q = await ctx.db.get("questions", questionId);
    // Only if the answer is still that voice note.
    if (q?.answer?.audioId === audioId) {
      await ctx.db.patch("questions", questionId, { answer: { ...q.answer, transcript, translation } });
      if (q.kind === "share") await ctx.scheduler.runAfter(0, internal.shareRequests.decide, { questionId });
    }
    return null;
  },
});

/** Sends audio to Ink and returns the text. Exported for the tests. */
export async function inkTranscribe(audio: Blob, apiKey: string, language = "en"): Promise<string> {
  const form = new FormData();
  form.append("file", audio, `answer.${EXT[audio.type] ?? "m4a"}`);
  form.append("model", MODEL);
  // Without it Ink assumes English, and Marathi comes back as English-sounding nonsense.
  form.append("language", language);
  const res = await fetch(STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Cartesia-Version": CARTESIA_VERSION },
    body: form,
  });
  const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
  if (!res.ok || typeof body?.text !== "string") throw new Error(`Cartesia STT ${res.status}`);
  return body.text.trim();
}

export const questionAnswer = internalAction({
  args: { questionId: v.id("questions") },
  returns: v.null(),
  handler: async (ctx, { questionId }) => {
    const found = await ctx.runQuery(internal.transcribe.audioFor, { questionId });
    if (!found) return null;
    let saved = false;
    try {
      saved = await writeOut(ctx, questionId, found.audioId, found.language);
    } finally {
      // A share ask is still read when her voice note can't be written out: no words is not a yes.
      if (!saved && found.share) await ctx.scheduler.runAfter(0, internal.shareRequests.decide, { questionId });
    }
    return null;
  },
});

/** Ink's transcript (and the English) saved on the answer; false when there are no words to save. */
async function writeOut(ctx: ActionCtx, questionId: Id<"questions">, audioId: Id<"_storage">, language: string): Promise<boolean> {
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    console.warn("CARTESIA_API_KEY isn't set; voice note left without a transcript");
    return false;
  }
  const audio = await ctx.storage.get(audioId);
  if (!audio) return false;
  const transcript = await inkTranscribe(audio, apiKey, language);
  if (!transcript) return false;
  const translation = language === "en" ? undefined : await toEnglish(transcript);
  await ctx.runMutation(internal.transcribe.saveTranscript, { questionId, audioId, transcript, translation });
  return true;
}

/** The kid's English. A failed translation still keeps the cook's own words. */
async function toEnglish(transcript: string): Promise<string | undefined> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY isn't set; answer left without an English translation");
    return undefined;
  }
  try {
    return await geminiTranslate(transcript, apiKey);
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

// Keys come from the process env (Cloud Run secrets) or, locally, the repo's gitignored root .env.
// Never log a value from here.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The nearest .env walking up from voice/, so it also works from a git worktree inside the repo. */
function readDotEnv(): Record<string, string> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const file = join(dir, ".env");
    if (existsSync(file)) {
      const out: Record<string, string> = {};
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
      return out;
    }
    dir = dirname(dir);
  }
  return {};
}

const dotEnv = readDotEnv();
const get = (name: string) => process.env[name] || dotEnv[name] || "";

function required(name: string): string {
  const v = get(name);
  if (!v) throw new Error(`Missing ${name} (Cloud Run secret or root .env)`);
  return v;
}

export const env = {
  port: Number(get("PORT") || 8080),
  cartesiaKey: required("CARTESIA_API_KEY"),
  anthropicKey: required("ANTHROPIC_API_KEY"),
  mossProjectId: get("MOSS_PROJECT_ID"),
  mossProjectKey: get("MOSS_PROJECT_KEY"),
  /** Convex HTTP actions live on the deployment's .convex.site URL. Empty = use the local stub. */
  convexSiteUrl: get("CONVEX_SITE_URL").replace(/\/$/, ""),
  voiceSecret: get("VOICE_SECRET"),
  /** Use the stub recipe even when CONVEX_SITE_URL is set (local tests without a session token). */
  voiceStub: get("VOICE_STUB") === "1",
  /** Overridable without a code change if latency needs a smaller model. */
  claudeModel: get("CLAUDE_MODEL") || "claude-opus-5-5",
  /** Opus fast mode (beta, premium price): up to 2.5x faster output. */
  claudeFast: get("CLAUDE_FAST") === "1",
  /** homie's voice everywhere it talks: the kid cooking, a cook recording, and /speak. Default "Riya bilingual"
   *  (Caleb's pick, Oct 24): our private localized copy of Cartesia's "Riya, College Roommate", which speaks
   *  native Marathi and Indian English. The way it's asked for (locale, speed, mood) is in sonic.ts. */
  homieVoice: get("HOMIE_VOICE") || "930eda72-c1af-4637-8d07-87d881d615fe",
  /** homie's pace, 0.6–1.5. Empty = sonic.ts's default (0.85, what Caleb heard). */
  homieSpeed: get("HOMIE_SPEED"),
  /** Log each Sonic request's voice, locale, speed and mood (for live tests). */
  ttsLog: get("TTS_LOG") === "1",
  /** Gemini Live hears the languages Ink 2 doesn't (Marathi), and Gemini TTS speaks when Sonic can't
   *  (geminiTts.ts). Empty = those recordings get no transcript, and no backup voice. */
  geminiKey: get("GEMINI_API_KEY"),
  geminiTtsModel: get("GEMINI_TTS_MODEL") || "gemini-3.8-flash-tts",
  /** A prebuilt Gemini voice: warm, Indian English, "Companion & Peer" (GET /v1beta/voices). */
  geminiTtsVoice: get("GEMINI_TTS_VOICE") || "en-in-assistant-3",
  geminiLiveModel: get("GEMINI_LIVE_MODEL") || "gemini-3.5-transcribe-live",
  /** The glasses VM, for homie's look at the stove. Both empty = no frames. */
  glassesUrl: get("GLASSES_URL").replace(/\/$/, ""),
  glassesSecret: get("GLASSES_SECRET"),
  /** Demo pacing: homie's first question at ~40 s instead of 4 min. */
  homieDemo: get("HOMIE_DEMO") === "1",
};

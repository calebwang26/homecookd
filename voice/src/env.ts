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
  /** Used in order when the key before runs out of credits (cartesiaKeys.ts). Comma-separated. */
  cartesiaBackupKeys: get("CARTESIA_API_KEYS_BACKUP").split(",").map((k) => k.trim()).filter(Boolean),
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
  /** The "should homie speak now?" check while a cook records (homie.ts decide), every 15 s or so, often with a
   *  camera still: the call that adds up. Haiku by default (Caleb, Oct 26: Opus here spent the month's limit). */
  homieDecideModel: get("HOMIE_DECIDE_MODEL") || "claude-haiku-5-5",
  /** Opus fast mode (beta, premium price): up to 2.5x faster output. Off unless CLAUDE_FAST=1 (Caleb, Oct 26: cost). */
  claudeFast: get("CLAUDE_FAST") === "1",
  /** homie's voice everywhere it talks: the kid cooking, a cook recording, and /speak. Default "Riya bilingual"
   *  (Caleb's pick, Oct 24): our private localized copy of Cartesia's "Riya, College Roommate", which speaks
   *  native Marathi and Indian English. The way it's asked for (locale, speed, mood) is in sonic.ts. */
  homieVoice: get("HOMIE_VOICE") || "930eda72-c1af-4637-8d07-87d881d615fe",
  /** homie's pace, 0.6–1.5. Empty = sonic.ts's default (0.85, what Caleb heard). */
  homieSpeed: get("HOMIE_SPEED"),
  /** Log each Sonic request's voice, locale, speed and mood (for live tests). */
  ttsLog: get("TTS_LOG") === "1",
  /** Gemini Live hears a cook's language only where Cartesia can't (stt.ts): Marathi until MARATHI_STT=cartesia,
   *  and Odia, hidden from the app since Oct 26. Empty = those recordings get no live transcript. */
  geminiKey: get("GEMINI_API_KEY"),
  geminiLiveModel: get("GEMINI_LIVE_MODEL") || "gemini-3.5-transcribe-live",
  /** "cartesia" = Marathi on Cartesia ink-whisper, as it is (Caleb, Oct 26); anything else = Gemini Live, as before. */
  marathiStt: get("MARATHI_STT").trim().toLowerCase(),
  /** The glasses VM, for homie's look at the stove. Both empty = no frames. */
  glassesUrl: get("GLASSES_URL").replace(/\/$/, ""),
  glassesSecret: get("GLASSES_SECRET"),
  /** Demo pacing: homie's first question at ~40 s instead of 4 min. */
  homieDemo: get("HOMIE_DEMO") === "1",
  /** The filmed demo: a fixed question every 5 minutes (lines.ts scriptedQuestion), no Claude deciding. Wins over HOMIE_DEMO. */
  homieScripted: get("HOMIE_SCRIPTED") === "1",
};

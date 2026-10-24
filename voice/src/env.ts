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
  /** Cartesia voice for Sonic. Default "Katie", same as scripts/check-cartesia.mjs. */
  cartesiaVoice: get("CARTESIA_VOICE") || "6ccbfb76-1fc6-48f7-b71d-91ac6298247b",
  /** homie's own voice while a cook records and for /speak. Default "Sindhu": a warm Indian voice
   *  that Sonic 3.6 speaks in Marathi (mr-IN) and English. */
  homieVoice: get("HOMIE_VOICE") || "07bc462a-c644-49f1-baf7-82d5599131be",
  /** Gemini Live hears the languages Ink 2 doesn't (Marathi). Empty = those recordings get no transcript. */
  geminiKey: get("GEMINI_API_KEY"),
  geminiLiveModel: get("GEMINI_LIVE_MODEL") || "gemini-3.5-transcribe-live",
  /** The glasses VM, for homie's look at the stove. Both empty = no frames. */
  glassesUrl: get("GLASSES_URL").replace(/\/$/, ""),
  glassesSecret: get("GLASSES_SECRET"),
  /** Demo pacing: homie's first question at ~40 s instead of 4 min. */
  homieDemo: get("HOMIE_DEMO") === "1",
};

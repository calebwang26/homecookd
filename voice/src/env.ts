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
  /** Overridable without a code change if latency needs a smaller model. */
  claudeModel: get("CLAUDE_MODEL") || "claude-opus-5-5",
  /** Opus fast mode (beta, premium price): up to 2.5x faster output. */
  claudeFast: get("CLAUDE_FAST") === "1",
  /** Cartesia voice for Sonic. Default "Katie", same as scripts/check-cartesia.mjs. */
  cartesiaVoice: get("CARTESIA_VOICE") || "6ccbfb76-1fc6-48f7-b71d-91ac6298247b",
};

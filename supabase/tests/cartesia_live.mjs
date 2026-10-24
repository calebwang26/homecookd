// Live check of our Cartesia setup: the server key mints a short-lived token (what POST /voice/token
// does in api/cartesia.ts), then the token alone speaks a line, the way the app or web will.
// Dependency-free (Node 20+). Prints PASS / FAIL lines; exits 1 on any FAIL. Never prints the key or token.
//
//   node supabase/tests/cartesia_live.mjs            # key from CARTESIA_API_KEY or the repo's gitignored .env
//   OUT=/tmp/hello.wav node supabase/tests/cartesia_live.mjs   # also keeps the audio to listen to

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.cartesia.ai";
const VERSION = "2026-08-14"; // keep in step with CARTESIA_VERSION in api/cartesia.ts
// "Katie" from Cartesia's own examples; swap for the voice we pick.
const VOICE = process.env.CARTESIA_VOICE || "6ccbfb76-1fc6-48f7-b71d-91ac6298247b";

function keyFromEnvFile() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "../../.env");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("CARTESIA_API_KEY="));
  return line ? line.slice("CARTESIA_API_KEY=".length).trim() : "";
}
const KEY = process.env.CARTESIA_API_KEY || keyFromEnvFile();
if (!KEY) {
  console.error("No CARTESIA_API_KEY in the environment or .env");
  process.exit(1);
}

let failed = 0;
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};
const headers = (bearer) => ({ Authorization: `Bearer ${bearer}`, "Cartesia-Version": VERSION, "Content-Type": "application/json" });

// 1. Server: API key -> access token
const tokRes = await fetch(`${BASE}/access-token`, {
  method: "POST",
  headers: headers(KEY),
  body: JSON.stringify({ grants: { tts: true }, expires_in: 60 }),
});
const tok = await tokRes.json().catch(() => ({}));
check(tokRes.ok && typeof tok.token === "string", "access-token minted", `${tokRes.status} ${tok.error_code ?? ""}`.trim());

// 2. Client: token -> /tts/bytes -> wav
if (tok.token) {
  const ttsRes = await fetch(`${BASE}/tts/bytes`, {
    method: "POST",
    headers: headers(tok.token),
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript: "Stir until it smells nutty, then add the garlic.",
      voice: VOICE,
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
      language: "en",
      generation_config: { speed: 0.9 },
    }),
  });
  const audio = Buffer.from(await ttsRes.arrayBuffer());
  const isWav = audio.subarray(0, 4).toString() === "RIFF";
  check(ttsRes.ok && isWav, "tts/bytes with token returns wav", `${ttsRes.status}, ${audio.length} bytes`);
  if (ttsRes.ok && process.env.OUT) writeFileSync(process.env.OUT, audio);
}

// 3. A bad token is refused with a structured error
const badRes = await fetch(`${BASE}/tts/bytes`, { method: "POST", headers: headers("not-a-token"), body: "{}" });
check(badRes.status === 401 || badRes.status === 403, "bad token refused", String(badRes.status));

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);

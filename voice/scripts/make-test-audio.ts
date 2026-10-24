// Makes the recorded test lines with Sonic, as 16 kHz mono 16-bit WAVs (what the app streams):
//   npm run make-audio        → test-audio/next-step.wav, question.wav, …, cook-mr-*.wav, cook-en-*.wav
//   npm run make-audio -- no  → only the lines named (test-audio/no.wav)
// It spends Sonic credits (1 per character, about 450 for all 14), and the WAVs are committed: re-record only
// the lines you change.
import { writeFileSync } from "node:fs";
import { env } from "../src/env.js";
import { CARTESIA_VERSION } from "../src/ink.js";
import { KID_VOICE, LINES } from "./testLines.js";

const only = process.argv.slice(2);
for (const name of only) if (!(name in LINES)) throw new Error(`no test line called ${name}`);
for (const [name, line] of Object.entries(LINES)) {
  if (only.length && !only.includes(name)) continue;
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { "X-API-Key": env.cartesiaKey, "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript: line.text,
      voice: line.voice ?? KID_VOICE,
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 16000 },
      // Sonic takes Marathi as a locale, never together with `language`.
      ...(line.lang === "mr" ? { locale: "mr-IN" } : { language: line.lang ?? "en" }),
    }),
  });
  if (!res.ok) throw new Error(`sonic ${res.status}: ${await res.text()}`);
  writeFileSync(new URL(`../test-audio/${name}.wav`, import.meta.url), Buffer.from(await res.arrayBuffer()));
  console.log(`test-audio/${name}.wav  "${line.text}"`);
}

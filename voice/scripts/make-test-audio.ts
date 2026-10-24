// Makes the recorded test lines with Sonic, as 16 kHz mono 16-bit WAVs (what the app streams):
//   npm run make-audio        → test-audio/next-step.wav, question.wav, unknown-question.wav, …
import { writeFileSync } from "node:fs";
import { env } from "../src/env.js";
import { CARTESIA_VERSION } from "../src/ink.js";

const LINES: Record<string, string> = {
  "next-step": "Next step.",
  question: "How do I know when the sugar is ready?",
  "unknown-question": "Can I use maple syrup instead of the rock sugar?",
  "go-back": "Wait, go back.",
  // For the demo family's Chicken Biryani (the cook warns about the oil at 384–404 s).
  "oil-question": "How hot should the oil be?",
};
// A different voice from the service's, so it sounds like a second person.
const KID_VOICE = "694f9389-aac1-45b6-b726-9d9369183238";

for (const [name, transcript] of Object.entries(LINES)) {
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: { "X-API-Key": env.cartesiaKey, "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify({
      model_id: "sonic-3.6",
      transcript,
      voice: KID_VOICE,
      output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 16000 },
      language: "en",
    }),
  });
  if (!res.ok) throw new Error(`sonic ${res.status}: ${await res.text()}`);
  writeFileSync(new URL(`../test-audio/${name}.wav`, import.meta.url), Buffer.from(await res.arrayBuffer()));
  console.log(`test-audio/${name}.wav  "${transcript}"`);
}

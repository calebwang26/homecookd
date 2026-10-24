// Makes the recorded test lines with Sonic, as 16 kHz mono 16-bit WAVs (what the app streams):
//   npm run make-audio        → test-audio/next-step.wav, question.wav, …, cook-mr-*.wav, cook-en-*.wav
//   npm run make-audio -- no  → only the lines named (test-audio/no.wav)
import { writeFileSync } from "node:fs";
import { env } from "../src/env.js";
import { CARTESIA_VERSION } from "../src/ink.js";

// A different voice from the service's, so it sounds like a second person.
const KID_VOICE = "694f9389-aac1-45b6-b726-9d9369183238";
// The cook for /record tests: a mature Indian voice ("Kavita"), in Marathi or English.
const COOK_VOICE = "56e35e2d-6eb6-4226-ab8b-9776515a7094";

type Line = { text: string; voice?: string; lang?: string };
const LINES: Record<string, Line> = {
  "next-step": { text: "Next step." },
  question: { text: "How do I know when the sugar is ready?" },
  "unknown-question": { text: "Can I use maple syrup instead of the rock sugar?" },
  "go-back": { text: "Wait, go back." },
  // For the demo family's Chicken Biryani (the cook warns about the oil at 384–404 s).
  "oil-question": { text: "How hot should the oil be?" },
  yes: { text: "Yes." },
  no: { text: "No, thanks." },
  timer: { text: "Set a timer for five minutes." },
  // The cook while homie listens (/record): a vague amount, then her answer, then yes to the opt-in.
  "cook-mr-cooking": { text: "हो, आधी तांदूळ तीन वेळा धुवून घे. मग थोडं मीठ टाक, अंदाजाने.", voice: COOK_VOICE, lang: "mr" },
  "cook-mr-answer": { text: "साधारण एक छोटा चमचा मीठ. जास्त नको.", voice: COOK_VOICE, lang: "mr" },
  "cook-mr-yes": { text: "हो, नक्की ऐकू दे.", voice: COOK_VOICE, lang: "mr" },
  "cook-en-cooking": { text: "Okay, now the turmeric goes in. Just a little, until it looks right.", voice: COOK_VOICE },
  "cook-en-answer": { text: "About half a teaspoon. You want it golden, not bright yellow.", voice: COOK_VOICE },
  "cook-en-yes": { text: "Yes, of course she can.", voice: COOK_VOICE },
};

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

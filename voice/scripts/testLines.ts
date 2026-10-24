// The recorded test lines in test-audio/*.wav: what each one says, and in which voice and language.
// make-test-audio.ts records them with Sonic; the test clients send the words as text instead when the
// service runs with fake speech (scripts/guard.ts), so most test runs never touch Cartesia.

// A different voice from the service's, so it sounds like a second person.
export const KID_VOICE = "694f9389-aac1-45b6-b726-9d9369183238";
// The cook for /record tests: a mature Indian voice ("Kavita"), in Marathi or English.
const COOK_VOICE = "56e35e2d-6eb6-4226-ab8b-9776515a7094";

export type Line = { text: string; voice?: string; lang?: string };
export const LINES: Record<string, Line> = {
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

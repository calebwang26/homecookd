// The recorded test lines in test-audio/*.wav: what each one says, and in which voice and language.
// make-test-audio.ts records them with Sonic; the test clients send the words as text instead when the
// service runs with fake speech (scripts/guard.ts), so most test runs never touch Cartesia.

// A different voice from the service's, so it sounds like a second person.
export const KID_VOICE = "694f9389-aac1-45b6-b726-9d9369183238";
// The cook for /record tests: a mature Indian voice ("Kavita"), in Hindi, English, Tamil or Mandarin.
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
  // Everyday yes and no (src/yesNo.ts): a yes or a no with more after it.
  "sure-read-it": { text: "Sure, read it." },
  "yeah-go-ahead": { text: "Yeah, go ahead." },
  "no-not-now": { text: "No, not right now." },
  nah: { text: "Nah, I'm good." },
  dont: { text: "Don't." },
  "please-do": { text: "Please do." },
  "oh-no-thanks": { text: "Oh, no thanks." },
  "no-next-step": { text: "No, next step." },
  "no-ginger": { text: "No, I'm out of ginger. Can I skip it?" },
  "no-need": { text: "No, no need to read it." },
  timer: { text: "Set a timer for five minutes." },
  // Not for homie (the kid talking to a roommate), and the same kind of question with homie's name (agent.ts).
  "to-roommate": { text: "Maya, can you grab me a plate from the cupboard?" },
  "homie-question": { text: "Homie, how long should this simmer?" },
  // The cook while homie listens (/record): a vague amount, then her answer, then yes to the opt-in.
  "cook-hi-cooking": { text: "हाँ, पहले चावल तीन बार धो लो. फिर थोड़ा नमक डालो, अंदाज़ से.", voice: COOK_VOICE, lang: "hi" },
  "cook-hi-answer": { text: "लगभग एक छोटा चम्मच नमक. ज़्यादा नहीं.", voice: COOK_VOICE, lang: "hi" },
  "cook-hi-yes": { text: "हाँ, ज़रूर सुनने दो.", voice: COOK_VOICE, lang: "hi" },
  "cook-en-cooking": { text: "Okay, now the turmeric goes in. Just a little, until it looks right.", voice: COOK_VOICE },
  "cook-en-answer": { text: "About half a teaspoon. You want it golden, not bright yellow.", voice: COOK_VOICE },
  "cook-en-yes": { text: "Yes, of course she can.", voice: COOK_VOICE },
  // Oct 24: two of the languages ink-whisper hears (stub recordings "stub-ta" and "stub-zh").
  "cook-ta-cooking": { text: "சரி, முதல்ல பருப்பை மூணு தடவை கழுவிக்கோங்க. அப்புறம் கொஞ்சம் உப்பு போடுங்க, கண் அளவுல.", voice: COOK_VOICE, lang: "ta" },
  "cook-ta-answer": { text: "ஒரு சின்ன ஸ்பூன் உப்பு போதும். ரொம்ப வேண்டாம்.", voice: COOK_VOICE, lang: "ta" },
  "cook-ta-yes": { text: "ஆமா, கண்டிப்பா கேக்கட்டும்.", voice: COOK_VOICE, lang: "ta" },
  "cook-zh-cooking": { text: "好，先把西红柿切成块，然后把鸡蛋打散，加一点盐，看着放就行。", voice: COOK_VOICE, lang: "zh" },
  "cook-zh-answer": { text: "大概半小勺盐，别放太多。", voice: COOK_VOICE, lang: "zh" },
  "cook-zh-yes": { text: "好的，当然可以让她听。", voice: COOK_VOICE, lang: "zh" },
};

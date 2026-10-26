// Community's word filter: what keeps a recipe or a dinner off the map before other families see it.
// Conservative on purpose: whole words and phrases only, accents folded, and nothing that is also a
// food or cooking word in English or another language (the tests hold the ones we checked). The team
// hears about everything else through reports (reports.ts).

const TERMS = [
  "blowjob", "chink", "chinks", "clit", "cumshot", "cunt", "cunts", "dildo", "faggot", "faggots",
  "fuck", "fucked", "fucker", "fuckers", "fucking", "fucks", "handjob", "motherfucker", "nigga",
  "niggas", "nigger", "niggers", "pussy", "raghead", "rapist", "sandnigger", "slut", "sluts",
  "towelhead", "tranny", "wetback", "whore", "whores", "kkk", "heil hitler", "sieg heil",
  "white power", "kys", "kill yourself", "kill urself", "i will kill you", "i'll kill you",
  "gonna kill you", "rape you", "shoot you", "stab you", "murder you",
];

/** " word word " in lowercase with accents folded and anything but letters and digits as one space. */
function words(text: string): string {
  const plain = text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return ` ${plain.split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ")} `;
}

const PATTERNS = TERMS.map(words);

/** True when any of the texts holds a filtered word or phrase. */
export function flagged(...texts: (string | null | undefined)[]): boolean {
  const all = words(texts.filter(Boolean).join("\n"));
  return PATTERNS.some((p) => all.includes(p));
}

/**
 * What other families read of a shared recipe: its name, its steps and the story card. Her step quotes
 * aren't here: a filtered one never reaches the card (storyCard.quoteChoices leaves it out).
 */
export function recipeWords(r: {
  title: string;
  steps: readonly { title: string; text: string }[];
  storyCard?: { text: string; culture?: string };
}): string[] {
  return [r.title, ...r.steps.flatMap((s) => [s.title, s.text]), r.storyCard?.text ?? "", r.storyCard?.culture ?? ""];
}

export const NOT_SHAREABLE = "Some words in this recipe can't go on the map. It stays with your family.";
export const NOT_POSTABLE = "Some of those words can't go in Community. Try other words.";

// The word filter (convex/lib/moderation.ts, the same list and rules). Conservative on purpose: whole words and phrases only, accents
// folded, and nothing that is also a food or cooking word in English or another language.
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

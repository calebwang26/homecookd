// What homie calls people, and the check that it never guesses a family role or a gender (Caleb, Oct 24: "the AI
// homie will always refer to me as like a mom"). The app knows names and the family's word for a cook
// (people.relation: "Aaji", "Grandma", "Rajani Aaji"), never how the kid is related to the cook, nor anyone's gender.

/**
 * Family words that stand on their own: a cook the family calls "Dad" is "Dad", not "Vijay Dad".
 * Words that follow a name ("Rajani Aaji", "Ramesh Ajoba", "Lakshmi Paati") aren't here, so they keep the name.
 * TODO(caleb): which words stand alone. Today: these English ones, so "Hi, Rajani Aaji." stays as it is.
 */
const ON_ITS_OWN = new Set([
  "mom", "mum", "mommy", "mummy", "mama", "ma", "mother", "dad", "daddy", "papa", "pa", "father",
  "grandma", "grandpa", "granny", "gran", "grandad", "granddad", "grandmother", "grandfather", "nana",
  "aunt", "auntie", "aunty", "uncle",
]);

const words = (s: string): string[] => s.toLowerCase().match(/\p{L}+/gu) ?? [];

/**
 * How homie names a cook, from their name and the family's word for them (people.relation). The relation alone when
 * it already holds the name ("Rajani Aaji") or stands on its own ("Dad"); the name alone when the name is already a
 * family word (a profile named "Grandma"); else the first name and the word ("Rajani Pawar" + "Aaji" → "Rajani Aaji").
 */
export function callOf(name: string | undefined, relation?: string): string | undefined {
  const n = name?.trim() ?? "";
  const r = relation?.trim() ?? "";
  if (!r) return n || undefined;
  if (!n) return r;
  const first = n.split(/\s+/)[0];
  const rw = words(r);
  if (words(first).every((w) => rw.includes(w))) return r;
  if (words(n).some((w) => ON_ITS_OWN.has(w))) return n;
  if (rw.some((w) => ON_ITS_OWN.has(w))) return r;
  return `${first} ${r}`;
}

// The words a guess is made of, in English. "Oh boy" and "kid-friendly" aren't about anyone.
const KID = String.raw`sons?|daughters?|grand(?:sons?|daughters?|child(?:ren)?|kids?|bab(?:y|ies))|kids?(?!-)|child(?:ren)?|little ones?`;
const ROLE = String.raw`moms?|mums?|mommy|mummy|mama|mothers?|dads?|daddy|papa|fathers?|parents?|grand(?:ma|mas|mothers?|pa|pas|fathers?|parents?|dads?|ads?)|granny|nana|nani|aunt(?:ie|y|s)?|uncles?|ma['’]am|sir|brothers?|sisters?|(?<!\boh,?\s)boys?|girls?|nephews?|nieces?|husband|wife|aaji|ajoba|dadi|dada`;
const PRONOUN = String.raw`he|she|him|his|her|hers|himself|herself`;
const re = (alts: string) => new RegExp(String.raw`\b(?:${alts})\b`, "gi");
const CHECKS = { kid: re(KID), roles: re(`${KID}|${ROLE}`), all: re(`${KID}|${ROLE}|${PRONOUN}`) };
const PRONOUNS = new Set(PRONOUN.split("|"));

/**
 * A line (its English) that names a family role or a gender nobody gave homie: homie never says it.
 * - `names`: what homie was told (the cook's call, the kid's name, the dish), so "Hi, Dad." for a cook called Dad,
 *   or "Dad's Sunday Chili", passes.
 * - `heard`: the cook's own recent words. They allow a role the cook just said ("my son loves this"), never a pronoun.
 * - `check`: "all" (roles and he/she: a hello, the last questions, a tap line), "roles" (a question mid-filming,
 *   where "she" mostly echoes the cook) or "kid" (a reaction: only a guess at how the kid is related).
 */
export function guessesFamily(
  textEn: string,
  given: { names?: readonly (string | undefined)[]; heard?: readonly string[] } = {},
  check: keyof typeof CHECKS = "all",
): boolean {
  const named = new Set((given.names ?? []).flatMap((g) => words(g ?? "")));
  const said = new Set((given.heard ?? []).flatMap(words));
  return [...textEn.matchAll(CHECKS[check])].some(([match]) =>
    words(match).some((w) => !named.has(w) && (PRONOUNS.has(w) || !said.has(w))),
  );
}

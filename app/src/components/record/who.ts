// "Who is it for?" on the pre-record sheet and on Send (Oct 24): each kid's chip is a toggle (tap Leo,
// tap Zoe: both dark; tap Leo again: white), and "Everyone" ticks every kid at once (tapped again, it
// clears them). Every kid ticked is "everyone": the recipe goes to everyone else in the family, cooks
// too. "Everyone" shows only with two kids or more (with one, it would be that kid), or with no kids at
// all, where it stands alone for the rest of the family. Pure, so scripts/test-who.mjs runs it.
//
//   const [who, setWho] = useState<Who | null>(null);
//   const now = who ?? firstWho(kids, others, { requestFrom });
//   onPress={() => setWho(toggleKid(now, kid.id))}     onPress={() => setWho(toggleEveryone(now, kids, others))}
//   const { picked, everyone, recipients, label } = whoTo(now, kids, others);
//   const to = doneTo(me.id, profiles, learners, draft)   who a finished recording goes to (the done
//                                                       view, and a resend after a crash)

export type Person = { id: string; name: string };
/** The ticked kids' ids, or [EVERYONE] in a family with no kids. */
export type Who = string[];

export const EVERYONE = 'everyone';

/** Whether "Everyone" is a chip of its own. */
export const showEveryone = (kids: Person[], others: Person[]) => kids.length >= 2 || (kids.length === 0 && others.length > 0);

const all = (kids: Person[], others: Person[]): Who => (kids.length ? kids.map((k) => k.id) : others.length ? [EVERYONE] : []);

/**
 * Who's ticked before she taps anything: the draft's pick (Send, after the sheet), "Everyone", the kid
 * who asked for the dish, else the first kid, else the rest of the family.
 */
export function firstWho(
  kids: Person[],
  others: Person[],
  from: { picked?: string[] | null; everyone?: boolean; requestFrom?: string | null } = {},
): Who {
  if (from.everyone) return all(kids, others);
  if (from.picked) return from.picked.filter((id) => kids.some((k) => k.id === id));
  if (from.requestFrom && kids.some((k) => k.id === from.requestFrom)) return [from.requestFrom];
  if (kids.length) return [kids[0].id];
  return all(kids, others);
}

export function isEveryone(who: Who, kids: Person[], others: Person[]): boolean {
  if (kids.length === 0) return others.length > 0 && who.includes(EVERYONE);
  return kids.length >= 2 && kids.every((k) => who.includes(k.id));
}

export const toggleKid = (who: Who, id: string): Who => (who.includes(id) ? who.filter((x) => x !== id) : [...who, id]);

export const toggleEveryone = (who: Who, kids: Person[], others: Person[]): Who => (isEveryone(who, kids, others) ? [] : all(kids, others));

/** "Leo", "Leo & Zoe", "Leo, Zoe & Sam". */
export function namesLabel(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * What the pick means: the ticked kids (in the chips' order), whether it's everyone, who gets the recipe,
 * and "Leo & Zoe" / "everyone" / null (nobody: it only goes to her recipes).
 */
export function whoTo<P extends Person>(who: Who, kids: P[], others: P[]): { picked: P[]; everyone: boolean; recipients: P[]; label: string | null } {
  const picked = kids.filter((k) => who.includes(k.id));
  const everyone = isEveryone(who, kids, others);
  const recipients = everyone ? others : picked;
  const label = everyone ? 'everyone' : picked.length ? namesLabel(picked.map((p) => p.name)) : null;
  return { picked, everyone, recipients, label };
}

/**
 * Who a finished recording goes to, from the pre-record sheet's answers (the kids ticked, else the kid
 * who asked, or everyone). `nobody`: there's nobody else in the family.
 */
export function doneTo<P extends Person>(
  meId: string | null | undefined,
  profiles: P[],
  learners: P[],
  d: { forKids: string[] | null; requestFrom: string | null; everyone: boolean },
) {
  const others = profiles.filter((p) => p.id !== meId);
  const kids = learners.filter((p) => p.id !== meId);
  const who = firstWho(kids, others, { picked: d.forKids ?? (d.requestFrom ? [d.requestFrom] : []), everyone: d.everyone });
  return { ...whoTo(who, kids, others), nobody: others.length === 0 };
}

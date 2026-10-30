// A dish card's link opened in the app (docs/build/V2-LINKING.md 2.5–2.7): the kid's /miss?k=… or
// Mom's /a?t=…. What it is and what happens next, decided here; the screens are app/miss.tsx and
// app/a.tsx (components/signin/ClaimLink) and the calls are in lib/live/links.ts. Pure TS
// (node scripts/test-links.mjs).
//
//   parseLinkInfo(body)                   POST /link/open's answer, or null when it isn't one
//   planClaim(info, { signedIn, picked }) what the claim screen does next:
//     no such link (404)                    dead     "This link doesn't work anymore."
//     in a family, someone picked           claim    links.claim, then the card (taken: who has it)
//     in a family, nobody picked yet        pick     "Who's in the kitchen?", then this link again
//     signed out, with a join ticket        join     the join card: the name (prefilled from the card:
//                                                    the kid's, or "Mom"), then Apple or Google with the
//                                                    ticket (link_ticket) makes them a new person in the
//                                                    card's family (docs/build/JOIN-SIMPLE.md §1)
//     signed out, that side claimed before  taken    "This one's already with Mom."
//     signed out, no ticket                 signIn   /join?claim=…: Apple or Google first (no family yet,
//                                                    outside the 30 days, or links not set up)
//   claimHref(kind, token)                '/miss?k=…' or '/a?t=…': the link, to open again once signed in
//   signInHref(href, plan)                /join with that link as ?claim=, plus the name and the role
//   claimFromParam / nameFromParam / roleFromParam   join.tsx's ?claim=, ?name=, ?role=, checked
// Someone signed in to another family still claims their side (2.7): the card shows in their app and
// nobody moves families. Convex decides that, so it's one `claim` here.
import type { Role } from './api';

/** Which link: the kid's card (/miss?k=) or Mom's ask (/a?t=). */
export type LinkKind = 'card' | 'ask';
/** Which side of the card the link is for: the kid (a learner) or the cook (Mom). */
export type LinkSide = 'kid' | 'cook';
/** Why /link/open gave no ticket ('yes': it gave one). */
export type Joinable = 'yes' | 'taken' | 'window' | 'no_family' | 'off';

export type LinkInfo = {
  side: LinkSide;
  dish: string;
  kidName: string | null;
  /** What the kid calls the cook ("Mom", "Grandma"). */
  relation: string | null;
  familyName: string | null;
  /** Someone holds this side now. */
  taken: boolean;
  /** A join ticket for POST /auth/apple|google's `link_ticket`: someone new may join the card's family. */
  ticket: string | null;
  /** The language Mom answered in (to pre-pick her cook language). */
  language: string | null;
  joinable: Joinable;
};

/** links.claim's answer. `taken`: another person holds that side, so nothing changed. */
export type Claimed = { dishAskId: string; side: LinkSide; sameFamily: boolean; taken: boolean };

export type ClaimPlan =
  | { kind: 'dead' }
  | { kind: 'claim' }
  | { kind: 'pick' }
  | { kind: 'join'; ticket: string; name: string | null; role: Role }
  | { kind: 'taken'; name: string | null }
  | { kind: 'signIn'; name: string | null; role: Role; dish: string | null };

const MAX_NAME = 40;
const MAX_DISH = 80;
const JOINABLE: readonly string[] = ['yes', 'taken', 'window', 'no_family', 'off'];
const TOKEN = '[0-9A-Za-z]{22}';
const CLAIM_PATH = new RegExp(`^/(?:miss\\?k|a\\?t)=${TOKEN}$`);

/** Trimmed, one space between words, at most `max` characters; null when empty or not text. */
function clean(v: unknown, max = MAX_NAME): string | null {
  if (typeof v !== 'string') return null;
  return v.trim().replace(/\s+/g, ' ').slice(0, max).trim() || null;
}

/** "mom" → "Mom": /link/open sends the card's relation as stored; the app shows and names her with it. */
const label = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : null);

export function parseLinkInfo(body: unknown): LinkInfo | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const dish = clean(b.dish, MAX_DISH);
  if ((b.side !== 'kid' && b.side !== 'cook') || !dish) return null;
  const ticket = typeof b.ticket === 'string' && b.ticket.trim() ? b.ticket.trim() : null;
  // An older server that doesn't say why: a ticket means yes, none means not now.
  const joinable = typeof b.joinable === 'string' && JOINABLE.includes(b.joinable) ? (b.joinable as Joinable) : ticket ? 'yes' : 'off';
  return {
    side: b.side,
    dish,
    kidName: clean(b.kidName),
    relation: label(clean(b.relation)),
    familyName: clean(b.familyName, MAX_DISH),
    taken: b.taken === true,
    ticket,
    language: clean(b.language, 16),
    joinable,
  };
}

export function parseClaimed(v: unknown): Claimed | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  if (typeof c.dishAskId !== 'string' || !c.dishAskId || (c.side !== 'kid' && c.side !== 'cook')) return null;
  return { dishAskId: c.dishAskId, side: c.side, sameFamily: c.sameFamily === true, taken: c.taken === true };
}

/** Who this side of the card is: the kid by name, the cook by what the kid calls her ("Mom"). The join card's name. */
export function sideName(info: LinkInfo): string | null {
  return info.side === 'kid' ? info.kidName : info.relation;
}

export const roleFor = (side: LinkSide): Role => (side === 'kid' ? 'learner' : 'cook');

/**
 * What the card is called on the sign-in screen ("Sign in to keep Mom's tomato egg."): the kid's card by the cook
 * it's from ("Mom's tomato egg"), Mom's ask by the kid ("Caleb's tomato egg"). A dish typed with that name already
 * ("mom's tomato egg") isn't doubled.
 */
export function cardTitle(info: LinkInfo): string {
  const whose = info.side === 'kid' ? info.relation : info.kidName;
  if (!whose) return info.dish;
  const plain = (x: string) => x.toLowerCase().replace(/’/g, "'");
  if (plain(info.dish).startsWith(`${plain(whose)}'s `)) return info.dish;
  return clean(`${whose}’s ${info.dish}`, MAX_DISH) ?? info.dish;
}

/** `signedIn`: this phone is in a family. `picked`: someone is in (`me`). */
export function planClaim(info: LinkInfo | null, who: { signedIn: boolean; picked: boolean }): ClaimPlan {
  if (!info) return { kind: 'dead' };
  if (who.signedIn) return who.picked ? { kind: 'claim' } : { kind: 'pick' };
  const name = sideName(info);
  const role = roleFor(info.side);
  if (info.ticket) return { kind: 'join', ticket: info.ticket, name, role };
  // One automatic join per side, ever (2.3): once claimed, the link asks for an invite instead.
  if (info.joinable === 'taken') return { kind: 'taken', name };
  return { kind: 'signIn', name, role, dish: cardTitle(info) };
}

export function claimHref(kind: LinkKind, token: string): string {
  return kind === 'card' ? `/miss?k=${token}` : `/a?t=${token}`;
}

/** /join with the link to open again, the name and role, and what the card is called (its "keep" line). */
export function signInHref(href: string, who: { name: string | null; role: Role; dish?: string | null }) {
  return {
    pathname: '/join' as const,
    params: { claim: href, role: who.role, ...(who.name ? { name: who.name } : {}), ...(who.dish ? { dish: who.dish } : {}) },
  };
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A claim link to open again: '/miss?k=…' or '/a?t=…' only (never any other path). */
export function claimFromParam(v: string | string[] | undefined): string | null {
  const s = one(v);
  return s && CLAIM_PATH.test(s) ? s : null;
}

export function nameFromParam(v: string | string[] | undefined): string | null {
  return clean(one(v));
}

export function dishFromParam(v: string | string[] | undefined): string | null {
  return clean(one(v), MAX_DISH);
}

export function roleFromParam(v: string | string[] | undefined): Role | null {
  const s = one(v);
  return s === 'learner' || s === 'cook' ? s : null;
}

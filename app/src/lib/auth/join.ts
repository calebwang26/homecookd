// What a sign-in from a link sends, and what a refusal means (docs/build/JOIN-SIMPLE.md §3). SessionProvider
// signs in; this is the pure part (node scripts/test-signin.mjs):
//   linkFields(opts)    SignInOptions -> POST /auth/apple|google's join_token / link_ticket / role / move /
//                       claim_profile_id
//   signInFailure(e)    a refused sign-in -> its sentence and which card it calls for (`why`)
//   claimStep(...)      "Are you Leo?" on a family link's card: whether to ask, and what sign-in sends
import { ApiError, errorMessage, type Claimable, type InviteState, type ProviderAuthInput, type Role } from '../api';

/**
 * The link someone signs in from (one at most): `joinToken` (/i?t=, 22 characters for a family join
 * link, 16 for an older invite) or `linkTicket` (a dish card's, from Convex's /link/open). `name` and
 * `role` come from its card (a ticket's side sets the role); `move` only after "Join <B> instead?";
 * `claimProfileId` only after "Are you Leo?" -> "Yes, that's me" (a join token's card).
 */
export type SignInOptions = {
  joinToken?: string | null;
  linkTicket?: string | null;
  role?: Role | null;
  move?: boolean;
  name?: string | null;
  claimProfileId?: string | null;
};

export type LinkFields = Pick<ProviderAuthInput, 'join_token' | 'link_ticket' | 'role' | 'move' | 'claim_profile_id'>;

/** Why a sign-in was refused, for the card to show (anything else is only `error`). */
export type SignInFailure =
  | 'name' // "Asha is already in this family": a different name fixes it
  | 'link-used' // that side of the card already brought someone in (409 LINK_USED)
  | 'gone' // an invite or join link that's used, expired or turned off (410)
  | 'bad-ticket' // the card's ticket didn't check out (403): open the link again for a fresh one
  | 'not-found'; // no such link (404)

export type SignInRefused = { status: 'error'; error: string; why?: SignInFailure; invite?: Exclude<InviteState, 'pending'> };

const MAX_NAME = 40;

/** Trimmed, one space between words, at most 40 characters ('' when empty). */
export const cleanName = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME).trim();

/**
 * The link fields of SignInOptions: one link at most (a token wins over a ticket); a ticket's side sets the
 * role; a claim goes only with a join token, and then the person keeps their own role.
 */
export function linkFields(opts: SignInOptions = {}): LinkFields {
  const joinToken = opts.joinToken?.trim() || null;
  const linkTicket = joinToken ? null : opts.linkTicket?.trim() || null;
  const claim = joinToken ? opts.claimProfileId?.trim() || null : null;
  return {
    ...(joinToken ? { join_token: joinToken } : linkTicket ? { link_ticket: linkTicket } : null),
    ...(opts.role && !linkTicket && !claim ? { role: opts.role } : null),
    ...(opts.move && (joinToken || linkTicket) ? { move: true } : null),
    ...(claim ? { claim_profile_id: claim } : null),
  };
}

/** A refused sign-in in people's words, and which card it calls for. */
export function signInFailure(e: unknown): SignInRefused {
  const error = errorMessage(e);
  if (!(e instanceof ApiError)) return { status: 'error', error };
  const code = typeof e.body?.code === 'string' ? e.body.code : '';
  if (e.status === 409) return { status: 'error', error, why: code === 'LINK_USED' || /brought someone in/i.test(error) ? 'link-used' : 'name' };
  if (e.status === 410) {
    const s = e.body?.status;
    return { status: 'error', error, why: 'gone', invite: s === 'expired' || s === 'revoked' ? s : 'used' };
  }
  if (e.status === 403) return { status: 'error', error, why: 'bad-ticket' };
  if (e.status === 404) return { status: 'error', error, why: 'not-found' };
  if (e.status === 400 && /\bname\b/i.test(error)) return { status: 'error', error, why: 'name' };
  return { status: 'error', error };
}

// ---- "Are you Leo?" (a family join link's card)

/** A name as the server compares it for a claim: cleanName, lowercase. */
export const nameKey = (s: string | null | undefined) => cleanName(s).toLowerCase();

/** What a peek with a name answered: `name` is the nameKey it was asked for. */
export type ClaimFound = { name: string; claimable: Claimable | null };
/** "Yes, that's me" (`me`) or "No, I'm someone else", for the name (nameKey) it was given for. */
export type ClaimAnswer = { name: string; me: boolean };

export type ClaimStep = {
  /** Whom to ask about (the face and "Are you Leo?"); null: nothing to ask. */
  ask: Claimable | null;
  /** The answer for the name typed now (true: that's me); null until they pick. */
  me: boolean | null;
  /** The Apple button shows: nothing to ask, or they answered. */
  ready: boolean;
  /** The role chips show: nothing to ask, or "No, I'm someone else" (Leo keeps his own role). */
  showRole: boolean;
  /** What sign-in sends as claimProfileId. */
  claimProfileId: string | null;
  /** The settled peek isn't back for this name: peek before signing in. */
  needsPeek: boolean;
};

/**
 * The card's step for the name typed now. A peek or an answer for another name doesn't count, so changing
 * the name clears the answer (extra spaces or capitals aren't a change).
 */
export function claimStep(typed: string, found: ClaimFound | null, answer: ClaimAnswer | null): ClaimStep {
  const key = nameKey(typed);
  const ask = key && found?.name === key ? found.claimable : null;
  const me = ask && answer?.name === key ? answer.me : null;
  return {
    ask,
    me,
    ready: !ask || me !== null,
    showRole: !ask || me === false,
    claimProfileId: ask && me ? ask.id : null,
    needsPeek: !!key && found?.name !== key,
  };
}

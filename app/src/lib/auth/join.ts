// What a sign-in from a link sends, and what a refusal means (docs/build/JOIN-SIMPLE.md §3). SessionProvider
// signs in; this is the pure part (node scripts/test-signin.mjs):
//   linkFields(opts)    SignInOptions -> POST /auth/apple|google's join_token / link_ticket / role / move
//   signInFailure(e)    a refused sign-in -> its sentence and which card it calls for (`why`)
import { ApiError, errorMessage, type InviteState, type ProviderAuthInput, type Role } from '../api';

/**
 * The link someone signs in from (one at most): `joinToken` (/i?t=, 22 characters for a family join
 * link, 16 for an older invite) or `linkTicket` (a dish card's, from Convex's /link/open). `name` and
 * `role` come from its card (a ticket's side sets the role); `move` only after "Join <B> instead?".
 */
export type SignInOptions = { joinToken?: string | null; linkTicket?: string | null; role?: Role | null; move?: boolean; name?: string | null };

export type LinkFields = Pick<ProviderAuthInput, 'join_token' | 'link_ticket' | 'role' | 'move'>;

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

/** The link fields of SignInOptions: one link at most (a token wins over a ticket); a ticket's side sets the role. */
export function linkFields(opts: SignInOptions = {}): LinkFields {
  const joinToken = opts.joinToken?.trim() || null;
  const linkTicket = joinToken ? null : opts.linkTicket?.trim() || null;
  return {
    ...(joinToken ? { join_token: joinToken } : linkTicket ? { link_ticket: linkTicket } : null),
    ...(opts.role && !linkTicket ? { role: opts.role } : null),
    ...(opts.move && (joinToken || linkTicket) ? { move: true } : null),
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

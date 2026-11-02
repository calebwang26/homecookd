// The Accounts routes for 1.1: sign-in, sessions, the family and its people, links, sign-out and deleting an
// account. Contract: docs/build/contracts/ACCOUNTS.md on aws-migration. Screens move onto these behind
// AWS_ON (config.ts); nothing calls them while it's off.
//
// The family routes speak snake_case and call a kid `learner`; /v1 speaks camelCase and says `kid`. These
// types keep each route's own words, as the contract does.

import { request, session, setAwsCredentials, type Session } from './client';

export type Role11 = 'cook' | 'learner';

export type SignInAnswer =
  | { existing: boolean; needs_name: true; suggested_name: string | null }
  | {
      existing: true;
      needs_move: true;
      from_family: string;
      to_family: string;
      /** Deleted by the move: warn first. */
      would_delete: { profile_id: string; name: string }[];
    }
  | {
      existing: boolean;
      needs_name: false;
      joined: boolean;
      device_key: string;
      family_name: string;
      profile_id: string;
      moved?: { receipt: string | null };
    };

export type SignInInput = {
  name?: string;
  role?: Role11;
  device_label?: string;
  join_token?: string;
  link_ticket?: string;
  claim_profile_id?: string;
  move?: boolean;
  share_token?: string;
};

export type FamilyPerson = {
  id: string;
  name: string;
  role: 'cook' | 'learner';
  relation: string | null;
  avatar_key: string | null;
  invited: boolean;
  has_phone: boolean;
  /** Their own phone, not this one: show them, never act as them. */
  locked: boolean;
  memorial: boolean;
};

export type FamilyAnswer = {
  family: { id: string; name: string };
  profiles: FamilyPerson[];
  /** People who left: only for drawing old messages. */
  former_profiles: { id: string; name: string; role: 'cook' | 'learner'; relation: string | null; avatar_key: string | null }[];
  device_profile_id: string | null;
};

export type Me = { person: { id: string; name: string; role: 'cook' | 'kid'; language: string | null }; family: { id: string; name: string } };

export type LinkPeek = {
  status: 'pending' | 'expired' | 'revoked';
  family_name: string;
  inviter: { name: string; relation: string | null; avatar_key: string | null } | null;
  expires_at: string | null;
  same_family?: boolean;
  kind: 'link';
  claimable: { id: string; name: string; avatar_key: string | null } | null;
};

export type CardOpen = {
  side: 'kid' | 'cook';
  dish: string;
  kidName: string | null;
  relation: string;
  familyName: string | null;
  taken: boolean;
  ticket: string | null;
  language: string | null;
  joinable: 'yes' | 'taken' | 'window' | 'no_family' | 'off';
};

/** Sign-in waits up to 5 s for Apple's keys on the server; give it room. */
const SIGN_IN_TIMEOUT_MS = 25_000;

/**
 * Sign in with Apple's identityToken. When the answer has a device key, this phone now holds it: the caller
 * saves it (storage.ts secrets) and starts the session with `session()`.
 */
export async function signInWithApple(idToken: string, input: SignInInput = {}): Promise<SignInAnswer> {
  const a = await request<SignInAnswer>('/auth/apple', { auth: 'none', body: { id_token: idToken, ...input }, timeoutMs: SIGN_IN_TIMEOUT_MS });
  if ('device_key' in a) setAwsCredentials({ deviceKey: a.device_key, personId: a.profile_id });
  return a;
}

export const accounts = {
  /** This phone's own session (or `as` a phone-less person's): {sessionToken, familyId, personId, role}. */
  session: (as?: string | null): Promise<Session> => session(as),
  me: (as?: string | null) => request<Me>('/v1/me', { auth: 'session', as }),
  family: (as?: string | null) => request<FamilyAnswer>('/family', { auth: 'key', as }),
  /** Someone with no phone of their own. */
  addPerson: (input: { name: string; role: Role11; relation?: string | null }, as?: string | null) =>
    request<{ id: string; name: string; role: Role11; relation: string | null; avatar_key: string | null }>('/profiles', {
      auth: 'key',
      as,
      body: input,
    }),
  /** Leave the family, as `personId` (this phone's own person signs the phone out). */
  leave: (personId: string) =>
    request<{ ok: true }>(`/profiles/${encodeURIComponent(personId)}/remove`, { auth: 'key', as: personId, body: {} }),
  joinLink: (as: string) => request<{ url: string; expires_at: string | null }>('/join-links', { auth: 'key', as, body: {} }),
  revokeJoinLink: (as: string) => request<{ ok: true }>('/join-links/revoke', { auth: 'key', as, body: {} }),
  peekLink: (token: string, name?: string | null) =>
    request<LinkPeek>('/invites/peek', { auth: 'none', body: name ? { token, name } : { token } }),
  /** Sign this phone out: the key and every session on it stop at once. The caller clears what it saved. */
  signOut: () => request<{ ok: true }>('/devices/revoke', { auth: 'key', body: {} }),
  appleRevokeReady: () => request<{ ready: boolean }>('/v1/apple/revoke-ready', { auth: 'session' }),
  appleRevoke: (authorizationCode: string) =>
    request<{ revoked: boolean; reason?: string }>('/v1/apple/revoke', { auth: 'session', body: { authorizationCode }, timeoutMs: 40_000 }),
  /** Delete this person's account (`as` a phone-less person to delete them). A retry's 401 means it worked. */
  deleteAccount: (as?: string | null) => request<{ deleted: true }>('/v1/account/delete', { auth: 'session', as, body: {} }),
  openCard: (token: string) => request<CardOpen>('/link/open', { auth: 'none', body: { token } }),
  claimCard: (token: string) =>
    request<{ dishAskId: string; side: 'kid' | 'cook'; sameFamily: boolean; taken: boolean }>('/v1/links/claim', { auth: 'session', body: { token } }),
  /** After a move: bring their recipes along. */
  moved: (receipt: string) => request<{ recipes: number; faces: number }>('/v1/links/moved', { auth: 'session', body: { receipt } }),
};

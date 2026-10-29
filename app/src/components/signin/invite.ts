// What the /i screen shows for a family join link (22 characters) or an older invite (16): what it
// says (POST /invites/peek) set against who this phone is signed in as (docs/build/JOIN-SIMPLE.md §1).
// Pure, so the screen and its dev fixtures draw the same cards.
//
//   join      pending, signed out: the join card, "Join Test family" (the family's own name, never the
//             inviter's, so every link into one family reads the same: QA B28), "Mom sent this.", the
//             name, the role chips and Sign in with Apple (components/signin/JoinCard)
//   move      pending, signed in to another family: "You're in Wang family. Join Test family
//             instead?" (components/signin/MoveCard)
//   already   this phone is signed in to that family: "You're already in." -> Profiles (so Mom
//             opening her own link never uses it up)
//   gone      used, expired or turned off: the sentence + "Ask Mom for a new one."
//   missing   no such link (404) or a broken one: Back to start
//   unreachable  offline, too many tries or server trouble: Try again
// "That family": the server says so (peek's `same_family`, answered when this phone sends its key).
// Without that answer (an older server), i.tsx refreshes the family and matches it by sight: the
// same family name, the invited person and the inviter are in it, and a pending invite's person is
// still "invited" there (a person of that name who already joined means another family that just
// looks the same). A family invite names nobody, so the family name and the inviter must do.
import type { Family, InvitePeek, InviteState, Profile } from '@/lib/api';
import { english, type T, type WordKey } from '@/lib/words/words';

export type Gone = Exclude<InviteState, 'pending'>;

export type Peeked =
  | { state: 'loading' }
  | { state: 'ok'; peek: InvitePeek }
  | { state: 'missing'; sentence: string }
  /** Offline, rate-limited or server trouble: `line` says what to do. */
  | { state: 'unreachable'; sentence: string; line: string };

/** This phone, as far as an invite cares. null while the session is still loading. */
export type Viewer = { signedIn: boolean; family: Family | null; profiles: Profile[] } | null;

export type InviteView =
  | { kind: 'loading' }
  | { kind: 'join'; peek: InvitePeek }
  /** `from`: the family this phone is in now; `to`: the link's. */
  | { kind: 'move'; peek: InvitePeek; from: string; to: string }
  | { kind: 'already'; peek: InvitePeek }
  | { kind: 'gone'; peek: InvitePeek | null; status: Gone; sentence: string }
  | { kind: 'missing'; sentence: string }
  | { kind: 'unreachable'; sentence: string; line: string };

/** The server's own sentences for an invite, so the web page and the app agree (keys for t()). */
export const GONE_SENTENCE: Record<Gone, WordKey> = {
  used: 'signin.invite.used',
  expired: 'signin.invite.expired',
  revoked: 'signin.invite.revoked',
};
/** The same for a family join link (it's never used up: anyone can use it until it expires). */
const LINK_GONE: Record<Gone, WordKey> = {
  used: 'signin.invite.linkExpired',
  expired: 'signin.invite.linkExpired',
  revoked: 'signin.invite.linkRevoked',
};
export const goneSentence = (peek: InvitePeek, status: Gone, t: T = english) => t((peek.kind === 'link' ? LINK_GONE : GONE_SENTENCE)[status]);
// Our own sentences, as keys for t().
export const NOT_FOUND = 'signin.invite.notFound' satisfies WordKey;
export const UNREACHABLE = 'signin.invite.unreachable' satisfies WordKey;
export const CHECK_CONNECTION = 'signin.invite.checkConnection' satisfies WordKey;
export const OUR_SIDE = 'signin.invite.ourSide' satisfies WordKey;
export const TRY_SOON = 'signin.invite.trySoon' satisfies WordKey;

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const byName = (people: Profile[], name: string | null | undefined) => people.find((p) => norm(p.name) === norm(name)) ?? null;

function inThatFamily(peek: InvitePeek, viewer: NonNullable<Viewer>): boolean {
  if (!viewer.signedIn || !viewer.family) return false;
  if (typeof peek.same_family === 'boolean') return peek.same_family;
  if (norm(viewer.family.name) !== norm(peek.family_name)) return false;
  if (peek.invitee) {
    const invitee = byName(viewer.profiles, peek.invitee.name);
    if (!invitee || (peek.status === 'pending' && !invitee.invited)) return false;
  }
  return !peek.inviter || !!byName(viewer.profiles, peek.inviter.name);
}

export function describeInvite(peeked: Peeked, viewer: Viewer, t: T = english): InviteView {
  if (peeked.state === 'missing') return { kind: 'missing', sentence: peeked.sentence };
  if (peeked.state === 'unreachable') return { kind: 'unreachable', sentence: peeked.sentence, line: peeked.line };
  if (peeked.state === 'loading' || !viewer) return { kind: 'loading' };
  const { peek } = peeked;
  if (inThatFamily(peek, viewer)) return { kind: 'already', peek };
  if (peek.status !== 'pending') return { kind: 'gone', peek, status: peek.status, sentence: goneSentence(peek, peek.status, t) };
  if (viewer.signedIn && viewer.family) return { kind: 'move', peek, from: familyName(viewer.family.name), to: familyName(peek.family_name) };
  return { kind: 'join', peek };
}

/**
 * A family's own name, as it is ("Caleb's family", "Test family"), mid-sentence: "Our family" ->
 * "our family", "The Wangs" -> "the Wangs". The last two words stay on one line (a no-break space).
 */
export function familyName(family: string): string {
  return family
    .trim()
    .replace(/^(Our|The)\b/, (w) => w.toLowerCase())
    .replace(/ (?=\S+$)/, '\u00A0');
}

/** "Join Test family" / "Join our family": the family's own name (the web /i page says the same). */
export function joinTitle(peek: InvitePeek, t: T = english): string {
  const name = familyName(peek.family_name);
  return name ? t('signin.joinCard.title', { family: name }) : t('signin.joinCard.titleYours');
}

/** "Mom sent this.", naming whoever sent the link; null when it doesn't say. */
export function sentBy(peek: InvitePeek, t: T = english): string | null {
  const from = peek.inviter?.name?.trim();
  return from ? t('signin.joinCard.sent', { name: from }) : null;
}

/** "Ask Mom for a new one." */
export const askForNew = (peek: InvitePeek | null, t: T = english) => {
  const name = peek?.inviter?.name?.trim();
  return name ? t('signin.invite.askFor', { name }) : t('signin.invite.askFamily');
};

// ---------------------------------------------------------------------------------------------
// Dev fixtures (web screenshots before the backend is live)

export const INVITE_FIXTURES = ['pending', 'used', 'expired', 'revoked', 'notfound', 'offline', 'already', 'other'] as const;
export type InviteFixture = (typeof INVITE_FIXTURES)[number];

export function isInviteFixture(v: string | undefined): v is InviteFixture {
  return !!v && (INVITE_FIXTURES as readonly string[]).includes(v);
}

// A real family: nobody but the seeded demo family has an avatar_key, so these draw initials.
const person = (id: string, name: string, role: Profile['role'], extra: Partial<Profile> = {}): Profile => ({
  id,
  name,
  role,
  relation: null,
  avatar_key: null,
  ...extra,
});

/**
 * A family join link (for nobody in particular) by default; `to=Dad` or `role=learner` (Leo) is an
 * older invite for one person; `from=none` hides the inviter, `from=Dad` changes them.
 */
export function inviteFixture(
  kind: InviteFixture,
  opts: { role?: string; from?: string; to?: string } = {},
  t: T = english,
): { peeked: Peeked; viewer: Viewer } {
  if (kind === 'notfound') return { peeked: { state: 'missing', sentence: t(NOT_FOUND) }, viewer: null };
  if (kind === 'offline') return { peeked: { state: 'unreachable', sentence: t(UNREACHABLE), line: t(CHECK_CONNECTION) }, viewer: null };
  const from = opts.from === 'none' ? null : opts.from?.trim() || 'Mom';
  const learner = opts.role === 'learner';
  const named = learner || (!!opts.to && opts.to !== 'none');
  const invitee = learner ? person('p-leo', 'Leo', 'learner') : person('p-dad', 'Dad', 'cook');
  const status: InviteState = kind === 'used' || kind === 'expired' || kind === 'revoked' ? kind : 'pending';
  const peek: InvitePeek = {
    status,
    family_name: 'Mom’s family',
    inviter: from ? { name: from, relation: from, avatar_key: null } : null,
    invitee: named ? { name: invitee.name, role: invitee.role, avatar_key: invitee.avatar_key } : null,
    expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    ...(named ? null : { kind: 'link' as const }),
    ...(kind === 'already' ? { same_family: true } : kind === 'other' ? { same_family: false } : null),
  };
  const signedOut: Viewer = { signedIn: false, family: null, profiles: [] };
  const inviter = from ? [person('p-inviter', from, 'cook')] : [];
  const viewer: Viewer =
    kind === 'already'
      ? { signedIn: true, family: { id: 'f-mom', name: 'Mom’s family' }, profiles: [...inviter, { ...invitee, invited: true }] }
      : kind === 'other'
        ? { signedIn: true, family: { id: 'f-sam', name: 'Sam’s family' }, profiles: [person('p-sam', 'Sam', 'cook')] }
        : signedOut;
  return { peeked: { state: 'ok', peek }, viewer };
}

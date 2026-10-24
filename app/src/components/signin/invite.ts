// What the /i screen shows for an invite: what the invite says (POST /invites/peek) set against who
// this phone is signed in as. Pure, so the screen and its dev fixtures draw the same cards.
//
//   join      pending: "Join Test family?" (+ "instead" when signed in to another family): the
//             family's own name, never the inviter's, so every invite into one family reads the same
//             (QA B28). The line under it names the sender beside their face: "Mom invited you as
//             Dad." for one person, "Mom invited you." for a family invite (`invitee` null, Oct 17
//             E3: whoever opens it says who they are on Profiles)
//   already   this phone is signed in to that family: "You're already in." -> Profiles (so Mom
//             opening her own link never uses it up)
//   gone      used, expired or turned off: the server's sentence + "Ask Mom for a new one."
//   missing   no such invite (404) or a broken link: Back to start (or "Type it again" for a code)
//   unreachable  offline, too many tries or server trouble: Try again
// "That family": the server says so (peek's `same_family`, answered when this phone sends its key).
// Without that answer (an older server), i.tsx refreshes the family and matches it by sight: the
// same family name, the invited person and the inviter are in it, and a pending invite's person is
// still "invited" there (a person of that name who already joined means another family that just
// looks the same). A family invite names nobody, so the family name and the inviter must do.
import type { Family, InvitePeek, InviteState, Profile } from '@/lib/api';

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
  | { kind: 'join'; peek: InvitePeek; instead: boolean }
  | { kind: 'already'; peek: InvitePeek }
  | { kind: 'gone'; peek: InvitePeek | null; status: Gone; sentence: string }
  | { kind: 'missing'; sentence: string }
  | { kind: 'unreachable'; sentence: string; line: string };

/** The server's own sentences (POST /invites/accept), so the web page and the app agree. */
export const GONE_SENTENCE: Record<Gone, string> = {
  used: 'This invite was already used.',
  expired: 'This invite expired.',
  revoked: 'This invite was turned off.',
};
export const NOT_FOUND = 'That invite link doesn’t work.';
/** The server's 404 for a typed code. */
export const CODE_NOT_FOUND = 'That invite code doesn’t work.';
export const UNREACHABLE = 'We can’t reach homecookd.';
export const CHECK_CONNECTION = 'Check your connection and try again.';
export const OUR_SIDE = 'Something went wrong on our side.';
export const TRY_SOON = 'Try again in a minute.';

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

export function describeInvite(peeked: Peeked, viewer: Viewer): InviteView {
  if (peeked.state === 'missing') return { kind: 'missing', sentence: peeked.sentence };
  if (peeked.state === 'unreachable') return { kind: 'unreachable', sentence: peeked.sentence, line: peeked.line };
  if (peeked.state === 'loading' || !viewer) return { kind: 'loading' };
  const { peek } = peeked;
  if (inThatFamily(peek, viewer)) return { kind: 'already', peek };
  if (peek.status !== 'pending') return { kind: 'gone', peek, status: peek.status, sentence: GONE_SENTENCE[peek.status] };
  return { kind: 'join', peek, instead: viewer.signedIn && !!viewer.family };
}

/** "Our family" -> "our family", "The Wangs" -> "the Wangs" (mid-sentence). */
function midSentence(family: string): string {
  return family.trim().replace(/^(Our|The)\b/, (w) => w.toLowerCase());
}

/**
 * "Join Test family?" / "Join Test family instead?" / "Join our family?": the family's own name (the
 * web /i page and the share card say the same). Without "instead", the name's last two words stay on
 * one line (a no-break space), so it never ends on a lone "family?".
 */
export function joinTitle(peek: InvitePeek, instead = false): string {
  const name = midSentence(peek.family_name) || 'your family';
  return `Join ${instead ? name : name.replace(/ (?=\S+$)/, '\u00A0')}${instead ? ' instead' : ''}?`;
}

/**
 * The line under the title, naming the sender beside their face: "Mom invited you as Dad." /
 * "Mom invited you." (a family invite names nobody); with no sender, "You're joining as Dad." or null.
 */
export function joiningAs(peek: InvitePeek): string | null {
  const from = peek.inviter?.name?.trim();
  const as = peek.invitee?.name.trim();
  if (from) return as ? `${from} invited you as ${as}.` : `${from} invited you.`;
  return as ? `You’re joining as ${as}.` : null;
}

/** "Ask Mom for a new one." */
export const askForNew = (peek: InvitePeek | null) => `Ask ${peek?.inviter?.name?.trim() || 'your family'} for a new one.`;

// ---------------------------------------------------------------------------------------------
// Dev fixtures (web screenshots before the backend is live)

export const INVITE_FIXTURES = ['pending', 'used', 'expired', 'revoked', 'notfound', 'badcode', 'offline', 'already', 'other'] as const;
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
 * `role=learner` invites Leo instead of Dad; `to=none` is a family invite (for nobody in
 * particular); `from=none` hides the inviter, `from=Dad` changes them.
 */
export function inviteFixture(kind: InviteFixture, opts: { role?: string; from?: string; to?: string } = {}): { peeked: Peeked; viewer: Viewer } {
  if (kind === 'notfound') return { peeked: { state: 'missing', sentence: NOT_FOUND }, viewer: null };
  if (kind === 'badcode') return { peeked: { state: 'missing', sentence: CODE_NOT_FOUND }, viewer: null };
  if (kind === 'offline') return { peeked: { state: 'unreachable', sentence: UNREACHABLE, line: CHECK_CONNECTION }, viewer: null };
  const from = opts.from === 'none' ? null : opts.from?.trim() || 'Mom';
  const learner = opts.role === 'learner';
  const invitee = learner ? person('p-leo', 'Leo', 'learner') : person('p-dad', 'Dad', 'cook');
  const status: InviteState = kind === 'used' || kind === 'expired' || kind === 'revoked' ? kind : 'pending';
  const peek: InvitePeek = {
    status,
    family_name: 'Mom’s family',
    inviter: from ? { name: from, relation: from, avatar_key: null } : null,
    invitee: opts.to === 'none' ? null : { name: invitee.name, role: invitee.role, avatar_key: invitee.avatar_key },
    expires_at: new Date(Date.now() + 13 * 86_400_000).toISOString(),
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

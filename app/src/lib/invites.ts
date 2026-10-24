// Inviting family (docs/build/FEEDBACK-OCT16c.md E2, and B3 for the older paths). The shared logic
// behind the invite sheet (components/profiles/AddFamilySheet, a Spotify-style share sheet whose
// app row is components/share/ExternalRow) and "Send again" (PersonSheet, MembersSheet).
// Any other screen that invites someone opens <AddFamilySheet visible onClose />.
//
// The family invite (the usual one, Oct 17):
//   createFamilyInvite(from)             POST /invites {}: one link, one use, 14 days, for whoever
//                                        opens it (they add themselves on "Who's in the kitchen?").
//                                        The sheet makes one per opening and every button reuses it.
//   familyInviteText(url)                "Join our family table on homecookd: <url>"
//
// Someone invited the old way who hasn't joined ("Send again" in profiles/PersonSheet and
// messages/MembersSheet):
//   sendInvite({ profileId, phone? })    the link this phone still holds for them (below), else a
//                                        fresh one (POST /invites {profile_id}; older ones stop),
//                                        then Messages (the share sheet where there's no Messages)
//   sendInvite({ name, role, phone? })   the older "someone new by name" invite, kept for callers
//     -> { status, url?, error?, profile?, invite?, copied? }
//        'sent'       Messages says it went (Android can't tell, so it counts as sent)
//        'shared'     no Messages on this device: the system share sheet went through, or on the
//                     web the link was copied instead (`copied`)
//        'cancelled'  they backed out; the invite stays good for 14 days (`url` still works)
//        'error'      `error` is a sentence to show; with `url` set the invite was made anyway
//   deliverInvite({ name, url, phone })  Messages (or the share sheet) for an invite already made
//   forgetInvite(profileId)              drop the link held for someone (they were removed)
//   inviteText(name, url)                "Dad, join our family table on homecookd: <url>"
//   copyInviteLink(url)                  the clipboard; true when it worked
//
// Held links. A re-invite link that may not have reached them yet (Messages was cancelled or didn't
// open, or it was only copied) is kept in memory for this launch, and the next "Send again" re-sends
// that same link. A fresh link would turn off every older one, including one Mom already pasted to
// Dad, and if she then backed out again no working link would exist anywhere. A link that went out
// is let go, so a later "Send again" makes a fresh one as the plan says.
//
// The text goes out from the sender's own phone: iMessage turns off links from unknown senders, so
// a link from Mom works where a text from a company may not, and it costs nothing. The server never
// texts anyone. The sender is the current person (x-profile-id), or `from` when nobody is picked yet
// (the Profiles screen). Never log a link.
import { Platform, Share } from 'react-native';

import { copyLink, openMessages } from '@/components/share/shareLink';

import { ApiError, api, errorMessage, type Invite, type NewInvite, type Profile, type Role } from './api';

export type InviteStatus = 'sent' | 'shared' | 'cancelled' | 'error';

/** What happened when the text was handed to Messages (or the share sheet). */
export type Delivered = { status: InviteStatus; error?: string; copied?: boolean };

export type SendInviteResult = Delivered & {
  /** The invite link (also set after a cancel or a delivery error: the invite exists). */
  url?: string;
  /** The person invited: made just now, or the one re-invited. */
  profile?: Profile;
  invite?: Invite;
};

export type SendInviteInput =
  | { name: string; role: Role; phone?: string | null; relation?: string | null }
  /** `phone` replaces the number picked last time. */
  | { profileId: string; phone?: string | null };

const SHARE_TITLE = 'Join our family table';
const NO_MESSAGES = 'Messages didn’t open. Tap Copy link and text it to them.';
const NO_SENDER = 'Tap your face first, then invite family.';
const NOT_MADE = 'That invite didn’t go through. Try again.';

// ---------------------------------------------------------------------------------------------
// The words

/** "Dad, join our family table on homecookd: https://homecookd.app/i?t=…" */
export function inviteText(name: string, url: string): string {
  const who = name.trim();
  return who ? `${who}, join our family table on homecookd: ${url}` : familyInviteText(url);
}

/** "Join our family table on homecookd: https://homecookd.app/i?t=…" */
export function familyInviteText(url: string): string {
  return `Join our family table on homecookd: ${url}`;
}

// ---------------------------------------------------------------------------------------------
// The family invite

/**
 * POST /invites {} sent as `from`: a link for whoever opens it. Throws an ApiError whose message is
 * a sentence to show (offline, or nobody to send it as).
 */
export async function createFamilyInvite(from: string | null): Promise<Invite> {
  if (!from) throw new ApiError(NO_SENDER, 0, 'config');
  const { invite } = await api.createInvite({}, { profileId: from });
  return invite;
}

// ---------------------------------------------------------------------------------------------
// Re-inviting someone who hasn't joined

type Held = { invite: Invite; profile: Profile };
/** Links that may not have reached them yet, by profile id (memory only, this launch). */
const held = new Map<string, Held>();

function heldFor(profileId: string): Held | null {
  const h = held.get(profileId);
  if (!h) return null;
  if (Date.parse(h.invite.expires_at) > Date.now()) return h;
  held.delete(profileId);
  return null;
}

/** POST /invites for someone by name or a re-invite. Throws an ApiError with a sentence. */
async function makeInvite(input: SendInviteInput, from: string | null | undefined): Promise<Held> {
  const body: NewInvite =
    'profileId' in input
      ? { profile_id: input.profileId, ...(input.phone ? { phone: input.phone } : null) }
      : { name: input.name.trim(), role: input.role, relation: input.relation ?? null, phone: input.phone ?? null };
  const res = await api.createInvite(body, from ? { profileId: from } : {});
  if (!res.profile) throw new ApiError(NOT_MADE, 0, 'parse');
  return { invite: res.invite, profile: res.profile };
}

/** Someone was removed: their links are off, so never re-send one. */
export function forgetInvite(profileId: string): void {
  held.delete(profileId);
}

/** Make the invite (for someone not yet joined: re-send the held link, else a fresh one), then open Messages. */
export async function sendInvite(input: SendInviteInput, opts: { from?: string | null } = {}): Promise<SendInviteResult> {
  let made = 'profileId' in input ? heldFor(input.profileId) : null;
  if (!made) {
    try {
      made = await makeInvite(input, opts.from);
    } catch (e) {
      return { status: 'error', error: errorMessage(e, NOT_MADE) };
    }
  }
  const phone = input.phone || keptPhone(made.invite);
  const sent = await deliverInvite({ name: made.profile.name, url: made.invite.url, phone });
  // Hold the link until it surely went out (Messages sent, or the share sheet went through).
  if (sent.status === 'sent' || (sent.status === 'shared' && !sent.copied)) held.delete(made.profile.id);
  else held.set(made.profile.id, made);
  return { ...sent, url: made.invite.url, profile: made.profile, invite: made.invite };
}

/**
 * Messages with the text filled in (to `phone` when we have it), else the system share sheet, else
 * (the web) the link on the clipboard. Never throws.
 */
export async function deliverInvite({ name, url, phone }: { name: string; url: string; phone?: string | null }): Promise<Delivered> {
  const text = inviteText(name, url);
  const r = await openMessages(text, phone);
  if (r === 'sent' || r === 'opened') return { status: 'sent' };
  if (r === 'cancelled') return { status: 'cancelled' };
  const shared = await shareSheet(text);
  if (shared === 'shared') return { status: 'shared' };
  if (shared === 'dismissed') return { status: 'cancelled' };
  if (await copyInviteLink(url)) return { status: 'shared', copied: true };
  return { status: 'error', error: NO_MESSAGES };
}

/** The system share sheet. 'unavailable' where there is none (most desktop browsers). */
async function shareSheet(text: string): Promise<'shared' | 'dismissed' | 'unavailable'> {
  if (Platform.OS === 'web' && typeof globalThis.navigator?.share !== 'function') return 'unavailable';
  try {
    // The text already carries the link; passing `url` too would paste it twice on iOS.
    const res = await Share.share({ message: text, title: SHARE_TITLE }, { subject: SHARE_TITLE, dialogTitle: SHARE_TITLE });
    // react-native-web resolves with nothing once navigator.share went through.
    return res?.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    // The web rejects when they close the sheet; a native failure falls back to copying.
    return Platform.OS === 'web' ? 'dismissed' : 'unavailable';
  }
}

export function copyInviteLink(url: string): Promise<boolean> {
  return copyLink(url);
}

/** The number picked last time, which the server returns with a re-invite so "Send again" opens the same chat. */
function keptPhone(invite: Invite): string | null {
  const phone = invite.phone;
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null;
}

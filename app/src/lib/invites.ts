// Inviting family (docs/build/JOIN-SIMPLE.md, Oct 29: join a family only by a join link). The family has one link,
// for anyone, any number of times, for 7 days (POST /join-links; the same link while it has more than a day left),
// shared from the invite sheet (components/profiles/AddFamilySheet, with components/share/ExternalRow). Any screen
// that invites someone opens <AddFamilySheet visible onClose />. The per-person invites ("Send again") are gone; a
// phoneless person someone added is claimed on joining ("Are you Leo?", the Notifications & linking chat's).
//   familyJoinLink(from)    the family's link (`from`: who asks, when nobody is picked yet)
//   familyInviteText(url)   "Join our family on homecookd: <url>"
// The text goes out from the sender's own phone (Messages trusts a link from Mom). Never log a link.
import { api } from './api';

/** The family's 7-day join link. */
export async function familyJoinLink(from?: string | null): Promise<string> {
  return (await api.joinLink(from ? { profileId: from } : {})).url;
}

/** "Join our family on homecookd: https://homecookd.app/i?t=…" */
export function familyInviteText(url: string): string {
  return `Join our family on homecookd: ${url}`;
}

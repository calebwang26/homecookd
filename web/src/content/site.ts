// Facts about homecookd itself, shown in the footer and on /privacy (QA B19). Never guess these: an
// empty value hides everything that needs it.
//
// The address people can write to (Caleb, Oct 18): every Contact link and the "write to us" lines on
// /privacy. NEXT_PUBLIC_CONTACT_EMAIL overrides it at build time.
export const CONTACT_EMAIL: string = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || 'team@homecookd.app';

// TODO(caleb): who makes homecookd and where, for the footer's one line, e.g. 'Made by Caleb and Sam
// in Berkeley.' Hidden while empty.
export const MADE_BY: string = '';

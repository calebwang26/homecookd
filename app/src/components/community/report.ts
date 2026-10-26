// The words of "Report or block" (ReportSheet), as pure functions (tested by scripts/test-community-ui.mjs).
import type { Reportable, ReportReason } from '@/lib/live/community';

export const REPORT_LINK = 'Report or block';
export const TEAM_EMAIL = 'team@homecookd.app';
export const BLOCK_LINE = 'You won’t see each other in Community.';
export const REPORTED = { title: 'Thanks.', subtitle: 'We’ll look at it within a day.' };
export const BLOCKED = { title: 'Blocked', subtitle: BLOCK_LINE };

export const REPORT_REASONS: { key: ReportReason; label: string }[] = [
  { key: 'not_food', label: 'Not about food' },
  { key: 'rude', label: 'Rude or hurtful' },
  { key: 'other', label: 'Something else' },
];

export function reportTitle(kind: Reportable): string {
  return `Report this ${kind}`;
}

/** "Block the Pawar family", "Block Mei's family"; "Block this family" when there's no name. */
export function blockLabel(familyName: string | null | undefined): string {
  const name = (familyName ?? '').trim().replace(/^The /, 'the ');
  return `Block ${name || 'this family'}`;
}

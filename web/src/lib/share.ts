// Share helpers for "Send this to {R}" (brief 8.12).
//   const res = await shareInvite('dad', copy, 'kid');   // 'shared' | 'copied' | 'cancelled' | 'failed'
// Every send ends in something visible: 'copied' and 'failed' mean the caller shows the link as text
// with Text it / Email it (SendPanel, EarlyAccessForm), since a desktop browser has no share sheet and
// some in-app browsers open one that never answers.
//   <a href={smsHref('dad', copy, 'kid')}>Text it</a>  <a href={mailtoHref('dad', copy, 'kid')}>Email it</a>
// The invite is read by the other side of the family, so its link opens the other version: a kid's
// "Will you teach me?" opens /?aud=parent&from=invite&for=dad (Dad's own page, saved as his pick),
// a cook's message opens /learn?aud=kid&from=invite&for=dad (src/lib/audience-route.ts).
import type { Relation } from '@/content/types';
import { AUDIENCE_PATH, otherAudience, type Audience } from '@/content/audience';
import type { Copy } from '@/content/copy';
import { fill } from './relation';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export function inviteUrl(rel: Relation, audience: Audience): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL ?? '');
  const to = otherAudience(audience);
  return `${origin}${AUDIENCE_PATH[to]}?aud=${to}&from=invite&for=${rel}`;
}

export function inviteText(rel: Relation, c: Copy): string {
  return fill(c.finalCta.shareText, rel);
}

export function smsHref(rel: Relation, c: Copy, audience: Audience): string {
  return `sms:?&body=${encodeURIComponent(`${inviteText(rel, c)} ${inviteUrl(rel, audience)}`)}`;
}

export function mailtoHref(rel: Relation, c: Copy, audience: Audience): string {
  const subject = encodeURIComponent(fill(c.finalCta.emailSubject, rel));
  const body = encodeURIComponent(`${inviteText(rel, c)}\n\n${inviteUrl(rel, audience)}`);
  return `mailto:?subject=${subject}&body=${body}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** how long the share sheet gets to answer before the copy fallback shows anyway */
const SHARE_WAIT_MS = 3000;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/**
 * navigator.share when available, else copy to the clipboard. A share sheet that fails, or doesn't
 * answer within 3 s (some in-app browsers never settle the promise), falls back to the copy too.
 * A sheet that answers after that (an iPhone's stays open while the message is written) calls
 * `onLate('shared' | 'cancelled')`, so the caller can put its fallback card away again.
 */
export async function shareInvite(
  rel: Relation,
  c: Copy,
  audience: Audience,
  onLate?: (answer: 'shared' | 'cancelled') => void,
): Promise<ShareResult> {
  const text = inviteText(rel, c);
  const url = inviteUrl(rel, audience);
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const sheet = navigator.share({ title: c.finalCta.shareTitle, text, url }).then(() => 'shared' as const);
      const answer = await Promise.race([
        sheet,
        new Promise<'late'>((resolve) => window.setTimeout(() => resolve('late'), SHARE_WAIT_MS)),
      ]);
      if (answer === 'shared') return 'shared';
      // no answer yet: copy, so the page still shows the link, and report the sheet's answer later
      let early: 'shared' | 'cancelled' | null = null;
      let done = false;
      const later = (a: 'shared' | 'cancelled') => (done ? onLate?.(a) : (early = a));
      sheet.then(
        () => later('shared'),
        (e: unknown) => {
          if (isAbort(e)) later('cancelled');
        },
      );
      const copied = await copyText(`${text} ${url}`);
      done = true;
      return early ?? (copied ? 'copied' : 'failed');
    } catch (e) {
      if (isAbort(e)) return 'cancelled';
      // fall through to copy
    }
  }
  return (await copyText(`${text} ${url}`)) ? 'copied' : 'failed';
}

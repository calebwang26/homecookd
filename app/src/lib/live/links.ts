// A dish card's link in the app (docs/build/V2-LINKING.md 2.5): the kid's /miss?k=… or Mom's /a?t=….
// Convex tells the two tokens apart.
//   const opened = await openLink(token)         POST /link/open on the Convex HTTP host: the dish, whose,
//                                                and a join ticket when someone new may join (lib/linkClaim)
//   const claimed = await claimLink(token, as?)  links.claim: this person holds that side of the card now
// openLink never throws; claimLink throws when the claim didn't happen (offline, signed out, not deployed).
import { siteUrl } from '@/components/community/invite';
import { parseClaimed, parseLinkInfo, type Claimed, type LinkInfo } from '@/lib/linkClaim';

import { call, token as sessionFor } from './convex';

const SITE = siteUrl(process.env.EXPO_PUBLIC_CONVEX_URL);
const TOKEN = /^[0-9A-Za-z]{22}$/;
const TIMEOUT_MS = 15_000;

/** 'gone': no such link (404). 'offline': no answer, or one we can't read (try again). */
export type OpenedLink = { ok: true; link: LinkInfo } | { ok: false; why: 'gone' | 'offline' };

export async function openLink(token: string | null | undefined): Promise<OpenedLink> {
  if (!token || !TOKEN.test(token)) return { ok: false, why: 'gone' };
  if (!SITE) return { ok: false, why: 'offline' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SITE}/link/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 400) return { ok: false, why: 'gone' };
    const link = res.ok ? parseLinkInfo(await res.json().catch(() => null)) : null;
    return link ? { ok: true, link } : { ok: false, why: 'offline' };
  } catch {
    return { ok: false, why: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

/** `as`: the person claiming (a profile id), by default whoever is in. Idempotent on the server. */
export async function claimLink(token: string, as?: string): Promise<Claimed> {
  const sessionToken = await sessionFor(as);
  const notYet = () => {
    throw new Error('links.claim isn’t on the server yet.');
  };
  const claimed = parseClaimed(await call<unknown>('mutation', 'links:claim', { sessionToken, token }, notYet, { strict: true }));
  if (!claimed) throw new Error('links.claim gave no card.');
  return claimed;
}

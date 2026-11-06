// A dinner's invite link opened in the app (homecookd://d?t=…, or homecookd.app/d where the app is
// installed): POST /invite/open on the Convex HTTP host with this install's own random id, so the
// dinner counts this phone once in "X going", whoever is signed in (or nobody). The reply is only the
// dish, the host's name and when (convex/lib/inviteRoutes.ts). The web page /d does the same.
import { isInviteToken, parseOpened, randomId, siteUrl, type OpenedDinner } from '@/components/community/invite';
import { community as awsCommunity } from '@/lib/aws/community';
import { AWS_ON } from '@/lib/aws/config';
import { isAwsError } from '@/lib/aws/errors';
import { kvGet, kvSet } from '@/lib/storage';

const SITE = siteUrl(process.env.EXPO_PUBLIC_CONVEX_URL);
const DEVICE_KEY = 'invite.deviceId';
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;

let device: Promise<string> | null = null;

/** This install's id for invite opens, made once and kept. */
function deviceId(): Promise<string> {
  device ??= (async () => {
    const kept = await kvGet(DEVICE_KEY);
    if (kept && DEVICE.test(kept)) return kept;
    const id = randomId();
    await kvSet(DEVICE_KEY, id);
    return id;
  })();
  return device;
}

export type Opened = { ok: true; dinner: OpenedDinner } | { ok: false; why: 'gone' | 'offline' };

export async function openInvite(token: string | null | undefined): Promise<Opened> {
  if (!isInviteToken(token)) return { ok: false, why: 'gone' };
  if (AWS_ON) {
    // POST /invite/open on the AWS api (COMMUNITY.md, item 14): the same body and answer. 429 reads as "try again".
    try {
      const dinner = parseOpened(await awsCommunity.openInvite(token, await deviceId()));
      return dinner ? { ok: true, dinner } : { ok: false, why: 'offline' };
    } catch (e) {
      return isAwsError(e) && (e.status === 404 || e.status === 400) ? { ok: false, why: 'gone' } : { ok: false, why: 'offline' };
    }
  }
  if (!SITE) return { ok: false, why: 'offline' };
  try {
    const res = await fetch(`${SITE}/invite/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId: await deviceId() }),
    });
    if (res.status === 404 || res.status === 400) return { ok: false, why: 'gone' };
    const dinner = res.ok ? parseOpened(await res.json().catch(() => null)) : null;
    return dinner ? { ok: true, dinner } : { ok: false, why: 'offline' };
  } catch {
    return { ok: false, why: 'offline' };
  }
}

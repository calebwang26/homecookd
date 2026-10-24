// /d?t=<token>: a dinner's invite link, sent from the app's "Invite friends". The page tells homecookd
// this browser opened it (POST /invite/open on the Convex HTTP host: public, CORS for homecookd.app),
// which counts it once in the dinner's "X going", and gets back only the dish, the host's first name
// and when. Never the place or the address. A random id kept in localStorage makes it "once per
// browser"; where storage is blocked it's a fresh id each visit.
import { CONVEX_SITE_URL } from './recipe-web/config';

export type OpenedDinner = { dish: string; hostFirstName: string; startsAt: number };
export type Opened = { ok: true; dinner: OpenedDinner } | { ok: false; why: 'gone' | 'offline' };

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;
const DEVICE_KEY = 'homecookd.inviteDevice';

export const isInviteToken = (t: string | null): t is string => !!t && TOKEN.test(t);

function newId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = c?.getRandomValues ? c.getRandomValues(new Uint8Array(18)) : Uint8Array.from({ length: 18 }, () => Math.floor(Math.random() * 256));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function deviceId(): string {
  try {
    const kept = localStorage.getItem(DEVICE_KEY);
    if (kept && DEVICE.test(kept)) return kept;
    const id = newId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return newId();
  }
}

function parse(body: unknown): OpenedDinner | null {
  const b = body as Partial<OpenedDinner> | null;
  if (!b || typeof b !== 'object' || typeof b.dish !== 'string' || !b.dish.trim() || typeof b.hostFirstName !== 'string') return null;
  if (typeof b.startsAt !== 'number' || !Number.isFinite(b.startsAt)) return null;
  return { dish: b.dish, hostFirstName: b.hostFirstName, startsAt: b.startsAt };
}

export async function openInvite(token: string): Promise<Opened> {
  try {
    const res = await fetch(`${CONVEX_SITE_URL}/invite/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceId: deviceId() }),
    });
    if (res.status === 404 || res.status === 400) return { ok: false, why: 'gone' };
    const dinner = res.ok ? parse(await res.json().catch(() => null)) : null;
    return dinner ? { ok: true, dinner } : { ok: false, why: 'offline' };
  } catch {
    return { ok: false, why: 'offline' };
  }
}

// ---- The words (the app's components/community/labels.ts, in the reader's own clock) ----

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayStart = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "Jollof Rice Night". */
export function nightTitle(dish: string): string {
  const d = dish.trim();
  return /\bnight$/i.test(d) ? d : `${d} Night`;
}

/** "Friday · 7 pm", "Tonight · 7:30 pm", "Tomorrow · 6 pm", "Oct 30 · 7 pm". */
export function whenLabel(at: number, now: number): string {
  const d = new Date(at);
  const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000);
  const day =
    days === 0 ? (d.getHours() >= 17 ? 'Tonight' : 'Today') : days === 1 ? 'Tomorrow' : days > 1 && days < 7 ? DAYS[d.getDay()] : `${MON[d.getMonth()]} ${d.getDate()}`;
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${day} · ${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

// The Community screens' words, as pure functions (tested by scripts/test-community-ui.mjs):
//   cardWhen        "Dinner tonight · 7 pm"            the dark dinner card
//   detailWhen      "Tonight · 7:00 pm · 6 seats"       the dinner page
//   seatLine        "2 of 6 seats taken" ("4 seats left" before the seat count is known)
//   familyLine      "Okafor family · Under a mile"           a family card
//   hostLine        "Hosted by Shreya · the Pawar family"
//   privacyNote     "Rajani’s video and voice stay in the family. You’ll see the story and the recipe text."
//   whoComing       the "Who's coming" chips
//   pickNextDinner  which dinner the Community tab puts on top
//   dayOptions, TIMES, startsAt, firstOpenDay   the host form's day and time chips
// Times are the phone's own clock. Nothing here imports React or the app, so Node runs it as is.
import type { Dinner, FeedDinner, PlaceKind } from '@/lib/live/community';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** From 5 pm a dinner today is "tonight". */
const EVENING_HOUR = 17;

function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Calendar days from `now` to `at` (0 = today). Rounded, so a daylight-saving day still counts as one. */
export function daysFrom(now: number, at: number): number {
  return Math.round((dayStart(at) - dayStart(now)) / 86_400_000);
}

/** "Tonight", "Today", "Tomorrow", "Saturday" (this week), else "Oct 30". */
export function dayWord(at: number, now: number): string {
  const days = daysFrom(now, at);
  const d = new Date(at);
  if (days === 0) return d.getHours() >= EVENING_HOUR ? 'Tonight' : 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return DAYS[d.getDay()];
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

const RELATIVE = new Set(['Tonight', 'Today', 'Tomorrow']);
const midSentence = (word: string) => (RELATIVE.has(word) ? word.toLowerCase() : word);

function hour12(d: Date): string {
  const h = d.getHours() % 12;
  return String(h === 0 ? 12 : h);
}
const ampm = (d: Date) => (d.getHours() < 12 ? 'am' : 'pm');

/** "7 pm", "7:30 pm", "12 pm". */
export function shortClock(at: number): string {
  const d = new Date(at);
  const m = d.getMinutes();
  return `${hour12(d)}${m ? `:${String(m).padStart(2, '0')}` : ''} ${ampm(d)}`;
}

/** "7:00 pm". */
export function longClock(at: number): string {
  const d = new Date(at);
  return `${hour12(d)}:${String(d.getMinutes()).padStart(2, '0')} ${ampm(d)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Dinner tonight · 7 pm", "Dinner Saturday · 7:30 pm". */
export function cardWhen(at: number, now: number): string {
  return `Dinner ${midSentence(dayWord(at, now))} · ${shortClock(at)}`;
}

/** "Tonight · 7:00 pm · 6 seats". */
export function detailWhen(at: number, seats: number, now: number): string {
  return `${dayWord(at, now)} · ${longClock(at)} · ${plural(seats, 'seat')}`;
}

/** "2 of 6 seats taken"; with only the seats left known (the feed), "4 seats left" or "Full". */
export function seatLine(seats: number | null | undefined, seatsLeft: number): string {
  const left = Math.max(0, seatsLeft);
  if (seats == null) return left > 0 ? `${plural(left, 'seat')} left` : 'Full';
  return `${Math.max(0, seats - left)} of ${plural(seats, 'seat')} taken`;
}

/** "Hosted by Shreya · the Pawar family" (the family part only when the recipe's text says whose it is). */
export function hostLine(hostName: string, familyName: string | null | undefined): string {
  const host = `Hosted by ${hostName.trim() || 'a neighbor'}`;
  const family = (familyName ?? '').trim().replace(/^The /, 'the ');
  return family ? `${host} · ${family}` : host;
}

/** A family card's line: "Okafor family · Under a mile" (no leading "The", so it fits one line). */
export function familyLine(familyName: string, distanceLabel: string): string {
  const family = familyName.trim().replace(/^The /, '');
  return [family, distanceLabel.trim()].filter(Boolean).join(' · ');
}

/** "Rajani’s", "James’". */
function whose(name: string): string {
  const n = name.trim();
  if (!n) return 'The cook’s';
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

/**
 * "Rajani’s video and voice stay in the family." (+ "You’ll see the story and the recipe text." when
 * there's a recipe to open).
 * TODO(caleb): the mockup says "stay with her family"; we don't know a cook's gender (Papa Vikram,
 * Grandpa Joe), so it says "in the family".
 */
export function privacyNote(cookName: string | null | undefined, canOpenRecipe: boolean): string {
  const first = `${whose(cookName ?? '')} video and voice stay in the family.`;
  return canOpenRecipe ? `${first} You’ll see the story and the recipe text.` : first;
}

export const PLACE_KINDS: { key: PlaceKind; label: string }[] = [
  { key: 'campus_kitchen', label: 'Campus kitchen' },
  { key: 'community_center', label: 'Community center' },
  { key: 'cafe', label: 'Café' },
  { key: 'home', label: 'Home' },
];

export function placeLabel(kind: PlaceKind): string {
  return PLACE_KINDS.find((p) => p.key === kind)?.label ?? '';
}

/**
 * The "Who's coming" chips: the host first, then the guests the host said yes to. Only the host
 * sees guests' names, so anyone else sees "You" (once accepted) and "+2" for the rest.
 */
export function whoComing(d: Pick<Dinner, 'hostName' | 'isHost' | 'seats' | 'seatsLeft' | 'myRequest' | 'requests'>): string[] {
  const host = d.isHost ? 'You · host' : `${d.hostName.trim() || 'Host'} · host`;
  if (d.isHost) return [host, ...(d.requests ?? []).filter((r) => r.status === 'accepted').map((r) => r.guestName.trim() || 'Guest')];
  const taken = Math.max(0, d.seats - d.seatsLeft);
  const me = d.myRequest?.status === 'accepted';
  const others = taken - (me ? 1 : 0);
  return [host, ...(me ? ['You'] : []), ...(others > 0 ? [`+${others}`] : [])];
}

type Rankable = Pick<Dinner, 'dinnerId' | 'startsAt' | 'status' | 'isHost' | 'myRequest'>;

/**
 * The one dinner the Community tab shows on top: one I host, then one I'm in, then one I asked to
 * join, then the soonest open one nearby. Past and called-off dinners, and any that said no to me,
 * never show.
 */
export function pickNextDinner<M extends Rankable, F extends Pick<FeedDinner, 'dinnerId' | 'startsAt' | 'seatsLeft'>>(
  mine: M[],
  feed: F[],
  now: number,
): { mine: M } | { feed: F } | null {
  const rank = (d: Rankable) =>
    d.isHost ? 0 : d.myRequest?.status === 'accepted' ? 1 : d.myRequest?.status === 'pending' ? 2 : null;
  const ranked = mine
    .filter((d) => d.startsAt > now && d.status !== 'cancelled' && rank(d) !== null)
    .sort((a, b) => (rank(a) ?? 0) - (rank(b) ?? 0) || a.startsAt - b.startsAt);
  if (ranked[0]) return { mine: ranked[0] };
  const declined = new Set(mine.filter((d) => d.myRequest?.status === 'declined').map((d) => d.dinnerId));
  const open = feed.filter((d) => d.startsAt > now && d.seatsLeft > 0 && !declined.has(d.dinnerId)).sort((a, b) => a.startsAt - b.startsAt);
  return open[0] ? { feed: open[0] } : null;
}

// ---- The host form ----

export type DayOption = { offset: number; label: string };

/** Today, Tomorrow, then the next five days by name. */
export function dayOptions(now: number, count = 7): DayOption[] {
  const today = new Date(now);
  return Array.from({ length: count }, (_, offset) => {
    if (offset === 0) return { offset, label: 'Today' };
    if (offset === 1) return { offset, label: 'Tomorrow' };
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    return { offset, label: DAYS[d.getDay()] };
  });
}

export type TimeOption = { hour: number; minute: number; label: string };

/** Dinner times, every half hour from 5 to 9 pm. */
export const TIMES: TimeOption[] = Array.from({ length: 9 }, (_, i) => {
  const hour = 17 + Math.floor(i / 2);
  const minute = i % 2 ? 30 : 0;
  return { hour, minute, label: shortClock(new Date(2026, 0, 1, hour, minute).getTime()) };
});

/** The moment for a day chip and a time chip, on the phone's clock. */
export function startsAt(now: number, offset: number, hour: number, minute: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, hour, minute).getTime();
}

/** Today if that time is still ahead, else tomorrow. */
export function firstOpenDay(now: number, hour: number, minute: number): number {
  return startsAt(now, 0, hour, minute) > now ? 0 : 1;
}

/** What a Convex error says (ConvexError carries its sentence in `data`), else `fallback`. */
export function errorText(e: unknown, fallback = 'Couldn’t do that. Try again.'): string {
  const data = (e as { data?: unknown } | null)?.data;
  return typeof data === 'string' && data.trim() ? data.trim() : fallback;
}

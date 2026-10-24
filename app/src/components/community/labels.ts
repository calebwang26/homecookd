// The Community screens' words, as pure functions (tested by scripts/test-community-ui.mjs):
//   cardWhen        "Dinner tonight · 7 pm"            the dark dinner card
//   dinnerWhen      "Friday · 7 pm"                    the dinner page and the Join row
//   seatLine        "2 of 6 seats taken" ("4 seats left" before the seat count is known)
//   awayLabel       "About 1 mi away", "In your building"      the map's dish card
//   cookLine        "Mama Ngozi · Nigerian"
//   spotLabel       "Jollof Rice by Mama Ngozi, under a mile away"   a map circle, for VoiceOver
//   clusterTitle    "3 dishes in your building"
//   newRequests, youLabel   the sun dot on "You" and "You, 1 new request"
//   whose           "Rajani’s", "James’"
//   privacyNote     "Rajani’s video and voice stay in the family. Neighbors see the recipe text and …"
//   nightTitle, goingFaces, dinnerAction   the dinner page: "Jollof Rice Night", "4 going", its one button
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

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Dinner tonight · 7 pm", "Dinner Saturday · 7:30 pm". */
export function cardWhen(at: number, now: number): string {
  return `Dinner ${midSentence(dayWord(at, now))} · ${shortClock(at)}`;
}

/** "Friday · 7 pm", "Tonight · 7:30 pm". */
export function dinnerWhen(at: number, now: number): string {
  return `${dayWord(at, now)} · ${shortClock(at)}`;
}

/** "2 of 6 seats taken"; with only the seats left known (the feed), "4 seats left" or "Full". */
export function seatLine(seats: number | null | undefined, seatsLeft: number): string {
  const left = Math.max(0, seatsLeft);
  if (seats == null) return left > 0 ? `${plural(left, 'seat')} left` : 'Full';
  return `${Math.max(0, seats - left)} of ${plural(seats, 'seat')} taken`;
}

// ---- The map ----

const BUILDING = /^in your building$/i;

/** "About 1 mi away", "Under a mile away"; "In your building" stays as it is. */
export function awayLabel(distanceLabel: string): string {
  const d = distanceLabel.trim();
  return !d || BUILDING.test(d) ? d : `${d} away`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "Mama Ngozi · Nigerian", or whichever of the two there is. */
export function cookLine(cookName: string, culture: string | null | undefined): string {
  return [cookName.trim(), (culture ?? '').trim()].filter(Boolean).join(' · ');
}

type SpotDish = { dish: string; cookName: string; distanceLabel: string };

const byCook = (r: SpotDish) => (r.cookName.trim() ? `${r.dish} by ${r.cookName.trim()}` : r.dish);

/** "Jollof Rice by Mama Ngozi, under a mile away"; a shared circle: "3 dishes, in your building: A, B and C". */
export function spotLabel(members: readonly SpotDish[]): string {
  if (!members.length) return '';
  const where = lowerFirst(awayLabel(members[0].distanceLabel));
  if (members.length === 1) return [byCook(members[0]), where].filter(Boolean).join(', ');
  const names = members.map(byCook);
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${plural(members.length, 'dish', 'dishes')}${where ? `, ${where}` : ''}: ${list}`;
}

/** Open requests to join the dinners I host that are still ahead: the sun dot on "You". */
export function newRequests(mine: readonly Pick<Dinner, 'isHost' | 'startsAt' | 'status' | 'requests'>[], now: number): number {
  return mine
    .filter((d) => d.isHost && d.startsAt > now && d.status !== 'cancelled')
    .reduce((n, d) => n + (d.requests ?? []).filter((r) => r.status === 'pending').length, 0);
}

/** "You", "You, 1 new request" (the "You" dot, for VoiceOver). */
export function youLabel(requests: number): string {
  return requests ? `You, ${plural(requests, 'new request')}` : 'You';
}

/** Above a shared circle's dishes: "3 dishes in your building", "2 dishes about 1 mi away". */
export function clusterTitle(count: number, distanceLabel: string): string {
  return [plural(count, 'dish', 'dishes'), lowerFirst(awayLabel(distanceLabel))].filter(Boolean).join(' ');
}

/** "Rajani’s", "James’"; "The cook’s" without a name. */
export function whose(name: string): string {
  const n = name.trim();
  if (!n) return 'The cook’s';
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

/**
 * "Rajani’s video and voice stay in the family. Neighbors see the recipe text and one line Rajani
 * said." (the line is the map card's quote).
 * TODO(caleb): the mockup says "stay with her family"; we don't know a cook's gender (Papa Vikram,
 * Grandpa Joe), so it says "in the family". The words about the quote are new too.
 */
export function privacyNote(cookName: string | null | undefined): string {
  const name = (cookName ?? '').trim();
  return `${whose(name)} video and voice stay in the family. Neighbors see the recipe text and one line ${name || 'the cook'} said.`;
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

// ---- The dinner page ----

/** "Jollof Rice Night". */
export function nightTitle(dish: string): string {
  const d = dish.trim();
  return /\bnight$/i.test(d) ? d : `${d} Night`;
}

const initial = (name: string) => (Array.from(name.trim())[0] ?? '').toUpperCase();

/**
 * Who's going: "4 going" counts the host and every guest the host said yes to, and a few faces lead
 * it (initials): the host first, then the guests by name for the host, or "you" for a guest who's
 * in. Only the host knows guests' names, so the rest of the count has no face.
 */
export function goingFaces(
  d: Pick<Dinner, 'hostName' | 'isHost' | 'seats' | 'seatsLeft' | 'myRequest' | 'requests'>,
  myName: string,
  max = 3,
): { faces: string[]; label: string } {
  const count = 1 + Math.max(0, d.seats - d.seatsLeft);
  const names = d.isHost
    ? [myName, ...(d.requests ?? []).filter((r) => r.status === 'accepted').map((r) => r.guestName)]
    : [d.hostName, ...(d.myRequest?.status === 'accepted' ? [myName] : [])];
  return { faces: names.map(initial).filter(Boolean).slice(0, Math.min(max, count)), label: `${count} going` };
}

export type DinnerAction = { kind: 'calendar' } | { kind: 'ask' } | { kind: 'waiting'; label: string } | { kind: 'note'; text: string };

/** The dinner page's one action: add it to the calendar once you're in (or host), ask, wait, or a short note. */
export function dinnerAction(d: Pick<Dinner, 'hostName' | 'isHost' | 'startsAt' | 'status' | 'seatsLeft' | 'myRequest'>, now: number): DinnerAction {
  if (d.status === 'cancelled') return { kind: 'note', text: 'This dinner was called off.' };
  if (d.startsAt <= now) return { kind: 'note', text: 'This dinner already happened.' };
  const status = d.myRequest?.status;
  if (d.isHost || status === 'accepted') return { kind: 'calendar' };
  if (status === 'pending') return { kind: 'waiting', label: 'Asked · waiting' };
  if (status === 'declined') return { kind: 'note', text: `${d.hostName.trim() || 'The host'} can’t fit you this time.` };
  if (d.status !== 'open' || d.seatsLeft <= 0) return { kind: 'note', text: 'Every seat is taken.' };
  return { kind: 'ask' };
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

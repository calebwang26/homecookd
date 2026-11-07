// Text formatting in the bible's voice: "Sunday evening", "Monday, October 13", "8:30 pm",
// "Last night", "Sunday, 7:05 pm", "0:38", "~50 min". Words a cook reads take her t() (lib/words) as a last
// argument; without it they read English, as the kid side does.
import { english, type T, type WordKey } from './words/words';

const DAYS = [0, 1, 2, 3, 4, 5, 6].map((i) => `common.day.${i}` as WordKey);
const MON = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => `common.mon.${i}` as WordKey);

type DateIn = Date | string | number | null | undefined;

function toDate(d: DateIn): Date | null {
  if (d == null) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}

/** "0:38", "12:05" (minutes:seconds). Hours roll into minutes ("72:10"). */
export function mmss(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export function dayPart(date: DateIn = new Date()): DayPart {
  const h = (toDate(date) ?? new Date()).getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

/** Parent-Home title start: "Good morning" / "Good afternoon" / "Good evening" (night counts as evening). */
export function goodGreeting(date: DateIn = new Date(), t: T = english): string {
  const p = dayPart(date);
  return t(p === 'morning' ? 'common.greet.morning' : p === 'afternoon' ? 'common.greet.afternoon' : 'common.greet.evening');
}

/** "Sunday, Sep 28" (adds the year when it isn't this year). */
export function shortDate(date: DateIn, t: T = english): string {
  const d = toDate(date);
  if (!d) return '';
  const vars = { day: t(DAYS[d.getDay()]), mon: t(MON[d.getMonth()]), date: d.getDate(), year: d.getFullYear() };
  return t(d.getFullYear() !== new Date().getFullYear() ? 'common.date.shortYear' : 'common.date.short', vars);
}

/** "8:30 pm". */
export function clock(date: DateIn, t: T = english): string {
  const d = toDate(date);
  if (!d) return '';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return t(h < 12 ? 'common.time.am' : 'common.time.pm', { h: h % 12 === 0 ? 12 : h % 12, m });
}

/** "Sep 28", or "Sep 28, 2025" in another year. */
function monthDay(d: Date, now: Date, t: T): string {
  const vars = { mon: t(MON[d.getMonth()]), date: d.getDate(), year: d.getFullYear() };
  return t(d.getFullYear() !== now.getFullYear() ? 'common.date.monDayYear' : 'common.date.monDay', vars);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days between `date` and now (0 = today, 1 = yesterday). */
export function daysAgo(date: DateIn, now: Date = new Date()): number {
  const d = toDate(date);
  if (!d) return Infinity;
  return Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
}

/**
 * A relative day in the bible's words: "Today", "Tonight", "Last night", "Yesterday", "Thursday"
 * (within a week), else "Sep 28". `lower` gives "last night" for mid-sentence use.
 */
export function relativeDay(date: DateIn, opts: { lower?: boolean; now?: Date } = {}, t: T = english): string {
  const d = toDate(date);
  if (!d) return '';
  const now = opts.now ?? new Date();
  const ago = daysAgo(d, now);
  const evening = d.getHours() >= 18 || d.getHours() < 4;
  const word = (key: 'today' | 'tonight' | 'lastNight' | 'yesterday') => t(`common.rel.${key}${opts.lower ? 'Lower' : ''}` as WordKey);
  if (ago <= 0) return word(evening && now.getHours() >= 18 ? 'tonight' : 'today');
  if (ago === 1) return word(evening ? 'lastNight' : 'yesterday');
  if (ago < 7) return t(DAYS[d.getDay()]);
  return monthDay(d, now, t);
}

/** Chat day separator: "Today", "Yesterday", "Sunday", "Sep 28". */
export function chatDay(date: DateIn, now: Date = new Date(), t: T = english): string {
  const d = toDate(date);
  if (!d) return '';
  const ago = daysAgo(d, now);
  if (ago <= 0) return t('common.rel.today');
  if (ago === 1) return t('common.rel.yesterday');
  if (ago < 7) return t(DAYS[d.getDay()]);
  return t('common.date.monDay', { mon: t(MON[d.getMonth()]), date: d.getDate() });
}

/** "Sunday, 7:05 pm" (or "Today, 7:05 pm"). */
export function chatStamp(date: DateIn, now: Date = new Date(), t: T = english): string {
  const d = toDate(date);
  if (!d) return '';
  return t('common.date.stamp', { day: chatDay(d, now, t), time: clock(d, t) });
}

/** True when two timestamps fall on different calendar days (for chat day separators). */
export function differentDay(a: DateIn, b: DateIn): boolean {
  const x = toDate(a);
  const y = toDate(b);
  if (!x || !y) return true;
  return startOfDay(x) !== startOfDay(y);
}

/** How long ago, mid-sentence: "just now", "2 min ago", "1 hr ago", "3 hrs ago", "yesterday", "3 days ago". */
export function timeAgo(date: DateIn, now: Date = new Date(), t: T = english): string {
  const d = toDate(date);
  if (!d) return '';
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (min < 1) return t('common.ago.now');
  if (min < 60) return t('common.ago.min', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t(h === 1 ? 'common.ago.hour' : 'common.ago.hours', { n: h });
  const days = daysAgo(d, now);
  return days <= 1 ? t('common.ago.yesterday') : t('common.ago.days', { n: days });
}

/** "12 min", "1 hr 5 min", "4 hrs" from seconds (rounded to whole minutes, at least 1). */
export function minutesLabel(seconds: number | null | undefined, t: T = english): string {
  const total = Math.max(1, Math.round((Number(seconds) || 0) / 60));
  if (total < 60) return t('common.dur.min', { m: total });
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? t('common.dur.hourMin', { h, m }) : t(h === 1 ? 'common.dur.hour' : 'common.dur.hours', { h });
}

/** A recipe's `total_time` as the bible writes it: "~50 min" (keeps the "~"; null when unknown). */
export function totalTimeLabel(total: string | null | undefined): string | null {
  const t = (total ?? '').trim();
  if (!t) return null;
  return t.startsWith('~') ? t : `~${t}`;
}

/** Possessive: "Dad's", "James'" (names ending in s get a bare apostrophe). */
export function possessive(name: string): string {
  const n = name.trim();
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

/** "Leo", "Leo and Maya", "Leo, Maya and Sam" (or "Mom or Dad" with `joiner` 'or'). */
export function listNames(names: string[], joiner: 'and' | 'or' = 'and', t: T = english): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? '';
  const first = n.slice(0, -1).join(t('common.list.comma'));
  return t(joiner === 'and' ? 'common.list.and' : 'common.list.or', { first, last: n[n.length - 1] });
}

/** "1 recipe", "3 recipes". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// Each person's local time, for the retention features (docs/build/RETENTION-HANDOFF.md 2.3-2.5, 3.2,
// 3.7). Everything time-based runs on the recipient's own clock: quiet hours, the day / week / month
// a push cap counts in, the Sunday-table week, the recap's month, and the hours the hourly cron acts
// in (Sunday 17:00 for the kid's nudge, the 1st at 10:00 for the recap).
//
// Pure: no database, no network, no clock (callers pass `now`). The bottom of the import graph:
// plumbing.ts, table.ts, recap.ts and the PR modules import this file; it imports nothing, so there are
// no cycles (retention.ts re-exports it for index.ts).

const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** The zone of a profile with none stored yet (the app sends x-tz on every call). */
export const DEFAULT_TZ = "America/Los_Angeles";

// TODO(caleb): quiet hours are 21:00-08:00 local (handoff section 8, decision 1).
export const QUIET_FROM_HOUR = 21;
export const QUIET_TO_HOUR = 8;

/** Sunday 17:00-17:59 local: the kid's Sunday-table nudge (handoff 3.2). TODO(caleb): fixed hour. */
export const NUDGE_AT = { weekday: 7, hour: 17 } as const;
/** The 1st, 10:00-10:59 local: the monthly recap push (handoff 3.7). */
export const RECAP_AT = { day: 1, hour: 10 } as const;

// IANA-style names only. Intl also takes offsets like "+05:30", but Postgres reads those as POSIX
// zones with the sign flipped, so they are refused before they can be stored.
const TZ_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(tz);
  if (cached) return cached;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
    return f;
  } catch {
    return null;
  }
}

/**
 * The zone name as given (trimmed), or null when Intl doesn't know it or it isn't IANA-style.
 * Anything from a header goes through this. Kept as sent, not canonicalised: ICU would turn
 * "Asia/Kolkata" into "Asia/Calcutta", and Postgres reads either (case-insensitively).
 */
export function validTz(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const s = name.trim();
  if (!s || s.length > 64 || !TZ_NAME.test(s)) return null;
  return formatter(s) ? s : null;
}

/** A stored zone, or the default when it's missing or bad. */
export const zoneOf = (tz: unknown): string => validTz(tz) ?? DEFAULT_TZ;

/** weekday: Monday = 1 ... Sunday = 7 (ISO). */
export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The wall clock in `tz` at `date`. An unknown zone reads as DEFAULT_TZ. */
export function localParts(date: Date, tz: string): LocalParts {
  const f = formatter(tz) ?? formatter(DEFAULT_TZ)!;
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAY[p.weekday] ?? 0,
  };
}

/** 'yyyy-mm-dd' of the local calendar day. */
export function localDateKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 'yyyy-mm' of the local calendar month. */
export function localMonthKey(date: Date, tz: string): string {
  const p = localParts(date, tz);
  return `${p.year}-${pad(p.month)}`;
}

/** How far the zone's wall clock is ahead of UTC at this instant, in ms (PDT: -7 h). */
function offsetMs(at: number, tz: string): number {
  const p = localParts(new Date(at), tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(at / MINUTE) * MINUTE;
}

/**
 * The instant local midnight starts this calendar day (month 1-12; an out-of-range day rolls over
 * like Date.UTC). Two passes, so a DST change between UTC midnight and local midnight is right.
 * Where a DST jump skips midnight itself (America/Santiago in September), the day starts at the
 * first instant after the jump.
 */
export function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  const t1 = guess - offsetMs(guess, tz);
  const t2 = guess - offsetMs(t1, tz);
  if (t2 === t1) return new Date(t1);
  const want = new Date(guess);
  const p = localParts(new Date(t2), tz);
  const isMidnight = p.hour === 0 && p.minute === 0 && p.year === want.getUTCFullYear() &&
    p.month === want.getUTCMonth() + 1 && p.day === want.getUTCDate();
  return new Date(isMidnight ? t2 : t1);
}

/** Monday 00:00 local of the week holding `date` (weeks run Monday to Sunday), as an instant. */
export function weekStartUtc(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  return zonedMidnight(p.year, p.month, p.day - (p.weekday - 1), tz);
}

/** The 1st of the local month at 00:00, as an instant. */
export function monthStartUtc(date: Date, tz: string): Date {
  const p = localParts(date, tz);
  return zonedMidnight(p.year, p.month, 1, tz);
}

/** A local month 'yyyy-mm' as [start, end) instants (for the monthly recap); null when malformed. */
export function monthBounds(month: string, tz: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  return { start: zonedMidnight(year, mon, 1, tz), end: zonedMidnight(year, mon + 1, 1, tz) };
}

/** 21:00-08:00 in the person's zone: no app-initiated pushes (skipped, not queued). */
export function inQuietHours(date: Date, tz: string): boolean {
  const h = localParts(date, tz).hour;
  return QUIET_FROM_HOUR > QUIET_TO_HOUR
    ? h >= QUIET_FROM_HOUR || h < QUIET_TO_HOUR
    : h >= QUIET_FROM_HOUR && h < QUIET_TO_HOUR;
}

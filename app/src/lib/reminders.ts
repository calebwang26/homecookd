// The weekly "film it" reminder for a kid's ask (Phase 5, docs/design/phase5-cold-parents screen 7): pure
// logic, no native module, so Node can test it (scripts/test-reminders.mjs). Scheduling it on the phone is
// lib/askReminders.ts.
//
//   weeklyTrigger(0, 'afternoon')                -> { type: 'weekly', weekday: 1, hour: 16, minute: 0 }
//   reminderContent({ askId, dish, kidName, profileId })   -> { title, body, data: { url, profile_id } }
//   recordUrl({ dish, from, ask })               -> '/record?dish=…&from=…&ask=…' (at most 300 characters)
//
// Days are 0 = Sunday … 6 = Saturday, like Date.getDay() and CravingAsk.filmingDay. expo-notifications counts
// weekdays 1 = Sunday … 7 = Saturday.
import { english, type T, type WordKey } from './words/words';

export type ReminderPart = 'morning' | 'afternoon' | 'evening';
export const REMINDER_PARTS: readonly ReminderPart[] = ['morning', 'afternoon', 'evening'];

// TODO(caleb): the defaults for Morning, Afternoon and Evening (9 am, 4 pm, 6 pm).
export const PART_TIME: Record<ReminderPart, { hour: number; minute: number }> = {
  morning: { hour: 9, minute: 0 },
  afternoon: { hour: 16, minute: 0 },
  evening: { hour: 18, minute: 0 },
};

/** What kv `reminder.<askId>` keeps: one reminder per ask. */
export type StoredReminder = { notificationId: string; day: number; part: ReminderPart };
export const reminderKey = (askId: string) => `reminder.${askId}`;

/** The same shape as expo-notifications' WeeklyTriggerInput ('weekly' is SchedulableTriggerInputTypes.WEEKLY). */
export type WeeklyTrigger = { type: 'weekly'; weekday: number; hour: number; minute: number; channelId?: string };

export const isDay = (day: unknown): day is number => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6;
export const isPart = (part: unknown): part is ReminderPart => REMINDER_PARTS.includes(part as ReminderPart);

/** A kv value read back, or null when it isn't one of ours. */
export function parseReminder(raw: unknown): StoredReminder | null {
  const r = raw as Partial<StoredReminder> | null;
  if (!r || typeof r.notificationId !== 'string' || !r.notificationId || !isDay(r.day) || !isPart(r.part)) return null;
  return { notificationId: r.notificationId, day: r.day, part: r.part };
}

/** Every `day` (0 = Sunday) at the part's time, in the phone's own time zone. */
export function weeklyTrigger(day: number, part: ReminderPart, channelId?: string): WeeklyTrigger {
  if (!isDay(day)) throw new RangeError(`day must be 0 (Sunday) to 6, not ${day}`);
  const { hour, minute } = PART_TIME[part];
  return { type: 'weekly', weekday: day + 1, hour, minute, ...(channelId ? { channelId } : {}) };
}

/** pushUrl (lib/push.ts) opens nothing longer. */
export const MAX_URL = 300;

/**
 * Record with the dish filled in and "Caleb asked for braised pork". A very long dish (or name) is cut
 * so the path stays within MAX_URL; Record falls back to the ask's own dish when the cut one is empty.
 */
export function recordUrl({ dish, from, ask }: { dish: string; from: string; ask: string }): string {
  const build = (d: string, f: string) => `/record?dish=${encodeURIComponent(d)}&from=${encodeURIComponent(f)}&ask=${encodeURIComponent(ask)}`;
  let d = [...dish.trim()];
  let f = [...from.trim()];
  while (build(d.join(''), f.join('')).length > MAX_URL && d.length) d = d.slice(0, -1);
  while (build(d.join(''), f.join('')).length > MAX_URL && f.length) f = f.slice(0, -1);
  return build(d.join('').trim(), f.join('').trim());
}

export type ReminderContent = { title: string; body: string; data: { url: string; profile_id: string } };

/** "Making braised pork today?" / "Tap record for Caleb." Opens Record as her (`profile_id`) on a shared phone. */
export function reminderContent(
  { askId, dish, kidName, profileId }: { askId: string; dish: string; kidName: string; profileId: string },
  t: T = english,
): ReminderContent {
  return {
    title: t('request.reminder.pushTitle', { dish: dish.trim() }),
    body: t('request.reminder.pushBody', { kid: kidName.trim() }),
    data: { url: recordUrl({ dish, from: kidName, ask: askId }), profile_id: profileId },
  };
}

const DAY: WordKey[] = [0, 1, 2, 3, 4, 5, 6].map((i) => `common.day.${i}` as WordKey);
const DAYS: WordKey[] = [0, 1, 2, 3, 4, 5, 6].map((i) => `request.reminder.days.${i}` as WordKey);
const SHORT: WordKey[] = [0, 1, 2, 3, 4, 5, 6].map((i) => `request.reminder.short.${i}` as WordKey);
const PART_WORD: Record<ReminderPart, WordKey> = {
  morning: 'request.reminder.morning',
  afternoon: 'request.reminder.afternoon',
  evening: 'request.reminder.evening',
};

/** "Sunday". */
export const dayName = (day: number, t: T = english) => t(DAY[day]);
/** "Sundays" (the button: "Remind me on Sundays"). */
export const dayPlural = (day: number, t: T = english) => t(DAYS[day]);
/** "Sun" (a day chip). */
export const dayShort = (day: number, t: T = english) => t(SHORT[day]);
/** "Afternoon". */
export const partName = (part: ReminderPart, t: T = english) => t(PART_WORD[part]);

/** "4 pm", "9:30 am". */
export function partClock(part: ReminderPart, t: T = english): string {
  const { hour, minute } = PART_TIME[part];
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const key: WordKey = minute ? (hour < 12 ? 'common.time.am' : 'common.time.pm') : hour < 12 ? 'request.reminder.hourAm' : 'request.reminder.hourPm';
  return t(key, { h, m: String(minute).padStart(2, '0') });
}

/** "Every Sunday at 4 pm". */
export const everyLine = (day: number, part: ReminderPart, t: T = english) => t('request.reminder.every', { day: dayName(day, t), time: partClock(part, t) });

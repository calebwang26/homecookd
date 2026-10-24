// A small built-in holiday calendar for Kid Home recommendations. Pure (no React Native imports) so
// scripts/test-recommend.mjs can run it under plain Node.
//   - Fixed-date and rule-based days (Halloween, Thanksgiving, Easter, Mother's Day...) are computed
//     for any year.
//   - Lunar / lunisolar days come from a table (checked Oct 16 2026 against publicholidays.*,
//     chinatravel.com, dekhopanchang.com, farmersalmanac.com). Years outside the table are skipped.
// Dates are local calendar days (midnight). Hanukkah = the evening of the first candle.

export type Holiday = {
  id: string;
  /** "Mid-Autumn", "Thanksgiving" (used in "For Mid-Autumn"). */
  name: string;
  date: Date;
  /** Dish words that make a family recipe fit (title, tags, ingredients). */
  keywords: string[];
  /** Mother's / Father's Day: the cook's own dishes fit (relation of the recipe's cook). */
  cookRelation?: RegExp;
};

type Rule = Omit<Holiday, 'date'>;

// month-day by year. TODO: extend past 2028.
const LUNAR: Record<string, Record<number, string>> = {
  'lunar-new-year': { 2026: '02-17', 2027: '02-06', 2028: '01-26' },
  'mid-autumn': { 2026: '09-25', 2027: '09-15', 2028: '10-03' },
  diwali: { 2026: '11-08', 2027: '10-29', 2028: '10-17' }, // 2028: one source only
  hanukkah: { 2026: '12-04', 2027: '12-24', 2028: '12-12' },
};

const RULES: Record<string, Rule> = {
  'new-year': { id: 'new-year', name: 'New Year', keywords: ['new year', 'black eyed peas', 'hoppin john', 'soba', 'champagne'] },
  'lunar-new-year': {
    id: 'lunar-new-year',
    name: 'Lunar New Year',
    keywords: ['lunar new year', 'chinese new year', 'dumpling', 'jiaozi', 'spring roll', 'nian gao', 'rice cake', 'tangyuan', 'longevity noodles', 'whole fish', 'tteokguk'],
  },
  valentines: { id: 'valentines', name: 'Valentine’s Day', keywords: ['valentine', 'chocolate', 'dessert', 'strawberry', 'heart'] },
  easter: { id: 'easter', name: 'Easter', keywords: ['easter', 'hot cross bun', 'deviled egg', 'lamb', 'ham'] },
  'mothers-day': { id: 'mothers-day', name: 'Mother’s Day', keywords: ['mothers day'], cookRelation: /\b(mom|mum|mother|mama|ma)\b/i },
  'fathers-day': { id: 'fathers-day', name: 'Father’s Day', keywords: ['fathers day'], cookRelation: /\b(dad|father|papa|pa)\b/i },
  'mid-autumn': {
    id: 'mid-autumn',
    name: 'Mid-Autumn',
    keywords: ['mid autumn', 'mooncake', 'lotus seed', 'red bean paste', 'salted egg yolk', 'osmanthus', 'pomelo', 'taro'],
  },
  halloween: {
    id: 'halloween',
    name: 'Halloween',
    keywords: ['halloween', 'pumpkin', 'candy', 'caramel apple', 'candy apple', 'apple cider', 'spooky'],
  },
  diwali: {
    id: 'diwali',
    name: 'Diwali',
    keywords: ['diwali', 'mithai', 'ladoo', 'laddu', 'barfi', 'burfi', 'gulab jamun', 'jalebi', 'kheer', 'halwa', 'samosa', 'chakli'],
  },
  thanksgiving: {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    keywords: ['thanksgiving', 'turkey', 'stuffing', 'cranberry', 'pumpkin pie', 'pecan pie', 'sweet potato', 'gravy', 'cornbread', 'mashed potatoes'],
  },
  hanukkah: { id: 'hanukkah', name: 'Hanukkah', keywords: ['hanukkah', 'latke', 'sufganiyot', 'brisket'] },
  christmas: {
    id: 'christmas',
    name: 'Christmas',
    keywords: ['christmas', 'gingerbread', 'cookie', 'eggnog', 'fruitcake', 'stollen', 'yule', 'roast ham'],
  },
};

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

/** The n-th `weekday` (0 = Sunday) of a month, e.g. Thanksgiving = 4th Thursday of November. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const first = day(year, month, 1).getDay();
  return day(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
}

/** Western Easter Sunday (anonymous Gregorian computus). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return day(year, month, ((h + l - 7 * m + 114) % 31) + 1);
}

/** Every holiday we know in `year`, in date order. */
export function holidaysIn(year: number): Holiday[] {
  const at = (id: string, date: Date | null): Holiday[] => (date ? [{ ...RULES[id], date }] : []);
  const lunar = (id: string) => {
    const md = LUNAR[id][year];
    return md ? day(year, Number(md.slice(0, 2)), Number(md.slice(3))) : null;
  };
  return [
    ...at('new-year', day(year, 1, 1)),
    ...at('lunar-new-year', lunar('lunar-new-year')),
    ...at('valentines', day(year, 2, 14)),
    ...at('easter', easter(year)),
    ...at('mothers-day', nthWeekday(year, 5, 0, 2)), // US: 2nd Sunday of May
    ...at('fathers-day', nthWeekday(year, 6, 0, 3)), // US: 3rd Sunday of June
    ...at('mid-autumn', lunar('mid-autumn')),
    ...at('halloween', day(year, 10, 31)),
    ...at('diwali', lunar('diwali')),
    ...at('thanksgiving', nthWeekday(year, 11, 4, 4)), // US: 4th Thursday of November
    ...at('hanukkah', lunar('hanukkah')),
    ...at('christmas', day(year, 12, 25)),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Whole calendar days from `from` to `to` (local dates; DST-safe). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Holidays from today through `windowDays` ahead, nearest first. */
export function upcomingHolidays(now: Date, windowDays = 21): { holiday: Holiday; days: number }[] {
  const y = now.getFullYear();
  return [...holidaysIn(y), ...holidaysIn(y + 1)]
    .map((holiday) => ({ holiday, days: daysBetween(now, holiday.date) }))
    .filter((h) => h.days >= 0 && h.days <= windowDays)
    .sort((a, b) => a.days - b.days);
}

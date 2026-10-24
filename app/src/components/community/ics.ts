// A dinner as an iCalendar (.ics) file, for "Add to calendar" (RFC 5545: CRLF lines, escaped text,
// long lines folded at 75 bytes). Times are UTC. The dinner has no end time, so it lasts two hours.
// Pure (tested by scripts/test-community-ui.mjs); components/community/calendar.ts writes and opens it.

export type CalendarEvent = {
  uid: string; // the dinner's id
  title: string; // "Jollof Rice Night"
  startsAt: number;
  location: string; // "Baker House kitchen, 362 Memorial Dr" (the address only once it's yours to see)
  description: string; // "Hosted by Mom"
  now: number;
};

const LENGTH_MS = 2 * 60 * 60_000;

/** 20261030T230000Z */
export function icsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Backslash, semicolon, comma and newlines are escaped in a text value. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Lines longer than 75 bytes continue on the next line after one space, never inside a character. */
export function icsFold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of Array.from(line)) {
    const limit = out.length ? 74 : 75; // a continuation's leading space counts
    if (bytes(cur + ch) > limit) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function icsText(e: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//homecookd//Dinner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}@homecookd.app`,
    `DTSTAMP:${icsTime(e.now)}`,
    `DTSTART:${icsTime(e.startsAt)}`,
    `DTEND:${icsTime(e.startsAt + LENGTH_MS)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    ...(e.location.trim() ? [`LOCATION:${icsEscape(e.location.trim())}`] : []),
    ...(e.description.trim() ? [`DESCRIPTION:${icsEscape(e.description.trim())}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

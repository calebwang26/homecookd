// Keyset paging for lists (SCHEMA.md section 3): a page starts where the last one ended, so it costs the same however deep it goes, and a row added
// meanwhile can't push another off the page. A cursor is opaque to callers, and its parts only ever reach SQL as query parameters.
import { invalid } from "./errors.js";

export const badCursor = () => invalid("cursor");

export const encodeCursor = (parts: (string | number)[]) => Buffer.from(JSON.stringify(parts)).toString("base64url");

/** A cursor's parts, or null for the first page. Anything else is a 400. */
export function decodeCursor(raw: string | undefined, size: number): string[] | null {
  if (raw === undefined || raw === "") return null;
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw badCursor();
  }
  if (!Array.isArray(parts) || parts.length !== size || !parts.every((p) => typeof p === "string" || typeof p === "number")) throw badCursor();
  const strings = parts.map(String);
  if (strings.some((p) => p.includes("\0"))) throw badCursor(); // Postgres text can't hold one, and a cursor is encoded, so app.ts's check can't see inside
  return strings;
}

// A time travels as Postgres's own text (`created_at::text`): a JS Date would cut microseconds, and the next page would skip or repeat a row.
// The year may run past four digits: a dinner may be set as far ahead as a JS date goes.
const TIME = /^(\d{4,6})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?[+-](\d{2})(?::(\d{2}))?$/;
const MAX_YEAR = 275_760;
export type After = { at: string; id: string };

/** A real moment Postgres will take, so a forged cursor is our 400 and not its error. No row's time falls outside these years. */
export function isTime(at: string): boolean {
  const m = TIME.exec(at);
  if (!m) return false;
  const [year, month, day, hour, minute, second, zoneH, zoneM] = [m[1], m[2], m[3], m[4], m[5], m[6], m[8], m[9] ?? "0"].map(Number);
  if (year < 1970 || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return false;
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  return hour <= 23 && minute <= 59 && second <= 59 && zoneH <= 15 && zoneM <= 59;
}

/** A (time, id) position from a cursor's parts. */
export function afterOf(at: string, id: string): After {
  if (!isTime(at) || !id || id.length > 200) throw badCursor();
  return { at, id };
}

/** A page of a time-keyed list: `rows` was read with one row over the limit. */
export function pageOf<T extends { id: string; cursor_at: string }>(rows: T[], limit: number): { rows: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return { rows: page, nextCursor: rows.length > limit && last ? encodeCursor([last.cursor_at, last.id]) : null };
}

/** The position in a time-keyed list's cursor. */
export function afterCursor(raw: string | undefined): After | null {
  const parts = decodeCursor(raw, 2);
  return parts ? afterOf(parts[0], parts[1]) : null;
}

// Keyset paging for lists (SCHEMA.md section 3): a page starts where the last one ended, so it costs the same however deep it goes, and a row added
// meanwhile can't push another off the page. A cursor is opaque to callers, and its parts only ever reach SQL as query parameters.
import { ApiError } from "./errors.js";

export const badCursor = () => new ApiError(400, "bad_request");

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
  return parts.map(String);
}

// A time travels as Postgres's own text (`created_at::text`): a JS Date would cut microseconds, and the next page would skip or repeat a row.
const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
export type After = { at: string; id: string };

/** A (time, id) position from a cursor's parts. */
export function afterOf(at: string, id: string): After {
  if (!TIME.test(at) || !id || id.length > 200) throw badCursor();
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

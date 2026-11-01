// Limits and small checks for the messages area. Every refusal is a code (errors.ts); docs/build/MESSAGES-MIGRATION.md maps each to the sentence old builds read.
import { ApiError } from "../../errors.js";
import { type After, afterCursor, badCursor, encodeCursor as encodeParts, isTime } from "../../paging.js";

export const LIBRARY_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
export const ROW_ID = /^[A-Za-z0-9:_-]{1,100}$/;
/** Convex's and Supabase's limit on what someone wrote. */
export const MAX_BODY = 2000;
export const MAX_TRANSCRIPT = 5000;
export const MAX_VOICE_S = 300;
export const MAX_RECIPIENTS = 30;
export const MAX_STEP = 200;
/** A family's page sizes: Convex took 100 and Supabase up to 500, with no way to page. */
export const PAGE = { default: 100, max: 200 };

export const bad = (code: string) => new ApiError(400, code);

export function text(value: unknown, max: number, tooLong = "too_long"): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw bad("bad_request");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw bad(tooLong);
  return trimmed;
}

export function number(value: unknown, o: { min?: number; max?: number; int?: boolean } = {}): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw bad("bad_number");
  if (o.int && !Number.isInteger(value)) throw bad("bad_number");
  if (o.min !== undefined && value < o.min) throw bad("bad_number");
  if (o.max !== undefined && value > o.max) throw bad("bad_number");
  return value;
}

export function libraryId(value: unknown, required: boolean): string | null {
  const id = text(value, 100);
  if (id === null) {
    if (required) throw bad("library_id_required");
    return null;
  }
  if (!LIBRARY_ID.test(id)) throw bad("bad_library_id");
  return id;
}

export const isRowId = (value: unknown): value is string => typeof value === "string" && ROW_ID.test(value);

export type Cursor = After;

/** The server's own ISO text, as Postgres writes it: what paging.ts takes. */
const postgresTime = (at: string) => at.replace("T", " ").replace(/Z$/, "+00");

/** An opaque keyset position: `(created_at, id)`, with the time as the server's own text so it keeps its microseconds. Paging's rules: a forged one is a 400. */
export const encodeCursor = (at: string, id: string) => encodeParts([postgresTime(at), id]);

export function decodeCursor(value: unknown): Cursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw badCursor();
  return afterCursor(value);
}

export function pageSize(value: unknown, page: { default: number; max: number } = PAGE): number {
  if (value === undefined || value === null || value === "") return page.default;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw bad("bad_limit");
  return Math.min(n, page.max);
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** An ISO time from a client, kept as sent so it keeps its microseconds: a raw "+00:00" arrives as a space when a client forgets to encode it. Postgres must be able to read it. */
export function isoTime(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) throw bad("bad_time");
  const fixed = value.trim().replace(" ", "+");
  if (!ISO_TIME.test(fixed) || !isTime(postgresTime(fixed).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))) throw bad("bad_time");
  return fixed;
}

export const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// Limits and small checks for the messages area. Every refusal is a code (errors.ts); docs/build/MESSAGES-MIGRATION.md maps each to the sentence old builds read.
import { ApiError } from "../../errors.js";

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

export type Cursor = { at: string; id: string };

export const encodeCursor = (at: string, id: string) => Buffer.from(JSON.stringify([at, id])).toString("base64url");

/** An opaque keyset position: `(created_at, id)`, with the time as the server's own text so it keeps its microseconds. */
export function decodeCursor(value: unknown): Cursor | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 300) throw bad("bad_cursor");
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString());
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string" && !Number.isNaN(Date.parse(parsed[0]))) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    // Falls through to the refusal below.
  }
  throw bad("bad_cursor");
}

export function pageSize(value: unknown, page: { default: number; max: number } = PAGE): number {
  if (value === undefined || value === null || value === "") return page.default;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw bad("bad_limit");
  return Math.min(n, page.max);
}

/** An ISO time from a client, kept as sent: a raw "+00:00" arrives as a space when a client forgets to encode it. */
export function isoTime(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) throw bad("bad_time");
  const fixed = value.trim().replace(" ", "+");
  if (Number.isNaN(Date.parse(fixed))) throw bad("bad_time");
  return fixed;
}

export const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

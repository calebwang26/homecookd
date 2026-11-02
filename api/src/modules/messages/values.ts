// Limits and small checks for the messages area. Bad input is a 400 `invalid` naming the field as the route calls it; every code is in
// docs/build/contracts/ERROR-CODES.md.
import { invalid, notFound } from "../../errors.js";
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

/** Convex's sentences, for what someone can reach with a working app. */
export const WRITE_SOMETHING = "Write something first.";
const TOO_LONG = "That message is too long.";

/** A recipe that isn't there or isn't this family's: one sentence for both, so they can't be told apart. */
export const noSuchRecipe = () => notFound("That recipe isn't here anymore.");

export function text(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalid(field);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw invalid(field, TOO_LONG);
  return trimmed;
}

export function number(value: unknown, field: string, o: { min?: number; max?: number; int?: boolean } = {}): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(field);
  if (o.int && !Number.isInteger(value)) throw invalid(field);
  if (o.min !== undefined && value < o.min) throw invalid(field);
  if (o.max !== undefined && value > o.max) throw invalid(field);
  return value;
}

/** Every route sends it as `libraryId`. */
export function libraryId(value: unknown, required: boolean): string | null {
  const id = text(value, "libraryId", 100);
  if (id === null) {
    if (required) throw invalid("libraryId");
    return null;
  }
  if (!LIBRARY_ID.test(id)) throw invalid("libraryId");
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

/** Every list calls it `limit`. */
export function pageSize(value: unknown, page: { default: number; max: number } = PAGE): number {
  if (value === undefined || value === null || value === "") return page.default;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw invalid("limit");
  return Math.min(n, page.max);
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** An ISO time from a client, kept as sent so it keeps its microseconds: a raw "+00:00" arrives as a space when a client forgets to encode it. Postgres must be able to read it. */
export function isoTime(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 40) throw invalid(field);
  const fixed = value.trim().replace(" ", "+");
  if (!ISO_TIME.test(fixed) || !isTime(postgresTime(fixed).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))) throw invalid(field);
  return fixed;
}

export const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

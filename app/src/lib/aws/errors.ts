// What a failed AWS api call means, read the same way on every route (ACCOUNTS.md, "Errors"; ERROR-CODES.md).
//
// Every route answers {error: <code>, message?: <English sentence>, requestId}, with retry-after as a header (the
// api's #291). Screens pick their own words by `code`, in the person's language (errorWords.ts); `message` is an
// English fallback for a code the app doesn't know yet, and its text is never matched.

export type AwsErrorKind =
  | 'unavailable' // down, overloaded, rate-limited, or the route isn't there: keep what's on screen, retry later
  | 'signed_out' // 401: the session or the device key is gone (client.ts tells which)
  | 'refused' // any other 4xx, and staging's not-moved answers: show it, don't retry
  | 'server' // 500: a read may retry; a write only with its same Idempotency-Key
  | 'network'; // no answer at all: offline, or too slow

export class AwsError extends Error {
  status: number;
  /** snake_case, e.g. `own_phone`; '' when the api sent only a sentence. */
  code: string;
  kind: AwsErrorKind;
  /** Seconds the api asked us to wait (429, 503); null when it didn't say. */
  retryAfterS: number | null;
  requestId: string | null;
  /** The rest of the body: `field` on invalid, `status` on gone. */
  extra: Record<string, unknown>;

  constructor(
    message: string,
    o: { status: number; code: string; kind: AwsErrorKind; retryAfterS?: number | null; requestId?: string | null; extra?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'AwsError';
    this.status = o.status;
    this.code = o.code;
    this.kind = o.kind;
    this.retryAfterS = o.retryAfterS ?? null;
    this.requestId = o.requestId ?? null;
    this.extra = o.extra ?? {};
  }
}

export function isAwsError(e: unknown): e is AwsError {
  return e instanceof AwsError;
}

const CODE = /^[a-z][a-z0-9_]*$/;
const UNREACHABLE = 'Can’t reach homecookd. Trying again.';
// Nothing was written, and waiting won't help: a setting missing on the server, or (staging only) an area
// whose switch is off there.
const NOT_MOVED = new Set(['not_moved', 'accounts_not_moved', 'not_set_up']);

function seconds(h: string | null): number | null {
  if (h == null || h.trim() === '') return null;
  const n = Number(h);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A non-2xx answer as an AwsError. `body` is the raw text; `retryAfter` the retry-after header. */
export function readError(status: number, body: string, retryAfter: string | null): AwsError {
  const wait = seconds(retryAfter);
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = body ? JSON.parse(body) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch {
    // the load balancer's or CloudFront's own page
  }
  // Not JSON: nobody healthy answered (ACCOUNTS.md, "Not JSON, or 502/503/504 with no JSON body").
  if (!json) return new AwsError(UNREACHABLE, { status, code: 'unavailable', kind: 'unavailable', retryAfterS: wait });

  const { error, message, requestId, ...extra } = json;
  const err = text(error);
  // A body whose `error` isn't a code (something other than the api answered): no code, its words as the fallback.
  const c = err && CODE.test(err) ? err : '';
  const sentence = text(message) ?? (err && !c ? err : null) ?? (c || `Request failed (${status}).`);
  const kind: AwsErrorKind = NOT_MOVED.has(c)
    ? 'refused'
    : status === 401
      ? 'signed_out'
      : status === 429 || status === 502 || status === 503 || status === 504 || c === 'no_route' || c === 'unavailable'
        ? 'unavailable'
        : status >= 500
          ? 'server'
          : 'refused';
  return new AwsError(sentence, { status, code: c, kind, retryAfterS: wait, requestId: text(requestId), extra });
}

/** No answer: offline, or it took too long. */
export function networkError(timedOut: boolean): AwsError {
  return new AwsError(timedOut ? 'That took too long. Trying again.' : UNREACHABLE, {
    status: 0,
    code: timedOut ? 'timeout' : 'network',
    kind: 'network',
  });
}

/**
 * How long to wait before trying again: the api's retry-after when it gave one, else 5 s doubling to 60 s,
 * spread by ±20% so phones don't all come back at once (ACCOUNTS.md, "When the api can't be reached").
 * `attempt` counts from 0.
 */
export function retryDelayMs(e: AwsError | null, attempt: number, random: () => number = Math.random): number {
  if (e?.retryAfterS != null) return Math.round(e.retryAfterS * 1000);
  const base = Math.min(60_000, 5_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

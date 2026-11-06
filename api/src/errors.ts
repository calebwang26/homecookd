// Errors a caller may see, in one shape on every route: `{error: <code>, message?: <English sentence>, requestId, ...extra}` (app.ts sends it).
// The app shows its own words, picked by `error`; `message` is the English fallback. Every code: docs/build/contracts/ERROR-CODES.md.
// Anything that isn't an ApiError is a 500 with no detail.
import type { FastifyReply, FastifyRequest } from "fastify";

const CODE = /^[a-z][a-z0-9_]*$/;

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
    readonly sentence?: string, // the English fallback the app may show; never logged
    readonly extra: Record<string, unknown> = {}, // more fields next to `error`: `field` on `invalid`, an invite's `status` on a 410
  ) {
    super(code);
    this.name = "ApiError";
    // A sentence in `error` is what this shape exists to end, so one can't be built: it fails as a 500 that a test sees.
    if (!CODE.test(code)) throw new Error("ApiError code must be snake_case");
  }
}

/** What the caller gets for an ApiError. `error` and `requestId` can't be overwritten by `extra`. */
export const errorBody = (error: ApiError, requestId: string) => ({
  ...error.extra,
  error: error.code,
  ...(error.sentence ? { message: error.sentence } : {}),
  requestId,
});

export const sendError = (reply: FastifyReply, req: FastifyRequest, error: ApiError) =>
  reply.status(error.statusCode).headers(error.headers).send(errorBody(error, String(req.id)));

/** No route has this path: an older api, not a missing row. */
export const noRoute = () => new ApiError(404, "no_route", {}, "No such route.");

/** Bad input: don't retry. `field` names the one field that's wrong, when it's one. */
export const invalid = (field?: string, sentence?: string) => new ApiError(400, "invalid", {}, sentence, field ? { field } : {});
export const signedOut = (sentence?: string) => new ApiError(401, "signed_out", {}, sentence);
export const forbidden = (sentence?: string) => new ApiError(403, "forbidden", {}, sentence);
/** The acting person left the family. Their phone stays signed in until accounts ends it, so it's a 403, not a 401. */
export const removedFromFamily = (sentence?: string) => new ApiError(403, "removed_from_family", {}, sentence);
// The same answer for "doesn't exist" and "isn't yours", so nobody can probe for another family's rows.
// A route may give it a sentence, but one sentence for all of those cases: a wrong family and a missing row stay the same bytes.
export const notFound = (sentence?: string) => new ApiError(404, "not_found", {}, sentence);
/** A refusal the app shows. Only for what the caller may know: never a reason that says a row of another family exists. */
export const refused = (status: number, code: string, sentence?: string, extra: Record<string, unknown> = {}) => new ApiError(status, code, {}, sentence, extra);
export const retryAfter = (seconds: number) => ({ "retry-after": String(Math.max(1, Math.ceil(seconds))) });
export const tooMany = (retryAfterS: number, sentence?: string) => new ApiError(429, "rate_limited", retryAfter(retryAfterS), sentence);
/** The database is away or busy: ask again soon. The seconds are spread so that phones don't all return at once. */
export const unavailable = (sentence = "We're busy for a moment. Try again.") =>
  new ApiError(503, "unavailable", { "retry-after": String(5 + Math.floor(Math.random() * 11)) }, sentence);
/** A server setting this needs isn't there (staging, or a key not set yet). Retrying won't help. */
export const notSetUp = (sentence?: string) => new ApiError(503, "not_set_up", {}, sentence);
/** An outside service (S3, a model, Apple or Google, the recipe library) failed or couldn't be reached. Nothing was written: try again. */
export const providerDown = (status: 502 | 503, sentence?: string) => new ApiError(status, "provider_down", {}, sentence);

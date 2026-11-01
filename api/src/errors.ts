// Errors a caller may see. Anything else is a 500 with no detail (app.ts).
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export const signedOut = () => new ApiError(401, "signed_out");
export const forbidden = () => new ApiError(403, "forbidden");
// The same answer for "doesn't exist" and "isn't yours", so nobody can probe for another family's rows.
export const notFound = () => new ApiError(404, "not_found");
export const tooMany = (retryAfterS: number) =>
  new ApiError(429, "rate_limited", { "retry-after": String(Math.max(1, Math.ceil(retryAfterS))) });
/** The database is away or busy: ask again soon. The seconds are spread so that phones don't all return at once. */
export const unavailable = () => new ApiError(503, "unavailable", { "retry-after": String(5 + Math.floor(Math.random() * 11)) });

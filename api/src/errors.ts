// Errors a caller may see. Anything else is a 500 with no detail (app.ts).
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    readonly headers: Record<string, string> = {},
    readonly sentence?: string, // what the app shows; never logged
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export const signedOut = () => new ApiError(401, "signed_out");
export const forbidden = () => new ApiError(403, "forbidden");
// The same answer for "doesn't exist" and "isn't yours", so nobody can probe for another family's rows.
// A route may give it a sentence, but one sentence for all of those cases: a wrong family and a missing row stay the same bytes.
export const notFound = (sentence?: string) => new ApiError(404, "not_found", {}, sentence);
/** A refusal the app shows. Only for what the caller may know: never a reason that says a row of another family exists. */
export const refused = (status: number, code: string, sentence: string) => new ApiError(status, code, {}, sentence);
export const tooMany = (retryAfterS: number) =>
  new ApiError(429, "rate_limited", { "retry-after": String(Math.max(1, Math.ceil(retryAfterS))) });

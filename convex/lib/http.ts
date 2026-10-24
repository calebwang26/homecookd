// Shared pieces of the HTTP routes (http.ts and the route files beside it). Each of our own services
// sends one shared secret in a header; errors are JSON `{ error }` with 400, 401 or 404.
import { httpAction, type ActionCtx } from "../_generated/server";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const fail = (status: number, error: string) => json({ error }, status);

export function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export type Body = Record<string, unknown>;
export type Handler = (ctx: ActionCtx, body: Body) => Promise<Response>;

/** A POST route behind one shared secret, with a JSON object body. */
export function secured(header: "x-worker-secret" | "x-voice-secret" | "x-glasses-secret", envName: string, handler: Handler) {
  return httpAction(async (ctx, req) => {
    if (!sameSecret(req.headers.get(header), process.env[envName])) return fail(401, "wrong secret");
    const text = await req.text();
    if (text.length > 1_000_000) return fail(400, "body too large");
    let body: unknown = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        return fail(400, "body must be JSON");
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "body must be a JSON object");
    return await handler(ctx, body as Body);
  });
}

export const isStr = (x: unknown, max = 2000): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
export const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
export const worker = (handler: Handler) => secured("x-worker-secret", "WORKER_SECRET", handler);
export const voice = (handler: Handler) => secured("x-voice-secret", "VOICE_SECRET", handler);
export const glasses = (handler: Handler) => secured("x-glasses-secret", "GLASSES_SECRET", handler);

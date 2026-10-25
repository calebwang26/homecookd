// homie's live recording routes, called by the voice service with x-voice-secret (STACK.md, "Voice
// service → Convex for homie"). Each one carries the cook's own session token; live.ts checks it.
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { fail, isNum, isStr, json, voice, type Body, type Handler } from "./http";

const STATUSES = ["recording", "wrapping_up", "ended"] as const;
const KINDS = ["intro", "amount", "cue", "substitution", "story", "show", "reaction", "end", "plate", "closing", "optin"] as const;
const PROMPT_STATUSES = ["spoken", "answered", "ignored", "not_now"] as const;
type Of<T extends readonly string[]> = T[number];
const oneOf = <T extends readonly string[]>(list: T, x: unknown): x is Of<T> => list.includes(x as string);

/** Maps live.ts's `{ error }` to the contract's status codes. */
function reply(result: object): Response {
  if (!("error" in result)) return json(result);
  const error = result.error;
  if (error === "signed_out") return fail(401, "signed out");
  // The voice service knows this exact message (voice/src/convex.ts Ended): the recording was ended underneath it.
  if (error === "ended") return fail(400, "recording already ended");
  return fail(404, "no such recording");
}

/** Every route needs the cook's session token; most also need a recording id. */
const route = (needsRecording: boolean, handler: (ctx: Parameters<Handler>[0], body: Body & { sessionToken: string; recordingId: string }) => Promise<Response>) =>
  voice(async (ctx, body) => {
    if (!isStr(body.sessionToken, 200)) return fail(400, "sessionToken is required");
    if (needsRecording && !isStr(body.recordingId, 100)) return fail(400, "recordingId is required");
    return handler(ctx, body as Body & { sessionToken: string; recordingId: string });
  });

/** When homie's voice played: `{ atS, endS }` on the recording's clock. */
function saidOf(raw: unknown): { atS: number; endS: number } | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const a = raw as Record<string, unknown>;
  if (typeof a !== "object" || !isNum(a.atS) || !isNum(a.endS) || a.endS < a.atS) return "said must be { atS, endS } with endS >= atS";
  return { atS: a.atS, endS: a.endS };
}

function answerOf(raw: unknown): { transcript: string; transcriptEn?: string; atS: number; endS: number } | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const a = raw as Record<string, unknown>;
  if (typeof a !== "object" || !isStr(a.transcript, 4000) || !isNum(a.atS) || !isNum(a.endS)) return "answer must be { transcript, transcriptEn?, atS, endS }";
  if (a.transcriptEn !== undefined && typeof a.transcriptEn !== "string") return "answer.transcriptEn must be a string";
  return { transcript: a.transcript, transcriptEn: a.transcriptEn as string | undefined, atS: a.atS, endS: a.endS };
}

export function registerLiveRoutes(http: HttpRouter): void {
  http.route({
    path: "/live/person",
    method: "POST",
    handler: route(false, async (ctx, { sessionToken }) => {
      const person = await ctx.runQuery(internal.live.person, { sessionToken });
      return person ? json(person) : fail(401, "signed out");
    }),
  });

  http.route({
    path: "/live/session",
    method: "POST",
    handler: route(true, async (ctx, { sessionToken, recordingId }) =>
      reply(await ctx.runQuery(internal.live.sessionView, { sessionToken, recordingId })),
    ),
  });

  http.route({
    path: "/live/status",
    method: "POST",
    handler: route(true, async (ctx, { sessionToken, recordingId, status, touch }) => {
      // { touch: true } instead of a status: the heartbeat, which only marks the recording as still in use.
      if (touch === true && status === undefined) return reply(await ctx.runMutation(internal.live.touch, { sessionToken, recordingId }));
      if (!oneOf(STATUSES, status)) return fail(400, `status must be one of ${STATUSES.join(", ")}`);
      return reply(await ctx.runMutation(internal.live.setStatus, { sessionToken, recordingId, status }));
    }),
  });

  http.route({
    path: "/live/prompt",
    method: "POST",
    handler: route(true, async (ctx, { sessionToken, recordingId, kind, text, textEn, atS, status, said }) => {
      if (!oneOf(KINDS, kind)) return fail(400, `kind must be one of ${KINDS.join(", ")}`);
      if (!isStr(text, 2000) || !isStr(textEn, 2000)) return fail(400, "text and textEn are required");
      if (!isNum(atS)) return fail(400, "atS must be a number");
      const s = status ?? "spoken";
      if (!oneOf(PROMPT_STATUSES, s)) return fail(400, `status must be one of ${PROMPT_STATUSES.join(", ")}`);
      const spoke = saidOf(said);
      if (typeof spoke === "string") return fail(400, spoke);
      return reply(await ctx.runMutation(internal.live.addPrompt, { sessionToken, recordingId, kind, text, textEn, atS, status: s, said: spoke }));
    }),
  });

  http.route({
    path: "/live/prompt-said",
    method: "POST",
    handler: route(false, async (ctx, { sessionToken, promptId, said }) => {
      if (!isStr(promptId, 100)) return fail(400, "promptId is required");
      const spoke = saidOf(said);
      if (spoke === undefined || typeof spoke === "string") return fail(400, spoke ?? "said is required");
      return reply(await ctx.runMutation(internal.live.promptSaid, { sessionToken, promptId, said: spoke }));
    }),
  });

  http.route({
    path: "/live/prompt-update",
    method: "POST",
    handler: route(false, async (ctx, { sessionToken, promptId, status, answer }) => {
      if (!isStr(promptId, 100)) return fail(400, "promptId is required");
      if (!oneOf(PROMPT_STATUSES, status)) return fail(400, `status must be one of ${PROMPT_STATUSES.join(", ")}`);
      const parsed = answerOf(answer);
      if (typeof parsed === "string") return fail(400, parsed);
      return reply(await ctx.runMutation(internal.live.updatePrompt, { sessionToken, promptId, status, answer: parsed }));
    }),
  });

  http.route({
    path: "/live/optin",
    method: "POST",
    handler: route(true, async (ctx, { sessionToken, recordingId, optIn }) => {
      if (typeof optIn !== "boolean") return fail(400, "optIn must be a boolean");
      return reply(await ctx.runMutation(internal.live.setOptIn, { sessionToken, recordingId, optIn }));
    }),
  });
}

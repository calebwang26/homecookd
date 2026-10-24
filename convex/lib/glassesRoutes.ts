// Routes for the glasses VM, with x-glasses-secret (glasses/INGEST.md, STACK.md "Glasses VM → Convex").
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";
import { fail, glasses, isNum, isStr, json, sameSecret } from "./http";

export function registerGlassesRoutes(http: HttpRouter): void {
  http.route({
    path: "/glasses/active",
    method: "POST",
    handler: glasses(async (ctx, body) => {
      const { recordingId } = body;
      if (recordingId !== undefined && !isStr(recordingId, 100)) return fail(400, "recordingId must be a string");
      const r = await ctx.runQuery(internal.glasses.active, { recordingId });
      if (r) return json(r);
      return recordingId === undefined ? new Response(null, { status: 204 }) : fail(404, "no such glasses recording");
    }),
  });

  http.route({
    path: "/glasses/finished",
    method: "POST",
    handler: glasses(async (ctx, body) => {
      const { recordingId, videoStartedAt, durationS, videoGaps } = body;
      if (!isStr(recordingId, 100)) return fail(400, "recordingId must be a string");
      // The VM only ever uploads to this folder. Any other path could point the job at another family's video.
      const path = `glasses-${recordingId}/`;
      if (body.uploadPath !== path) return fail(400, "uploadPath must be glasses-<recordingId>/");
      if (!isNum(videoStartedAt) || videoStartedAt <= 0) return fail(400, "videoStartedAt must be epoch ms");
      if (!isNum(durationS) || durationS <= 0) return fail(400, "durationS must be a positive number");
      // The laptop bridge also says where even its full backup has no footage (the VM sends none).
      const gaps = videoGaps === undefined ? undefined : spans(videoGaps);
      if (gaps === null) return fail(400, "videoGaps must be [{startS, endS}] with startS <= endS");
      const r = await ctx.runMutation(internal.glasses.finished, {
        recordingId,
        uploadPath: path,
        videoStartedAt,
        videoGaps: gaps,
      });
      return "jobId" in r ? json(r) : fail(r.status, r.error);
    }),
  });

  // The newest glasses frame, about once a second from the laptop bridge, for the cook's recording screen.
  // Raw JPEG body (not JSON), so it can't use glasses(); same secret.
  http.route({
    path: "/glasses/frame",
    method: "POST",
    handler: httpAction(async (ctx, req) => {
      if (!sameSecret(req.headers.get("x-glasses-secret"), process.env.GLASSES_SECRET)) return fail(401, "wrong secret");
      const recordingId = new URL(req.url).searchParams.get("recordingId");
      if (!isStr(recordingId, 100)) return fail(400, "recordingId must be in the query string");
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length > MAX_FRAME_BYTES) return fail(400, "frame too large");
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail(400, "body must be a JPEG");
      const storageId = await ctx.storage.store(new Blob([bytes], { type: "image/jpeg" }));
      const r = await ctx.runMutation(internal.liveEvents.setFrame, { recordingId, storageId, at: Date.now() });
      return "ok" in r ? json(r) : fail(r.status, r.error);
    }),
  });

  // One window of the laptop bridge's live analysis (glasses/BRIDGE.md).
  http.route({
    path: "/glasses/live-events",
    method: "POST",
    handler: glasses(async (ctx, body) => {
      const { recordingId, sessionId, sessionStartedAt, windowStartS, windowEndS, ok, reason, events } = body;
      if (!isStr(recordingId, 100)) return fail(400, "recordingId must be a string");
      if (!isStr(sessionId, 100)) return fail(400, "sessionId must be a string");
      if (!isNum(sessionStartedAt) || sessionStartedAt <= 0) return fail(400, "sessionStartedAt must be epoch ms");
      if (!isNum(windowStartS) || !isNum(windowEndS) || windowEndS < windowStartS)
        return fail(400, "windowStartS..windowEndS must be a span in seconds");
      if (typeof ok !== "boolean") return fail(400, "ok must be true or false");
      if (reason !== undefined && typeof reason !== "string") return fail(400, "reason must be a string");
      if (!Array.isArray(events)) return fail(400, "events must be a list");
      const clean = [];
      for (const e of events) {
        const ev = liveEvent(e);
        if (!ev) return fail(400, "each event needs kind, atS, title, text and confidence");
        clean.push(ev);
      }
      const r = await ctx.runMutation(internal.liveEvents.ingest, {
        recordingId,
        sessionId,
        sessionStartedAt,
        windowStartS,
        windowEndS,
        ok,
        reason,
        events: clean,
      });
      return "events" in r ? json(r) : fail(r.status, r.error);
    }),
  });
}

const MAX_FRAME_BYTES = 512 * 1024;
const KINDS = ["step", "ingredient", "cue", "quote", "story", "marker"] as const;
const optStr = (x: unknown) => x === undefined || typeof x === "string";

/** A live event with only the fields Convex stores, or null if it doesn't have the right shape. */
function liveEvent(e: unknown) {
  if (!e || typeof e !== "object") return null;
  const { kind, atS, endS, title, text, saidAs, quoteOriginal, confidence } = e as Record<string, unknown>;
  const k = KINDS.find((x) => x === kind);
  if (!k || !isNum(atS) || !(endS === undefined || isNum(endS)) || !isNum(confidence)) return null;
  if (typeof title !== "string" || title.length > 500 || typeof text !== "string" || text.length > 4000) return null;
  if (!optStr(saidAs) || !optStr(quoteOriginal)) return null;
  return {
    kind: k,
    atS,
    endS: endS as number | undefined,
    title,
    text,
    saidAs: (saidAs as string | undefined)?.slice(0, 500),
    quoteOriginal: (quoteOriginal as string | undefined)?.slice(0, 2000),
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

function spans(x: unknown): { startS: number; endS: number }[] | null {
  if (!Array.isArray(x) || x.length > 1000) return null;
  const out = [];
  for (const g of x) {
    const { startS, endS } = (g ?? {}) as Record<string, unknown>;
    if (!isNum(startS) || !isNum(endS) || endS < startS) return null;
    out.push({ startS, endS });
  }
  return out;
}

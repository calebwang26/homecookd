// Routes for the glasses VM, with x-glasses-secret (glasses/INGEST.md, STACK.md "Glasses VM → Convex").
import type { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { fail, glasses, isNum, isStr, json } from "./http";

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
      const { recordingId, videoStartedAt, durationS } = body;
      if (!isStr(recordingId, 100)) return fail(400, "recordingId must be a string");
      // The VM only ever uploads to this folder. Any other path could point the job at another family's video.
      const path = `glasses-${recordingId}/`;
      if (body.uploadPath !== path) return fail(400, "uploadPath must be glasses-<recordingId>/");
      if (!isNum(videoStartedAt) || videoStartedAt <= 0) return fail(400, "videoStartedAt must be epoch ms");
      if (!isNum(durationS) || durationS <= 0) return fail(400, "durationS must be a positive number");
      const r = await ctx.runMutation(internal.glasses.finished, { recordingId, uploadPath: path, videoStartedAt });
      return "jobId" in r ? json(r) : fail(r.status, r.error);
    }),
  });
}

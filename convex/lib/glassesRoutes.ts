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
      const path = typeof body.uploadPath === "string" ? body.uploadPath.trim() : "";
      if (!path || path.length > 500 || path.includes("..") || path.startsWith("/")) {
        return fail(400, "uploadPath must be a path in the uploads bucket");
      }
      if (!isNum(videoStartedAt) || videoStartedAt <= 0) return fail(400, "videoStartedAt must be epoch ms");
      if (!isNum(durationS) || durationS <= 0) return fail(400, "durationS must be a positive number");
      const r = await ctx.runMutation(internal.glasses.finished, { recordingId, uploadPath: path, videoStartedAt });
      return "jobId" in r ? json(r) : fail(r.status, r.error);
    }),
  });
}

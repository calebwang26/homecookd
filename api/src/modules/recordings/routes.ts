// Reads only: homie is off, so nothing here starts or moves a recording (docs/build/JOBS-MIGRATION.md, "Deferred"). Convex's function is beside each route.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import * as service from "./service.js";

const byId = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 100 } } };
const paramId = (req: FastifyRequest) => (req.params as { id: string }).id;

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preValidation", requireSession);

  // glasses.videos. At most 10, so it needs no paging. It comes before :id, though Fastify picks the exact route either way.
  app.get("/v1/recordings/glasses-videos", async (req) => ({ videos: await service.readGlassesVideos(signedIn(req)) }));
  // live.recording
  app.get("/v1/recordings/:id", { schema: { params: byId } }, async (req) => await service.getOr404(service.readRecording(signedIn(req), paramId(req))));
  // liveEvents.forRecording
  app.get("/v1/recordings/:id/log", { schema: { params: byId } }, async (req) => await service.getOr404(service.readLiveLog(signedIn(req), paramId(req))));
  // liveEvents.frame: `frame` is null when there's none yet. Another family's recording is a 404.
  app.get("/v1/recordings/:id/frame", { schema: { params: byId } }, async (req) => {
    await service.getOr404(service.readRecording(signedIn(req), paramId(req)));
    return { frame: await service.readLiveFrame(signedIn(req), paramId(req)) };
  });
  // cooking.current. At most 50 open rows, one per kid, so it needs no paging.
  app.get("/v1/cooking", async (req) => ({ cooking: await service.readCooking(signedIn(req)) }));
}

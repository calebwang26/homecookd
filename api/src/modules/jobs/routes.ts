// Jobs and uploads, in place of cloud/signer's links and convex/jobs.ts. Each route checks the session first, then its input. Convex's function is beside each route.
//
// `uploadId` is checked by its own rule: an upload belongs to the person who asked for its links (uploads.ts ownUpload, service.ts createJob). It's a folder's name, not a
// file's key, so it isn't in config.fileKeys. Tested per route in jobs.test.ts.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import { ApiError } from "../../errors.js";
import * as service from "./service.js";
import * as uploads from "./uploads.js";

const ID = { type: "string", minLength: 1, maxLength: 100 };
const byId = { type: "object", required: ["id"], properties: { id: ID } };
const byUpload = { type: "object", required: ["uploadId"], properties: { uploadId: ID } };
const page = { type: "object", properties: { cursor: { type: "string", maxLength: 500 } } };
const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,200}$/;

const paramId = (req: FastifyRequest) => (req.params as { id: string }).id;
const uploadIdOf = (req: FastifyRequest) => (req.params as { uploadId: string }).uploadId;
const trace = (req: FastifyRequest) => String(req.id);

function idempotencyKey(req: FastifyRequest): string {
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || !IDEMPOTENCY.test(key)) throw new ApiError(400, "bad_request");
  return key;
}

const askForUploads = {
  type: "object",
  required: ["videos"],
  properties: {
    videos: {
      type: "array",
      items: {
        type: "object",
        required: ["contentType", "size"],
        properties: { contentType: { type: "string", maxLength: 100 }, size: { type: "integer", minimum: 1 }, durationS: { type: "number", minimum: 0 } },
      },
    },
  },
};

const partsToSign = {
  type: "object",
  required: ["index", "partNumbers"],
  properties: { index: { type: "integer", minimum: 1 }, partNumbers: { type: "array", items: { type: "integer" }, maxItems: 1000 } },
};

const partsDone = {
  type: "object",
  required: ["index", "parts"],
  properties: {
    index: { type: "integer", minimum: 1 },
    parts: {
      type: "array",
      maxItems: 10000,
      items: {
        type: "object",
        required: ["partNumber", "etag"],
        properties: { partNumber: { type: "integer", minimum: 1 }, etag: { type: "string", minLength: 1, maxLength: 200 } },
      },
    },
  },
};

const newJob = {
  type: "object",
  required: ["uploadId", "source"],
  properties: {
    uploadId: ID,
    source: { type: "string", enum: ["phone", "glasses"] },
    title: { type: "string", maxLength: 1000 },
    language: { type: "string", maxLength: 20 },
    forKidId: ID,
    forKidIds: { type: "array", maxItems: 100, items: ID },
    recordingId: ID,
  },
};

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preValidation", requireSession);

  // cloud/signer's POST
  app.post("/v1/video-uploads", { schema: { body: askForUploads } }, async (req, reply) => {
    const signed = signedIn(req);
    if (signed.role !== "cook") throw new ApiError(403, "forbidden");
    const { status, body } = await uploads.requestUpload(signed, (req.body as { videos: uploads.VideoAsked[] }).videos, idempotencyKey(req));
    return reply.code(status).send(body);
  });
  // New: the signer's links lasted 7 days
  app.post("/v1/video-uploads/:uploadId/links", { schema: { params: byUpload }, config: { noBody: true } }, async (req) => await uploads.newLinks(signedIn(req), uploadIdOf(req)));
  // New: a video over S3's 5 GiB limit for one PUT goes up in parts
  app.post("/v1/video-uploads/:uploadId/parts", { schema: { params: byUpload, body: partsToSign } }, async (req) => {
    const b = req.body as { index: number; partNumbers: number[] };
    return await uploads.partLinks(signedIn(req), uploadIdOf(req), b.index, b.partNumbers);
  });
  app.post("/v1/video-uploads/:uploadId/parts/finish", { schema: { params: byUpload, body: partsDone } }, async (req) => {
    const b = req.body as { index: number; parts: { partNumber: number; etag: string }[] };
    return await uploads.finishParts(signedIn(req), uploadIdOf(req), b.index, b.parts);
  });
  // New: the upload-complete check, which the signer's status file and the worker's release did
  app.post("/v1/video-uploads/:uploadId/complete", { schema: { params: byUpload }, config: { noBody: true } }, async (req) => await uploads.completeUpload(signedIn(req), uploadIdOf(req), trace(req)));
  // jobs.cancelUpload, and the signer's action: cancel
  app.post("/v1/video-uploads/:uploadId/cancel", { schema: { params: byUpload }, config: { noBody: true } }, async (req) => ({
    stopped: await service.cancelUpload(signedIn(req), uploadIdOf(req), trace(req)),
  }));

  // jobs.create
  app.post("/v1/jobs", { schema: { body: newJob } }, async (req, reply) => {
    const { status, jobId, recipeId } = await service.createJob(signedIn(req), req.body as service.JobInput, trace(req));
    return reply.code(status).send({ jobId, recipeId });
  });
  // jobs.forFamily
  app.get("/v1/jobs", { schema: { querystring: page } }, async (req) => await service.listJobs(signedIn(req), (req.query as { cursor?: string }).cursor));
  // New: one job's progress
  app.get("/v1/jobs/:id", { schema: { params: byId } }, async (req) => await service.getJob(signedIn(req), paramId(req)));
  // jobs.cancel
  app.post("/v1/jobs/:id/cancel", { schema: { params: byId }, config: { noBody: true } }, async (req) => ({
    stopped: await service.cancelJob(signedIn(req), paramId(req), trace(req)),
  }));
}

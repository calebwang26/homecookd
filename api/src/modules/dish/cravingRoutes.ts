// The dish module's signed-in routes, a card's and cravings': the name of the Convex function each replaces is beside it. Card-making stays on POST /dish/cards. A refusal is
// app.ts's one shape.
import * as Sentry from "@sentry/node";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import type { Trace } from "./budget.js";
import * as cravings from "./cravings.js";
import { myCard } from "./service.js";
import { DishFail } from "./values.js";

const ID = { type: "string", minLength: 1, maxLength: 100 };
const byId = { type: "object", required: ["id"], properties: { id: ID } };
const page = { type: "object", properties: { cursor: { type: "string", maxLength: 500 } } };
const OK = { ok: true };

const paramId = (req: FastifyRequest) => (req.params as { id: string }).id;
const traceOf = (req: FastifyRequest): Trace => ({ requestId: String(req.id), log: req.log as unknown as Trace["log"] });

/** Before files.ts's guard, which only takes a confirmed file: see cravings.confirmOwnClip. It can't be a route's service step, because the guard runs first. */
async function confirmClip(req: FastifyRequest): Promise<void> {
  const key = (req.body as { audioKey?: unknown } | null | undefined)?.audioKey;
  if (typeof key === "string" && key.length <= 300) await cravings.confirmOwnClip(signedIn(req), paramId(req), key);
}

/** S3 failing is logged here, with its cause; app.ts answers every error. */
function onError(error: FastifyError, req: FastifyRequest): never {
  if (error instanceof DishFail && error.code === "provider_down") {
    const cause = (error as { cause?: Error }).cause ?? error;
    req.log.error({ err: { type: cause.name } }, "craving storage failed");
    Sentry.captureException(cause, { tags: { request_id: String(req.id) } });
  }
  throw error;
}

export async function cravingRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler(onError);
  app.addHook("preValidation", requireSession);

  // dishAsks.get: /dish/<id>, which the `answered` and `joined` pushes open. Any role, for the card's kid or its cook.
  app.get("/v1/dish-asks/:id", { schema: { params: byId } }, async (req) => await myCard(signedIn(req), paramId(req), traceOf(req)));

  // cravings.createLink, revokeLink
  app.post("/v1/cravings/link", { schema: { body: { type: "object", properties: { message: { type: "string", maxLength: 2000 } } } } }, async (req) =>
    await cravings.createLink(signedIn(req), (req.body as { message?: string } | undefined)?.message),
  );
  app.post("/v1/cravings/link/revoke", { config: { noBody: true } }, async (req) => {
    await cravings.revokeLink(signedIn(req));
    return OK;
  });

  // cravings.forCook, get
  app.get("/v1/cravings", { schema: { querystring: page } }, async (req) => await cravings.forCook(signedIn(req), (req.query as { cursor?: string }).cursor));
  app.get("/v1/cravings/:id", { schema: { params: byId } }, async (req) => await cravings.getAsk(signedIn(req), paramId(req)));

  // cravings.setFilmingDay. Untyped, so a day that isn't one gets its own sentence, not a coerced number.
  app.post("/v1/cravings/:id/filming-day", { schema: { params: byId, body: { type: "object", required: ["day"], properties: { day: {} } } } }, async (req) => {
    await cravings.setFilmingDay(signedIn(req), paramId(req), (req.body as { day: unknown }).day);
    return OK;
  });

  // cravings.sendVoiceRecipe, split so the bytes skip the api: the link, a PUT to S3, then this.
  app.post(
    "/v1/cravings/:id/voice-recipe/upload",
    { schema: { params: byId, body: { type: "object", properties: { contentType: {}, size: {} } } } },
    async (req, reply) => {
      const b = req.body as { contentType?: unknown; size?: unknown };
      return reply.code(201).send(await cravings.requestVoiceUpload(signedIn(req), paramId(req), b.contentType, b.size));
    },
  );
  app.post(
    "/v1/cravings/:id/voice-recipe",
    {
      preValidation: confirmClip,
      schema: {
        params: byId,
        body: {
          type: "object",
          required: ["audioKey", "durationS"],
          properties: { audioKey: { type: "string", maxLength: 300 }, durationS: { type: "number" }, language: { type: "string", maxLength: 10 } },
        },
      },
      config: { fileKeys: ["audioKey"] },
    },
    async (req) => {
      const b = req.body as { audioKey: string; durationS: number; language?: string };
      await cravings.sendVoiceRecipe(signedIn(req), { id: paramId(req), ...b }, traceOf(req));
      return OK;
    },
  );
}

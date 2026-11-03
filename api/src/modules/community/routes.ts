// Community's signed-in routes. Every one checks the session first, then its input; a list always pages. The name of the Convex function each replaces is beside it, and
// docs/build/COMMUNITY-MIGRATION.md has what an adapter does with the replies.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import { invalid } from "../../errors.js";
import { PLACE_KINDS, REPORT_REASONS, type PlaceKind, type ReportReason } from "./data.js";
import { createDinner, getDinner, inviteLink, myDinners, requestJoin, respondToJoin } from "./dinners.js";
import type { Reportable } from "./safety.js";
import * as service from "./service.js";
import { askToShare, familyDishes, unshare } from "./shareAsks.js";

const ID = { type: "string", minLength: 1, maxLength: 100 };
const byId = { type: "object", required: ["id"], properties: { id: ID } };
const page = { type: "object", properties: { cursor: { type: "string", maxLength: 500 } } };
const nearby = { type: "object", properties: { cursor: { type: "string", maxLength: 500 }, maxMiles: { type: "number", minimum: 0 } } };
const answer = { type: "object", required: ["accept"], properties: { accept: { type: "boolean" } } };
const target = {
  kind: { type: "string", enum: ["recipe", "dinner"] },
  targetId: ID,
};
const IDEMPOTENCY = /^[A-Za-z0-9_-]{8,100}$/;

const cursorOf = (req: FastifyRequest) => (req.query as { cursor?: string }).cursor;
const paramId = (req: FastifyRequest) => (req.params as { id: string }).id;
const OK = { ok: true };

function idempotencyKey(req: FastifyRequest): string | undefined {
  const key = req.headers["idempotency-key"];
  if (key === undefined) return undefined;
  if (typeof key !== "string" || !IDEMPOTENCY.test(key)) throw invalid("Idempotency-Key");
  return key;
}

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  // Everything here needs a session, before the body is looked at.
  app.addHook("preValidation", requireSession);

  // community.feed. The app's `now` isn't taken: Postgres has a clock, and Convex's queries didn't.
  app.get("/v1/community/feed", { schema: { querystring: nearby } }, async (req) => {
    const { maxMiles, cursor } = req.query as { maxMiles?: number; cursor?: string };
    return await service.feed(signedIn(req), { maxMiles, cursor });
  });
  app.get("/v1/community/dinners", { schema: { querystring: nearby } }, async (req) => {
    const { maxMiles, cursor } = req.query as { maxMiles?: number; cursor?: string };
    return await service.moreDinners(signedIn(req), { maxMiles, cursor });
  });
  // community.recipe
  app.get("/v1/community/recipes/:id", { schema: { params: byId } }, async (req) => await service.recipe(signedIn(req), paramId(req)));

  // community.mySwaps, requestSwap, cookTogether, respondSwap
  app.get("/v1/community/swaps", { schema: { querystring: page } }, async (req) => await service.mySwaps(signedIn(req), cursorOf(req)));
  app.post(
    "/v1/community/swaps",
    { schema: { body: { type: "object", required: ["recipeId"], properties: { recipeId: ID, myRecipeId: ID } } } },
    async (req) => {
      const { recipeId, myRecipeId } = req.body as { recipeId: string; myRecipeId?: string };
      return await service.requestSwap(signedIn(req), recipeId, myRecipeId);
    },
  );
  app.post(
    "/v1/community/cook-together",
    { schema: { body: { type: "object", required: ["recipeId"], properties: { recipeId: ID } } } },
    async (req) => await service.cookTogether(signedIn(req), (req.body as { recipeId: string }).recipeId),
  );
  app.post("/v1/community/swaps/:id/respond", { schema: { params: byId, body: answer } }, async (req) => {
    await service.respondSwap(signedIn(req), paramId(req), (req.body as { accept: boolean }).accept);
    return OK;
  });

  // community.report, block, blocked, unblock
  app.post(
    "/v1/community/reports",
    { schema: { body: { type: "object", required: ["kind", "targetId"], properties: { ...target, reason: { type: "string", enum: [...REPORT_REASONS] } } } } },
    async (req) => {
      const { kind, targetId, reason } = req.body as { kind: Reportable; targetId: string; reason?: ReportReason };
      await service.report(signedIn(req), kind, targetId, reason ?? null, String(req.id));
      return OK;
    },
  );
  app.post("/v1/community/blocks", { schema: { body: { type: "object", required: ["kind", "targetId"], properties: target } } }, async (req) => {
    const { kind, targetId } = req.body as { kind: Reportable; targetId: string };
    await service.block(signedIn(req), kind, targetId, String(req.id));
    return OK;
  });
  app.get("/v1/community/blocks", { schema: { querystring: page } }, async (req) => await service.blocked(signedIn(req), cursorOf(req)));
  app.delete("/v1/community/blocks/:id", { schema: { params: byId }, config: { noBody: true } }, async (req) => {
    await service.unblock(signedIn(req), paramId(req));
    return OK;
  });

  // dinners.create, get, mine, requestJoin, respond, inviteLink
  app.post(
    "/v1/dinners",
    {
      bodyLimit: 16 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["recipeId", "startsAt", "placeName", "address", "seats"],
          properties: {
            recipeId: ID,
            startsAt: { type: "number", minimum: 0, maximum: 8.64e15 },
            placeKind: { type: "string", enum: [...PLACE_KINDS] },
            placeName: { type: "string" },
            address: { type: "string" },
            seats: { type: "number" },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body as { recipeId: string; startsAt: number; placeKind?: PlaceKind; placeName: string; address: string; seats: number };
      return reply.code(201).send(await createDinner(signedIn(req), body, idempotencyKey(req)));
    },
  );
  app.get("/v1/dinners/mine", { schema: { querystring: page } }, async (req) => await myDinners(signedIn(req), cursorOf(req)));
  app.get("/v1/dinners/:id", { schema: { params: byId } }, async (req) => await getDinner(signedIn(req), paramId(req)));
  app.post("/v1/dinners/:id/join", { schema: { params: byId }, config: { noBody: true } }, async (req) => await requestJoin(signedIn(req), paramId(req)));
  app.post("/v1/dinner-requests/:id/respond", { schema: { params: byId, body: answer } }, async (req) => {
    await respondToJoin(signedIn(req), paramId(req), (req.body as { accept: boolean }).accept);
    return OK;
  });
  app.post("/v1/dinners/:id/invite-link", { schema: { params: byId }, config: { noBody: true } }, async (req) => await inviteLink(signedIn(req), paramId(req)));

  // shareRequests.ask, familyDishes
  app.post(
    "/v1/share-requests",
    { schema: { body: { type: "object", required: ["recipeId"], properties: { recipeId: ID } } } },
    async (req) => await askToShare(signedIn(req), (req.body as { recipeId: string }).recipeId, String(req.id)),
  );
  app.get("/v1/share-requests/dishes", { schema: { querystring: page } }, async (req) => await familyDishes(signedIn(req), cursorOf(req)));
  // community.setShare with on: false (her switch). On is her tap on /v1/share-requests.
  app.post("/v1/recipes/:id/unshare", { schema: { params: byId }, config: { noBody: true } }, async (req) => {
    await unshare(signedIn(req), paramId(req));
    return OK;
  });
}

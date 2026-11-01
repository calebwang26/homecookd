// A family's recipes. Reads work now. The one edit here is behind the recipes switch (switch.ts), which is off. Convex's function is beside each route.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import { getRecipe, listRecipes, setMemoriesOptIn } from "./reads.js";

const byId = { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1, maxLength: 100 } } };
const page = { type: "object", properties: { cursor: { type: "string", maxLength: 500 } } };
const paramId = (req: FastifyRequest) => (req.params as { id: string }).id;

export async function recipeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preValidation", requireSession);

  // recipes.list
  app.get("/v1/recipes", { schema: { querystring: page } }, async (req) => await listRecipes(signedIn(req), (req.query as { cursor?: string }).cursor));
  // recipes.get
  app.get("/v1/recipes/:id", { schema: { params: byId } }, async (req) => await getRecipe(signedIn(req), paramId(req)));
  // recipes.setMemoriesOptIn
  app.post(
    "/v1/recipes/:id/memories-opt-in",
    { schema: { params: byId, body: { type: "object", required: ["optIn"], properties: { optIn: { type: "boolean" } } } } },
    async (req) => {
      await setMemoriesOptIn(signedIn(req), paramId(req), (req.body as { optIn: boolean }).optIn);
      return { ok: true };
    },
  );
}

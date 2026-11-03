// A family's recipes. Reads work now; the edit and staging's test recipe are behind the recipes switch (switch.ts). Convex's function is beside each route.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import { signedOut } from "../../errors.js";
import { keyMatches, testSignInKey } from "../accounts/testSignIn.js";
import { getRecipe, listRecipes, setMemoriesOptIn } from "./reads.js";
import { makeTestRecipe, TEST_RECIPE_BODY, type TestRecipeAsk } from "./testRecipe.js";

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

  // Staging's scripts only (testRecipe.ts): without TEST_SIGNIN_KEY there's no route at all, as for the test sign-in. Her session is checked first, then the key, then the body.
  const testKey = testSignInKey();
  if (testKey) {
    const theTestKey = async (req: FastifyRequest) => {
      if (!keyMatches(req.headers["x-test-signin-key"], testKey)) throw signedOut("That test key isn't right.");
      req.body ??= {}; // every field is optional, so no body at all is fine
    };
    app.post("/v1/test/recipe", { schema: { body: TEST_RECIPE_BODY }, preValidation: theTestKey }, async (req, reply) =>
      reply.code(201).send(await makeTestRecipe(signedIn(req), req.body as TestRecipeAsk, String(req.id))),
    );
  }
}

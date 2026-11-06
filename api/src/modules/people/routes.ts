// The template for a module: a route checks the input and who's asking, service.ts holds the rules, data.ts holds the SQL.
import type { FastifyInstance } from "fastify";
import { requireSession, signedIn } from "../../auth.js";
import { me } from "./service.js";

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/me", { preValidation: requireSession }, async (req) => me(signedIn(req)));
}

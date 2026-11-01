// The real app, with every module, starts. Two routes on one address only fail when the app builds, typecheck can't see them, and a task would stop at launch. No database:
// building reaches none, so this runs and says why even when the rest of a run skips.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("the real app builds with every module", async () => {
  const app = buildApp({ logger: false });
  await app.ready();
  assert.ok(app.allRoutes.length > 50, `only ${app.allRoutes.length} routes`);
  await app.close();
});

test("two routes on one address stop it", async () => {
  const app = buildApp({ logger: false, routes: (a) => void a.register(async (m) => void m.get("/health", async () => "again")) }); // as a module registers
  await assert.rejects(async () => void (await app.ready()), /already declared/);
});

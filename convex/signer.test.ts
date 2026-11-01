import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { LIMITS } from "./lib/rateLimit";
import { addRecipe, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));
afterEach(() => vi.unstubAllGlobals());

test("the signer may cancel or delete only the caller's own family's jobs and recipes, and only for a cook", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  await t.mutation(api.jobs.create, { sessionToken: dad.sessionToken, uploadPath: "dal-a1b2c3/", source: "phone" });
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  await t.run((ctx) => ctx.db.patch("recipes", recipeId, { libraryId: "sunday-chili" }));

  const owns = (sessionToken: string, kind: "job" | "recipe", id: string) =>
    t.query(api.signer.owns, { sessionToken, kind, id });
  expect(await owns(dad.sessionToken, "job", "dal-a1b2c3")).toBe(true);
  expect(await owns(dad.sessionToken, "recipe", "sunday-chili")).toBe(true);
  expect(await owns(dad.sessionToken, "job", "dal-a1b2")).toBe(false); // a prefix of the id isn't the job
  expect(await owns(dad.sessionToken, "recipe", "weed-steak")).toBe(false); // the shared library isn't hers
  expect(await owns(leo.sessionToken, "job", "dal-a1b2c3")).toBe(false); // kids can't

  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const other = await signIn(t, "q-1");
  expect(await owns(other.sessionToken, "job", "dal-a1b2c3")).toBe(false);
  expect(await owns(other.sessionToken, "recipe", "sunday-chili")).toBe(false);
  await expect(owns("x".repeat(43), "job", "dal-a1b2c3")).rejects.toThrow("signed out");
});

test("upload links: only a cook, so many a day, and each person counts alone", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  const leo = await signIn(t, "p-leo");
  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const sam = await signIn(t, "q-1");
  const allow = (sessionToken: string) => t.mutation(api.signer.allowUpload, { sessionToken });

  expect(await allow(leo.sessionToken)).toBe("cook_only");
  await expect(allow("x".repeat(43))).rejects.toThrow("signed out");

  for (let i = 0; i < LIMITS.signerUploads.max; i++) expect(await allow(dad.sessionToken)).toBe("ok");
  expect(await allow(dad.sessionToken)).toBe("too_many");
  expect(await allow(sam.sessionToken)).toBe("ok");

  vi.setSystemTime(new Date("2026-11-02T00:00:01Z"));
  expect(await allow(dad.sessionToken)).toBe("ok");
  vi.useRealTimers();
});

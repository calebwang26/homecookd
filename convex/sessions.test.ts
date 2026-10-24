import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { addRecipe, FAMILY, newBackend, signIn, stubFetch } from "./test.helpers";

vi.mock("@moss-js/moss", () => ({ MossClient: class {} }));
afterEach(() => vi.unstubAllGlobals());

test("sign-in checks the device key with Supabase and mirrors the family", async () => {
  const fetch = stubFetch();
  const t = newBackend();
  const s = await signIn(t, "p-leo");
  expect(s.role).toBe("kid");
  expect(s.sessionToken).toHaveLength(43);

  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toMatch(/\/functions\/v1\/api\/family$/);
  expect((init?.headers as Record<string, string>)["x-device-key"]).toBe("k".repeat(43));
  expect((init?.headers as Record<string, string>)["x-profile-id"]).toBe("p-leo");

  const people = await t.run((ctx) => ctx.db.query("people").collect());
  expect(people.map((p) => [p.name, p.role]).sort()).toEqual([
    ["Amy", "kid"],
    ["Dad", "cook"],
    ["Leo", "kid"],
    ["Mom", "cook"],
  ]);
  // Only the hash is stored.
  const sessions = await t.run((ctx) => ctx.db.query("sessions").collect());
  expect(sessions).toHaveLength(1);
  expect(sessions[0].tokenHash).not.toContain(s.sessionToken);

  // Signing in again reuses the family and people.
  await signIn(t, "p-dad");
  expect(await t.run((ctx) => ctx.db.query("people").collect())).toHaveLength(4);
  expect(await t.run((ctx) => ctx.db.query("families").collect())).toHaveLength(1);
});

test("sign-in refuses locked, invited and unknown people, and passes Supabase's errors on", async () => {
  stubFetch();
  const t = newBackend();
  await expect(signIn(t, "p-mom")).rejects.toThrow("Mom uses their own phone.");
  await expect(signIn(t, "p-amy")).rejects.toThrow("They haven't joined yet.");
  await expect(signIn(t, "p-nobody")).rejects.toThrow("isn't in this family");

  stubFetch(FAMILY, (url) => (url.endsWith("/family") ? Response.json({ error: "This phone was signed out." }, { status: 401 }) : undefined));
  await expect(signIn(t, "p-leo")).rejects.toThrow("This phone was signed out.");
  expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toHaveLength(0);
});

test("every public function needs a live session, and sees only its own family", async () => {
  stubFetch();
  const t = newBackend();
  await expect(t.query(api.recipes.list, { sessionToken: "x".repeat(43) })).rejects.toThrow("signed out");

  const dad = await signIn(t, "p-dad");
  const recipeId = await addRecipe(t, dad.familyId, dad.personId);
  expect(await t.query(api.recipes.list, { sessionToken: dad.sessionToken })).toHaveLength(1);

  stubFetch({ family: { id: "fam-2", name: "Others" }, profiles: [{ id: "q-1", name: "Sam", role: "cook" }] });
  const other = await signIn(t, "q-1");
  expect(await t.query(api.recipes.list, { sessionToken: other.sessionToken })).toHaveLength(0);
  expect(await t.query(api.recipes.get, { sessionToken: other.sessionToken, recipeId })).toBeNull();

  await t.mutation(api.sessions.end, { sessionToken: dad.sessionToken });
  await expect(t.query(api.recipes.list, { sessionToken: dad.sessionToken })).rejects.toThrow("signed out");
});

test("expired sessions stop working in mutations and get purged", async () => {
  stubFetch();
  const t = newBackend();
  const dad = await signIn(t, "p-dad");
  await t.run(async (ctx) => {
    const s = (await ctx.db.query("sessions").first())!;
    await ctx.db.patch("sessions", s._id, { expiresAt: Date.now() - 1 });
  });
  await expect(t.mutation(api.files.uploadUrl, { sessionToken: dad.sessionToken })).rejects.toThrow("signed out");
  await t.mutation(internal.sessions.purgeExpired, {});
  expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toHaveLength(0);
});

test("the demo seed is taken over by the first real sign-in", async () => {
  stubFetch();
  const t = newBackend();
  const { recipesAdded } = await t.mutation(internal.seed.demo, { supabaseFamilyId: "fam-1" });
  expect(recipesAdded).toBe(4);
  expect((await t.mutation(internal.seed.demo, { supabaseFamilyId: "fam-1" })).recipesAdded).toBe(0);

  const dad = await signIn(t, "p-dad");
  const recipes = await t.query(api.recipes.list, { sessionToken: dad.sessionToken });
  expect(recipes.filter((r) => r.cookName === "Dad")).toHaveLength(2);
  expect(recipes.every((r) => r.steps.length > 0 && r.status === "ready")).toBe(true);
  const dadRow = await t.run((ctx) => ctx.db.get("people", dad.personId));
  expect(dadRow?.supabaseProfileId).toBe("p-dad");
});

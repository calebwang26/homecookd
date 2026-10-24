// Shared setup for the Community suites (two dots in the name, so Convex doesn't deploy it): families
// and signed-in people written straight to the tables, and a Kanda Poha recipe with her Marathi quote.
import type { Id } from "./_generated/dataModel";
import { hashToken } from "./lib/auth";
import { DEMO_LOCATION } from "./lib/geo";
import { type Backend, newBackend } from "./test.helpers";

export type Who = { sessionToken: string; personId: Id<"people">; familyId: Id<"families"> };

export async function family(t: Backend, name: string, publicName?: string) {
  return await t.run((ctx) => ctx.db.insert("families", { name, supabaseFamilyId: `test:${name}`, publicName }));
}

export async function person(
  t: Backend,
  familyId: Id<"families">,
  name: string,
  role: "cook" | "kid",
  approx?: { lat: number; lng: number },
  language?: string,
): Promise<Who> {
  const sessionToken = `token-${name}-${"x".repeat(24)}`;
  const tokenHash = await hashToken(sessionToken);
  const personId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("people", { familyId, supabaseProfileId: `test:${name}`, name, role, approx, language });
    await ctx.db.insert("sessions", { tokenHash, familyId, personId: id, expiresAt: Date.now() + 86_400_000 });
    return id;
  });
  return { sessionToken, personId, familyId };
}

export async function recipe(t: Backend, who: Who, extra: Record<string, unknown> = {}) {
  return await t.run((ctx) =>
    ctx.db.insert("recipes", {
      familyId: who.familyId,
      cookId: who.personId,
      title: "Kanda Poha",
      status: "ready",
      libraryId: "lib-poha-secret",
      recipeJsonUrl: "https://storage.googleapis.com/edible-recipes/poha/recipe.json",
      coverUrl: "https://storage.googleapis.com/edible-recipes/poha/poster.jpg",
      steps: [
        { order: 1, title: "Rinse the poha", text: "Rinse it twice.", quote: "Not too long, beta.", quoteOriginal: "जास्त वेळ नको", moment: { startS: 10, endS: 40 } },
        { order: 2, title: "Temper", text: "Mustard seeds in hot oil.", moment: { startS: 50, endS: 90 } },
      ],
      memories: [{ kind: "story", text: "Her mother made this every Sunday in Pune.", moment: { startS: 60, endS: 80 } }],
      memoriesOptIn: false,
      ...extra,
    }),
  );
}

/** Two families: the Pawars (Grandma Rajani + Shreya) and a neighbor, plus Caleb in his own family. */
export async function world() {
  const t = newBackend();
  const pawar = await family(t, "Pawar home", "Pawar");
  const rajani = await person(t, pawar, "Rajani", "cook");
  const shreya = await person(t, pawar, "Shreya", "kid");
  const zhang = await family(t, "Zhang home");
  const serene = await person(t, zhang, "Serene", "kid");
  const serenesMom = await person(t, zhang, "Mei", "cook", { lat: DEMO_LOCATION.lat + 0.02, lng: DEMO_LOCATION.lng });
  const wang = await family(t, "Wang home");
  const caleb = await person(t, wang, "Caleb", "kid");
  return { t, rajani, shreya, serene, serenesMom, caleb };
}

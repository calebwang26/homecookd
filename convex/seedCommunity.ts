// Community demo data: eight neighbor families, 0.5–3 mi from the venue, one shared recipe each (text
// only, no video), and one pre-written dish for each floormate's real family. Safe to run twice:
//   npx convex run seedCommunity:neighbors
//   npx convex run seedCommunity:floormateDish '{"familyId": "<id>", "dish": "Tomato Egg Stir-Fry",
//     "culture": "Chinese", "quote": "<one of the steps' quotes>", "coverUrl": "https://homecookd.app/media/stock/<photo>.jpg",
//     "steps": [{"title": "…", "text": "…", "quote": "…"}]}'
//   npx convex run seedCommunity:place '{"familyId": "<id>"}'          a whole family at the venue ("In your building")
//   npx convex run seedCommunity:place '{"personId": "<id>"}'          one real account, at the venue
//   npx convex run seedCommunity:publicName '{"familyId": "<id>", "publicName": "Pawar"}'
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { plainStory, PUBLIC_COVER } from "./community";
import { DEMO_LOCATION, roundToGrid } from "./lib/geo";
import { cleanCulture, cleanStory, quoteChoices, unquote } from "./lib/storyCard";

type Neighbor = {
  slug: string;
  culture: string;
  publicName: string;
  cook: string;
  dish: string;
  cover: string; // web/public/media/stock/
  at: [number, number]; // offset from DEMO_LOCATION, in grid steps (0.01°)
  story: string;
  // [title, text, the cook's words]; the card's quote is her line (feelQuote in web/src/content/recipes.ts)
  steps: [string, string, string?][];
};

const NO_MOMENT = { startS: 0, endS: 0 }; // text only: there's no video to point at

const NEIGHBORS: Neighbor[] = [
  {
    slug: "okafor", culture: "Nigerian", publicName: "Okafor", cook: "Mama Ngozi", dish: "Jollof Rice", cover: "dish-jollof-rice.jpg", at: [1, 0],
    story: "Mama Ngozi's party jollof, cooked low and slow until the bottom of the pot turns smoky.",
    steps: [
      ["Blend the base", "Blend tomatoes, red peppers, scotch bonnet and onion until smooth."],
      ["Fry the paste", "Fry tomato paste in oil until it turns a deep brick red."],
      ["Cook it down", "Add the blended base and simmer until the oil rises to the top."],
      ["Season", "Stir in stock, thyme, curry powder, bay leaves and salt."],
      ["Add the rice", "Stir in washed rice, cover tightly and cook on low heat."],
      ["Let it catch", "Leave it alone for the last ten minutes so the bottom gets smoky.", "let the bottom catch a little, that's the best part"],
    ],
  },
  {
    slug: "santos", culture: "Filipino", publicName: "Santos", cook: "Lolo Rey", dish: "Pork Adobo", cover: "dish-adobo.jpg", at: [0, 1],
    story: "Lolo Rey's adobo: vinegar, soy and garlic, simmered until the pork falls apart.",
    steps: [
      ["Marinate", "Mix pork with soy sauce, vinegar, crushed garlic and peppercorns."],
      ["Brown the pork", "Sear the pork pieces in a hot pan until golden."],
      ["Simmer", "Pour in the marinade with bay leaves and simmer, covered, for an hour.", "low and slow, till the vinegar stops biting your nose"],
      ["Don't stir the vinegar", "Let the vinegar boil a few minutes before you stir, so it mellows."],
      ["Reduce", "Uncover and cook until the sauce is glossy and thick."],
      ["Add the eggs", "Add halved boiled eggs and spoon sauce over them. Serve with rice."],
    ],
  },
  {
    slug: "hernandez", culture: "Mexican", publicName: "Hernández", cook: "Abuela Rosa", dish: "Tamales", cover: "dish-tamales.jpg", at: [-1, -1],
    story: "Abuela Rosa's tamales, the ones the whole family folds together every December.",
    steps: [
      ["Soak the husks", "Soak corn husks in hot water for an hour."],
      ["Make the filling", "Simmer shredded pork in red chile sauce until thick."],
      ["Beat the masa", "Beat masa with lard, broth and salt until a bit floats in water.", "a little handful of salt"],
      ["Spread", "Spread masa thinly on each husk and add a spoon of filling."],
      ["Fold", "Fold the sides in, then the bottom up, and tie with a strip of husk."],
      ["Steam", "Steam standing up for about an hour, until the masa pulls from the husk."],
    ],
  },
  {
    slug: "romero", culture: "Argentine", publicName: "Romero", cook: "Grandpa Luis", dish: "Empanadas", cover: "dish-empanadas.jpg", at: [2, 0],
    story: "Grandpa Luis's empanadas, crimped by hand and served with his green chimichurri.",
    steps: [
      ["Cook the filling", "Brown beef with onion, cumin and paprika, then let it cool."],
      ["Add the extras", "Fold in chopped boiled egg and green olives."],
      ["Fill", "Spoon filling onto each dough round and fold it into a half moon."],
      ["Crimp", "Pinch and twist the edge all the way around.", "twelve little pinches around the edge"],
      ["Bake", "Brush with egg and bake at 400°F until deep golden."],
      ["Chimichurri", "Mix parsley, garlic, oregano, vinegar and oil to serve on the side."],
    ],
  },
  {
    slug: "mehta", culture: "Indian", publicName: "Mehta", cook: "Papa Vikram", dish: "Dal Tadka", cover: "dish-dal.jpg", at: [-2, 1],
    story: "Papa Vikram's weeknight dal, finished with a sizzling spoon of ghee, cumin and dried chilies.",
    steps: [
      ["Rinse the dal", "Rinse toor dal until the water runs clear."],
      ["Pressure cook", "Cook the dal with turmeric and salt until soft."],
      ["Make the base", "Fry onion, ginger, garlic and tomato until soft."],
      ["Combine", "Whisk the cooked dal into the base and simmer five minutes.", "until it smells like home, then the tadka"],
      ["Tadka", "Heat ghee, add cumin seeds and dried chilies until they crackle."],
      ["Finish", "Pour the hot tadka over the dal and top with cilantro."],
    ],
  },
  {
    slug: "kowalski", culture: "Polish American", publicName: "Kowalski", cook: "Grandpa Joe", dish: "Strawberry Pierogi", cover: "dish-pierogi.jpg", at: [0, -4],
    story: "Grandpa Joe's summer pierogi, filled with fresh strawberries and served with sweet cream.",
    steps: [
      ["Make the dough", "Mix flour, egg, sour cream and warm water into a soft dough."],
      ["Rest", "Cover the dough and let it rest thirty minutes."],
      ["Roll and cut", "Roll it thin and cut circles with a glass."],
      ["Fill", "Put a few strawberry pieces and a pinch of sugar on each circle."],
      ["Seal", "Fold and pinch the edges tight so no juice leaks.", "pinch it shut like you mean it"],
      ["Boil", "Boil until they float, then two minutes more. Serve with sweet cream."],
    ],
  },
  {
    slug: "kim", culture: "Korean", publicName: "Kim", cook: "Halmeoni Soon-ja", dish: "Kimchi Stew", cover: "dish-kimchi-stew.jpg", at: [3, 2],
    story: "Halmeoni Soon-ja's kimchi stew, made with the sourest kimchi in the jar.",
    steps: [
      ["Fry the kimchi", "Fry sour kimchi with pork belly until the pork is cooked.", "it only tastes right with sour kimchi"],
      ["Add the heat", "Stir in gochugaru and a spoon of gochujang."],
      ["Add water", "Pour in water or anchovy stock and bring it to a boil."],
      ["Simmer", "Simmer twenty minutes so the kimchi softens."],
      ["Tofu", "Slide in sliced tofu and simmer five minutes more."],
      ["Finish", "Top with green onion and serve bubbling, with rice."],
    ],
  },
  {
    slug: "nguyen", culture: "Vietnamese", publicName: "Nguyen", cook: "Bà Lan", dish: "Phở", cover: "dish-pho.jpg", at: [-4, 0],
    story: "Bà Lan's phở, with a clear broth she simmers all morning with charred onion and star anise.",
    steps: [
      ["Char", "Char onion and ginger over a flame until blackened in spots.", "char the onion till it's black, don't be shy"],
      ["Blanch the bones", "Boil beef bones five minutes, drain and rinse."],
      ["Simmer the broth", "Simmer bones with the onion, ginger, star anise and cinnamon for hours."],
      ["Season", "Season the broth with fish sauce and a little rock sugar."],
      ["Noodles", "Soak and blanch rice noodles, then put them in bowls."],
      ["Serve", "Top with thin raw beef and ladle boiling broth over it. Add herbs and lime."],
    ],
  },
];

export const neighbors = internalMutation({
  args: {},
  returns: v.object({ familiesAdded: v.number() }),
  handler: async (ctx) => {
    let familiesAdded = 0;
    for (const n of NEIGHBORS) {
      const supabaseFamilyId = `seed:community:${n.slug}`;
      const found = await ctx.db
        .query("families")
        .withIndex("by_supabaseFamilyId", (q) => q.eq("supabaseFamilyId", supabaseFamilyId))
        .unique();
      if (found) continue;
      const familyId = await ctx.db.insert("families", { name: `The ${n.publicName} family`, supabaseFamilyId, publicName: n.publicName });
      const approx = roundToGrid({ lat: DEMO_LOCATION.lat + n.at[0] / 100, lng: DEMO_LOCATION.lng + n.at[1] / 100 });
      const cookId = await ctx.db.insert("people", {
        familyId,
        supabaseProfileId: `${supabaseFamilyId}:cook`,
        name: n.cook,
        role: "cook",
        approx,
      });
      const now = Date.now();
      const steps = n.steps.map(([title, text, quote], i) => ({ order: i + 1, title, text, ...(quote ? { quote } : {}), moment: NO_MOMENT }));
      const quote = quoteChoices(steps)[0];
      await ctx.db.insert("recipes", {
        familyId,
        cookId,
        title: n.dish,
        status: "ready",
        coverUrl: `https://homecookd.app/media/stock/${n.cover}`,
        steps,
        memories: [],
        memoriesOptIn: false,
        sharedAt: now - familiesAdded * 3600_000,
        storyCard: { text: n.story, writtenAt: now, usedStories: false, culture: n.culture, ...(quote ? { quote } : {}) },
      });
      familiesAdded++;
    }
    return { familiesAdded };
  },
});

// Marks the family's one seeded dish, so running floormateDish again updates it. A row with no
// recipe.json never shows in the family's library (lib/familyLibrary.ts).
const FLOORMATE = "seed:floormate";

/**
 * One shared, text-only dish with a pre-written card for a floormate's real family (Caleb's call: the
 * floormates' families show "In your building"). The cook is the family's first cook unless `cookId`
 * says. The card's quote has to be one of the steps' quotes, so it's always her own words; without
 * one, it's the first step quote. Running it again updates the same dish.
 */
export const floormateDish = internalMutation({
  args: {
    familyId: v.id("families"),
    dish: v.string(),
    culture: v.optional(v.string()),
    quote: v.optional(v.string()),
    coverUrl: v.optional(v.string()), // a homecookd.app/media/stock/ or app-covers/ photo
    story: v.optional(v.string()), // the card's one sentence; default "Mei's Dumplings, from the Zhang family."
    cookId: v.optional(v.id("people")),
    steps: v.array(v.object({ title: v.string(), text: v.string(), quote: v.optional(v.string()) })),
  },
  returns: v.object({ recipeId: v.id("recipes"), cookName: v.string() }),
  handler: async (ctx, a) => {
    const family = await ctx.db.get("families", a.familyId);
    if (!family) throw new Error("There's no family with that id.");
    const people = await ctx.db
      .query("people")
      .withIndex("by_familyId", (q) => q.eq("familyId", a.familyId))
      .take(50);
    const cook = a.cookId ? people.find((p) => p._id === a.cookId) : (people.find((p) => p.role === "cook") ?? people[0]);
    if (!cook) throw new Error(a.cookId ? "That person isn't in this family." : "No one in this family has signed in yet.");

    const dish = a.dish.trim();
    const steps = a.steps
      .map((s) => ({ title: s.title.trim(), text: s.text.trim(), quote: unquote(s.quote ?? "") }))
      .filter((s) => s.title || s.text)
      .map(({ title, text, quote }, i) => ({ order: i + 1, title, text, ...(quote ? { quote } : {}), moment: NO_MOMENT }));
    if (!dish || !steps.length) throw new Error("Give the dish a name and at least one step.");
    if (a.coverUrl !== undefined && !PUBLIC_COVER.test(a.coverUrl)) {
      throw new Error("coverUrl has to be a https://homecookd.app/media/stock/ or app-covers/ photo.");
    }
    const choices = quoteChoices(steps);
    const quote = a.quote === undefined ? (choices[0] ?? null) : unquote(a.quote);
    if (quote !== null && !choices.includes(quote)) {
      throw new Error("The quote has to be one of the steps' quotes (her own words, 2 to 20 words).");
    }
    const culture = a.culture === undefined ? null : cleanCulture(a.culture);
    if (a.culture !== undefined && !culture) throw new Error('culture is one to three words, like "Filipino".');
    const text = a.story === undefined ? plainStory({ cookName: cook.name, dish, publicName: family.publicName ?? null }) : cleanStory(a.story);
    if (!text) throw new Error("story is one sentence of at most 25 words.");

    const now = Date.now();
    const fields = {
      cookId: cook._id,
      title: dish,
      status: "ready" as const,
      coverUrl: a.coverUrl,
      steps,
      memories: [],
      memoriesOptIn: false,
      storyCard: { text, writtenAt: now, usedStories: false, ...(culture ? { culture } : {}), ...(quote ? { quote } : {}) },
    };
    const recipes = await ctx.db
      .query("recipes")
      .withIndex("by_familyId", (q) => q.eq("familyId", a.familyId))
      .take(200);
    const seeded = recipes.find((r) => r.libraryId === FLOORMATE);
    if (seeded) {
      await ctx.db.patch("recipes", seeded._id, { ...fields, sharedAt: seeded.sharedAt ?? now });
      return { recipeId: seeded._id, cookName: cook.name };
    }
    const recipeId = await ctx.db.insert("recipes", { familyId: a.familyId, libraryId: FLOORMATE, sharedAt: now, ...fields });
    return { recipeId, cookName: cook.name };
  },
});

/**
 * Puts people at the demo venue: one account, or everyone in a family. A shared dish sits where its
 * cook is, so `{ familyId }` is what puts a floormate's family dish "In your building".
 */
export const place = internalMutation({
  args: { personId: v.optional(v.id("people")), familyId: v.optional(v.id("families")) },
  returns: v.object({ placed: v.number() }),
  handler: async (ctx, { personId, familyId }) => {
    const ids = new Set(personId ? [personId] : []);
    if (familyId) {
      const people = await ctx.db
        .query("people")
        .withIndex("by_familyId", (q) => q.eq("familyId", familyId))
        .take(50);
      for (const p of people) ids.add(p._id);
    }
    if (!ids.size) throw new Error("Give a personId, or a familyId with someone in it.");
    for (const id of ids) await ctx.db.patch("people", id, { approx: DEMO_LOCATION });
    return { placed: ids.size };
  },
});

/** The name community cards show, e.g. "Pawar" → "The Pawar family". */
export const publicName = internalMutation({
  args: { familyId: v.id("families"), publicName: v.string() },
  returns: v.null(),
  handler: async (ctx, { familyId, publicName }) => {
    await ctx.db.patch("families", familyId, { publicName: publicName.trim() || undefined });
    return null;
  },
});

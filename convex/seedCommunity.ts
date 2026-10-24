// Community demo data: eight neighbor families, 0.5–3 mi from the venue, one shared recipe each (text
// only, no video). Safe to run twice:
//   npx convex run seedCommunity:neighbors
//   npx convex run seedCommunity:place '{"personId": "<id>"}'          a real account, at the venue
//   npx convex run seedCommunity:publicName '{"familyId": "<id>", "publicName": "Pawar"}'
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { DEMO_LOCATION, roundToGrid } from "./lib/geo";

type Neighbor = {
  slug: string;
  publicName: string;
  cook: string;
  dish: string;
  cover: string; // web/public/media/stock/
  at: [number, number]; // offset from DEMO_LOCATION, in grid steps (0.01°)
  story: string;
  steps: [string, string][];
};

const NEIGHBORS: Neighbor[] = [
  {
    slug: "okafor", publicName: "Okafor", cook: "Mama Ngozi", dish: "Jollof Rice", cover: "dish-jollof-rice.jpg", at: [1, 0],
    story: "Mama Ngozi's party jollof, cooked low and slow until the bottom of the pot turns smoky.",
    steps: [
      ["Blend the base", "Blend tomatoes, red peppers, scotch bonnet and onion until smooth."],
      ["Fry the paste", "Fry tomato paste in oil until it turns a deep brick red."],
      ["Cook it down", "Add the blended base and simmer until the oil rises to the top."],
      ["Season", "Stir in stock, thyme, curry powder, bay leaves and salt."],
      ["Add the rice", "Stir in washed rice, cover tightly and cook on low heat."],
      ["Let it catch", "Leave it alone for the last ten minutes so the bottom gets smoky."],
    ],
  },
  {
    slug: "santos", publicName: "Santos", cook: "Lolo Rey", dish: "Pork Adobo", cover: "dish-adobo.jpg", at: [0, 1],
    story: "Lolo Rey's adobo: vinegar, soy and garlic, simmered until the pork falls apart.",
    steps: [
      ["Marinate", "Mix pork with soy sauce, vinegar, crushed garlic and peppercorns."],
      ["Brown the pork", "Sear the pork pieces in a hot pan until golden."],
      ["Simmer", "Pour in the marinade with bay leaves and simmer, covered, for an hour."],
      ["Don't stir the vinegar", "Let the vinegar boil a few minutes before you stir, so it mellows."],
      ["Reduce", "Uncover and cook until the sauce is glossy and thick."],
      ["Add the eggs", "Add halved boiled eggs and spoon sauce over them. Serve with rice."],
    ],
  },
  {
    slug: "hernandez", publicName: "Hernández", cook: "Abuela Rosa", dish: "Tamales", cover: "dish-tamales.jpg", at: [-1, -1],
    story: "Abuela Rosa's tamales, the ones the whole family folds together every December.",
    steps: [
      ["Soak the husks", "Soak corn husks in hot water for an hour."],
      ["Make the filling", "Simmer shredded pork in red chile sauce until thick."],
      ["Beat the masa", "Beat masa with lard, broth and salt until a bit floats in water."],
      ["Spread", "Spread masa thinly on each husk and add a spoon of filling."],
      ["Fold", "Fold the sides in, then the bottom up, and tie with a strip of husk."],
      ["Steam", "Steam standing up for about an hour, until the masa pulls from the husk."],
    ],
  },
  {
    slug: "romero", publicName: "Romero", cook: "Grandpa Luis", dish: "Empanadas", cover: "dish-empanadas.jpg", at: [2, 0],
    story: "Grandpa Luis's empanadas, crimped by hand and served with his green chimichurri.",
    steps: [
      ["Cook the filling", "Brown beef with onion, cumin and paprika, then let it cool."],
      ["Add the extras", "Fold in chopped boiled egg and green olives."],
      ["Fill", "Spoon filling onto each dough round and fold it into a half moon."],
      ["Crimp", "Pinch and twist the edge all the way around."],
      ["Bake", "Brush with egg and bake at 400°F until deep golden."],
      ["Chimichurri", "Mix parsley, garlic, oregano, vinegar and oil to serve on the side."],
    ],
  },
  {
    slug: "mehta", publicName: "Mehta", cook: "Papa Vikram", dish: "Dal Tadka", cover: "dish-dal.jpg", at: [-2, 1],
    story: "Papa Vikram's weeknight dal, finished with a sizzling spoon of ghee, cumin and dried chilies.",
    steps: [
      ["Rinse the dal", "Rinse toor dal until the water runs clear."],
      ["Pressure cook", "Cook the dal with turmeric and salt until soft."],
      ["Make the base", "Fry onion, ginger, garlic and tomato until soft."],
      ["Combine", "Whisk the cooked dal into the base and simmer five minutes."],
      ["Tadka", "Heat ghee, add cumin seeds and dried chilies until they crackle."],
      ["Finish", "Pour the hot tadka over the dal and top with cilantro."],
    ],
  },
  {
    slug: "kowalski", publicName: "Kowalski", cook: "Grandpa Joe", dish: "Strawberry Pierogi", cover: "dish-pierogi.jpg", at: [0, -4],
    story: "Grandpa Joe's summer pierogi, filled with fresh strawberries and served with sweet cream.",
    steps: [
      ["Make the dough", "Mix flour, egg, sour cream and warm water into a soft dough."],
      ["Rest", "Cover the dough and let it rest thirty minutes."],
      ["Roll and cut", "Roll it thin and cut circles with a glass."],
      ["Fill", "Put a few strawberry pieces and a pinch of sugar on each circle."],
      ["Seal", "Fold and pinch the edges tight so no juice leaks."],
      ["Boil", "Boil until they float, then two minutes more. Serve with sweet cream."],
    ],
  },
  {
    slug: "kim", publicName: "Kim", cook: "Halmeoni Soon-ja", dish: "Kimchi Stew", cover: "dish-kimchi-stew.jpg", at: [3, 2],
    story: "Halmeoni Soon-ja's kimchi stew, made with the sourest kimchi in the jar.",
    steps: [
      ["Fry the kimchi", "Fry sour kimchi with pork belly until the pork is cooked."],
      ["Add the heat", "Stir in gochugaru and a spoon of gochujang."],
      ["Add water", "Pour in water or anchovy stock and bring it to a boil."],
      ["Simmer", "Simmer twenty minutes so the kimchi softens."],
      ["Tofu", "Slide in sliced tofu and simmer five minutes more."],
      ["Finish", "Top with green onion and serve bubbling, with rice."],
    ],
  },
  {
    slug: "nguyen", publicName: "Nguyen", cook: "Bà Lan", dish: "Phở", cover: "dish-pho.jpg", at: [-4, 0],
    story: "Bà Lan's phở, with a clear broth she simmers all morning with charred onion and star anise.",
    steps: [
      ["Char", "Char onion and ginger over a flame until blackened in spots."],
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
      await ctx.db.insert("recipes", {
        familyId,
        cookId,
        title: n.dish,
        status: "ready",
        coverUrl: `https://homecookd.app/media/stock/${n.cover}`,
        steps: n.steps.map(([title, text], i) => ({ order: i + 1, title, text, moment: { startS: 0, endS: 0 } })),
        memories: [],
        memoriesOptIn: false,
        sharedAt: now - familiesAdded * 3600_000,
        storyCard: { text: n.story, writtenAt: now, usedStories: false },
      });
      familiesAdded++;
    }
    return { familiesAdded };
  },
});

/** Puts a person at the demo venue (the floormates' real accounts: "in your building"). */
export const place = internalMutation({
  args: { personId: v.id("people") },
  returns: v.null(),
  handler: async (ctx, { personId }) => {
    await ctx.db.patch("people", personId, { approx: DEMO_LOCATION });
    return null;
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

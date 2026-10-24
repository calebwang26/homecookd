// What a tap on the resting pot says (Caleb, Oct 24): a tap always gets a spoken answer. When something is
// new for this person (convex/homie.ts news: an answer from Grandma, Leo cooking your dish, a quiet week),
// homie says that, once, in Claude's words when they're ready (lib/homie/news). Otherwise the screen's own
// "Explore X by doing X" line, two per screen taking turns, so taps in a row never repeat a line. Pure
// (node scripts/test-homie.mjs); lib/homie/intro keeps the hello, the turns and what was told.

export type TapScreen = 'cook' | 'kidHome' | 'recipes' | 'community' | 'ask' | 'parentHome' | 'parentRecipes' | 'messages' | 'dish' | 'record' | 'other';

/** One thing that's new (convex/homie.ts Fact): `line` says it plainly. */
export type TapFact = { id: string; kind: string; line: string; at: number };

export const TAP_LINES: Record<TapScreen, readonly string[]> = {
  // Cook mode's own tap turns the mic on with this line (HELP.cook).
  cook: ['Say next, back, repeat, or ask me anything.'],
  kidHome: ['Find your next dish by swiping through the cards.', 'Ask your family anything by tapping Have a question.'],
  recipes: ['Find your next dish by scrolling the family table.', 'See one cook’s dishes by tapping their name.'],
  community: ['Explore dishes near you by tapping a photo on the map.', 'Share your family’s cooking by tapping Share your recipe.'],
  ask: ['Ask your family anything by tapping Ask about a dish.', 'Catch up with your family by opening a chat.'],
  parentHome: ['Teach your family a new dish by tapping Record.', 'See who cooked with you this week by looking at the table.'],
  parentRecipes: ['Share a dish with family by tapping Send a recipe.', 'See who made your dishes by scrolling your recipes.'],
  messages: ['Talk to your family by opening a chat.', 'Start a conversation by tapping New message.'],
  dish: ['Cook this one with me by tapping Start cooking.', 'Keep this dish close by tapping the heart.'],
  record: ['Teach a new dish by tapping Start recording.', 'Film with your phone or your glasses by tapping Start recording.'],
  other: ['I’m right here. Tap me anytime.', 'Find your way home by tapping Back.'],
};

/** Which screen's lines a path gets. */
export function tapScreen(pathname: string): TapScreen {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p.startsWith('/cook/')) return 'cook';
  if (p === '/kid' || p === '/kid/home') return 'kidHome';
  if (p === '/kid/recipes') return 'recipes';
  if (p === '/kid/community' || p === '/community') return 'community';
  if (p === '/kid/ask') return 'ask';
  if (p === '/parent' || p === '/parent/home') return 'parentHome';
  if (p === '/parent/recipes') return 'parentRecipes';
  if (p === '/parent/messages') return 'messages';
  if (/^\/(recipe|kid\/recipes|community)\/[^/]+$/.test(p)) return 'dish';
  if (p === '/record') return 'record';
  return 'other';
}

/**
 * The line for this tap: the newest fact not told yet (Claude's words from `written`, else its plain
 * line), else this screen's lines from `turn`; never `last` (the line the tap before said) when another
 * line is there. `factId`: the fact it tells, so it's never told again.
 */
export function chooseTapLine(o: {
  screen: TapScreen;
  facts: readonly TapFact[];
  told: ReadonlySet<string>;
  written?: ReadonlyMap<string, string>;
  last: string | null;
  turn: number;
}): { text: string; factId?: string } {
  const fact = o.screen === 'cook' ? undefined : o.facts.find((f) => !o.told.has(f.id));
  if (fact) {
    const text = o.written?.get(fact.id)?.trim() || fact.line;
    if (text !== o.last) return { text, factId: fact.id };
  }
  const lines = TAP_LINES[o.screen];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[(o.turn + i) % lines.length];
    if (text !== o.last) return { text };
  }
  return { text: lines[0] };
}

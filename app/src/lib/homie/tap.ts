// What a tap on the resting pot says (Caleb, Oct 24): a tap always gets a spoken answer. When something is
// new for this person (convex/homie.ts news: an answer from Grandma, Leo cooking your dish, a quiet week),
// homie says that, once, in Claude's words when they're ready (lib/homie/news). Otherwise the screen's one
// line, about its big button in the button's own words ("Cook something tonight by tapping Start
// cooking."). A second tap in a row gets TAP_AGAIN, so homie never says the same line twice in a row.
// Pure (node scripts/test-homie.mjs); lib/homie/intro keeps the hello and what was told.

export type TapScreen = 'cook' | 'kidHome' | 'recipes' | 'community' | 'ask' | 'parentHome' | 'parentRecipes' | 'messages' | 'dish' | 'record' | 'recording' | 'other';

/** One thing that's new (convex/homie.ts Fact): `line` says it plainly. */
export type TapFact = { id: string; kind: string; line: string; at: number };

export const TAP_LINES: Record<TapScreen, string> = {
  // Cook mode's own tap asks; a long press turning the mic on says this (HELP.cook).
  cook: 'Say next, back, repeat, or ask me anything.',
  kidHome: 'Cook something tonight by tapping Start cooking.',
  recipes: 'Pick tonight’s dish by tapping its photo.',
  community: 'Explore dishes near you by tapping a photo on the map.',
  ask: 'Ask your family anything by tapping Ask about a dish.',
  parentHome: 'Teach your family a new dish by tapping Record.',
  parentRecipes: 'Share a dish with family by tapping Send a recipe.',
  messages: 'Talk to your family by opening a chat.',
  dish: 'Cook this one with me by tapping Start cooking.',
  record: 'Teach a new dish by tapping Start recording.',
  // While she films: homie is already listening, and nothing else goes into her video.
  recording: 'Keep cooking. I’m listening.',
  other: 'I’m right here. Tap me anytime.',
};

/** A second tap in a row, after the screen's line. */
export const TAP_AGAIN = 'I’m right here.';

/** Screens where a tap never tells news: the kid cooking, the cook filming. */
const NO_NEWS: ReadonlySet<TapScreen> = new Set(['cook', 'recording']);

/** Which screen's line a path gets. */
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
  if (p === '/recording') return 'recording';
  return 'other';
}

/**
 * The line for this tap: the newest fact not told yet (Claude's words from `written`, else its plain
 * line), else this screen's line, or TAP_AGAIN when that was `last` (the line the tap before said).
 * `factId`: the fact it tells, so it's never told again.
 */
export function chooseTapLine(o: {
  screen: TapScreen;
  facts: readonly TapFact[];
  told: ReadonlySet<string>;
  written?: ReadonlyMap<string, string>;
  last: string | null;
}): { text: string; factId?: string } {
  const fact = NO_NEWS.has(o.screen) ? undefined : o.facts.find((f) => !o.told.has(f.id));
  if (fact) {
    const text = o.written?.get(fact.id)?.trim() || fact.line;
    if (text !== o.last) return { text, factId: fact.id };
  }
  const line = TAP_LINES[o.screen];
  return { text: line === o.last ? TAP_AGAIN : line };
}

// The map's choosers, one step at a time (Caleb's final Community canvas, Oct 24), as pure functions
// (tested by scripts/test-community-ui.mjs). Each returns big rows, a title and one line, the first green:
//   connectRows   a dish's "Connect with Mama Ngozi": Join her dinner (when there is one), Swap recipes,
//                 Cook together ("Ask Mama Ngozi to make it with you"; once they said yes, "Host a
//                 dinner": "Cooking Jollof Rice together with the Okafor family")
//   shareChoices  "Share your recipe": Put it on the map, Host a dinner (your own dinner lives only here)
//   dishRows      which family dish goes on the map, when there are several
//   offerRows     which of our shared dishes to offer in a swap, or "Just ask"
//   joinLine, mapLine, swapLine   "Friday · 7 pm · 2 seats left", "Asked Grandma Rajani", "Grandma
//                 Rajani said not now", "You’re swapping Kanda Poha ↔ Jollof Rice with the Okafor family"
// Nothing here imports React or the app, so Node runs it as is.
import type { FamilyDish, FeedRecipe, RequestStatus, Swap, SwapStatus } from '@/lib/live/community';

import { awayLabel, dinnerWhen, seatLine, whose } from './labels';

export type ChoiceRow = { key: string; title: string; line: string; primary: boolean; disabled?: boolean };

/** After she says not now (or homie couldn't tell), the family waits a day to ask her again (convex/shareRequests.ts). */
export const ASK_AGAIN_MS = 24 * 60 * 60_000;

const HOST_ROW = { key: 'host', title: 'Host a dinner', line: 'Pick a time and place. Neighbors ask to join.' };

const firstGreen = (rows: Omit<ChoiceRow, 'primary'>[]): ChoiceRow[] => rows.map((r, i) => ({ ...r, primary: i === 0 }));

/** "Mama Ngozi’s Jollof Rice", the chooser's title. */
export function dishTitle(cookName: string, dish: string): string {
  return cookName.trim() ? `${whose(cookName)} ${dish}` : dish;
}

/**
 * "Friday · 7 pm · 2 seats left". The dinner is where its host is; when that isn't where the cook's
 * dish shows, it says how far: "… · About 2 mi away".
 */
export function joinLine(dinner: NonNullable<FeedRecipe['dinner']>, cookDistance: string, now: number): string {
  const line = `${dinnerWhen(dinner.startsAt, now)} · ${seatLine(null, dinner.seatsLeft)}`;
  return dinner.distanceLabel && dinner.distanceLabel !== cookDistance ? `${line} · ${awayLabel(dinner.distanceLabel)}` : line;
}

function swapRowLine(status: SwapStatus | null): string {
  if (status === 'pending') return 'Asked · waiting';
  if (status === 'accepted') return 'You’re swapping recipes';
  if (status === 'declined') return 'They said not this time';
  return 'Teach each other your family dishes';
}

/** "Cooking Jollof Rice together with the Okafor family". */
export function cookingTogetherLine(dish: string, familyName: string): string {
  return `Cooking ${dish.trim() || 'it'} together with ${midSentence(familyName) || 'them'}`;
}

/** The third row: ask them to cook it with you; once they said yes, host a dinner of it together. */
function cookRow(recipe: Pick<FeedRecipe, 'dish' | 'cookName' | 'familyName'>, status: SwapStatus | null): Omit<ChoiceRow, 'primary'> {
  if (status === 'accepted') return { key: 'cook', title: 'Host a dinner', line: cookingTogetherLine(recipe.dish, recipe.familyName) };
  if (status === 'pending') return { key: 'cook', title: 'Cook together', line: 'Asked · waiting', disabled: true };
  if (status === 'declined') return { key: 'cook', title: 'Cook together', line: 'They said not this time', disabled: true };
  return { key: 'cook', title: 'Cook together', line: `Ask ${recipe.cookName.trim() || 'them'} to make it with you` };
}

/**
 * After "Connect with <cook>". `dinner` is the dish's dinner still ahead (or null), `myRequest` my ask
 * to join it, `swap` my family's ask to swap for this dish and `cook` our ask to cook it together.
 * Hosting a dinner of your own dish is only under "Share your recipe".
 */
export function connectRows(o: {
  recipe: Pick<FeedRecipe, 'distanceLabel' | 'dish' | 'cookName' | 'familyName'>;
  dinner: FeedRecipe['dinner'];
  myRequest: RequestStatus | null;
  swap: SwapStatus | null;
  cook: SwapStatus | null;
  now: number;
}): ChoiceRow[] {
  const rows: Omit<ChoiceRow, 'primary'>[] = [];
  if (o.dinner) {
    const host = o.dinner.hostName.trim() || 'their';
    const line =
      o.myRequest === 'accepted'
        ? `You’re in · ${dinnerWhen(o.dinner.startsAt, o.now)}`
        : o.myRequest === 'pending'
          ? 'Asked · waiting'
          : o.myRequest === 'declined'
            ? `${host} can’t fit you this time`
            : joinLine(o.dinner, o.recipe.distanceLabel, o.now);
    rows.push({ key: 'join', title: host === 'their' ? 'Join their dinner' : `Join ${whose(host)} dinner`, line });
  }
  rows.push({ key: 'swap', title: 'Swap recipes', line: swapRowLine(o.swap), disabled: o.swap === 'declined' || o.swap === 'pending' });
  rows.push(cookRow(o.recipe, o.cook));
  return firstGreen(rows);
}

/** She said not now (or homie couldn't tell) less than a day ago: nobody can ask her again yet. */
export function saidNotNow(d: Pick<FamilyDish, 'shared' | 'asked' | 'notNowAt'>, now: number): boolean {
  return !d.shared && !d.asked && d.notNowAt !== null && now - d.notNowAt < ASK_AGAIN_MS;
}

/** A dish whose row is only words: on the map, asked, or a "not now" still fresh. */
const settled = (d: FamilyDish, now: number) => d.shared || d.asked || saidNotNow(d, now);

/**
 * What "Put it on the map" says about one dish: on the map, asked, she said not now, mine (it goes on
 * now), or whose cook homie asks first.
 * TODO(caleb): the mockup says "Her video stays private"; we don't know the cook's gender.
 */
export function mapLine(d: FamilyDish, now: number): string {
  const cook = d.cookName.trim() || 'the cook';
  if (d.shared) return 'It’s on the map.';
  if (d.asked) return `Asked ${cook}`;
  if (saidNotNow(d, now)) return `${cook.charAt(0).toUpperCase()}${cook.slice(1)} said not now`;
  if (d.mine) return 'Neighbors see the recipe text, one line you said and homie’s guess at where it’s from.';
  return `homie asks ${cook} first. The video stays private.`;
}

/** "Share your recipe": the title and the two rows. `dishes` is null while it loads. */
export function shareChoices(dishes: FamilyDish[] | null, now: number): { title: string; rows: ChoiceRow[] } {
  const one = dishes?.length === 1 ? dishes[0] : null;
  const title = one ? `Share ${one.mine ? `your ${one.dish}` : dishTitle(one.cookName, one.dish)}` : 'Share your family’s dish';
  let map: Omit<ChoiceRow, 'primary'>;
  if (!dishes) map = { key: 'map', title: 'Put it on the map', line: 'One moment…', disabled: true };
  else if (!dishes.length) map = { key: 'map', title: 'Put it on the map', line: 'Your family hasn’t recorded a dish yet.', disabled: true };
  else if (one) map = { key: 'map', title: 'Put it on the map', line: mapLine(one, now), disabled: settled(one, now) };
  else if (dishes.every((d) => d.shared)) map = { key: 'map', title: 'Put it on the map', line: 'Your family’s dishes are on the map.', disabled: true };
  else map = { key: 'map', title: 'Put it on the map', line: 'Pick a dish. homie asks its cook first.' };
  return { title, rows: firstGreen([map, HOST_ROW]) };
}

/** Several family dishes: one row each. */
export function dishRows(dishes: FamilyDish[], now: number): ChoiceRow[] {
  return dishes.map((d) => ({ key: d.recipeId, title: d.dish, line: mapLine(d, now), primary: false, disabled: settled(d, now) }));
}

/** A swap's offer: one of our shared dishes, or none yet. */
export function offerRows(shared: FamilyDish[]): ChoiceRow[] {
  return firstGreen([
    ...shared.map((d) => ({ key: d.recipeId, title: d.dish, line: d.mine ? 'Your recipe' : `${whose(d.cookName)} recipe` })),
    { key: 'none', title: 'Just ask', line: 'Offer one of yours later' },
  ]);
}

export const midSentence = (familyName: string) => familyName.trim().replace(/^The /, 'the ');

/**
 * One swap or "cook together", on the "You" card: "You’re swapping Kanda Poha ↔ Jollof Rice with the
 * Okafor family", "The Pawar family would swap their Kanda Poha for your Dumplings.", "Cooking Jollof
 * Rice together with the Okafor family", "The Pawar family would like to cook your Jollof Rice together."
 */
export function swapLine(s: Swap): string {
  const family = midSentence(s.familyName);
  const ours = s.ourDish?.dish;
  const theirs = s.theirDish?.dish;
  if (s.kind === 'cook') {
    const dish = theirs ?? ours ?? 'it';
    if (s.status === 'accepted') return cookingTogetherLine(dish, s.familyName);
    if (s.status === 'declined') return s.incoming ? `You said not this time to ${family}` : `${s.familyName} said not this time`;
    return s.incoming ? `${s.familyName} would like to cook your ${dish} together.` : `Asked ${family} to cook together`;
  }
  if (s.status === 'accepted') {
    const what = ours && theirs ? `${ours} ↔ ${theirs}` : (theirs ?? ours ?? 'recipes');
    return `You’re swapping ${what} with ${family}`;
  }
  if (s.status === 'declined') return s.incoming ? `You said not this time to ${family}` : `${s.familyName} said not this time`;
  if (!s.incoming) return `Asked ${family} to swap`;
  if (!ours) return `${s.familyName} would like to swap recipes.`;
  return theirs ? `${s.familyName} would swap their ${theirs} for your ${ours}.` : `${s.familyName} would like to swap for your ${ours}.`;
}

/** Swaps the other family asked us for, still unanswered: part of the sun dot on "You". */
export function newSwaps(swaps: readonly Pick<Swap, 'incoming' | 'status'>[]): number {
  return swaps.filter((s) => s.incoming && s.status === 'pending').length;
}

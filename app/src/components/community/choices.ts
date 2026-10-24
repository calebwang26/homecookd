// The map's choosers, one step at a time (Caleb's Community mockup, Oct 24), as pure functions (tested by
// scripts/test-community-ui.mjs). Each returns big rows, a title and one line, the first one green:
//   connectRows   a dish's "Connect with Mama Ngozi": Join her dinner (when there is one), Swap recipes,
//                 Host a dinner
//   shareChoices  "Share your recipe": Put it on the map, Host a dinner
//   dishRows      which family dish goes on the map, when there are several
//   offerRows     which of our shared dishes to offer in a swap, or "Just ask"
//   joinLine, mapLine, swapLine   "Friday · 7 pm · 2 seats left", "Asked Grandma Rajani",
//                 "You’re swapping Kanda Poha ↔ Jollof Rice with the Okafor family"
// Nothing here imports React or the app, so Node runs it as is.
import type { FamilyDish, FeedRecipe, RequestStatus, Swap, SwapStatus } from '@/lib/live/community';

import { awayLabel, dinnerWhen, seatLine, whose } from './labels';

export type ChoiceRow = { key: string; title: string; line: string; primary: boolean; disabled?: boolean };

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

/**
 * After "Connect with <cook>". `dinner` is the dish's dinner still ahead (or null), `myRequest` my ask
 * to join it, and `swap` my family's ask to swap for this dish.
 */
export function connectRows(o: {
  recipe: Pick<FeedRecipe, 'distanceLabel'>;
  dinner: FeedRecipe['dinner'];
  myRequest: RequestStatus | null;
  swap: SwapStatus | null;
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
  rows.push(HOST_ROW);
  return firstGreen(rows);
}

/**
 * What "Put it on the map" says about one dish: on the map, asked, mine (it goes on now), or whose
 * cook homie asks first.
 * TODO(caleb): the mockup says "Her video stays private"; we don't know the cook's gender.
 */
export function mapLine(d: FamilyDish): string {
  if (d.shared) return 'It’s on the map.';
  if (d.asked) return `Asked ${d.cookName.trim() || 'the cook'}`;
  if (d.mine) return 'Neighbors see the recipe text and one line you said.';
  return `homie asks ${d.cookName.trim() || 'the cook'} first. The video stays private.`;
}

/** "Share your recipe": the title and the two rows. `dishes` is null while it loads. */
export function shareChoices(dishes: FamilyDish[] | null): { title: string; rows: ChoiceRow[] } {
  const one = dishes?.length === 1 ? dishes[0] : null;
  const title = one ? `Share ${one.mine ? `your ${one.dish}` : dishTitle(one.cookName, one.dish)}` : 'Share your family’s dish';
  let map: Omit<ChoiceRow, 'primary'>;
  if (!dishes) map = { key: 'map', title: 'Put it on the map', line: 'One moment…', disabled: true };
  else if (!dishes.length) map = { key: 'map', title: 'Put it on the map', line: 'Your family hasn’t recorded a dish yet.', disabled: true };
  else if (one) map = { key: 'map', title: 'Put it on the map', line: mapLine(one), disabled: one.shared || one.asked };
  else if (dishes.every((d) => d.shared)) map = { key: 'map', title: 'Put it on the map', line: 'Your family’s dishes are on the map.', disabled: true };
  else map = { key: 'map', title: 'Put it on the map', line: 'Pick a dish. homie asks its cook first.' };
  return { title, rows: firstGreen([map, HOST_ROW]) };
}

/** Several family dishes: one row each. */
export function dishRows(dishes: FamilyDish[]): ChoiceRow[] {
  return dishes.map((d) => ({ key: d.recipeId, title: d.dish, line: mapLine(d), primary: false, disabled: d.shared || d.asked }));
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
 * One swap, on the "You" card: "You’re swapping Kanda Poha ↔ Jollof Rice with the Okafor family",
 * "The Pawar family would swap their Kanda Poha for your Dumplings."
 */
export function swapLine(s: Swap): string {
  const family = midSentence(s.familyName);
  const ours = s.ourDish?.dish;
  const theirs = s.theirDish?.dish;
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

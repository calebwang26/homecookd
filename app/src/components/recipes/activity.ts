// The short activity word(s) on a dish in the kid's Recipes list, from my own history
// (GET /me/recipe-stats) and the dish's facts. Real data only, first match wins:
//   You cooked it / Baked 3 times   I tapped "I made it"
//   New                             sent to me in the last 2 weeks, not opened since
//   You opened it 3 times           my views
//   ~1 hr 20 min / 6 steps          otherwise, the dish's own facts
import { madeVerb, times } from '@/components/parent/kitchen';
import { daysAgo } from '@/lib/format';
import type { RecipeStat } from '@/lib/api';
import type { LibraryEntry, Recipe } from '@/lib/recipes';

import { rowTime } from '@/components/browse/reasons';

/** "New" lasts two weeks, or until I open it. */
const NEW_DAYS = 14;
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0);

export type Activity = { text: string; tone: 'done' | 'new' | 'plain' };

export function activityFor(entry: LibraryEntry, stat: RecipeStat | undefined, recipe: Recipe | undefined): Activity | null {
  if (stat && stat.cooked > 0) {
    const verb = madeVerb(entry.tags, entry.title);
    const text = stat.cooked > 1 ? `${verb[0].toUpperCase()}${verb.slice(1)} ${times(stat.cooked)}` : `You ${verb} it`;
    return { text, tone: 'done' };
  }
  if (stat?.sent_to_me_at && daysAgo(stat.sent_to_me_at) <= NEW_DAYS && !(time(stat.last_viewed_at) >= time(stat.sent_to_me_at))) {
    return { text: 'New', tone: 'new' };
  }
  if (stat && stat.views > 0) return { text: `You opened it ${times(stat.views)}`, tone: 'plain' };
  const total = rowTime(recipe?.total_time);
  if (total) return { text: total, tone: 'plain' };
  if (recipe?.steps.length) return { text: `${recipe.steps.length} ${recipe.steps.length === 1 ? 'step' : 'steps'}`, tone: 'plain' };
  return null;
}

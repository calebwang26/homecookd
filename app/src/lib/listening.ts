// "Heard" events (RETENTION-HANDOFF 2.3): every play of a cook's recipe voice that runs 3 s or more
// posts api.event(recipe, 'heard', {cook_id, duration_s, start_s}). It lights the Sunday table and
// adds up the recap's "minutes of family voices". lib/media.ts measures each play of a clip that
// carries `heard`; this file sends it, so media.ts needs no api or session import. Voice notes and
// the hello card never carry `heard`, so they never log.
//
//   registerHeardLogging()                          // once, from the root layout
//   const heard = useHeard(recipe)                  // then useClipAudio({ ...clip, heard })
import { api } from './api';
import { setHeardListener, type AudioClip } from './media';
import { cookProfile } from './recipes';
import { useSession } from './session';
import { invalidateTable } from './tableApi';
import type { Recipe } from './types';

let registered = false;

export function registerHeardLogging(): void {
  if (registered) return;
  registered = true;
  setHeardListener((p) => {
    // A listen lights the kid's face at the Sunday table: ask again on the next look.
    void api
      .event(p.recipe_id, 'heard', { cook_id: p.cook_id, duration_s: p.duration_s, start_s: p.start_s })
      .then(() => invalidateTable())
      .catch(() => {});
  });
}

/**
 * The `heard` tag for a recipe's voice, or undefined when there is nothing to log: nobody is picked,
 * or it is my own voice. A cook outside the family (a YouTube dish) logs with cook_id null; the
 * server counts only family cooks.
 */
export function useHeard(recipe: Pick<Recipe, 'id' | 'cook'> | null | undefined): AudioClip['heard'] {
  const { profiles, me } = useSession();
  if (!recipe?.id || !me) return undefined;
  const cook = cookProfile(recipe, profiles);
  if (cook && cook.id === me.id) return undefined;
  return { recipe_id: recipe.id, cook_id: cook?.id ?? null };
}

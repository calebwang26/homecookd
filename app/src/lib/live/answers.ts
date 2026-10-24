// The cook's answers to the kid's questions about a dish, live (Convex questions.forRecipe), so cook
// mode can say "Grandma answered your question" and play her voice note.
//
//   const rows = useRecipeAnswers(libraryId)   every question about the dish, newest first
//   const heard = useHeardAnswers()            the answers this phone already played (heard.ids, heard.add(id))
//   playClip({ url, key: `${ANSWER_KEY}${id}` })  her voice note on the shared player
//
// Takes the library id and finds the dish's Convex id itself. A dish Convex doesn't know (a library
// dish), or Convex stubbed: nothing, and nothing asked.
import { useCallback, useEffect, useRef, useState } from 'react';

import { kvGetJson, kvSetJson } from '@/lib/storage';
import { useSession } from '@/lib/session';

import { convexRecipeId, useLive } from './convex';
import type { AnswerRow } from './voiceLogic';

export type RecipeAnswer = AnswerRow & {
  recipeId: string;
  stepOrder?: number;
  status: 'found_in_video' | 'asked_cook' | 'answered';
  answer?: { text?: string; transcript?: string; translation?: string };
};

/** The shared player's key prefix for the cook's voice-note answer (homie never talks over it). */
export const ANSWER_KEY = 'cook-answer:';

const HEARD_KEY = 'homie.heardAnswers';
const HEARD_MAX = 100;
const none = (onData: (v: RecipeAnswer[]) => void) => {
  onData([]);
  return () => {};
};

export function useRecipeAnswers(libraryId: string | null): RecipeAnswer[] {
  const { me } = useSession();
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const meId = me?.id;
  useEffect(() => {
    let alive = true;
    if (!libraryId || !meId) return;
    void convexRecipeId(libraryId)
      .then((id) => alive && setRecipeId(id !== libraryId ? id : null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [libraryId, meId]);
  const rows = useLive<RecipeAnswer[]>('questions:forRecipe', [], none, !!recipeId, { recipeId });
  return recipeId ? rows : [];
}

export function useHeardAnswers(): { ids: ReadonlySet<string>; loaded: boolean; add: (id: string) => void } {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const current = useRef(ids);
  useEffect(() => {
    let alive = true;
    void kvGetJson<string[]>(HEARD_KEY).then((saved) => {
      if (!alive) return;
      if (Array.isArray(saved)) {
        current.current = new Set([...saved, ...current.current]);
        setIds(current.current);
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const add = useCallback((id: string) => {
    const next = new Set(current.current).add(id);
    current.current = next;
    setIds(next);
    void kvSetJson(HEARD_KEY, [...next].slice(-HEARD_MAX));
  }, []);
  return { ids, loaded, add };
}

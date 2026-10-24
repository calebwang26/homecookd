'use client';
// A tiny external store for the DeckFilm's time-based "pops" (brief 4.6: pops inside scrubbed scenes
// fire from progress crossings). The GSAP timeline writes flags once per crossing; small child
// components subscribe to the one flag they need, so DeckFilm itself never re-renders while scrolling.
import { createContext, useContext, useSyncExternalStore } from 'react';

export interface FilmFlags {
  /** film (pinned, scrubbed) mode is on */
  film: boolean;
  /** film mode uses the mobile choreography */
  mobile: boolean;
  /** the hero still covers the top of the stage (before A22) */
  navHero: boolean;
  /** the canvas sheet is behind the pause button (it switches to the ink variant) */
  pauseInk: boolean;
  /** pass-down chips (A72+) */
  passChips: boolean;
  /** the hero video is paused because the stack has dropped out of sight (B90+) */
  suspended: boolean;
  /** the hero video is really playing (HeroVideo's `playing`); not film-specific */
  videoPlaying: boolean;
}

export const INITIAL_FLAGS: FilmFlags = {
  film: false,
  mobile: false,
  navHero: true,
  pauseInk: false,
  passChips: false,
  suspended: false,
  videoPlaying: false,
};

export interface FilmStore {
  get: () => FilmFlags;
  set: (patch: Partial<FilmFlags>) => void;
  subscribe: (fn: () => void) => () => void;
}

export function createFilmStore(): FilmStore {
  let state: FilmFlags = { ...INITIAL_FLAGS };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k of Object.keys(patch) as (keyof FilmFlags)[]) {
        if (state[k] !== patch[k]) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((fn) => fn());
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export const FilmStoreCtx = createContext<FilmStore | null>(null);

const noop = () => () => {};

/** Subscribe to one flag. Server and static mode read the initial value. */
export function useFilmFlag<K extends keyof FilmFlags>(key: K): FilmFlags[K] {
  const store = useContext(FilmStoreCtx);
  return useSyncExternalStore(
    store ? store.subscribe : noop,
    () => (store ? store.get()[key] : INITIAL_FLAGS[key]),
    () => INITIAL_FLAGS[key],
  );
}

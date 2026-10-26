// Recipes: the family library & each recipe.json from the public bucket, falling back to the JSON
// bundled in assets/data/ on ANY error (no env var, offline, bad JSON, 404...).
// The library also lists the signed-in family's own finished dishes from Convex (recipes.list, live;
// familyLibrary.ts): the pipeline publishes those to Convex, never to the public library.json. Their
// recipe.json is the row's recipeJsonUrl in the media bucket, loaded and cached like the others.
// That file has no stories or tips: Convex keeps them and shows them only to the cook until she says
// yes, so the row's memories are put back into it (withMemories). An older file still holds them all,
// so a family dish whose row comes without them loads without them too (forViewer, before caching).
// It fails closed: until the signed-in person's rows come, any dish that isn't public (library.json's
// or bundled) loads without them, and the ones she shared load again with them once the rows say so.
// The ingredients the cook confirmed after the video (her yes to homie's "Did you add …?", the row's
// addedIngredients) go at the end of its ingredient list for everyone (withAdded, in forViewer too).
// With Convex stubbed (Expo Go, no EXPO_PUBLIC_CONVEX_URL) the library is library.json's alone, and
// no rows ever come.
//
//   const { entries, loading } = useLibrary();
//   const { recipe, loading } = useRecipe(id);
//   useStoriesWithheld(id)    true when the dish's stories and tips are kept from whoever is signed in
//   recipesByCook(entries, 'Dad'), stepIngredients(recipe, step), stepClip(step), firstQuote(recipe),
//   cookProfile(recipe, profiles)
//
// Results are cached in memory for the session, so moving between screens never refetches or
// flashes a spinner. `refreshLibrary()` forces a reload (pull to refresh, after a publish).
// A fetched recipe without short substeps takes them from its bundled copy (withBundledShortSteps).
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { Profile } from './api';
import { bundledLibrary, bundledRecipes } from './bundled';
import { loadHiddenIds } from './deletes';
import {
  familyEntries,
  mergeLibrary,
  sharedAdded,
  sharedMemories,
  withAdded,
  withheldIds,
  withMemories,
  withoutStories,
  type AddedIngredient,
  type FamilyRecipe,
  type Memory,
} from './familyLibrary';
import { cacheBuster, fetchJson } from './http';
import { invalidateConvexRecipes, useLive } from './live/convex';
import { getSession, useSession, type Session } from './session';
import type { Ingredient, LibraryEntry, Recipe, Step } from './types';

export { cacheBuster, fetchJson } from './http';
export type { Ingredient, LibraryEntry, Recipe, Special, Step, Story } from './types';

// Public bucket; the default lets a store build (no app/.env) load recipes. .env overrides it.
const RAW_BASE = process.env.EXPO_PUBLIC_BUCKET_URL || 'https://storage.googleapis.com/edible-media-379797517579';
export const BUCKET_URL = RAW_BASE.trim().replace(/\/+$/, '');

export type Source = 'remote' | 'bundled';

// In-memory caches so screens can find an entry/recipe by id without refetching.
const entryCache = new Map<string, LibraryEntry>();
const recipeCache = new Map<string, Recipe>();
const bundledEntries = new Map(bundledLibrary.filter(isEntry).map((e) => [e.id, normalizeEntry(e)]));
for (const [id, e] of bundledEntries) entryCache.set(id, e);

function isEntry(x: unknown): x is LibraryEntry {
  const e = x as LibraryEntry;
  return !!e && typeof e.id === 'string' && typeof e.title === 'string';
}

function normalizeEntry(e: LibraryEntry): LibraryEntry {
  return {
    ...e,
    cook_name: typeof e.cook_name === 'string' && e.cook_name.trim() ? e.cook_name : 'Family',
    relation: typeof e.relation === 'string' ? e.relation : '',
    poster_url: e.poster_url || null,
    tags: Array.isArray(e.tags) ? e.tags : [],
    sample: !!e.sample,
    recipe_url: e.recipe_url || '',
  };
}

/** Defensive defaults so a slightly-off recipe.json never crashes a screen. */
export function normalizeRecipe(r: Recipe): Recipe {
  return {
    ...r,
    title: typeof r.title === 'string' && r.title.trim() ? r.title : 'A family recipe',
    cook: { name: r.cook?.name || 'Family', relation: r.cook?.relation || '' },
    intro: r.intro ?? '',
    servings: r.servings ?? null,
    total_time: r.total_time ?? null,
    sample: !!r.sample,
    source: r.source ?? null,
    tags: r.tags ?? [],
    media: {
      video_url: r.media?.video_url || null,
      audio_url: r.media?.audio_url || null,
      poster_url: r.media?.poster_url || null,
      duration_s: r.media?.duration_s ?? 0,
      width: r.media?.width ?? null,
      height: r.media?.height ?? null,
    },
    sessions: r.sessions ?? [],
    ingredients: r.ingredients ?? [],
    steps: (r.steps ?? [])
      .map((s) => ({ ...s, story_ids: s.story_ids ?? [], special_ids: s.special_ids ?? [], image_url: s.image_url ?? null }))
      .sort((a, b) => a.order - b.order),
    stories: r.stories ?? [],
    special: r.special ?? [],
    follow_up_questions: r.follow_up_questions ?? [],
  };
}

const words = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
/** The same step: the same instruction (spacing and case aside) over the same stretch of video. */
const sameStep = (a: Step, b: Step) =>
  words(a.instruction) === words(b.instruction) && Math.round(a.start_s) === Math.round(b.start_s) && Math.round(a.end_s) === Math.round(b.end_s);

/**
 * Cook mode's short substeps, step ingredients & tips (pipeline/shorten.py) are in the bundled copies,
 * but the bucket's recipe.json files predate them and are not republished yet (that needs Caleb's OK).
 * So a fetched recipe with no substeps borrows them, and the step titles hand-tidied with them, from the
 * bundled copy of the same id, only when every step is the same step (sameStep): a recipe whose
 * instructions were edited or re-merged since bundling keeps its own words and the app's own split.
 */
export function withBundledShortSteps(remote: Recipe, bundled: Recipe | null | undefined): Recipe {
  const steps = remote.steps;
  if (!bundled || !steps.length || steps.some((s) => s.substeps?.length)) return remote;
  const theirs = [...(bundled.steps ?? [])].sort((a, b) => a.order - b.order);
  if (theirs.length !== steps.length || !theirs.some((s) => s.substeps?.length)) return remote;
  if (theirs.some((s, i) => !sameStep(s, steps[i]))) return remote;
  return {
    ...remote,
    steps: steps.map((s, i) => ({
      ...s,
      title: theirs[i].title || s.title,
      substeps: theirs[i].substeps ?? null,
      uses: theirs[i].uses ?? null,
      tip: theirs[i].tip ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Loading

export async function fetchLibrary(): Promise<{ entries: LibraryEntry[]; source: Source }> {
  if (BUCKET_URL) {
    try {
      const { data } = await fetchJson(cacheBuster(`${BUCKET_URL}/library.json`));
      if (Array.isArray(data)) {
        const entries = data.filter(isEntry).map(normalizeEntry);
        for (const e of entries) entryCache.set(e.id, e);
        return { entries, source: 'remote' };
      }
    } catch {
      // fall through to bundled
    }
  }
  return { entries: bundledLibrary.filter(isEntry).map(normalizeEntry), source: 'bundled' };
}

/** Synchronous best-effort lookup (used for instant titles while a recipe loads). */
export function getCachedEntry(id: string): LibraryEntry | undefined {
  return entryCache.get(id);
}

/** Synchronous lookup of an already loaded (or bundled) recipe. */
export function getCachedRecipe(id: string): Recipe | undefined {
  const hit = recipeCache.get(id);
  if (hit) return forViewer(id, hit);
  const b = bundledRecipes[id];
  return b ? forViewer(id, normalizeRecipe(b)) : undefined;
}

const inflight = new Map<string, Promise<{ recipe: Recipe; source: Source } | null>>();

export function fetchRecipe(entryOrId: LibraryEntry | string): Promise<{ recipe: Recipe; source: Source } | null> {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
  const running = inflight.get(id);
  if (running) return running;
  const p = fetchRecipeUncached(entryOrId).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function fetchRecipeUncached(entryOrId: LibraryEntry | string): Promise<{ recipe: Recipe; source: Source } | null> {
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
  const entry = typeof entryOrId === 'string' ? entryCache.get(id) : entryOrId;
  // The entry's recipe_url first, then the conventional bucket path (covers a cold start on a
  // deep link, when only the bundled library is known).
  const urls = BUCKET_URL
    ? [...new Set([entry?.recipe_url, `${BUCKET_URL}/${encodeURIComponent(id)}/recipe.json`].filter(Boolean) as string[])]
    : [];

  for (const url of urls) {
    try {
      const { data } = await fetchJson(cacheBuster(url));
      const r = data as Recipe | null;
      if (r && typeof r === 'object' && Array.isArray(r.steps)) {
        // After the bundled copy lent its tips, so a withheld dish loses those too.
        const full = withBundledShortSteps(normalizeRecipe(r), bundledRecipes[id]);
        const recipe = forViewer(id, full);
        recipeCache.set(id, recipe);
        if (recipe !== full && storiesWithheld(id) && !family.withheld.has(id)) keptUntilRows.add(id);
        return { recipe, source: 'remote' };
      }
    } catch {
      // try the next candidate, then fall back
    }
  }
  const cached = recipeCache.get(id);
  if (cached) return { recipe: forViewer(id, cached), source: 'remote' };
  const bundled = bundledRecipes[id];
  if (bundled) return { recipe: forViewer(id, normalizeRecipe(bundled)), source: 'bundled' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Hooks (one shared library store, so every screen sees the same list)

type LibraryState = { entries: LibraryEntry[]; source: Source; loading: boolean; loaded: boolean };

/** library.json's entries (or the bundled copy's). */
let base: LibraryEntry[] = bundledLibrary.filter(isEntry).map(normalizeEntry);
/**
 * The signed-in person's family dishes (`key`: libraryKey), whether their rows have come (`rowsFor`:
 * the key, or null while Convex hasn't answered), what they were built from, the ids whose stories
 * and tips are withheld from this person (withheldIds), the stories and tips Convex sent them
 * (sharedMemories), and the ingredients each cook confirmed after the video (sharedAdded).
 */
let family: {
  key: string | null;
  rowsFor: string | null;
  sig: string;
  entries: LibraryEntry[];
  withheld: ReadonlySet<string>;
  memories: ReadonlyMap<string, readonly Memory[]>;
  added: ReadonlyMap<string, readonly AddedIngredient[]>;
} = { key: null, rowsFor: null, sig: '', entries: [], withheld: new Set(), memories: new Map(), added: new Map() };
/** Dishes cached without their stories only because the rows hadn't come: loaded again when they do. */
const keptUntilRows = new Set<string>();

/** Whose library it is: the signed-in family and person (null: nobody), the rows' key. */
function libraryKey(s: Pick<Session, 'me' | 'family'> | null): string | null {
  return s?.me && s.family ? `${s.family.id}:${s.me.id}` : null;
}

/** A dish anyone may see in full: in library.json (or the bundled library) or bundled with the app. */
function isPublic(id: string): boolean {
  return bundledEntries.has(id) || Object.prototype.hasOwnProperty.call(bundledRecipes, id) || base.some((e) => e.id === id);
}

/**
 * Whether the dish's stories and tips are kept from `key` (libraryKey; by default whoever the session
 * says is signed in now). The cook kept them (withheldIds), or the rows saying who may see them haven't
 * come for `key` or for the library's own key (Convex slow, unreachable or stubbed) and the dish isn't
 * public. Hooks pass useSession()'s key: the module's session lags a render behind.
 */
export function storiesWithheld(id: string, key: string | null = libraryKey(getSession())): boolean {
  if (family.withheld.has(id)) return true;
  const waiting = (!!family.key && family.rowsFor !== family.key) || (!!key && family.rowsFor !== key);
  return waiting && !isPublic(id);
}

/**
 * The recipe as this person may see it (`key` as in storiesWithheld): a family dish whose stories and
 * tips are kept from them loses them, and one whose recipe.json was published without them gets
 * Convex's back.
 */
function forViewer(id: string, recipe: Recipe, key?: string | null): Recipe {
  const added = family.added.get(id);
  const withIngredients = added ? withAdded(recipe, added) : recipe;
  if (storiesWithheld(id, key)) return withoutStories(withIngredients);
  const memories = family.memories.get(id);
  return memories ? withMemories(withIngredients, memories) : withIngredients;
}

let libState: LibraryState = {
  entries: visible(base),
  source: 'bundled',
  loading: false,
  loaded: false,
};
const libListeners = new Set<() => void>();
let libPromise: Promise<void> | null = null;

function visible(entries: LibraryEntry[]): LibraryEntry[] {
  let hidden: string[] = [];
  try {
    hidden = loadHiddenIds();
  } catch {
    hidden = [];
  }
  return hidden.length ? entries.filter((e) => !hidden.includes(e.id)) : entries;
}

function setLib(next: Partial<LibraryState>) {
  libState = { ...libState, ...next };
  for (const l of libListeners) l();
}

/** library.json's dishes and the family's new ones, minus the hidden. The family's are findable by id. */
function listed(): LibraryEntry[] {
  const have = new Set(base.map((e) => e.id));
  for (const e of family.entries) if (!have.has(e.id)) entryCache.set(e.id, e);
  return visible(mergeLibrary(base, family.entries));
}

/** Loads (or reloads) the library into the shared store. Safe to call often. */
export function refreshLibrary(): Promise<void> {
  if (libPromise) return libPromise;
  setLib({ loading: true });
  libPromise = fetchLibrary()
    .then(({ entries, source }) => {
      base = entries;
      setLib({ entries: listed(), source, loading: false, loaded: true });
    })
    .catch(() => setLib({ loading: false, loaded: true }))
    .finally(() => {
      libPromise = null;
    });
  return libPromise;
}

/** Re-reads the hidden ids (after a delete) without a network round trip. */
export function reapplyHidden() {
  setLib({ entries: listed() });
}

/**
 * The family's Convex recipes into the library (useFamilyLibrary). `key` is who is signed in, family
 * and person (libraryKey; null: nobody). `rows` null means nothing new for `key`: its dishes stay,
 * unless they were someone else's, which clears them, and until rows come for `key` a dish that isn't
 * public loads without its stories (storiesWithheld). Exported for scripts/test-library.mjs.
 */
export function showFamilyRecipes(key: string | null, rows: readonly FamilyRecipe[] | null, people: readonly Pick<Profile, 'name' | 'relation'>[] = []) {
  if (!rows && family.key === key) return;
  const mine = key && rows ? rows : [];
  const rowsFor = key && rows ? key : null;
  const entries = familyEntries(mine, people);
  const withheld = withheldIds(mine);
  const memories = sharedMemories(mine, family.memories);
  const added = sharedAdded(mine, family.added);
  // The recipe ids too: convex.ts maps a library id to its Convex recipe (the voice socket needs it).
  // And whose stories are withheld, so the cook's later yes loads them again, stories and all.
  const sig = JSON.stringify([entries, [...withheld], mine.map((r) => [r._id, r.libraryId ?? null, r.cookId])]);
  if (family.key === key && family.rowsFor === rowsFor && family.sig === sig && family.memories === memories && family.added === added) return;
  if (rowsFor && family.rowsFor !== rowsFor) {
    // The rows came: what was kept only while they hadn't loads again, with its stories if she shared them.
    for (const id of keptUntilRows) recipeCache.delete(id);
    keptUntilRows.clear();
  }
  const have = new Set(base.map((e) => e.id));
  const next = new Set(entries.map((e) => e.id));
  for (const e of family.entries) {
    if (next.has(e.id) || have.has(e.id)) continue;
    // No longer the family's (or signed out): forget it here too.
    recipeCache.delete(e.id);
    const bundled = bundledEntries.get(e.id);
    if (bundled) entryCache.set(e.id, bundled);
    else entryCache.delete(e.id);
  }
  // A dish whose stories were just withheld, or shared again, or whose stories changed, was cached the
  // other way: load it again.
  const changed = [...family.withheld, ...withheld].filter((id) => family.withheld.has(id) !== withheld.has(id));
  const memoryChanged = [...family.memories.keys(), ...memories.keys()].filter((id) => family.memories.get(id) !== memories.get(id));
  const addedChanged = [...family.added.keys(), ...added.keys()].filter((id) => family.added.get(id) !== added.get(id));
  for (const id of [...changed, ...memoryChanged, ...addedChanged]) recipeCache.delete(id);
  // The same set when nothing changed, so useRecipes reloads only when it did.
  family = { key, rowsFor, sig, entries, withheld: changed.length ? withheld : family.withheld, memories, added };
  invalidateConvexRecipes();
  setLib({ entries: listed() });
}

// The stub has no family recipes: the library stays library.json's.
const noFamilyRecipes = () => () => {};

/** Keeps the library's family dishes in step with Convex recipes.list (live) for whoever is signed in. */
function useFamilyLibrary() {
  const session = useSession();
  const { profiles } = session;
  // The person too: Convex sends the stories and tips to the cook alone (until she says yes), so on
  // a shared phone the next person waits for their own rows.
  const key = libraryKey(session);
  const rows = useLive<FamilyRecipe[] | null>('recipes:list', null, noFamilyRecipes, !!key);
  // useLive keeps its last value through a sign-out or a change of family or person: only rows that
  // arrive after `key` last changed are this person's.
  const [since, setSince] = useState({ key, rows });
  if (since.key !== key) setSince({ key, rows });
  const fresh = since.key === key && rows !== since.rows ? rows : null;
  useEffect(() => {
    showFamilyRecipes(key, fresh, profiles);
  }, [key, fresh, profiles]);
}

function subscribeLib(l: () => void) {
  libListeners.add(l);
  return () => libListeners.delete(l);
}

/**
 * The family library. Starts with the bundled copy (never empty offline), then swaps in the bucket
 * copy once it arrives, with the signed-in family's own dishes from Convex in front. `loaded` turns
 * true after the first remote attempt.
 */
export function useLibrary(): LibraryState & { refresh: () => Promise<void> } {
  useFamilyLibrary();
  const state = useSyncExternalStore(subscribeLib, () => libState, () => libState);
  useEffect(() => {
    if (!libState.loaded && !libPromise) void refreshLibrary();
  }, []);
  return { ...state, refresh: refreshLibrary };
}

/** One recipe by id. Shows the cached/bundled copy instantly, then the fresh one. */
export function useRecipe(id: string | null | undefined): {
  recipe: Recipe | null;
  entry: LibraryEntry | null;
  loading: boolean;
  missing: boolean;
  source: Source | null;
  reload: () => void;
} {
  const [state, setState] = useState<{ id: string | null; recipe: Recipe | null; loading: boolean; missing: boolean; source: Source | null }>(
    () => ({ id: id ?? null, recipe: id ? getCachedRecipe(id) ?? null : null, loading: !!id, missing: false, source: null }),
  );
  const [nonce, setNonce] = useState(0);
  // Whether its stories and tips are withheld from this person, and the ones Convex sent them. The
  // family's list can arrive, or the cook change her mind, after the recipe loaded: then it loses or
  // gets them at once, and loads again.
  const viewer = libraryKey(useSession());
  const withheld = useStoriesWithheld(id);
  const memoriesOf = () => (id ? family.memories.get(id) : undefined);
  const memories = useSyncExternalStore(subscribeLib, memoriesOf, memoriesOf);
  const addedOf = () => (id ? family.added.get(id) : undefined);
  const added = useSyncExternalStore(subscribeLib, addedOf, addedOf);

  // Reset synchronously when the id changes (derived state, no flash of the previous recipe), and
  // drop or add stories the same way.
  const shown = id && state.recipe ? forViewer(id, state.recipe, viewer) : state.recipe;
  if ((id ?? null) !== state.id) {
    setState({ id: id ?? null, recipe: id ? getCachedRecipe(id) ?? null : null, loading: !!id, missing: false, source: null });
  } else if (shown !== state.recipe) {
    setState({ ...state, recipe: shown });
  }

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchRecipe(id).then((res) => {
      if (!alive) return;
      setState((s) =>
        s.id !== id
          ? s
          : res
            ? { id, recipe: res.recipe, loading: false, missing: false, source: res.source }
            : { id, recipe: s.recipe, loading: false, missing: !s.recipe, source: s.source },
      );
    });
    return () => {
      alive = false;
    };
  }, [id, nonce, withheld, memories, added]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return {
    recipe: state.recipe,
    entry: id ? getCachedEntry(id) ?? null : null,
    loading: state.loading,
    missing: state.missing,
    source: state.source,
    reload,
  };
}

/** Whether the dish's stories and tips are kept from whoever is signed in (storiesWithheld), live. */
export function useStoriesWithheld(id: string | null | undefined): boolean {
  const key = libraryKey(useSession());
  const get = () => !!id && storiesWithheld(id, key);
  return useSyncExternalStore(subscribeLib, get, get);
}

/** `map` as `viewer` may see it (forViewer); the same object when nothing changes. */
function mapForViewer(map: Record<string, Recipe>, viewer: string | null): Record<string, Recipe> {
  let out: Record<string, Recipe> | null = null;
  for (const id of Object.keys(map)) {
    const shown = forViewer(id, map[id], viewer);
    if (shown !== map[id]) (out ??= { ...map })[id] = shown;
  }
  return out ?? map;
}

/** Loads several recipes at once (e.g. every dish for Kid Home's recommendation). */
export function useRecipes(ids: string[]): Record<string, Recipe> {
  const key = ids.join('|');
  // Which of them have their stories and tips withheld from this person, as in useRecipe: a string,
  // so it only changes (and they only reload) when that does.
  const viewer = libraryKey(useSession());
  const kept = () => ids.filter((id) => storiesWithheld(id, viewer)).join('|');
  const withheld = useSyncExternalStore(subscribeLib, kept, kept);
  // And the stories and tips Convex sent, as in useRecipe.
  const memories = useSyncExternalStore(subscribeLib, () => family.memories, () => family.memories);
  const added = useSyncExternalStore(subscribeLib, () => family.added, () => family.added);
  const [map, setMap] = useState<Record<string, Recipe>>(() => {
    const m: Record<string, Recipe> = {};
    for (const id of ids) {
      const r = getCachedRecipe(id);
      if (r) m[id] = r;
    }
    return m;
  });
  const shown = mapForViewer(map, viewer);
  if (shown !== map) setMap(shown);
  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    Promise.all(list.map((id) => fetchRecipe(id))).then((results) => {
      if (!alive) return;
      const m: Record<string, Recipe> = {};
      results.forEach((res, i) => {
        if (res) m[list[i]] = res.recipe;
      });
      setMap(m);
    });
    return () => {
      alive = false;
    };
  }, [key, withheld, memories, added]);
  return shown;
}

// ---------------------------------------------------------------------------------------------
// Helpers

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Library entries cooked by `name` (case-insensitive), in library order. */
export function recipesByCook(entries: LibraryEntry[], name: string | null | undefined): LibraryEntry[] {
  const n = norm(name);
  return n ? entries.filter((e) => norm(e.cook_name) === n) : [];
}

/** Library entries grouped by cook, in first-seen order: [{cook, relation, entries}]. */
export function kitchens(entries: LibraryEntry[]): { cook: string; relation: string; entries: LibraryEntry[] }[] {
  const out = new Map<string, { cook: string; relation: string; entries: LibraryEntry[] }>();
  for (const e of entries) {
    const k = norm(e.cook_name);
    if (!out.has(k)) out.set(k, { cook: e.cook_name, relation: e.relation, entries: [] });
    out.get(k)!.entries.push(e);
  }
  return [...out.values()];
}

/** The profile whose name matches the recipe's cook (case-insensitive), if they're in the family. */
export function cookProfile(recipe: Pick<Recipe, 'cook'> | Pick<LibraryEntry, 'cook_name'> | null | undefined, profiles: Profile[]): Profile | null {
  if (!recipe) return null;
  const name = 'cook' in recipe ? recipe.cook?.name : recipe.cook_name;
  const n = norm(name);
  return (n && profiles.find((p) => norm(p.name) === n)) || null;
}

/** The [start_s, end_s] range that drives both Watch and Hear for a step. */
export function stepClip(step: Pick<Step, 'start_s' | 'end_s'>): { start_s: number; end_s: number; duration_s: number } {
  const start = Math.max(0, Math.floor(step.start_s || 0));
  const end = step.end_s && step.end_s > start ? step.end_s : start + 30;
  return { start_s: start, end_s: end, duration_s: end - start };
}

/**
 * Ingredients that belong to a step: first seen inside the step's time range. Falls back to
 * ingredients named in the step's instruction text (for recipes without `first_seen_s`).
 */
export function stepIngredients(recipe: Recipe, step: Step): Ingredient[] {
  const byTime = recipe.ingredients.filter(
    (i) => i.first_seen_s != null && i.first_seen_s >= step.start_s && i.first_seen_s < step.end_s,
  );
  if (byTime.length) return byTime;
  const text = norm(`${step.title} ${step.instruction}`);
  return recipe.ingredients.filter((i) => {
    const name = norm(i.name);
    if (!name) return false;
    if (text.includes(name)) return true;
    // "green onions" matches "onion"; "garlic cloves" matches "garlic".
    const head = name.split(/\s+/).filter((w) => w.length > 3).pop();
    return !!head && text.includes(head.replace(/s$/, ''));
  });
}

/** True when this recipe has real video / audio to play (synthetic samples have none). */
export function hasVideo(recipe: Recipe | null | undefined): boolean {
  return !!recipe?.media.video_url;
}
export function hasAudio(recipe: Recipe | null | undefined): boolean {
  return !!recipe?.media.audio_url;
}

/** The first step that carries a quote, trimmed to `maxLen` at a word boundary (default no limit). */
export function firstQuote(recipe: Recipe | null | undefined, maxLen?: number): { text: string; full: string; step: Step } | null {
  if (!recipe) return null;
  const step = recipe.steps.find((s) => s.quote && s.quote.trim());
  if (!step || !step.quote) return null;
  const full = step.quote.trim();
  return { text: maxLen ? clip(full, maxLen) : full, full, step };
}

/** The shortest quote (best for a one-line hero), or null. */
export function shortestQuote(recipe: Recipe | null | undefined, maxLen = 60): { text: string; full: string; step: Step } | null {
  if (!recipe) return null;
  const withQuotes = recipe.steps.filter((s) => s.quote && s.quote.trim());
  if (!withQuotes.length) return null;
  const fits = withQuotes.filter((s) => s.quote!.trim().length <= maxLen);
  const step = (fits.length ? fits : withQuotes).reduce((a, b) => (a.quote!.length <= b.quote!.length ? a : b));
  const full = step.quote!.trim();
  return { text: clip(full, maxLen), full, step };
}

/** Cuts text to at most `max` characters at a word boundary, adding an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/** "~50 min" style total time, or null. Accepts the recipe's own `total_time` string. */
export function totalMinutes(recipe: Pick<Recipe, 'total_time'> | null | undefined): number | null {
  const t = recipe?.total_time;
  if (!t) return null;
  const hrs = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(t);
  const mins = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/i.exec(t);
  if (!hrs && !mins) return null;
  return Math.round((hrs ? Number(hrs[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0));
}

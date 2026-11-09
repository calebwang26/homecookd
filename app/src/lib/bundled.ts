// The app ships no recipes (Caleb, Nov 8): every family starts with none, and nothing crosses between
// families, so there's no sample library to fall back to, offline or not. The family's own dishes come from
// the api; library.json on the media host is empty.
//
// assets/data/ (library.json, recipes/*.json) stays in the repo only as test fixtures: nothing here requires
// it, so none of it is in the app. pipeline/publish.py no longer writes this file; test-library checks that
// it requires nothing.
import type { LibraryEntry, Recipe } from './types';

export const bundledLibrary: LibraryEntry[] = [];
export const bundledRecipes: Record<string, Recipe> = {};

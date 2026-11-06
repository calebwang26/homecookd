// Deleting a recipe from the family table (and cancelling an upload job, same service).
//
// Flow: POST {"action": "delete", "recipe_id": id} to the upload service -> a laptop worker
// removes it from library.json within a minute or two. Meanwhile we hide the id locally
// (Paths.document/deleted.json on native, localStorage on web) so it stays gone after a
// relaunch, and drop the id once the fetched library no longer lists it.
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { webGetItem, webSetItem } from './legacyKeys';

import { AWS_ON } from './aws/config';
import { signerHeaders, UPLOAD_URL, uploadsConfigured } from './uploads';

const TIMEOUT_MS = 15000;

/** Asks the upload service to delete the recipe. Resolves on success, throws otherwise. */
export async function requestDelete(id: string): Promise<void> {
  // TODO(aws): deleting a recipe isn't on the AWS api yet (JOBS.md open item 11); nothing offers it under the switch.
  if (AWS_ON) throw new Error("Deleting isn't ready yet.");
  if (!uploadsConfigured()) throw new Error("Deleting isn't set up yet.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: await signerHeaders(),
      body: JSON.stringify({ action: 'delete', recipe_id: id }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let data: { ok?: unknown; error?: unknown } | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (e.g. a gateway error page)
    }
    if (!res.ok || data?.ok === false) {
      const reason = typeof data?.error === 'string' ? data.error : text.slice(0, 160);
      throw new Error(`The delete was refused (${res.status}). ${reason}`.trim());
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks the upload service to cancel an upload job (the worker skips it & no recipe is made).
 * Resolves on success, throws otherwise.
 */
export async function requestCancel(jobId: string): Promise<void> {
  if (AWS_ON) return; // the AWS stops (jobs.cancel, cancelUpload) delete the upload's files themselves
  if (!uploadsConfigured()) throw new Error("Cancelling isn't set up yet.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: await signerHeaders(),
      body: JSON.stringify({ action: 'cancel', job_id: jobId }),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let data: { ok?: unknown; error?: unknown } | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // not JSON (e.g. a gateway error page)
    }
    if (!res.ok || data?.ok === false) {
      const reason = typeof data?.error === 'string' ? data.error : text.slice(0, 160);
      throw new Error(`The cancel was refused (${res.status}). ${reason}`.trim());
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Locally hidden ids: Paths.document/deleted.json on native, localStorage on web.

const STORAGE_KEY = 'homecookd.deleted';

function deletedFile(): File {
  return new File(Paths.document, 'deleted.json');
}

export function loadHiddenIds(): string[] {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = webGetItem(STORAGE_KEY);
    } else {
      const f = deletedFile();
      raw = f.exists ? f.textSync() : null;
    }
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveHiddenIds(ids: string[]) {
  const raw = JSON.stringify(ids);
  try {
    if (Platform.OS === 'web') {
      webSetItem(STORAGE_KEY, raw);
    } else {
      const f = deletedFile();
      if (!f.exists) f.create({ intermediates: true });
      f.write(raw);
    }
  } catch (e) {
    console.warn('[deletes] could not save deleted.json', e);
  }
}

/** Hides the recipe on this device; returns the new list of hidden ids. */
export function hideRecipe(id: string): string[] {
  const ids = [...new Set([...loadHiddenIds(), id])];
  saveHiddenIds(ids);
  return ids;
}

/**
 * Forgets hidden ids the server has already removed. Only call with the REMOTE library
 * (the bundled fallback doesn't list new recipes, so it would forget too early).
 */
export function pruneHiddenIds(remoteLibraryIds: string[]): string[] {
  const current = loadHiddenIds();
  if (current.length === 0) return current;
  const live = new Set(remoteLibraryIds);
  const kept = current.filter((id) => live.has(id));
  if (kept.length !== current.length) saveHiddenIds(kept);
  return kept;
}

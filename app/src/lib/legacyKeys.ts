// Saved keys were "edible.*" before the homecookd rename. Reads fall back to the old key and move the
// value to the new one; writes clear the old key so a removed value can't come back. Never throws.
export const LEGACY_PREFIX = 'edible.';
export const PREFIX = 'homecookd.';

const legacyOf = (key: string) => LEGACY_PREFIX + key.slice(PREFIX.length);

/** localStorage get for a full "homecookd.*" key. */
export function webGetItem(key: string): string | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const v = ls.getItem(key);
    if (v != null) return v;
    const old = ls.getItem(legacyOf(key));
    if (old != null) {
      ls.setItem(key, old);
      ls.removeItem(legacyOf(key));
    }
    return old;
  } catch {
    return null;
  }
}

/** localStorage set (null removes) for a full "homecookd.*" key. */
export function webSetItem(key: string, value: string | null): void {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    if (value == null) ls.removeItem(key);
    else ls.setItem(key, value);
    ls.removeItem(legacyOf(key));
  } catch {
    // ignore
  }
}

/**
 * Native stores (SecureStore, AsyncStorage): same fallback-and-move, given that store's get/set/remove.
 * Returns null on any error, like the callers expect.
 */
export async function nativeGet(
  key: string,
  get: (k: string) => Promise<string | null>,
  set: (k: string, v: string) => Promise<void>,
  remove: (k: string) => Promise<void>,
): Promise<string | null> {
  try {
    const v = await get(key);
    if (v != null) return v;
    const old = await get(legacyOf(key));
    if (old != null) {
      await set(key, old);
      await remove(legacyOf(key));
    }
    return old;
  } catch {
    return null;
  }
}

export async function nativeClearLegacy(key: string, remove: (k: string) => Promise<void>): Promise<void> {
  try {
    await remove(legacyOf(key));
  } catch {
    // ignore
  }
}

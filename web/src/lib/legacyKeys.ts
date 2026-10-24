// Saved keys were "edible." / "edible:" before the homecookd rename. Reads fall back to the old key
// and move the value to the new one; writes clear the old key so a removed value can't come back.
// Both may throw (storage blocked); callers already catch.
const legacyOf = (key: string) => key.replace(/^homecookd(?=[.:])/, 'edible');

export function getItem(key: string): string | null {
  const v = window.localStorage.getItem(key);
  if (v != null) return v;
  const old = window.localStorage.getItem(legacyOf(key));
  if (old != null) {
    window.localStorage.setItem(key, old);
    window.localStorage.removeItem(legacyOf(key));
  }
  return old;
}

export function setItem(key: string, value: string | null): void {
  if (value == null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
  window.localStorage.removeItem(legacyOf(key));
}

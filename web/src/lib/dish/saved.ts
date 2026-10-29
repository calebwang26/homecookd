// What the kid's browser remembers with no account: the last dish they made (the "Your last dish ›"
// link) and their name. Storage can be blocked (private mode): every call is wrapped and best effort.
// There's no list of dishes on the web: keeping them all is what the app is for.
const LAST_KEY = 'homecookd.dish.last';
const NAME_KEY = 'homecookd.dish.name';
const LANG_KEY = 'homecookd.dish.lang';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

export function lastKidToken(): string | null {
  const k = read(LAST_KEY);
  return k && /^[A-Za-z0-9]{22}$/.test(k) ? k : null;
}

export const saveLastKidToken = (k: string | null) => write(LAST_KEY, k);

export function savedName(): string | null {
  const n = read(NAME_KEY)?.trim();
  return n ? n.slice(0, 40) : null;
}

export const saveName = (name: string) => write(NAME_KEY, name.trim().slice(0, 40) || null);

export const savedLang = () => read(LANG_KEY);
export const saveLang = (lang: string) => write(LANG_KEY, lang);

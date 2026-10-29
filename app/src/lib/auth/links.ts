// Reads a homecookd link and says where it goes (docs/build/JOIN-SIMPLE.md: joining is by link only):
//   https://homecookd.app/i?t=<token>   a family join link (22 characters) or an older invite (16); also
//                                        www., EXPO_PUBLIC_WEB_URL, homecookd:// and the pre-rename
//                                        edible://, and homecookd.app/i?t=… without the https://
//   …/i?c=<code>                        an old invite by its 6-letter code: /i says to tap the link instead
//   …/miss?k=<22>                       a kid's dish card (docs/build/V2-LINKING.md 2.2): claimed on /miss
//   …/a?t=<22>                          Mom's ask for that card: claimed on /a
// Links only: a bare token or a typed code is nothing, and a recipe link (/r) joins nobody any more.
// A whole copied text works ("Dad, join our family on homecookd: https://…"): the first homecookd link
// in it is used. Anything else is null.
import { WEB_URL } from '../api';

export type InviteInput =
  | { kind: 'token'; token: string }
  | { kind: 'code'; code: string }
  | { kind: 'card'; token: string }
  | { kind: 'ask'; token: string };

// A family join link (22 base62) or an older one-use invite (16).
const JOIN_TOKEN = /^(?:[0-9A-Za-z]{16}|[0-9A-Za-z]{22})$/;
// The server's CODE_ALPHABET: no 0/O/1/I.
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
// A dish card's kid token (/miss?k=) and its ask token (/a?t=): 22 base62 (DISH-ASK-SPEC).
const DISH_TOKEN = /^[0-9A-Za-z]{22}$/;
// An https link (host checked below), an app-scheme link, or homecookd.app with no scheme (copied
// from an address bar or retyped; never a longer host that ends in it), to /i, /miss or /a, plus
// its query.
const LINK = /(?:https?:\/\/([a-z0-9.-]+(?::\d+)?)|(?:homecookd|edible):\/\/|(?:^|[^a-z0-9.@/:-])(?:www\.)?homecookd\.app)\/*(i|miss|a)\/?\?(\S*)/gi;

function webHosts(): Set<string> {
  const own = /^https?:\/\/([^/?#]+)/i.exec(WEB_URL)?.[1]?.toLowerCase();
  return new Set(['homecookd.app', 'www.homecookd.app', ...(own ? [own] : [])]);
}

function param(query: string, name: string): string | null {
  return new RegExp(`(?:^|[?&])${name}=([0-9A-Za-z_-]+)`).exec(query)?.[1] ?? null;
}

function fromLink(page: string, query: string): InviteInput | null {
  if (page === 'miss' || page === 'a') {
    const token = param(query, page === 'miss' ? 'k' : 't');
    if (!token || !DISH_TOKEN.test(token)) return null;
    return page === 'miss' ? { kind: 'card', token } : { kind: 'ask', token };
  }
  const token = param(query, 't');
  if (isJoinToken(token)) return { kind: 'token', token };
  const code = param(query, 'c')?.toUpperCase();
  return code && CODE.test(code) ? { kind: 'code', code } : null;
}

/** A family join link's token (22 characters) or an older invite's (16), as /i?t= carries it. */
export const isJoinToken = (s: string | null | undefined): s is string => !!s && JOIN_TOKEN.test(s);

/** Where a homecookd link goes, or null when the text holds none. */
export function parseInviteInput(raw: string | null | undefined): InviteInput | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const hosts = webHosts();
  for (const m of text.matchAll(LINK)) {
    const [, host, page, query] = m;
    if (host && !hosts.has(host.toLowerCase())) continue;
    const found = fromLink(page.toLowerCase(), query);
    if (found) return found;
  }
  return null;
}

/** The screen a join link opens: /i?t=…, /miss?k=… or /a?t=… (an old code link: null). */
export function joinLinkHref(input: InviteInput | null): string | null {
  if (!input) return null;
  if (input.kind === 'token') return `/i?t=${input.token}`;
  if (input.kind === 'card') return `/miss?k=${input.token}`;
  if (input.kind === 'ask') return `/a?t=${input.token}`;
  return null;
}

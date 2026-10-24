// Reads what someone pastes or types for "Paste invite" / "Have an invite code?" and says what it is:
//   https://homecookd.app/i?t=<token>   (also www., EXPO_PUBLIC_WEB_URL, homecookd:// and the pre-rename edible://,
//                                        and homecookd.app/i?t=… without the https://)
//   …/i?c=<code>                        an invite by its 6-letter code
//   …/r?s=<share>                       a shared recipe: join that family through /join?s=
//   a bare 16-character token, or a 6-letter code ("k7qm 2x" works too)
// A whole pasted text works ("Dad, join our family table on homecookd: https://…"): the first
// homecookd link in it is used. Anything else is null: show NOT_AN_INVITE.
import { WEB_URL } from '../api';

export type InviteInput =
  | { kind: 'token'; token: string }
  | { kind: 'code'; code: string }
  | { kind: 'share'; share: string };

export const NOT_AN_INVITE = 'That doesn’t look like a homecookd invite.';

const TOKEN = /^[0-9A-Za-z]{16}$/;
// The server's CODE_ALPHABET: no 0/O/1/I.
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const SHARE = /^[0-9A-Za-z_-]{4,64}$/;
// An https link (host checked below), an app-scheme link, or homecookd.app with no scheme (copied
// from an address bar or retyped; never a longer host that ends in it), to /i or /r, plus its query.
const LINK = /(?:https?:\/\/([a-z0-9.-]+(?::\d+)?)|(?:homecookd|edible):\/\/|(?:^|[^a-z0-9.@/:-])(?:www\.)?homecookd\.app)\/*(i|r)\/?\?(\S*)/gi;

function webHosts(): Set<string> {
  const own = /^https?:\/\/([^/?#]+)/i.exec(WEB_URL)?.[1]?.toLowerCase();
  return new Set(['homecookd.app', 'www.homecookd.app', ...(own ? [own] : [])]);
}

function param(query: string, name: string): string | null {
  return new RegExp(`(?:^|[?&])${name}=([0-9A-Za-z_-]+)`).exec(query)?.[1] ?? null;
}

function fromLink(page: string, query: string): InviteInput | null {
  if (page === 'r') {
    const share = param(query, 's');
    return share && SHARE.test(share) ? { kind: 'share', share } : null;
  }
  const token = param(query, 't');
  if (token && TOKEN.test(token)) return { kind: 'token', token };
  const code = param(query, 'c')?.toUpperCase();
  return code && CODE.test(code) ? { kind: 'code', code } : null;
}

/** What a pasted or typed invite is, or null when it isn't one. */
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

  const bare = text.replace(/\s+/g, '');
  if (TOKEN.test(bare)) return { kind: 'token', token: bare };
  const code = bare.replace(/-/g, '').toUpperCase();
  return CODE.test(code) ? { kind: 'code', code } : null;
}

// Links from the web handoff pages (/i invites, the /r "Get the app" sheet, the dish pages) into the
// homecookd app. See docs/build/FEEDBACK-OCT16c.md section C. Everything here is a public value.

const httpsOnly = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return /^https:\/\/\S+$/.test(s) ? s : null;
};

/**
 * The iPhone app's App Store page (public since Nov 7, 2026). NEXT_PUBLIC_APP_STORE_URL replaces it
 * when it is set, so "Get the app" never depends on a setting someone has to remember.
 */
export const APP_STORE_URL: string = httpsOnly(process.env.NEXT_PUBLIC_APP_STORE_URL) ?? 'https://apps.apple.com/app/id6825621614';

/**
 * An Android phone or tablet. There is no homecookd app for it yet, so the hand-off says so there
 * instead of offering an Apple page and a link nothing can open.
 * TODO(caleb): an Android link once there is a Play or test build.
 */
export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/** homecookd://<path>?<params>: the app's own scheme (app/app.json). Only a phone with the app can open it. */
export function appSchemeUrl(path: 'i' | 'r' | 'miss' | 'a', params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `homecookd://${path}${q ? `?${q}` : ''}`;
}

/**
 * The two hosts the site answers on. The app claims both (app/app.config.ts, associatedDomains) and
 * both serve /.well-known/apple-app-site-association.
 */
const SITE_HOSTS = ['homecookd.app', 'www.homecookd.app'];

/** On a page's address: "Open homecookd" on the other host sent them here, so the app didn't take the link. */
const OPENED = 'o';

type At = { hostname: string; search: string };
const here = (): At | null => (typeof window === 'undefined' ? null : window.location);

/** This page was reached by "Open homecookd" on the site's other host: the app isn't on this phone, or didn't open. */
export function arrivedFromOpen(at: At | null = here()): boolean {
  return !!at && new URLSearchParams(at.search).get(OPENED) === '1';
}

/**
 * Where "Open homecookd" goes, for the pages the app claims (/i and /r in the association file).
 * iPhone never opens the app from a link to the page's own host, and the scheme alone is an "address
 * is invalid" error on a phone without the app. So the first tap is the same page on the site's
 * other host: with the app, iPhone opens the app; without it, that page loads and says to get the
 * app. On that page (and on any other host: a preview, localhost) the link is the scheme.
 */
export function openAppUrl(path: 'i' | 'r', params: Record<string, string>, at: At | null = here()): string {
  const i = at ? SITE_HOSTS.indexOf(at.hostname) : -1;
  if (i < 0 || arrivedFromOpen(at)) return appSchemeUrl(path, params);
  return `https://${SITE_HOSTS[1 - i]}/${path}?${new URLSearchParams({ ...params, [OPENED]: '1' })}`;
}

/**
 * The domain the app reads a copied link from. Copied links always use it, so a link copied on a
 * preview deployment is still picked up.
 */
export const WEB_ORIGIN = 'https://homecookd.app';

/**
 * The lander for whoever the link was meant for (the lander logs aud/from; FEEDBACK-OCT16c §3). A
 * family invite is for anyone, so it gets the parent page, the lander's default (E6).
 */
export const LANDER_LINK = {
  cook: '/teach?aud=parent&from=app',
  learner: '/learn?aud=kid&from=app',
  family: '/?from=app',
} as const;

/** A phone or tablet that can install the app (iPadOS reports itself as a Mac with touch). */
export function isPhoneOrTablet(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** An iPhone or iPad, where every browser is Safari underneath. */
function isAppleTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

type ClipboardItemClass = {
  new (items: Record<string, Blob>): ClipboardItem;
  supports?: (type: string) => boolean;
};

/**
 * On an iPhone, also mark a link as a link (`text/uri-list` next to the plain text). iOS can then
 * tell the app a link is on the clipboard without reading it, so the app puts Paste invite first.
 * Only where the browser says it can (`ClipboardItem.supports`); anywhere else the plain copy below
 * is what happens, exactly as before. The write starts inside the tap, as Safari requires.
 */
function writeLink(text: string): Promise<void> | null {
  if (!/^https:\/\/\S+$/.test(text) || !isAppleTouch()) return null;
  const Item = (globalThis as { ClipboardItem?: ClipboardItemClass }).ClipboardItem;
  if (!Item?.supports?.('text/uri-list') || !navigator.clipboard?.write) return null;
  return navigator.clipboard.write([
    new Item({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      'text/uri-list': new Blob([text], { type: 'text/uri-list' }),
    }),
  ]);
}

/**
 * Put text on the clipboard. Call it directly inside the tap handler: Safari only allows the write
 * while the tap is being handled. Resolves false when the browser refused.
 */
export function copyText(text: string): Promise<boolean> {
  try {
    const link = writeLink(text);
    if (link) {
      return link.then(
        () => true,
        // Refused as a link: try plain text (if that's refused too, the page says it couldn't copy).
        () => navigator.clipboard.writeText(text).then(() => true, () => false),
      );
    }
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      );
    }
  } catch {
    /* fall through to the old way */
  }
  // Older browsers and non-https pages: a hidden, read-only field (no keyboard on iPhone).
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  field.remove();
  return Promise.resolve(ok);
}

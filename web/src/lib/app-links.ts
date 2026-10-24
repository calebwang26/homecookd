// Links from the web handoff pages (/i invites, the /r "Get the app" sheet) into the homecookd app.
// See docs/build/FEEDBACK-OCT16c.md section C. Everything here is a public value.
//
// TODO(caleb): two values only you have:
//   - NEXT_PUBLIC_APP_STORE_URL: a public TestFlight or App Store link (set it in Vercel). Without
//     it, "Get the app" says homecookd is in early testing; no link is ever made up.
//   - web/public/.well-known/apple-app-site-association lists the app as "TEAMID.BUNDLEID" (JSON
//     has no comments). Put in <Apple Team ID>.<bundle id> once the bundle id is in the repo, or
//     universal links (tapping homecookd.app/i in Messages opens the app) stay off.

const httpsOnly = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return /^https:\/\/\S+$/.test(s) ? s : null;
};

/** The iPhone app's store link (TestFlight while testing, the App Store after launch), or null. */
export const APP_STORE_URL: string | null = httpsOnly(process.env.NEXT_PUBLIC_APP_STORE_URL);

/**
 * The link "Get the app" opens on this device, or null when there is none to offer yet. The store
 * link is iPhone-only, so Android gets null (the early-testing note) instead of an Apple page.
 * TODO(caleb): an Android link once there is a Play or test build.
 */
export function storeUrlForThisDevice(): string | null {
  if (typeof navigator === 'undefined') return APP_STORE_URL;
  return /Android/i.test(navigator.userAgent) ? null : APP_STORE_URL;
}

/**
 * homecookd://<path>?<params> (the app's scheme, app/app.json). A universal link never opens the
 * app from a page on its own domain, so "Open homecookd" on homecookd.app has to use the scheme.
 */
export function appSchemeUrl(path: 'i' | 'r', params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return `homecookd://${path}${q ? `?${q}` : ''}`;
}

/**
 * The domain the app's "Paste invite" recognises. Copied links always use it, so a link copied on
 * a preview deployment still pastes.
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

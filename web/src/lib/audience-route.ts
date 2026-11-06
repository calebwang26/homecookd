// Which version of the lander a visitor sees, and the one event we log about it (Caleb, Oct 16:
// no gate; the parent page is the default; the other side is one big hero button away).
//
// Routing happens only on the home page (/), before anything paints, in ROUTE_GATE (an inline
// <head> script, server-only in src/lib/audience-gate.ts, the first one in src/app/layout.tsx).
// Direct hits on /learn and /teach are never moved, and neither is a Back/Forward visit (so Back
// after a switch can't bounce anyone).
//   How they arrived                                         version     signal
//   a switch button (?aud=…&via=hero|footer)                 that one    'switch' (+ ui)
//   an app or invite link (?aud=…&from=app|invite|r)         that one    'link'
//     (/r → /learn?aud=kid&from=app, a "teach me" → /teach?aud=parent&from=app)
//   a tagged ad (?aud=kid|parent)                            that one    'aud'
//   a saved pick (an aud link or a switch before)            their pick  'saved'
//   opened inside Snapchat                                   kid         'snapchat'
//   anything else, Facebook included                         parent      'default'
// Precedence: aud param > saved pick > Snapchat > parent. A from= without aud still logs 'link'.
// The pick is saved (localStorage homecookd.aud) only from aud params, i.e. links and switches.
// aud, from and via are then removed from the address bar (utm_*, for, lite, log and the hash stay),
// so a /learn link shared from a kid's phone doesn't save 'kid' on Mom's.
// We never guess from location, device or fingerprinting. The in-app browser name is logged (not
// used for routing, except Snapchat) so the split per app can be measured later.
//
// Events go to the public POST /web-events of the `api` edge function (another session owns it):
//   { event: 'land' | 'switch' | 'tap', aud, signal?, ui?, app?, utm_source?, utm_campaign?, path, host }
// One 'land' or 'switch' per full page load (LandLogger, mounted in the Lander): 'switch' when a
// switch button opened the page (aud = the version it opened, ui = hero|footer). A switch keeps
// "where they came from": its signal and utm_* are the tab's first arrival, not the literal switch.
// 'tap' when the hero's main buttons are tapped (ui = cta "Get early access" | see "See it work" |
// send "Send this to {R}", the kid hero) or the kid page's sticky send button (ui = sticky).
// Sent with navigator.sendBeacon as text/plain (no CORS preflight). No IP is stored server-side.
// Nothing is sent from localhost or under automation (navigator.webdriver) unless the URL has ?log=1.
import { AUDIENCE_PATH, type Audience } from '@/content/audience';
import { API_URL } from '@/lib/recipe-web/config';

/** the lander's public endpoint (the app's own authenticated POST /events is a different route) */
export const EVENTS_URL = `${API_URL}/web-events`;

export type Signal = 'aud' | 'link' | 'saved' | 'snapchat' | 'default' | 'switch';
export type SwitchUi = 'hero' | 'footer';
/** the hero's buttons ("Get early access", "See it work", the kid's "Send this to {R}") and the
 *  kid page's sticky "Send this to {R}" */
export type TapUi = 'cta' | 'see' | 'send' | 'sticky';

/** What ROUTE_GATE recorded for this page load (window.__hcRoute). */
export interface RouteInfo {
  /** null on a direct /learn or /teach visit with no params, and on a Back/Forward visit */
  signal: Signal | null;
  /** in-app browser, e.g. 'snapchat', 'instagram', 'facebook', 'tiktok'; null in a normal browser */
  app: string | null;
  /** set when a switch button opened this page */
  ui: SwitchUi | null;
  /** a Back/Forward visit: never routed, never logged */
  back: boolean;
  /** on a switch: how this tab first arrived (its signal and utm_*), so the switch keeps it */
  arrival: { signal: Signal | null; utm_source: string | null; utm_campaign: string | null } | null;
}

declare global {
  interface Window {
    __hcRoute?: RouteInfo;
    /** ROUTE_GATE is sending this page elsewhere: don't log it */
    __hcAway?: boolean;
    __hcLanded?: boolean;
  }
}

/**
 * The switch buttons' link (hero, footer, the line under the final CTA): a plain href, so it works
 * before hydration and with no JS. The pick rides in the URL (aud + via); ROUTE_GATE saves it,
 * records it as a 'switch' and strips it from the address bar.
 *   switchHref('kid', 'hero')      → '/learn?aud=kid&via=hero'
 *   switchHref('parent', 'footer') → '/?aud=parent&via=footer'
 */
export function switchHref(to: Audience, ui: SwitchUi): string {
  return `${AUDIENCE_PATH[to]}?aud=${to}&via=${ui}`;
}

function canLog(): boolean {
  const { hostname, search } = window.location;
  if (/[?&]log=1(&|$)/.test(search)) return true;
  if (navigator.webdriver) return false; // perf checks, QA screenshots
  return !/^(localhost|127\.0\.0\.1|\[::1\])$|\.(local|localhost)$/.test(hostname);
}

type EventBody = {
  event: 'land' | 'switch' | 'tap';
  aud: Audience;
  signal?: Signal;
  ui?: SwitchUi | TapUi;
  app?: string;
  utm_source?: string;
  utm_campaign?: string;
  path: string;
  host: string;
};

function send(body: EventBody): void {
  const json = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(EVENTS_URL, new Blob([json], { type: 'text/plain' }))) return;
  } catch {
    /* fall through to fetch */
  }
  try {
    void fetch(EVENTS_URL, { method: 'POST', body: json, keepalive: true, mode: 'no-cors', headers: { 'content-type': 'text/plain' } }).catch(() => {});
  } catch {
    /* logging never breaks the page */
  }
}

/** The fields every event shares; utm_* fall back to the tab's first arrival (a switch link drops them). */
function common(aud: Audience) {
  const r = window.__hcRoute;
  const q = new URLSearchParams(window.location.search);
  const cap = (v: string | null | undefined, n = 100) => (v ? v.slice(0, n) : undefined);
  return {
    aud,
    app: r?.app ?? undefined,
    utm_source: cap(q.get('utm_source') ?? r?.arrival?.utm_source),
    utm_campaign: cap(q.get('utm_campaign') ?? r?.arrival?.utm_campaign),
    path: window.location.pathname.slice(0, 100),
    host: window.location.hostname.slice(0, 60),
  };
}

/** How this page's visitor got here: the tab's first arrival after a switch, else this load's own. */
function arrivalSignal(): Signal | undefined {
  const r = window.__hcRoute;
  return (r?.ui ? r.arrival?.signal : r?.signal) ?? undefined;
}

/**
 * Once per full page load: which version the visitor landed on and why ('land'), or that a switch
 * button opened it ('switch'). Skipped when ROUTE_GATE is redirecting and on Back/Forward visits.
 */
export function logLand(aud: Audience): void {
  if (typeof window === 'undefined' || window.__hcLanded) return;
  window.__hcLanded = true;
  const r = window.__hcRoute;
  if (window.__hcAway || r?.back || !canLog()) return;
  // JSON.stringify drops the undefined fields
  send(r?.ui ? { event: 'switch', ui: r.ui, signal: arrivalSignal(), ...common(aud) } : { event: 'land', signal: arrivalSignal(), ...common(aud) });
}

/** A tap on one of the hero's main buttons or the sticky send (the switch is logged by the page it opens). */
export function logTap(aud: Audience, ui: TapUi): void {
  if (typeof window === 'undefined' || !canLog()) return;
  send({ event: 'tap', ui, signal: arrivalSignal(), ...common(aud) });
}

/** The kid's web flow (PRD-V2): name the dish, get tonight's version, then Ask Mom from there. */
export const MISS_HREF = '/miss';

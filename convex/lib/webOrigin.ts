// Where the v2 web pages (/miss, /a) live: homecookd.app, or a test site while 1.0 is in App Review.
// DISH_WEB_ORIGIN (Convex env, e.g. https://test.homecookd.app) moves the links Convex hands out there and
// lets that site call the /dish and /link routes. Unset (production): homecookd.app.
const DEFAULT = "https://homecookd.app";

export function webOrigin(): string {
  const o = process.env.DISH_WEB_ORIGIN?.trim();
  return o && /^https:\/\/[a-z0-9.-]+$/.test(o) ? o : DEFAULT;
}

/** The test site from DISH_WEB_ORIGIN may call the routes too (homecookd.app and local dev always can). */
export const isWebOrigin = (origin: string) => origin === webOrigin();

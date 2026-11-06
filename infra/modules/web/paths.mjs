// What each address should answer, read off homecookd.app (Vercel) with curl on Oct 31. The function's test checks it
// against web/out, and infra/scripts/web-smoke.mjs checks it against a running site, so one table covers both.
export const CACHE = {
  page: 'public, max-age=0, must-revalidate',
  immutable: 'public, max-age=31536000, immutable',
  media: 'public, max-age=3600, stale-while-revalidate=604800',
  aasa: 'public, max-age=3600',
};

const HTML = 'text/html; charset=utf-8';
const TXT = 'text/plain; charset=utf-8';

const ok = (path, file, type = HTML, cache = CACHE.page) => ({ path, status: 200, file, type, cache });
const missing = (path, cache = CACHE.page) => ({ path, status: 404, file: '404.html', type: HTML, cache });
const moved = (path, location) => ({ path, status: 308, location, cache: CACHE.page });

export const AASA_PATH = '/.well-known/apple-app-site-association';

export const PATHS = [
  // The Apple file, exactly: a 200 with this type and no redirect, or universal links break on every installed phone.
  ok(AASA_PATH, '.well-known/apple-app-site-association', 'application/json', CACHE.aasa),
  ok(`${AASA_PATH}?x=1`, '.well-known/apple-app-site-association', 'application/json', CACHE.aasa),
  moved(`${AASA_PATH}/`, AASA_PATH),
  missing('/.well-known/assetlinks.json'),
  missing('/.well-known'),
  moved('/.well-known/', '/.well-known'),
  missing('/apple-app-site-association'),

  // Pages. The pages read their query string on the phone, so it's the same file with or without one.
  ok('/', 'index.html'),
  ok('/?aud=kid', 'index.html'),
  ok('/index', 'index.html'),
  ok('/r', 'r.html'),
  ok('/r?s=abc', 'r.html'),
  ok('/i', 'i.html'),
  ok('/i?code=x', 'i.html'),
  ok('/d', 'd.html'),
  ok('/miss', 'miss.html'),
  ok('/miss?k=abc', 'miss.html'),
  ok('/a', 'a.html'),
  ok('/a?t=abc', 'a.html'),
  ok('/learn', 'learn.html'),
  ok('/teach', 'teach.html'),
  ok('/privacy', 'privacy.html'),
  ok('/terms', 'terms.html'),
  ok('/_not-found', '_not-found.html'),
  ok('/%72', 'r.html'),

  // A trailing slash redirects, keeping the query string.
  moved('/r/', '/r'),
  moved('/i/', '/i'),
  moved('/d/', '/d'),
  moved('/miss/', '/miss'),
  moved('/a/', '/a'),
  moved('/learn/', '/learn'),
  moved('/teach/', '/teach'),
  moved('/privacy/', '/privacy'),
  moved('/terms/', '/terms'),
  moved('/index/', '/index'),
  moved('/nope/', '/nope'),
  moved('/a/b/c/', '/a/b/c'),
  moved('/learn/og.jpg/', '/learn/og.jpg'),
  moved('/r/?s=a%2Fb&x=1&x=2&flag', '/r?s=a%2Fb&x=1&x=2&flag'),

  // Doubled slashes collapse. //example.com/ must stay on this site.
  moved('//r', '/r'),
  moved('/r//', '/r/'),
  moved('//example.com/', '/example.com/'),

  // No page reads a path after its name: every one reads the query string. These are 404s on Vercel, so here too.
  missing('/r/abc'),
  missing('/r/abc/def'),
  missing('/i/abc'),
  missing('/d/abc'),
  missing('/miss/abc'),
  missing('/a/abc'),

  // A page is only reachable by its clean URL.
  missing('/r.html'),
  missing('/a.html'),
  missing('/index.html'),
  missing('/404'),
  missing('/404.html'),
  missing('/_not-found.html'),
  missing('/r.HTML'),
  missing('/R'),

  // Next's router data and the generated images.
  ok('/r.txt', 'r.txt', TXT),
  ok('/a.txt', 'a.txt', TXT),
  ok('/index.txt', 'index.txt', TXT),
  ok('/_not-found.txt', '_not-found.txt', TXT),
  ok('/__next._tree.txt', '__next._tree.txt', TXT),
  ok('/r/__next._full.txt', 'r/__next._full.txt', TXT),
  ok('/a/__next._tree.txt', 'a/__next._tree.txt', TXT),
  ok('/og.jpg', 'og.jpg', 'image/jpeg'),
  ok('/og.jpg?x=1', 'og.jpg', 'image/jpeg'),
  ok('/learn/og.jpg', 'learn/og.jpg', 'image/jpeg'),
  ok('/teach/og.jpg', 'teach/og.jpg', 'image/jpeg'),

  // Public files.
  ok('/favicon.ico', 'favicon.ico', 'image/vnd.microsoft.icon'),
  ok('/icon.svg', 'icon.svg', 'image/svg+xml'),
  ok('/apple-icon.png', 'apple-icon.png', 'image/png'),
  ok('/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json; charset=utf-8'),
  ok('/icon-192.png', 'icon-192.png', 'image/png'),
  ok('/brand/mark.svg', 'brand/mark.svg', 'image/svg+xml'),
  ok('/patterns/swirl-sun.svg', 'patterns/swirl-sun.svg', 'image/svg+xml'),
  ok('/fonts/fraunces-roman-latin.0ba5251864.woff2', 'fonts/fraunces-roman-latin.0ba5251864.woff2', 'font/woff2', CACHE.immutable),
  ok('/media/app/web-miss.mp4', 'media/app/web-miss.mp4', 'video/mp4', CACHE.media),
  ok('/media/stock/credits.json', 'media/stock/credits.json', 'application/json; charset=utf-8', CACHE.media),

  // Anything else.
  missing('/nope'),
  missing('/nope.html'),
  missing('/nope.jpg'),
  missing('/miss%20'),
  missing('/robots.txt'),
  missing('/sitemap.xml'),
  missing('/media'),
  missing('/fonts'),
  // Vercel really does send a year's cache on a missing font, because vercel.json matches the path.
  missing('/fonts/nope.woff2', null), // Vercel caches this 404 for a year; CloudFront doesn't, which is better. Neither is checked
];

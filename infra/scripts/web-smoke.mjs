#!/usr/bin/env node
// Checks a running copy of the website against the table Vercel set: node infra/scripts/web-smoke.mjs <base url> [--noindex]
// Reads only. Run after every deploy; pointed at https://homecookd.app it shows what Vercel does today.
import { AASA_PATH, CACHE, PATHS } from '../modules/web/paths.mjs';

const base = (process.argv[2] ?? '').replace(/\/+$/, '');
const noindex = process.argv.includes('--noindex');
if (!/^https:\/\//.test(base)) {
  console.error('usage: web-smoke.mjs https://<address> [--noindex]');
  process.exit(2);
}

// CloudFront's function hands query parameters back grouped by name, and pages read them by name, so the order doesn't matter.
const sameQueryOrder = (location) => {
  if (!location?.includes('?')) return location;
  const [path, query] = location.split('?');
  return `${path}?${query.split('&').sort().join('&')}`;
};

const failures = [];
const check = (name, got, want) => {
  if (got !== want) failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const noSpaces = (value) => (value ?? '').replace(/\s/g, '');
const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init });

for (const want of PATHS) {
  const res = await get(want.path, { method: 'HEAD' });
  check(`${want.path} status`, res.status, want.status);
  if (want.location) check(`${want.path} location`, sameQueryOrder(res.headers.get('location')), sameQueryOrder(want.location));
  if (want.type) check(`${want.path} type`, res.headers.get('content-type'), want.type);
  if (want.cache) check(`${want.path} cache`, noSpaces(res.headers.get('cache-control')), noSpaces(want.cache));
}

// The bytes Apple's servers get, not just the headers.
const aasa = await get(AASA_PATH);
check('Apple file status', aasa.status, 200);
check('Apple file type', aasa.headers.get('content-type'), 'application/json');
const body = await aasa.json();
check('Apple file app', body.applinks?.details?.[0]?.appIDs?.[0], '73UV499FKN.com.salik.homecookd');

const home = await get('/', { headers: { 'accept-encoding': 'br, gzip' } });
const html = await home.text();
check('home HSTS', home.headers.get('strict-transport-security'), 'max-age=63072000');
if (!home.headers.has('content-encoding')) console.log('note: the home page came back uncompressed (fine on a first request)');
check('home has no localhost address', /\/\/localhost[:/"]/.test(html), false);

// Hashed files, under whichever folder this build put them.
const script = html.match(/\/_next\/static\/[^"']+\.js/)?.[0];
const style = html.match(/\/_next\/static\/[^"']+\.css/)?.[0];
for (const [path, type] of [
  [script, 'application/javascript; charset=utf-8'],
  [style, 'text/css; charset=utf-8'],
]) {
  if (!path) {
    failures.push(`no ${type} file found in the home page`);
    continue;
  }
  const res = await get(path, { method: 'HEAD' });
  check(`${path} status`, res.status, 200);
  check(`${path} type`, res.headers.get('content-type'), type);
  check(`${path} cache`, noSpaces(res.headers.get('cache-control')), noSpaces(CACHE.immutable));
}
check('missing hashed file', (await get('/_next/static/nope.js', { method: 'HEAD' })).status, 404);

// Safari won't play a video from a server that ignores ranges.
const video = await get('/media/app/web-miss.mp4', { headers: { range: 'bytes=0-1' } });
check('video range status', video.status, 206);
await video.arrayBuffer();

const cors = await get('/fonts/fraunces-roman-latin.0ba5251864.woff2', { method: 'HEAD', headers: { origin: 'https://example.com' } });
check('CORS on a font', cors.headers.get('access-control-allow-origin'), '*');

const robots = (await get('/', { method: 'HEAD' })).headers.get('x-robots-tag');
check('search engines', robots, noindex ? 'noindex' : null);

if (failures.length) {
  console.error(`${failures.length} failed:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`ok: ${PATHS.length} paths and the extra checks, on ${base}`);

// The links from the web's hand-off pages into the app (lib/app-links.ts): where "Get the app" and
// "Open homecookd" go on each host, and that the app really claims what they point at.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APP_STORE_URL, appSchemeUrl, arrivedFromOpen, openAppUrl } from './app-links.ts';

const at = (hostname: string, search = '') => ({ hostname, search });
const repo = new URL('../../../', import.meta.url);

test('Get the app is the App Store page with no setting made', () => {
  assert.equal(process.env.NEXT_PUBLIC_APP_STORE_URL, undefined);
  assert.equal(APP_STORE_URL, 'https://apps.apple.com/app/id6825621614');
});

test('Open homecookd goes to the same page on the site’s other host, marked o=1', () => {
  assert.equal(openAppUrl('i', { t: 'abc_-123' }, at('homecookd.app', '?t=abc_-123')), 'https://www.homecookd.app/i?t=abc_-123&o=1');
  assert.equal(openAppUrl('i', { c: 'ABCD' }, at('www.homecookd.app', '?c=ABCD')), 'https://homecookd.app/i?c=ABCD&o=1');
  assert.equal(openAppUrl('r', { s: 'tok-1' }, at('homecookd.app', '?s=tok-1')), 'https://www.homecookd.app/r?s=tok-1&o=1');
});

test('once they arrive with o=1 the link is the app’s scheme, so two taps never loop between hosts', () => {
  for (const host of ['homecookd.app', 'www.homecookd.app']) {
    const here = at(host, '?t=abc&o=1');
    assert.equal(arrivedFromOpen(here), true);
    assert.equal(openAppUrl('i', { t: 'abc' }, here), 'homecookd://i?t=abc');
  }
  assert.equal(arrivedFromOpen(at('homecookd.app', '?t=abc')), false);
  assert.equal(arrivedFromOpen(at('homecookd.app', '?t=abc&o=0')), false);
});

test('on any other host (a preview, localhost) and with no page at all, the link is the scheme', () => {
  for (const here of [at('localhost', '?t=abc'), at('homecookd-git-x.vercel.app', '?t=abc'), null]) {
    assert.equal(arrivedFromOpen(here), false);
    assert.equal(openAppUrl('i', { t: 'abc' }, here), appSchemeUrl('i', { t: 'abc' }));
    assert.equal(openAppUrl('r', { s: 'abc' }, here), 'homecookd://r?s=abc');
  }
});

test('the app claims every page and both hosts Open homecookd points at', () => {
  const aasa = JSON.parse(readFileSync(new URL('web/public/.well-known/apple-app-site-association', repo), 'utf8'));
  const claimed: string[] = aasa.applinks.details.flatMap((d: { components: { '/': string }[] }) => d.components.map((c) => c['/']));
  for (const path of ['i', 'r'] as const) {
    assert.ok(claimed.includes(`/${path}`), `the association file lists /${path}`);
    for (const from of ['homecookd.app', 'www.homecookd.app']) {
      const to = new URL(openAppUrl(path, { x: '1' }, at(from)));
      assert.equal(to.protocol, 'https:');
      assert.notEqual(to.hostname, from);
      assert.equal(to.pathname, `/${path}`);
    }
  }
  const config = readFileSync(new URL('app/app.config.ts', repo), 'utf8');
  for (const host of ['homecookd.app', 'www.homecookd.app']) assert.ok(config.includes(`'applinks:${host}'`), `the app claims ${host}`);
});

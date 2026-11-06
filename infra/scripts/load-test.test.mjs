// load-test.mjs's guards, with no network: node --test infra/scripts/load-test.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { settings } from './load-test-args.mjs';

const YES = { LOAD_TEST_PRODUCTION: 'yes' };
const PROD = 'https://api.homecookd.app';
const run = (args, env = {}) => settings(args, env);

test('staging runs as before', () => {
  assert.deepEqual(run(['http://localhost:8080/']), { base: 'http://localhost:8080', rps: 50, minutes: 15, burst: 300, cards: 4, production: false });
  const s = run(['https://d123.cloudfront.net', '--rps', '120', '--minutes', '12', '--burst', '1500', '--cards', '9']);
  assert.deepEqual([s.rps, s.minutes, s.burst, s.cards, s.production], [120, 12, 1500, 6, false]);
});

test('staging refuses production, a bad address and bad numbers', () => {
  for (const args of [[], ['localhost:8080'], [PROD], ['https://homecookd.app'], ['http://homecookd-production-alb.example'], ['http://localhost', '--rps', 'x']]) {
    assert.ok(run(args).error, args.join(' '));
  }
  // The env var alone changes nothing.
  assert.ok(run([PROD], YES).error);
});

test('production needs both keys', () => {
  assert.match(run([PROD, '--production', '--cards', '2']).error, /LOAD_TEST_PRODUCTION=yes/);
  assert.match(run([PROD, '--production', '--cards', '2'], { LOAD_TEST_PRODUCTION: 'true' }).error, /LOAD_TEST_PRODUCTION=yes/);
  const s = run([PROD, '--production', '--cards', '2', '--rps', '200'], YES);
  assert.deepEqual(s, { base: PROD, rps: 200, minutes: 15, burst: 300, cards: 2, production: true });
});

test('production is https://api.homecookd.app only', () => {
  assert.match(run(['http://api.homecookd.app', '--production', '--cards', '2'], YES).error, /HTTPS only/);
  for (const base of ['https://homecookd.app', 'https://api.homecookd.app.example.com', 'https://d123.cloudfront.net', 'https://api.homecookd.app/dish', 'https://api.homecookd.app?x=1']) {
    assert.match(run([base, '--production', '--cards', '2'], YES).error, /only for https:\/\/api\.homecookd\.app/, base);
  }
  assert.ok(run(['--production', '--cards', '2'], YES).error);
});

test('production makes cards only when told how many', () => {
  assert.match(run([PROD, '--production'], YES).error, /how many cards/);
  assert.match(run([PROD, '--production', '--cards', '0'], YES).error, /how many cards/);
  assert.equal(run([PROD, '--production', '--cards', '9'], YES).cards, 6);
  assert.ok(run([PROD, '--production', '--cards', 'two'], YES).error);
});

test('the script itself stops before any request', () => {
  const script = fileURLToPath(new URL('./load-test.mjs', import.meta.url));
  // Every case here is refused, so nothing is fetched. Never add one that passes: it would run against that address.
  const cases = [
    [[PROD], YES],
    [[PROD, '--production', '--cards', '2'], {}],
    [['http://api.homecookd.app', '--production', '--cards', '2'], YES],
    [[PROD, '--production'], YES],
  ];
  for (const [args, extra] of cases) {
    const out = spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...extra }, encoding: 'utf8', timeout: 5_000 });
    assert.equal(out.status, 2, args.join(' '));
    assert.equal(out.stdout, '');
  }
});

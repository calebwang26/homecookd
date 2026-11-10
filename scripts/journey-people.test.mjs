// node --test scripts/journey-people.test.mjs: journey 2's test people on a fake fetch (no network, no key).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { appLink, DELETE_STEP, idsFor, leftovers, remove, SEED_STEP, setup, signIn } from './journey-people.mjs';

const dir = mkdtempSync(join(process.cwd(), '.journey-people-test-'));
const json = (status, body) => ({ status, text: async () => JSON.stringify(body) });

/** A fake staging: answers by path, records each call. */
function staging(answers) {
  const calls = [];
  const f = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    calls.push({ path, body, headers: init.headers });
    const a = answers[path];
    return typeof a === 'function' ? a(body, calls) : a;
  };
  return { f, calls };
}

test('ids come from the run alone, so a sweep can find them', () => {
  assert.deepEqual(idsFor(42664613421, 2), { cook: 'j42664613421-2-cook', kid: 'j42664613421-2-kid' });
  assert.match(idsFor(42664613421, 2).cook, /^[a-z0-9-]{1,40}$/); // staging's test_id rule
});

test("a family link becomes the app's own form", () => {
  assert.equal(appLink('https://homecookd.app/i?t=AbCdEfGhIjKlMnOpQrStUv'), 'homecookd://i?t=AbCdEfGhIjKlMnOpQrStUv');
  assert.throws(() => appLink('https://homecookd.app/i'), /no t=/);
});

test('a key that is set but refused fails loudly, never like a skip', async () => {
  for (const status of [401, 404]) {
    const { f } = staging({ '/v1/test/sign-in': json(status, {}) });
    await assert.rejects(signIn('k', 'j1-1-cook', 'cook', {}, f), /TEST_SIGNIN_KEY was refused by staging/);
  }
});

test('a 429 waits once and tries again', async () => {
  let n = 0;
  const { f } = staging({ '/v1/test/sign-in': () => (++n === 1 ? json(429, {}) : json(200, { device_key: 'dk', profile_id: 'p' })) });
  let waited = 0;
  const p = await signIn('k', 'j1-1-cook', 'cook', {}, f, async (ms) => (waited = ms));
  assert.equal(p.device_key, 'dk');
  assert.equal(waited, 61_000);
});

test('setup keeps the ids before any sign-in, then joins the kid by the cook’s link', async () => {
  const state = join(dir, 'setup.json');
  const masked = [];
  const { f, calls } = staging({
    '/v1/test/sign-in': (body) => {
      assert.deepEqual(JSON.parse(readFileSync(state, 'utf8')), idsFor(7, 1)); // written first
      return json(200, { device_key: `key-${body.test_id}`, profile_id: `p-${body.test_id}`, family_name: 'Asha (test)’s family' });
    },
    '/join-links': json(200, { url: 'https://homecookd.app/i?t=AbCdEfGhIjKlMnOpQrStUv' }),
  });
  const out = await setup('the-key', state, idsFor(7, 1), f, (line) => masked.push(line));
  assert.deepEqual(out, { familyLink: 'homecookd://i?t=AbCdEfGhIjKlMnOpQrStUv', kidKey: 'key-j7-1-kid', familyName: 'Asha (test)’s family' });
  assert.deepEqual(calls.map((c) => c.path), ['/v1/test/sign-in', '/join-links', '/v1/test/sign-in']);
  assert.equal(calls[0].headers['x-test-signin-key'], 'the-key');
  assert.deepEqual(calls[0].body, { test_id: 'j7-1-cook', name: 'Asha (test)', role: 'cook' });
  assert.equal(calls[1].headers['x-device-key'], 'key-j7-1-cook');
  assert.deepEqual(calls[2].body, { test_id: 'j7-1-kid', name: 'Leo (test)', role: 'learner', join_token: 'AbCdEfGhIjKlMnOpQrStUv' });
  // every value the log could show is masked before it's used
  assert.deepEqual(masked, ['::add-mask::key-j7-1-cook', '::add-mask::AbCdEfGhIjKlMnOpQrStUv', '::add-mask::key-j7-1-kid']);
});

test('setup fails when the kid lands in another family', async () => {
  const { f } = staging({
    '/v1/test/sign-in': (body) => json(200, { device_key: 'dk', profile_id: 'p', family_name: body.join_token ? 'Other' : 'Asha (test)’s family' }),
    '/join-links': json(200, { url: 'https://homecookd.app/i?t=AbCdEfGhIjKlMnOpQrStUv' }),
  });
  await assert.rejects(setup('k', join(dir, 'other.json'), idsFor(8, 1), f, () => {}), /did not join/);
});

test('delete signs each in again and deletes, kid first, and never throws', async () => {
  const log = [];
  const { f, calls } = staging({
    '/v1/test/sign-in': (body) => json(200, { device_key: `key-${body.test_id}`, profile_id: `p-${body.test_id}` }),
    '/v1/sessions/start': json(200, { sessionToken: 'st' }),
    '/v1/account/delete': json(200, { deleted: true }),
  });
  await remove('k', idsFor(9, 1), f, (l) => log.push(l));
  assert.deepEqual(log, ['deleted Leo (test)', 'deleted Asha (test)']);
  assert.equal(calls.find((c) => c.path === '/v1/account/delete').headers.authorization, 'Bearer st');

  const failing = staging({ '/v1/test/sign-in': json(500, {}) });
  const warned = [];
  await remove('k', idsFor(9, 1), failing.f, (l) => warned.push(l));
  assert.equal(warned.length, 2);
  assert.match(warned[0], /^::warning .*could not delete Leo \(test\)/);
});

test('the sweep finds runs that seeded and never finished deleting', () => {
  const step = (name, status, conclusion) => ({ name, status, conclusion });
  const run = (runId, steps) => ({ runId, attempt: 1, jobs: [{ name: 'scope', steps: [] }, { name: 'journeys', steps }] });
  const found = leftovers([
    run(1, [step(SEED_STEP, 'completed', 'success'), step(DELETE_STEP, 'completed', 'success')]), // cleaned up
    run(2, [step(SEED_STEP, 'completed', 'success'), step(DELETE_STEP, 'queued', null)]), // runner died after seeding
    run(3, [step(SEED_STEP, 'in_progress', null)]), // died mid-seed
    run(4, [step(SEED_STEP, 'completed', 'skipped')]), // never got that far
    run(5, [step(SEED_STEP, 'completed', 'success'), step(DELETE_STEP, 'completed', 'failure')]), // delete failed
    run(6, []), // the journeys job didn't run (no app/ change)
  ]);
  assert.deepEqual(found, [idsFor(2, 1), idsFor(3, 1), idsFor(5, 1)]);
});

test.after(async () => {
  const { rmSync } = await import('node:fs');
  rmSync(dir, { recursive: true, force: true });
});

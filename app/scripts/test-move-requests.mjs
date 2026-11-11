// The five move-request calls (src/lib/moveApi.ts) in both switch positions, against a fake fetch (no network):
//   off (1.0)  each goes to the Supabase api, as before: the same paths, methods, headers and bodies
//   on  (1.1)  each goes to the AWS api with the same paths, headers and bodies, and nothing reaches Supabase;
//              a refusal keeps its status (the Home pop-up reads 404/409/410) in the person's own words; the
//              api's own "signed out" is heard once, as on every other 1.1 call
// Each position loads its own copy of src/ (config.ts reads EXPO_PUBLIC_BACKEND when it loads), so one run tests both.
//   node scripts/test-move-requests.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A module under src/ gets its importer's ?query, so ?off and ?on are two separate copies of the app's files.
registerHooks({
  resolve(spec, ctx, next) {
    const parent = ctx.parentURL ? new URL(ctx.parentURL) : null;
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && parent ? join(dirname(fileURLToPath(parent)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) {
      const url = pathToFileURL(`${base}.ts`);
      url.search = parent?.protocol === 'file:' ? parent.search : '';
      return next(url.href, ctx);
    }
    return next(spec, ctx);
  },
});

const SUPABASE = 'https://bsudybxsqvtwftsdmwmz.supabase.co/functions/v1/api';
const AWS = 'https://api.test';
delete process.env.EXPO_PUBLIC_API_URL; // the store build's default address, as a 1.1 phone has it
process.env.EXPO_PUBLIC_AWS_URL = `${AWS}/`;

const load = async (pos) => {
  process.env.EXPO_PUBLIC_BACKEND = pos === 'on' ? 'aws' : '';
  const at = (f) => `${pathToFileURL(join(root, f)).href}?${pos}`;
  const [M, API, C, cfg] = await Promise.all(['src/lib/moveApi.ts', 'src/lib/api.ts', 'src/lib/aws/client.ts', 'src/lib/aws/config.ts'].map((f) => import(at(f))));
  return { M, API, C, cfg };
};
const off = await load('off');
const on = await load('on');
assert.deepEqual([off.cfg.AWS_ON, on.cfg.AWS_ON], [false, true], 'two copies, one per switch position');

// One fake fetch for everything: every call is recorded with where it went.
let calls = [];
let answer = () => ({ status: 200, body: {} });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const call = { host: `${u.protocol}//${u.host}`, url: String(url), method: init.method ?? 'GET', headers: { ...(init.headers ?? {}) }, body: init.body ? JSON.parse(init.body) : undefined };
  calls.push(call);
  const a = answer(call);
  if (a === 'offline') throw new TypeError('Network request failed');
  return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? null), { status: a.status ?? 200 });
};
on.C.setAwsTransportForTests((url, init) => globalThis.fetch(url, init), async () => {});

let passed = 0;
const test = async (name, fn) => {
  calls = [];
  answer = () => ({ status: 200, body: {} });
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};
const caught = async (p) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('expected an error');
};

// The phone: its key, and the person picked on it.
const KEY = 'dk-test-1';
for (const { API } of [off, on]) API.setApiAuth({ deviceKey: KEY, profileId: 'p-mom' });

// What each call sends. `me`: whether it goes as the picked person (x-profile-id).
const FIVE = [
  { name: 'ask', run: (M) => M.moveApi.ask('p-dad'), method: 'POST', path: '/move-requests', body: { profile_id: 'p-dad' }, me: false, reply: { id: 'm1', profile_id: 'p-dad', status: 'pending' } },
  { name: 'mine', run: (M) => M.moveApi.mine(), method: 'GET', path: '/move-requests/mine', body: undefined, me: false, reply: { id: 'm1', profile_id: 'p-dad', status: 'pending', asked: ['Mom'] } },
  { name: 'list', run: (M) => M.moveApi.list(), method: 'GET', path: '/move-requests', body: undefined, me: true, reply: [{ id: 'm1', profile: { id: 'p-dad', name: 'Dad' }, created_at: '2026-11-10T00:00:00.000Z' }] },
  { name: 'approve', run: (M) => M.moveApi.approve('m 1'), method: 'POST', path: '/move-requests/m%201/approve', body: {}, me: true, reply: { ok: true } },
  { name: 'decline', run: (M) => M.moveApi.decline('m 1'), method: 'POST', path: '/move-requests/m%201/decline', body: {}, me: true, reply: { ok: true } },
];

for (const c of FIVE) {
  await test(`off: ${c.name} goes to the Supabase api, as before`, async () => {
    answer = () => ({ body: c.reply });
    assert.deepEqual(await c.run(off.M), c.reply);
    assert.equal(calls.length, 1);
    const [sent] = calls;
    assert.deepEqual([sent.url, sent.method, sent.body], [`${SUPABASE}${c.path}`, c.method, c.body]);
    assert.equal(sent.headers['x-device-key'], KEY);
    assert.equal(sent.headers['x-profile-id'], c.me ? 'p-mom' : undefined);
  });

  await test(`on: ${c.name} goes to the AWS api with the same path, headers and body`, async () => {
    answer = () => ({ body: c.reply });
    assert.deepEqual(await c.run(on.M), c.reply);
    assert.equal(calls.length, 1);
    const [sent] = calls;
    assert.deepEqual([sent.url, sent.method, sent.body], [`${AWS}${c.path}`, c.method, c.body]);
    assert.equal(sent.headers['x-device-key'], KEY);
    assert.equal(sent.headers['x-profile-id'], c.me ? 'p-mom' : undefined);
  });
}

await test('on: nothing reaches Supabase, whatever answers', async () => {
  for (const reply of [{ status: 200, body: null }, { status: 401, body: { error: 'Who are you?' } }, { status: 503, body: 'down' }]) {
    answer = () => reply;
    for (const c of FIVE) await c.run(on.M).catch(() => {});
  }
  assert.ok(calls.length >= 15);
  assert.deepEqual([...new Set(calls.map((x) => x.host))], [AWS]);
});

await test('on: "no ask" is null (the api sends JSON null)', async () => {
  answer = () => ({ body: null });
  assert.equal(await on.M.moveApi.mine(), null);
});

await test('on: a refusal keeps its status for the pop-up (404, 409, 410), in the person\'s words', async () => {
  const cases = [
    [404, { error: 'not_found', message: 'No such request.' }],
    [409, { error: 'answered', message: 'Someone already answered.' }],
    [410, { error: 'gone', message: 'That ask expired.', status: 'expired' }],
  ];
  for (const [status, body] of cases) {
    answer = () => ({ status, body });
    const e = await caught(on.M.moveApi.approve('m1'));
    assert.ok(e instanceof on.M.MoveError, 'a MoveError, as the screens read');
    assert.equal(e.status, status);
    assert.ok(e.message && e.message !== body.error, `words, not the code: ${e.message}`);
  }
  on.API.setApiLanguage('es');
  answer = () => ({ status: 409, body: { error: 'answered', message: 'Someone already answered.' } });
  const es = await caught(on.M.moveApi.decline('m1'));
  on.API.setApiLanguage(null);
  answer = () => ({ status: 409, body: { error: 'answered', message: 'Someone already answered.' } });
  const en = await caught(on.M.moveApi.decline('m1'));
  assert.notEqual(es.message, en.message, 'the person\'s language');
});

await test('on: offline is status 0, as before', async () => {
  answer = () => 'offline';
  const e = await caught(on.M.moveApi.ask('p-dad'));
  assert.deepEqual([e instanceof on.M.MoveError, e.status], [true, 0]);
});

await test('off: refusals and offline read as before (the server\'s sentence; status 0)', async () => {
  answer = () => ({ status: 409, body: { error: 'Someone already answered.' } });
  const e = await caught(off.M.moveApi.approve('m1'));
  assert.deepEqual([e instanceof off.M.MoveError, e.status, e.message], [true, 409, 'Someone already answered.']);
  answer = () => 'offline';
  const o = await caught(off.M.moveApi.mine());
  assert.deepEqual([o.status, o.message], [0, 'Can’t reach your family right now. Try again.']);
});

await test('on: the api\'s own "signed out" signs this phone out once; a gateway 401 never does', async () => {
  let heard = 0;
  on.API.setSignedOutHandler(() => (heard += 1));
  answer = () => ({ status: 401, body: { error: 'unauthorized' } }); // a gateway's, no code of ours
  await caught(on.M.moveApi.list());
  assert.equal(heard, 0);
  answer = () => ({ status: 401, body: { error: 'signed_out', message: 'This phone was signed out.' } });
  await caught(on.M.moveApi.list());
  await caught(on.M.moveApi.list());
  assert.equal(heard, 1);
  on.API.setSignedOutHandler(null);
});

console.log(`\n${passed} passed`);

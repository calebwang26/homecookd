// Unit tests for the 1.1 AWS client (TS run by Node's type stripping, against a fake fetch; no network):
//   src/lib/aws/errors.ts    every error shape staging answers today, and the agreed one, read the same way;
//                            a page that isn't JSON is "unavailable"; retry-after and the 5 s -> 60 s backoff
//   src/lib/aws/client.ts    the two credentials, a session per person shared by concurrent calls, a 401 starting
//                            the session again once, a dead device key heard once, and which calls retry
//   src/lib/aws/accounts.ts  sign-in keeps the key it was given
//   src/lib/api.ts           with the switch on, the screens' calls go to the AWS api with the same paths and
//                            headers; the api's own "signed out" is heard once; a gateway's 401 never signs out
//   src/lib/aws/errorWords.ts the person's own words by code, in their language; an unknown code shows the api's sentence
//   node scripts/test-aws.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});
process.env.EXPO_PUBLIC_BACKEND = 'aws';
process.env.EXPO_PUBLIC_AWS_URL = 'https://api.test/';
const E = await import(pathToFileURL(join(root, 'src/lib/aws/errors.ts')).href);
const C = await import(pathToFileURL(join(root, 'src/lib/aws/client.ts')).href);
const A = await import(pathToFileURL(join(root, 'src/lib/aws/accounts.ts')).href);
const cfg = await import(pathToFileURL(join(root, 'src/lib/aws/config.ts')).href);
const API = await import(pathToFileURL(join(root, 'src/lib/api.ts')).href);
const W = await import(pathToFileURL(join(root, 'src/lib/aws/errorWords.ts')).href);
const WORDS = await import(pathToFileURL(join(root, 'src/lib/words/words.ts')).href);

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

/** A fake api: `routes` maps "METHOD /path" to a list of answers, used in order (the last one repeats). */
function fakeApi(routes) {
  const calls = [];
  const used = {};
  C.setAwsTransportForTests(
    async (url, init) => {
      const path = url.replace('https://api.test', '');
      const key = `${init.method} ${path}`;
      calls.push({ key, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
      const list = routes[key];
      if (!list) return new Response(JSON.stringify({ error: 'no_route', requestId: 'r' }), { status: 404 });
      const i = Math.min(used[key] ?? 0, list.length - 1);
      used[key] = i + 1;
      const a = list[i];
      if (a === 'offline') throw new TypeError('Network request failed');
      const body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? {});
      return new Response(body, { status: a.status ?? 200, headers: a.headers ?? {} });
    },
    async () => {},
  );
  return calls;
}
// A fresh phone each time: a new key drops every session the last test started.
let phones = 0;
const signIn = (deviceKey = `key-${++phones}`, personId = 'p-mom') => C.setAwsCredentials({ deviceKey, personId });
const sess = (token, personId = 'p-mom') => ({ body: { sessionToken: token, familyId: 'f1', personId, role: 'cook' } });
const caught = async (p) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('expected an error');
};

await test('the switch and the address come from EXPO_PUBLIC_BACKEND and EXPO_PUBLIC_AWS_URL, without a trailing slash', () => {
  assert.equal(cfg.AWS_ON, true);
  assert.equal(cfg.AWS_URL, 'https://api.test');
});

await test('the agreed shape: the code from error, the English fallback from message, the request id', () => {
  const e = E.readError(403, JSON.stringify({ error: 'own_phone', message: 'Maya uses their own phone.', requestId: 'abc' }), null);
  assert.deepEqual([e.status, e.code, e.kind, e.message, e.requestId], [403, 'own_phone', 'refused', 'Maya uses their own phone.', 'abc']);
  const bad = E.readError(400, JSON.stringify({ error: 'invalid', field: 'name', requestId: 'x' }), null);
  assert.deepEqual([bad.code, bad.extra], ['invalid', { field: 'name' }]);
});

await test('a body whose error is words, not a code: no code, the words as the fallback', () => {
  const e = E.readError(409, JSON.stringify({ error: 'Something went wrong upstream' }), null);
  assert.deepEqual([e.code, e.message, e.kind], ['', 'Something went wrong upstream', 'refused']);
  const busy = E.readError(503, JSON.stringify({ error: 'unavailable', message: 'Busy.' }), '7');
  assert.deepEqual([busy.code, busy.kind, busy.retryAfterS], ['unavailable', 'unavailable', 7]);
});

await test('a page that is not JSON, or a gateway error, is "unavailable", whatever its status', () => {
  for (const status of [502, 503, 504, 403]) {
    const e = E.readError(status, '<html><body>503 Service Temporarily Unavailable</body></html>', null);
    assert.deepEqual([e.code, e.kind], ['unavailable', 'unavailable'], String(status));
  }
});

await test('no_route means down (an older api), not gone; not_found means gone', () => {
  assert.equal(E.readError(404, JSON.stringify({ error: 'no_route' }), null).kind, 'unavailable');
  assert.equal(E.readError(404, JSON.stringify({ error: 'not_found' }), null).kind, 'refused');
});

await test("staging's not-moved answers are refusals: retrying won't help", () => {
  assert.equal(E.readError(503, JSON.stringify({ error: 'accounts_not_moved' }), null).kind, 'refused');
  assert.equal(E.readError(501, JSON.stringify({ error: 'not_moved' }), null).kind, 'refused');
});

await test('backoff: retry-after when given, else 5 s doubling to 60 s, spread by ±20%', () => {
  const mid = () => 0.5;
  assert.equal(E.retryDelayMs(E.readError(503, '{"error":"unavailable"}', '12'), 0), 12_000);
  assert.deepEqual([0, 1, 2, 3, 4, 9].map((n) => E.retryDelayMs(null, n, mid)), [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
  assert.equal(E.retryDelayMs(null, 0, () => 0), 4_000);
  assert.equal(E.retryDelayMs(null, 0, () => 1), 6_000);
});

await test('family routes send the device key and x-profile-id, never a Bearer; /v1 sends only the Bearer', async () => {
  signIn();
  const calls = fakeApi({
    'GET /family': [{ body: { family: { id: 'f1', name: "Asha's family" }, profiles: [], former_profiles: [], device_profile_id: 'p-mom' } }],
    'POST /v1/sessions/start': [sess('t1')],
    'GET /v1/me': [{ body: { person: { id: 'p-mom', name: 'Asha', role: 'cook', language: null }, family: { id: 'f1', name: 'x' } } }],
  });
  await A.accounts.family('p-mom');
  await A.accounts.me();
  const [fam, start, me] = calls;
  assert.match(fam.headers['x-device-key'], /^key-\d+$/);
  assert.equal(fam.headers['x-profile-id'], 'p-mom');
  assert.equal(fam.headers.authorization, undefined);
  assert.deepEqual(start.body, { deviceKey: fam.headers['x-device-key'], profileId: 'p-mom' });
  assert.equal(start.headers['x-device-key'], undefined, 'sessions/start carries the key in its body only');
  assert.equal(me.headers.authorization, 'Bearer t1');
  assert.equal(me.headers['x-device-key'], undefined);
  assert.match(me.headers['x-request-id'], /^[A-Za-z0-9-]{8,64}$/);
});

await test('a POST with nothing to say sends {} with the JSON content type', async () => {
  signIn();
  const calls = fakeApi({ 'POST /join-links': [{ body: { url: 'https://homecookd.app/i?t=x', expires_at: null } }] });
  await A.accounts.joinLink('p-mom');
  assert.deepEqual(calls[0].body, {});
  assert.equal(calls[0].headers['content-type'], 'application/json');
});

await test('concurrent calls share one session start; a phone-less person gets their own session', async () => {
  signIn();
  const calls = fakeApi({
    'POST /v1/sessions/start': [sess('t-mom'), sess('t-nani', 'p-nani')],
    'GET /v1/me': [{ body: {} }],
  });
  await Promise.all([A.accounts.me(), A.accounts.me(), A.accounts.me()]);
  await A.accounts.me('p-nani');
  const starts = calls.filter((c) => c.key === 'POST /v1/sessions/start');
  assert.deepEqual(starts.map((c) => c.body.profileId), ['p-mom', 'p-nani']);
  assert.equal(calls.at(-1).headers.authorization, 'Bearer t-nani');
});

await test("a /v1 401 starts the session again once and repeats the call once", async () => {
  signIn();
  const calls = fakeApi({
    'POST /v1/sessions/start': [sess('old'), sess('new')],
    'GET /v1/me': [{ status: 401, body: { error: 'signed_out' } }, { body: { ok: 1 } }],
  });
  assert.deepEqual(await A.accounts.me(), { ok: 1 });
  assert.deepEqual(calls.map((c) => c.key), ['POST /v1/sessions/start', 'GET /v1/me', 'POST /v1/sessions/start', 'GET /v1/me']);
  assert.equal(calls[3].headers.authorization, 'Bearer new');
});

await test('a dead device key is heard once, and the phone forgets its key and sessions', async () => {
  signIn();
  let heard = 0;
  const off = C.onDeadKey(() => (heard += 1));
  fakeApi({
    'POST /v1/sessions/start': [sess('t1'), { status: 401, body: { error: 'This phone was signed out.' } }],
    'GET /v1/me': [{ status: 401, body: { error: 'signed_out' } }],
  });
  const e = await caught(A.accounts.me());
  assert.equal(e.kind, 'signed_out');
  assert.equal(heard, 1);
  assert.equal(C.awsPersonId(), null);
  const again = await caught(A.accounts.family());
  assert.equal(again.kind, 'signed_out', 'no key is sent once it died');
  off();
});

await test('a 401 on a family route kills the key too', async () => {
  signIn();
  let heard = 0;
  const off = C.onDeadKey(() => (heard += 1));
  fakeApi({ 'GET /family': [{ status: 401, body: { error: 'This phone was signed out.' } }] });
  await caught(A.accounts.family());
  assert.equal(heard, 1);
  off();
});

await test('reads try once more when the api is down; then the caller keeps what it had', async () => {
  signIn();
  const calls = fakeApi({ 'GET /family': [{ status: 503, body: '<html>down</html>' }, { body: { profiles: [] } }] });
  assert.deepEqual(await A.accounts.family(), { profiles: [] });
  assert.equal(calls.length, 2);
  fakeApi({ 'GET /family': [{ status: 503, body: '<html>down</html>' }] });
  assert.equal((await caught(A.accounts.family())).kind, 'unavailable');
});

await test('a write without an Idempotency-Key never repeats on a 500 or a lost answer, only when nothing was written', async () => {
  signIn();
  let calls = fakeApi({ 'POST /profiles': [{ status: 500, body: { error: 'server_error' } }, { body: {} }] });
  assert.equal((await caught(A.accounts.addPerson({ name: 'Nani', role: 'cook' }))).kind, 'server');
  assert.equal(calls.length, 1);
  calls = fakeApi({ 'POST /profiles': ['offline', { body: {} }] });
  assert.equal((await caught(A.accounts.addPerson({ name: 'Nani', role: 'cook' }))).kind, 'network');
  assert.equal(calls.length, 1);
  calls = fakeApi({ 'POST /profiles': [{ status: 503, body: { error: 'unavailable' }, headers: { 'retry-after': '6' } }, { body: { id: 'p-nani' } }] });
  assert.deepEqual(await A.accounts.addPerson({ name: 'Nani', role: 'cook' }), { id: 'p-nani' });
  assert.equal(calls.length, 2);
});

await test('a write with its Idempotency-Key repeats with the same key', async () => {
  signIn();
  const calls = fakeApi({
    'POST /v1/sessions/start': [sess('t1')],
    'POST /v1/thing': [{ status: 500, body: { error: 'server_error' } }, { body: { ok: true } }],
  });
  await C.request('/v1/thing', { auth: 'session', body: { a: 1 }, idempotencyKey: 'idem-12345' });
  const writes = calls.filter((c) => c.key === 'POST /v1/thing');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map((c) => c.headers['idempotency-key']), ['idem-12345', 'idem-12345']);
});

await test('a retry-after longer than 15 s is left to the caller', async () => {
  signIn();
  const calls = fakeApi({ 'GET /family': [{ status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '60' } }] });
  const e = await caught(A.accounts.family());
  assert.deepEqual([e.code, e.retryAfterS, calls.length], ['rate_limited', 60, 1]);
});

await test('signing in keeps the key it was given; a needs_name answer keeps nothing', async () => {
  C.setAwsCredentials({ deviceKey: null, personId: null });
  fakeApi({ 'POST /auth/apple': [{ body: { existing: false, needs_name: true, suggested_name: null } }] });
  await A.signInWithApple('apple-token');
  assert.equal(C.awsPersonId(), null);
  const calls = fakeApi({
    'POST /auth/apple': [{ body: { existing: false, needs_name: false, joined: false, device_key: 'key-new', family_name: "Asha's family", profile_id: 'p-asha' } }],
  });
  await A.signInWithApple('apple-token', { name: 'Asha', role: 'cook' });
  assert.deepEqual(calls[0].body, { id_token: 'apple-token', name: 'Asha', role: 'cook' });
  assert.equal(calls[0].headers['x-device-key'], undefined);
  assert.equal(C.awsPersonId(), 'p-asha');
});

await test("a gateway's 401 page never signs the phone out; the api's own word does", async () => {
  signIn();
  let heard = 0;
  const off = C.onDeadKey(() => (heard += 1));
  fakeApi({ 'GET /family': [{ status: 401, body: '<html>401 Authorization Required</html>' }] });
  assert.equal((await caught(A.accounts.family())).kind, 'unavailable');
  fakeApi({ 'GET /family': [{ status: 401, body: { error: 'Missing family code (x-family-code header)' } }] });
  await caught(A.accounts.family());
  assert.equal(heard, 0, 'a 401 that is not the api saying the key is gone');
  fakeApi({ 'GET /family': [{ status: 401, body: { error: 'signed_out', requestId: 'r' } }] });
  await caught(A.accounts.family());
  assert.equal(heard, 1);
  off();
});

await test('switch on: the screens\' calls go to the AWS api with the phone key, and the person where a route needs one', async () => {
  API.setApiAuth({ deviceKey: 'aws-key-1', code: null, profileId: 'p-mom' });
  const calls = fakeApi({
    'GET /family': [{ body: { family: { id: 'f1', name: 'x' }, profiles: [] } }],
    'POST /join-links': [{ body: { url: 'https://homecookd.app/i?t=x', expires_at: null } }],
  });
  await API.api.family();
  await API.api.joinLink();
  assert.equal(calls[0].headers['x-device-key'], 'aws-key-1');
  assert.equal(calls[0].headers['x-profile-id'], undefined, 'the family loads for the phone, as on Supabase');
  assert.equal(calls[1].headers['x-profile-id'], 'p-mom');
  assert.deepEqual(calls[1].body, {});
});

await test('error words: by code in her language, by kind when the code is new, else the api\'s sentence', () => {
  const ta = WORDS.wordsFor('ta');
  const full = E.readError(409, JSON.stringify({ error: 'full', message: 'Every seat is taken.' }), null);
  assert.equal(W.errorWords(full), 'Every seat is taken.');
  assert.equal(W.errorWords(full, ta), ta('errors.full'));
  assert.equal(W.errorWords(E.readError(404, '{"error":"no_route"}', null)), W.errorWords(E.readError(503, '<html/>', null)), 'no_route reads as down');
  assert.equal(W.errorWords(E.readError(409, JSON.stringify({ error: 'brand_new_code', message: 'A new refusal.' }), null)), 'A new refusal.');
  assert.equal(W.errorWords(E.readError(409, JSON.stringify({ error: 'Nani is already in this family' }), null)), 'Nani is already in this family');
  assert.equal(W.errorWords(E.readError(429, JSON.stringify({ error: 'rate_limited' }), '5')), WORDS.english('errors.rate_limited'));
  assert.equal(W.errorWords(E.networkError(true)), WORDS.english('errors.timeout'));
});

// Every code the api can send (docs/build/contracts/ERROR-CODES.md on aws-migration, Nov 2), less the one no phone sees.
const API_CODES = `invalid family_full signed_out sign_in_failed forbidden removed_from_family own_phone account_deleted not_in_family
  only_self link_full ticket_expired origin other_left not_a_guest not_asked_of_you not_found no_route conflict name_taken
  idempotency_conflict retry link_used already_joined already_on_card answered already_delivered already_asked full own_family
  not_shared declined closed gone live_off too_large bad_type words not_a_dish update_app rate_limited budget server_error
  not_moved provider_down unavailable not_set_up accounts_not_moved`.split(/\s+/);

await test('every code the api can send has the app\'s own words, never the api\'s English', () => {
  for (const code of API_CODES) {
    const e = E.readError(400, JSON.stringify({ error: code, message: 'API ENGLISH' }), null);
    assert.notEqual(W.errorWords(e), 'API ENGLISH', code);
  }
});

await test('a setting missing on the server is a refusal: waiting won\'t help', () => {
  assert.equal(E.readError(503, JSON.stringify({ error: 'not_set_up' }), null).kind, 'refused');
  assert.equal(E.readError(503, JSON.stringify({ error: 'provider_down' }), null).kind, 'unavailable');
});

await test('switch on: a refusal with a code reads in her language; the session still sees the code', async () => {
  API.setApiAuth({ deviceKey: 'aws-key-5', code: null, profileId: 'p-mom' });
  API.setApiLanguage('hi');
  fakeApi({ 'POST /profiles': [{ status: 409, body: { error: 'name_taken', message: 'Nani is already in this family', requestId: 'r' } }] });
  const e = await caught(API.api.createProfile({ name: 'Nani', role: 'cook' }));
  assert.equal(e.message, WORDS.wordsFor('hi')('errors.name_taken'));
  assert.equal(e.body.error, 'name_taken');
  API.setApiLanguage(null);
});

await test("switch on: the api's sentence comes back as the ApiError screens already show", async () => {
  API.setApiAuth({ deviceKey: 'aws-key-2', code: null, profileId: 'p-mom' });
  fakeApi({ 'POST /profiles': [{ status: 409, body: { error: 'Nani is already in this family', requestId: 'r' } }] });
  const e = await caught(API.api.createProfile({ name: 'Nani', role: 'cook' }));
  assert.equal(e.name, 'ApiError');
  assert.deepEqual([e.status, e.message], [409, 'Nani is already in this family']);
  assert.equal(API.errorMessage(e), 'Nani is already in this family');
});

await test('switch on: "This phone was signed out." tells the session once, and the key is dropped', async () => {
  API.setApiAuth({ deviceKey: 'aws-key-3', code: null, profileId: 'p-mom' });
  const told = [];
  API.setSignedOutHandler((m) => told.push(m));
  fakeApi({ 'GET /family': [{ status: 401, body: { error: 'This phone was signed out.', requestId: 'r' } }] });
  await caught(API.api.family());
  assert.deepEqual(told, ['This phone was signed out.']);
  assert.equal(API.getApiAuth().key, null);
  API.setSignedOutHandler(null);
});

await test('switch on: acting as someone who now uses their own phone lets them go', async () => {
  API.setApiAuth({ deviceKey: 'aws-key-4', code: null, profileId: 'p-leo' });
  const gone = [];
  API.setProfileRemovedHandler((id) => gone.push(id));
  fakeApi({ 'POST /join-links': [{ status: 403, body: { error: 'Leo uses their own phone.', requestId: 'r' } }] });
  await caught(API.api.joinLink());
  assert.deepEqual(gone, ['p-leo']);
  API.setProfileRemovedHandler(null);
});

console.log(`\n${passed} passed`);

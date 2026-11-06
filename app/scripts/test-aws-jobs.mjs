// Unit tests for the 1.1 Jobs client (TS run by Node's type stripping, against a fake fetch and clock; no network):
//   src/lib/aws/jobs.ts   each route's path, body and Idempotency-Key; checking videos before asking for links;
//                         a PARTS video's byte ranges; recipes paged to the end
//   src/lib/aws/dish.ts   her requests read to the last page, one by id, her day, her link, the voice recipe's steps;
//                         a job for a kid's card carries its dishAskId
//   src/lib/aws/live.ts   one poll per topic and person shared by every watcher, waiting pollAfterMs, keeping the
//                         last value through a failure and backing off, pausing in the background, and stopping
//                         for good on signed_out / removed_from_family / live_off
//   node scripts/test-aws-jobs.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});
process.env.EXPO_PUBLIC_BACKEND = 'aws';
process.env.EXPO_PUBLIC_AWS_URL = 'https://api.test';
const C = await import(pathToFileURL(join(root, 'src/lib/aws/client.ts')).href);
const J = await import(pathToFileURL(join(root, 'src/lib/aws/jobs.ts')).href);
const L = await import(pathToFileURL(join(root, 'src/lib/aws/live.ts')).href);
const D = await import(pathToFileURL(join(root, 'src/lib/aws/dish.ts')).href);

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

/** A fake api: "METHOD /path" -> answers in order (the last repeats); a function answer gets the call. */
function fakeApi(routes) {
  const calls = [];
  const used = {};
  C.setAwsTransportForTests(
    async (url, init) => {
      const path = url.replace('https://api.test', '');
      const bare = path.split('?')[0];
      const key = `${init.method} ${bare}`;
      const call = { key, path, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const list = routes[key] ?? routes[`${init.method} ${path}`];
      if (!list) return new Response(JSON.stringify({ error: 'no_route' }), { status: 404 });
      const i = Math.min(used[key] ?? 0, list.length - 1);
      used[key] = i + 1;
      let a = list[i];
      if (typeof a === 'function') a = a(call);
      return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200, headers: a.headers ?? {} });
    },
    async () => {},
  );
  return calls;
}
let phones = 0;
const signIn = () => C.setAwsCredentials({ deviceKey: `key-${++phones}`, personId: 'p-mom' });
const session = { 'POST /v1/sessions/start': [{ body: { sessionToken: 't', familyId: 'f', personId: 'p-mom', role: 'cook' } }] };

// A fake clock for the polls: timers run when the test says.
let timers = [];
L.setLiveTimersForTests(
  (fn, ms) => {
    const t = { fn, ms };
    timers.push(t);
    return t;
  },
  (t) => (timers = timers.filter((x) => x !== t)),
);
const flush = () => new Promise((r) => setTimeout(r, 0));
const runNext = async () => {
  const t = timers.shift();
  assert.ok(t, 'a poll is waiting');
  t.fn();
  await flush();
  await flush();
  return t.ms;
};

await test('a new upload: the videos, and the Idempotency-Key saved before the call', async () => {
  signIn();
  const calls = fakeApi({ ...session, 'POST /v1/video-uploads': [{ status: 201, body: { uploadId: 'u1', uploadPath: 'u1/', uploads: [], expiresInS: 21600 } }] });
  const a = await J.jobs.newUpload([{ contentType: 'video/quicktime', size: 1234, durationS: 61 }], 'idem-upload-0001');
  const call = calls.find((c) => c.key === 'POST /v1/video-uploads');
  assert.deepEqual(call.body, { videos: [{ contentType: 'video/quicktime', size: 1234, durationS: 61 }] });
  assert.equal(call.headers['idempotency-key'], 'idem-upload-0001');
  assert.equal(call.headers.authorization, 'Bearer t');
  assert.equal(a.uploadId, 'u1');
});

await test('the job says source phone and takes uploadId, the dish, the kids and the language', async () => {
  signIn();
  const calls = fakeApi({ ...session, 'POST /v1/jobs': [{ status: 201, body: { jobId: 'j1', recipeId: null } }] });
  await J.jobs.create({ uploadId: 'u1', title: 'Dal', language: 'hi', forKidIds: ['p-leo'] });
  assert.deepEqual(calls.at(-1).body, { uploadId: 'u1', title: 'Dal', language: 'hi', forKidIds: ['p-leo'], source: 'phone' });
});

await test('links, parts, finish, complete and both cancels go to their paths with their bodies', async () => {
  signIn();
  const calls = fakeApi({
    ...session,
    'POST /v1/video-uploads/u%201/links': [{ body: { uploads: [] } }],
    'POST /v1/video-uploads/u%201/parts': [{ body: { parts: [] } }],
    'POST /v1/video-uploads/u%201/parts/finish': [{ body: { finished: true } }],
    'POST /v1/video-uploads/u%201/complete': [{ body: { complete: false, missing: [2], cancelled: false, job: null } }],
    'POST /v1/video-uploads/u%201/cancel': [{ body: { stopped: false } }],
    'POST /v1/jobs/j1/cancel': [{ body: { stopped: true } }],
  });
  await J.jobs.links('u 1');
  await J.jobs.parts('u 1', 2, [1, 2, 3]);
  await J.jobs.finishParts('u 1', 2, [{ partNumber: 1, etag: '"abc"' }]);
  assert.deepEqual((await J.jobs.complete('u 1')).missing, [2]);
  await J.jobs.cancelUpload('u 1');
  assert.deepEqual(await J.jobs.cancel('j1'), { stopped: true });
  const own = calls.filter((c) => !c.key.includes('sessions'));
  assert.deepEqual(own.map((c) => c.body), [{}, { index: 2, partNumbers: [1, 2, 3] }, { index: 2, parts: [{ partNumber: 1, etag: '"abc"' }] }, {}, {}, {}]);
});

await test('checking videos before asking: 1 to 20, video/*, 1 byte to 20 GiB, 4 hours in all', () => {
  const v = (o = {}) => ({ contentType: 'video/mp4', size: 10, durationS: 60, ...o });
  assert.equal(J.checkVideos([v()]), null);
  assert.equal(J.checkVideos([]), 'count');
  assert.equal(J.checkVideos(Array.from({ length: 21 }, () => v())), 'count');
  assert.equal(J.checkVideos([v({ contentType: 'image/jpeg' })]), 'type');
  assert.equal(J.checkVideos([v({ size: 0 })]), 'size', 'the old fileSizeFor fallback of 0 is refused');
  assert.equal(J.checkVideos([v({ size: 21_474_836_481 })]), 'size');
  assert.equal(J.checkVideos([v({ durationS: 7200 }), v({ durationS: 7201 })]), 'length');
});

await test("a PARTS video's ranges: each partBytes long but the last", () => {
  const size = 25 * 1024 * 1024;
  const pb = 5 * 1024 * 1024;
  const n = Math.ceil(size / pb);
  const ranges = Array.from({ length: n }, (_, i) => J.partRange(size, pb, i + 1));
  assert.equal(ranges.length, 5);
  assert.deepEqual(ranges[0], { start: 0, end: pb });
  assert.equal(ranges.at(-1).end, size);
  assert.equal(ranges.reduce((s, r) => s + (r.end - r.start), 0), size);
  assert.deepEqual(J.partRange(11, 5, 3), { start: 10, end: 11 }, 'a short last part');
});

await test('recipes are read to the last page', async () => {
  signIn();
  const calls = fakeApi({
    ...session,
    'GET /v1/recipes': [{ body: { recipes: [{ _id: 'r1' }, { _id: 'r2' }], nextCursor: 'c2' } }, { body: { recipes: [{ _id: 'r3' }], nextCursor: null } }],
  });
  assert.deepEqual((await J.recipes.all()).map((r) => r._id), ['r1', 'r2', 'r3']);
  assert.deepEqual(calls.filter((c) => c.key === 'GET /v1/recipes').map((c) => c.path), ['/v1/recipes', '/v1/recipes?cursor=c2']);
});

await test('one poll per topic and person, shared: a second watcher gets the last value at once', async () => {
  signIn();
  timers = [];
  const jobsA = [{ _id: 'j1', stage: 'queued', progress: 0, uploadPath: 'u1/', source: 'phone' }];
  const calls = fakeApi({ ...session, 'GET /v1/live/jobs': [{ body: { changed: true, version: 'v1', pollAfterMs: 5000, data: jobsA } }] });
  const seenA = [];
  const seenB = [];
  const offA = L.watchTopic('jobs', (d) => seenA.push(d));
  await flush();
  await flush();
  const offB = L.watchTopic('jobs', (d) => seenB.push(d));
  assert.equal(calls.filter((c) => c.key === 'GET /v1/live/jobs').length, 1, 'the second watcher does not poll again');
  assert.deepEqual([seenA.length, seenB.length], [1, 1]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5000, 'it waits pollAfterMs');
  offA();
  offB();
  assert.equal(timers.length, 0, 'the poll stops with the last watcher');
});

await test('it sends the last version as since, and an unchanged answer tells nobody', async () => {
  signIn();
  timers = [];
  const calls = fakeApi({
    ...session,
    'GET /v1/live/jobs': [
      { body: { changed: true, version: 'v1', pollAfterMs: 5000, data: [] } },
      { body: { changed: false, version: 'v1', pollAfterMs: 30000 } },
    ],
  });
  const seen = [];
  const off = L.watchTopic('jobs', (d) => seen.push(d));
  await flush();
  await flush();
  assert.equal(await runNext(), 5000);
  const polls = calls.filter((c) => c.key === 'GET /v1/live/jobs');
  assert.deepEqual(polls.map((c) => c.path), ['/v1/live/jobs?since=', '/v1/live/jobs?since=v1']);
  assert.equal(seen.length, 1);
  assert.equal(timers[0].ms, 30000);
  off();
});

await test('a failed poll keeps what was there and backs off with retry-after', async () => {
  signIn();
  timers = [];
  fakeApi({
    ...session,
    'GET /v1/live/jobs': [
      { body: { changed: true, version: 'v1', pollAfterMs: 5000, data: ['first'] } },
      { status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '20' } },
    ],
  });
  const seen = [];
  const off = L.watchTopic('jobs', (d) => seen.push(d));
  await flush();
  await flush();
  await runNext();
  assert.deepEqual(seen, [['first']], 'nothing new was made up');
  assert.equal(timers[0].ms, 20000);
  off();
});

await test('live_off and removed_from_family stop the poll for good, and the screen hears why', async () => {
  for (const [status, code] of [
    [410, 'live_off'],
    [403, 'removed_from_family'],
  ]) {
    signIn();
    timers = [];
    fakeApi({ ...session, 'GET /v1/live/jobs': [{ status, body: { error: code } }] });
    const why = [];
    L.watchTopic('jobs', () => {}, { onStop: (w) => why.push(w) });
    await flush();
    await flush();
    assert.deepEqual(why, [code]);
    assert.equal(timers.length, 0, `${code}: no more polls`);
  }
});

await test('in the background it waits; coming to the front asks at once', async () => {
  signIn();
  timers = [];
  let active = false;
  const front = L.setForeground(() => active);
  const calls = fakeApi({ ...session, 'GET /v1/live/jobs': [{ body: { changed: true, version: 'v1', pollAfterMs: 5000, data: [] } }] });
  const off = L.watchTopic('jobs', () => {});
  await flush();
  assert.equal(calls.filter((c) => c.key === 'GET /v1/live/jobs').length, 0, 'no poll in the background');
  active = true;
  front.changed();
  await flush();
  await flush();
  assert.equal(calls.filter((c) => c.key === 'GET /v1/live/jobs').length, 1);
  off();
  L.setForeground(() => true);
});

await test("a phone-less person's watch is its own poll, with her own session", async () => {
  signIn();
  timers = [];
  const calls = fakeApi({
    'POST /v1/sessions/start': [(c) => ({ body: { sessionToken: `t-${c.body.profileId}`, familyId: 'f', personId: c.body.profileId, role: 'cook' } })],
    'GET /v1/live/jobs': [{ body: { changed: true, version: 'v', pollAfterMs: 5000, data: [] } }],
  });
  const offMom = L.watchTopic('jobs', () => {});
  const offNani = L.watchTopic('jobs', () => {}, { as: 'p-nani' });
  await flush();
  await flush();
  const auths = calls.filter((c) => c.key === 'GET /v1/live/jobs').map((c) => c.headers.authorization).sort();
  assert.deepEqual(auths, ['Bearer t-p-mom', 'Bearer t-p-nani']);
  offMom();
  offNani();
});

await test("her requests: every page, one by id, her day, her link, the voice recipe's two calls", async () => {
  signIn();
  const calls = fakeApi({
    ...session,
    'GET /v1/cravings': [{ body: { asks: [{ id: 'a1' }], nextCursor: 'c' } }, { body: { asks: [{ id: 'a2' }], nextCursor: null } }],
    'GET /v1/cravings/a%201': [{ body: { id: 'a 1' } }],
    'POST /v1/cravings/a1/filming-day': [{ body: { ok: true } }],
    'POST /v1/cravings/link': [{ body: { url: 'https://x/miss?c=abc' } }],
    'POST /v1/cravings/a1/voice-recipe/upload': [{ status: 201, body: { audioKey: 'private/dish/k', uploadUrl: 'https://s3', uploadHeaders: {} } }],
    'POST /v1/cravings/a1/voice-recipe': [{ body: { ok: true } }],
  });
  assert.deepEqual((await D.cravings.all()).map((a) => a.id), ['a1', 'a2']);
  assert.equal((await D.cravings.get('a 1')).id, 'a 1');
  await D.cravings.filmingDay('a1', null);
  await D.cravings.link();
  const up = await D.cravings.voiceUpload('a1', 'audio/mp4', 4096);
  await D.cravings.voiceRecipe('a1', { audioKey: up.audioKey, durationS: 5 });
  const bodies = calls.filter((c) => c.key.startsWith('POST /v1/cravings')).map((c) => c.body);
  assert.deepEqual(bodies, [{ day: null }, {}, { contentType: 'audio/mp4', size: 4096 }, { audioKey: 'private/dish/k', durationS: 5 }]);
});

await test("a job for a kid's card carries its dishAskId", async () => {
  signIn();
  const calls = fakeApi({ ...session, 'POST /v1/jobs': [{ status: 201, body: { jobId: 'j', recipeId: null } }] });
  await J.jobs.create({ uploadId: 'u1', title: 'Tomato egg', dishAskId: 'card-1' });
  assert.equal(calls.at(-1).body.dishAskId, 'card-1');
});

console.log(`\n${passed} passed`);

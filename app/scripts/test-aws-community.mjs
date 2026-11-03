// Unit tests for the 1.1 Community client (TS run by Node's type stripping, against a fake fetch; no network):
//   src/lib/aws/community.ts  the feed read through every recipe page and on through `dinnersCursor`; a new dinner's
//                             Idempotency-Key; report and block bodies; unblock as a DELETE with no body; lists to
//                             their last page; the public invite open with no session
//   node scripts/test-aws-community.mjs
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
const K = await import(pathToFileURL(join(root, 'src/lib/aws/community.ts')).href);

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
function fakeApi(routes) {
  const calls = [];
  const used = {};
  C.setAwsTransportForTests(
    async (url, init) => {
      const path = url.replace('https://api.test', '');
      const call = { key: `${init.method} ${path.split('?')[0]}`, path, method: init.method, headers: init.headers, body: init.body };
      calls.push(call);
      const list = routes[call.key];
      if (!list) return new Response(JSON.stringify({ error: 'no_route' }), { status: 404 });
      const i = Math.min(used[call.key] ?? 0, list.length - 1);
      used[call.key] = i + 1;
      const a = list[i];
      return new Response(JSON.stringify(a.body ?? {}), { status: a.status ?? 200 });
    },
    async () => {},
  );
  return calls;
}
let phones = 0;
const signIn = () => C.setAwsCredentials({ deviceKey: `key-${++phones}`, personId: 'p-mom' });
const session = { 'POST /v1/sessions/start': [{ body: { sessionToken: 't', familyId: 'f', personId: 'p-mom', role: 'cook' } }] };
const own = (calls) => calls.filter((c) => !c.key.includes('sessions'));

await test('the feed: every recipe page, then the dinners on through dinnersCursor', async () => {
  signIn();
  const calls = fakeApi({
    ...session,
    'GET /v1/community/feed': [
      { body: { here: { lat: 1, lng: 2 }, recipes: [{ recipeId: 'r1' }], dinners: [{ dinnerId: 'd1' }], nextCursor: 'rc', dinnersCursor: 'dc' } },
      { body: { here: { lat: 1, lng: 2 }, recipes: [{ recipeId: 'r2' }], dinners: [{ dinnerId: 'd1' }], nextCursor: null, dinnersCursor: 'dc' } },
    ],
    'GET /v1/community/dinners': [{ body: { dinners: [{ dinnerId: 'd2' }], nextCursor: null } }],
  });
  const feed = await K.community.feed(5);
  assert.deepEqual(feed.recipes.map((r) => r.recipeId), ['r1', 'r2']);
  assert.deepEqual(feed.dinners.map((d) => d.dinnerId), ['d1', 'd2']);
  assert.deepEqual(feed.here, { lat: 1, lng: 2 });
  assert.ok(own(calls)[0].path.includes('maxMiles=5'));
});

await test('a new dinner carries its Idempotency-Key and its body as given', async () => {
  signIn();
  const calls = fakeApi({ ...session, 'POST /v1/dinners': [{ status: 201, body: { dinnerId: 'd1' } }] });
  const dinner = { recipeId: 'r1', startsAt: 1, placeName: 'Kitchen', address: '1 St', seats: 2 };
  assert.equal((await K.community.createDinner(dinner, 'dinner-key-0001')).dinnerId, 'd1');
  const c = own(calls)[0];
  assert.equal(c.headers['idempotency-key'], 'dinner-key-0001');
  assert.deepEqual(JSON.parse(c.body), dinner);
});

await test('report and block bodies; unblock is a DELETE with no body', async () => {
  signIn();
  const calls = fakeApi({
    ...session,
    'POST /v1/community/reports': [{ body: { ok: true } }],
    'POST /v1/community/blocks': [{ body: { ok: true } }],
    'DELETE /v1/community/blocks/b%201': [{ body: { ok: true } }],
  });
  await K.community.report('dinner', 'd1', 'rude');
  await K.community.block('recipe', 'r1');
  await K.community.unblock('b 1');
  const [rep, blk, del] = own(calls);
  assert.deepEqual(JSON.parse(rep.body), { kind: 'dinner', targetId: 'd1', reason: 'rude' });
  assert.deepEqual(JSON.parse(blk.body), { kind: 'recipe', targetId: 'r1' });
  assert.deepEqual([del.method, del.body, del.headers['content-type']], ['DELETE', undefined, undefined]);
});

await test('swaps, my dinners and the blocked list read to their last page', async () => {
  signIn();
  fakeApi({
    ...session,
    'GET /v1/community/swaps': [{ body: { swaps: [{ swapId: 's1' }], nextCursor: 'c' } }, { body: { swaps: [{ swapId: 's2' }], nextCursor: null } }],
    'GET /v1/dinners/mine': [{ body: { dinners: [{ dinnerId: 'd1' }], nextCursor: null } }],
    'GET /v1/community/blocks': [{ body: { blocked: [{ blockId: 'b1', familyName: 'A family' }], nextCursor: null } }],
  });
  assert.deepEqual((await K.community.swaps()).map((s) => s.swapId), ['s1', 's2']);
  assert.deepEqual((await K.community.myDinners()).map((d) => d.dinnerId), ['d1']);
  assert.deepEqual(await K.community.blocked(), [{ blockId: 'b1', familyName: 'A family' }]);
});

await test('opening an invite needs no session, and joining sends {}', async () => {
  signIn();
  const calls = fakeApi({ ...session, 'POST /invite/open': [{ body: { dish: 'Poha', hostName: 'Leo', startsAt: 1 } }], 'POST /v1/dinners/d1/join': [{ body: { requestId: 'q' } }] });
  await K.community.openInvite('t'.repeat(43), 'device-0000000001');
  await K.community.join('d1');
  const [open, ...rest] = calls;
  assert.equal(open.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(open.body), { token: 't'.repeat(43), deviceId: 'device-0000000001' });
  assert.equal(rest.at(-1).body, '{}');
});

console.log(`\n${passed} passed`);

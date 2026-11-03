// Unit tests for the 1.1 Messages client (TS run by Node's type stripping, against a fake fetch and clock; no network):
//   src/lib/aws/messages.ts  each route's path, body and Idempotency-Key; lists read to their last page; a thread
//                            read since `after` paging back and kept in order; uploads checked before asking; push
//                            tokens always as the phone's own person; the table's x-tz header
//   src/lib/aws/legacy.ts    with the switch on, the screens' api.* calls answered by AWS in today's shapes:
//                            snake_case, a kid as "learner", a send's fields renamed and keyed
//   src/lib/aws/live.ts      watchRead: one shared poll per key, every everyMs, the last value handed to the reader
//                            (for an `after` cursor), only in front, and stopping on signed_out
//   node scripts/test-aws-messages.mjs
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
const M = await import(pathToFileURL(join(root, 'src/lib/aws/messages.ts')).href);
const L = await import(pathToFileURL(join(root, 'src/lib/aws/live.ts')).href);
const API = await import(pathToFileURL(join(root, 'src/lib/api.ts')).href);

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

/** A fake api: "METHOD /path" (with or without its query) -> answers in order (the last repeats); a function gets the call. */
function fakeApi(routes) {
  const calls = [];
  const used = {};
  C.setAwsTransportForTests(
    async (url, init) => {
      const path = url.replace('https://api.test', '');
      const call = { key: `${init.method} ${path.split('?')[0]}`, path, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const k = routes[`${init.method} ${path}`] ? `${init.method} ${path}` : call.key;
      const list = routes[k];
      if (!list) return new Response(JSON.stringify({ error: 'no_route' }), { status: 404 });
      const i = Math.min(used[k] ?? 0, list.length - 1);
      used[k] = i + 1;
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
const session = { 'POST /v1/sessions/start': [(c) => ({ body: { sessionToken: `t-${c.body.profileId}`, familyId: 'f', personId: c.body.profileId, role: 'cook' } })] };
const own = (calls) => calls.filter((c) => !c.key.includes('sessions'));

let timers = [];
L.setLiveTimersForTests(
  (fn, ms) => {
    const t = { fn, ms };
    timers.push(t);
    return t;
  },
  (t) => (timers = timers.filter((x) => x !== t)),
);
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

await test('a message to a thread carries its Idempotency-Key and its body as given', async () => {
  signIn();
  const calls = fakeApi({ ...session, 'POST /v1/threads/th%201/messages': [{ body: { id: 'm1', kind: 'question' } }] });
  await M.messages.send('th 1', { kind: 'question', libraryId: 'dal', stepOrder: 2, body: 'How much salt?' }, 'idem-msg-0001');
  const c = own(calls)[0];
  assert.equal(c.headers['idempotency-key'], 'idem-msg-0001');
  assert.deepEqual(c.body, { kind: 'question', libraryId: 'dal', stepOrder: 2, body: 'How much salt?' });
});

await test('lists are read to their last page: threads, open questions, notes, favorites', async () => {
  signIn();
  fakeApi({
    ...session,
    'GET /v1/threads': [{ body: { threads: [{ id: 'a' }], nextCursor: 'c' } }, { body: { threads: [{ id: 'b' }], nextCursor: null } }],
    'GET /v1/questions/open': [{ body: { questions: [], nextCursor: 'c' } }, { body: { questions: [{ id: 'q' }], nextCursor: null } }],
    'GET /v1/favorites': [{ body: { libraryIds: ['dal'], nextCursor: null } }],
  });
  assert.deepEqual((await M.messages.threads()).map((t) => t.id), ['a', 'b']);
  assert.deepEqual((await M.messages.openQuestions()).map((q) => q.id), ['q'], 'a short page with a cursor is followed');
  assert.deepEqual(await M.messages.favorites(), ['dal']);
});

await test('a thread since `after` pages back with the cursor and keeps the messages in order', async () => {
  signIn();
  const calls = fakeApi({
    ...session,
    'GET /v1/threads/t1/messages': [
      { body: { messages: [{ id: 'm3' }, { id: 'm4' }], nextCursor: 'older' } },
      { body: { messages: [{ id: 'm1' }, { id: 'm2' }], nextCursor: null } },
    ],
  });
  const got = await M.messages.thread('t1', '2026-11-02T18:04:05.123456Z');
  assert.deepEqual(got.map((m) => m.id), ['m1', 'm2', 'm3', 'm4']);
  const paths = own(calls).map((c) => c.path);
  assert.ok(paths.every((p) => p.includes('after=2026-11-02T18%3A04%3A05.123456Z')), 'the after time is sent exactly as it came');
  assert.ok(paths[1].includes('cursor=older'));
});

await test('cook-mode answer and the ask carry their keys; a voice answer sends only audioKey', async () => {
  signIn();
  const calls = fakeApi({ ...session, 'POST /v1/questions/q1/answer': [{ body: { ok: true } }], 'POST /v1/questions': [{ status: 201, body: { questionId: 'q2', status: 'asked_cook' } }] });
  await M.messages.answer('q1', { audioKey: 'voice/k1' }, 'idem-ans-0001');
  await M.messages.ask({ recipeId: 'r1', stepOrder: 3, text: 'Is it done?' }, 'idem-ask-0001');
  const [answer, ask] = own(calls);
  assert.deepEqual([answer.body, answer.headers['idempotency-key']], [{ audioKey: 'voice/k1' }, 'idem-ans-0001']);
  assert.deepEqual(ask.body, { recipeId: 'r1', stepOrder: 3, text: 'Is it done?' });
});

await test('uploads are checked before asking: the listed types, and 1 byte to 20 MB', () => {
  assert.equal(M.checkUpload('voice', 'audio/m4a', 1000), null);
  assert.equal(M.checkUpload('photo', 'IMAGE/JPEG', 1000), null);
  assert.equal(M.checkUpload('photo', 'image/gif', 1000), 'type');
  assert.equal(M.checkUpload('voice', 'image/jpeg', 1000), 'type');
  assert.equal(M.checkUpload('voice', 'audio/m4a', 0), 'size');
  assert.equal(M.checkUpload('voice', 'audio/m4a', 20_971_521), 'size');
});

await test("push tokens go as the phone's own person, even while someone else uses it", async () => {
  signIn();
  C.setAwsCredentials({ personId: 'p-nani' }); // Nani is cooking on Mom's phone
  const calls = fakeApi({ ...session, 'POST /v1/push-tokens': [{ body: { ok: true } }], 'POST /v1/push-tokens/remove': [{ body: { ok: true } }] });
  await M.messages.registerPush({ token: 'ExponentPushToken[x]', platform: 'ios', tz: 'Asia/Kolkata' }, 'p-mom');
  await M.messages.removePush('ExponentPushToken[x]', 'p-mom');
  assert.deepEqual(own(calls).map((c) => c.headers.authorization), ['Bearer t-p-mom', 'Bearer t-p-mom']);
});

await test("the table sends the phone's zone as x-tz", async () => {
  signIn();
  const calls = fakeApi({ ...session, 'GET /v1/table': [{ body: { week_start: 'x' } }] });
  await M.messages.table('America/Los_Angeles');
  assert.equal(own(calls)[0].headers['x-tz'], 'America/Los_Angeles');
});

await test('opening a share needs no session', async () => {
  signIn();
  const calls = fakeApi({ 'POST /v1/shares/open': [{ body: { token: 'abc', libraryId: 'dal' } }] });
  await M.messages.openShare('abc1234567');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, undefined);
});

await test('watchRead: one shared poll per key, every everyMs, the last value handed to the reader', async () => {
  timers = [];
  const seen = [];
  let calls = 0;
  const reader = async (last) => {
    calls += 1;
    return (last ?? 0) + 1;
  };
  const offA = L.watchRead('thread:t1', reader, 3000, (v) => seen.push(['a', v]));
  await flush();
  const offB = L.watchRead('thread:t1', reader, 3000, (v) => seen.push(['b', v]));
  assert.equal(calls, 1, 'the second watcher shares the first poll');
  assert.deepEqual(seen, [['a', 1], ['b', 1]]);
  assert.equal(timers.at(-1).ms, 3000);
  timers.shift().fn();
  await flush();
  assert.deepEqual(seen.slice(-2), [['a', 2], ['b', 2]], 'the reader got the last value');
  offA();
  offB();
  assert.equal(timers.length, 0, 'the poll stops with the last watcher');
});

await test('watchRead waits in the background, and stops for good on signed_out', async () => {
  timers = [];
  let active = false;
  const front = L.setForeground(() => active);
  let calls = 0;
  const off = L.watchRead('inbox', async () => {
    calls += 1;
    return [];
  }, 8000, () => {});
  await flush();
  assert.equal(calls, 0);
  active = true;
  front.changed();
  await flush();
  assert.equal(calls, 1);
  off();
  L.setForeground(() => true);

  signIn();
  timers = [];
  fakeApi({ ...session, 'GET /v1/unread': [{ status: 401, body: { error: 'signed_out' } }] });
  const off2 = L.watchRead('unread', () => M.messages.unread(), 8000, () => {});
  await flush();
  assert.equal(timers.length, 0, 'no more polls after signed_out');
  off2();
});

const kidP = { id: 'p-leo', name: 'Leo', role: 'kid', relation: null, avatarKey: 'leo' };
const momP = { id: 'p-mom', name: 'Mom', role: 'cook', relation: 'mom', avatarKey: null };
const awsMsg = { id: 'm1', threadId: 't1', senderId: 'p-leo', createdAt: '2026-11-02T18:04:05.123456Z', kind: 'question', body: 'Salt?', libraryId: 'dal', stepOrder: 2, replyTo: null, photoUrl: null };

await test("switch on: the inbox comes back in today's shape (snake_case, a kid is a learner)", async () => {
  signIn();
  API.setApiAuth({ deviceKey: `key-${phones}`, code: null, profileId: 'p-mom' });
  fakeApi({ ...session, 'GET /v1/threads': [{ body: { threads: [{ id: 't1', kind: 'pair', other: kidP, members: [momP, kidP], last: awsMsg, unread: 2, libraryId: 'dal', postcards: 0 }], nextCursor: null } }] });
  const [t] = await API.api.threads();
  assert.deepEqual([t.id, t.kind, t.unread, t.recipe_id, t.other.role, t.other.avatar_key], ['t1', 'pair', 2, 'dal', 'learner', 'leo']);
  assert.deepEqual([t.last.thread_id, t.last.sender_id, t.last.recipe_id, t.last.step_order, t.last.created_at], ['t1', 'p-leo', 'dal', 2, '2026-11-02T18:04:05.123456Z']);
});

await test("switch on: a screen's send is renamed to AWS fields and keyed", async () => {
  signIn();
  API.setApiAuth({ deviceKey: `key-${phones}`, code: null, profileId: 'p-mom' });
  const calls = fakeApi({ ...session, 'POST /v1/threads/t1/messages': [{ body: { ...awsMsg, id: 'm2', kind: 'voice', senderId: 'p-mom' } }] });
  const m = await API.api.sendMessage('t1', { kind: 'voice', duration_s: 7, audio_path: 'voice/k1', recipe_id: 'dal', step_order: 2, reply_to: 'm1' });
  const c = own(calls)[0];
  assert.deepEqual(c.body, { kind: 'voice', libraryId: 'dal', stepOrder: 2, replyTo: 'm1', audioKey: 'voice/k1', durationS: 7 });
  assert.match(c.headers['idempotency-key'], /^[A-Za-z0-9_-]{8,}$/);
  assert.equal(m.kind, 'voice');
});

await test('switch on: a postcard, a note removed, and send-recipe answer in the old words', async () => {
  signIn();
  API.setApiAuth({ deviceKey: `key-${phones}`, code: null, profileId: 'p-leo' });
  const calls = fakeApi({
    ...session,
    'POST /v1/messages/m9/postcard': [{ body: { ...awsMsg, id: 'm9', kind: 'cooked', photoUrl: 'https://x/p.jpg', rating: 4 } }],
    'POST /v1/notes/n1/remove': [{ body: { ok: true, answerMessageId: 'a1', questionMessageId: 'q1' } }],
    'POST /v1/send-recipe': [{ body: { sent: [{ personId: 'p-mom', threadId: 't1', messageId: 'm3' }] } }],
  });
  const card = await API.api.postcard('m9', { photo_path: 'photo/k2', rating: 4 });
  assert.deepEqual([card.photo_url, card.rating], ['https://x/p.jpg', 4]);
  assert.deepEqual(own(calls)[0].body, { photoKey: 'photo/k2', rating: 4 });
  assert.deepEqual(await API.api.removeNote('n1'), { ok: true, answer_message_id: 'a1', question_message_id: 'q1' });
  assert.deepEqual(await API.api.sendRecipe({ recipe_id: 'dal', to: ['p-mom'] }), { sent: [{ profile_id: 'p-mom', thread_id: 't1', message_id: 'm3' }] });
});

console.log(`\n${passed} passed`);

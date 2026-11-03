// The Messages flows on AWS staging, through the app's own client (src/lib/aws), with test people from the staging-only
// test sign-in and a ready recipe from staging's test recipe route (MESSAGES.md, "Staging testing"). It writes to
// staging (messages, a voice note and a photo to the private S3 bucket) and deletes everyone it made.
//   node scripts/aws-messages-flows.mjs [base url]      default: staging over HTTPS
// Needs TEST_SIGNIN_KEY in the root .env (read here, never printed).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = (process.argv[2] || 'https://d2zh46br3dalyf.cloudfront.net').replace(/\/+$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envLine = readFileSync(join(root, '..', '.env'), 'utf8').split('\n').find((l) => l.startsWith('TEST_SIGNIN_KEY='));
const KEY = envLine?.slice('TEST_SIGNIN_KEY='.length).trim().replace(/^["']|["']$/g, '');
if (!KEY) throw new Error('TEST_SIGNIN_KEY is missing from the root .env');
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});
process.env.EXPO_PUBLIC_BACKEND = 'aws';
process.env.EXPO_PUBLIC_AWS_URL = BASE;
const C = await import(pathToFileURL(join(root, 'src/lib/aws/client.ts')).href);
const A = await import(pathToFileURL(join(root, 'src/lib/aws/accounts.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/aws/messages.ts')).href);
const L = await import(pathToFileURL(join(root, 'src/lib/aws/live.ts')).href);

let passed = 0;
const check = async (name, fn) => {
  try {
    const note = await fn();
    passed += 1;
    console.log(`ok   ${name}${note ? `  (${note})` : ''}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};
const refused = async (p) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  assert.fail('expected a refusal');
};
async function testSignIn(body) {
  const res = await fetch(`${BASE}/v1/test/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY }, body: JSON.stringify(body) });
  assert.equal(res.status, 200, `test sign-in answered ${res.status}`);
  return res.json();
}
const phone = (a) => C.setAwsCredentials({ deviceKey: a.device_key, personId: a.profile_id });
const key = () => `k-${randomUUID()}`;
/** Upload a file the way the app does: link, PUT with exactly its headers, confirm. */
async function upload(kind, contentType, bytes) {
  const f = await M.messages.newFile(kind, contentType, bytes.length);
  const put = await fetch(f.uploadUrl, { method: 'PUT', headers: f.uploadHeaders, body: bytes });
  assert.equal(put.status, 200, `PUT answered ${put.status}`);
  await M.messages.confirmFile(f.key);
  return f.key;
}

const run = randomBytes(4).toString('hex');
let cook, kid, cook2, recipe, pair, circle, question;

try {
  await check('a family: a cook, a kid and a second cook by the family link, and a ready recipe of the cook\'s', async () => {
    await testSignIn({ test_id: `msg-cook-${run}` });
    cook = await testSignIn({ test_id: `msg-cook-${run}`, name: `Msg Cook ${run}`, role: 'cook' });
    phone(cook);
    const link = await A.accounts.joinLink(cook.profile_id);
    const t = new URL(link.url).searchParams.get('t');
    kid = await testSignIn({ test_id: `msg-kid-${run}`, name: `Msg Kid ${run}`, join_token: t });
    cook2 = await testSignIn({ test_id: `msg-cook2-${run}`, name: `Other Cook ${run}`, role: 'cook', join_token: t });
    phone(cook);
    const res = await fetch(`${BASE}/v1/test/recipe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY, authorization: `Bearer ${(await A.accounts.session()).sessionToken}` },
      body: '{}',
    });
    assert.equal(res.status, 201, `test recipe answered ${res.status}`);
    const made = await res.json();
    const id = made.recipeId ?? made.id ?? made._id;
    const J = await import(pathToFileURL(join(root, 'src/lib/aws/jobs.ts')).href);
    recipe = await J.recipes.get(id);
    assert.equal(recipe.status, 'ready');
    assert.ok(recipe.libraryId);
    return recipe.title;
  });

  await check('the circle and a pair; a message sent twice with one key is stored once', async () => {
    phone(kid);
    circle = await M.messages.circle();
    assert.equal(circle.members.length, 3);
    pair = await M.messages.openThread(cook.profile_id);
    const k = key();
    const a = await M.messages.send(pair.id, { kind: 'text', body: 'Hi Mom' }, k);
    const b = await M.messages.send(pair.id, { kind: 'text', body: 'Hi Mom' }, k);
    assert.equal(a.id, b.id);
    const e = await refused(M.messages.send(pair.id, { kind: 'text', body: 'Different' }, k));
    assert.equal(e.code, 'idempotency_conflict');
  });

  await check('the cook sees it unread, reads the thread since a time, and marks it read', async () => {
    phone(cook);
    const u = await M.messages.unread();
    assert.ok(u.total >= 1 && u.lastMessageAt);
    const threads = await M.messages.threads();
    assert.equal(threads[0].kind, 'circle', 'the circle comes first');
    const all = await M.messages.thread(pair.id);
    assert.equal(all.at(-1).body, 'Hi Mom');
    phone(kid);
    const later = await M.messages.send(pair.id, { kind: 'text', body: 'Are you there?' }, key());
    phone(cook);
    const since = await M.messages.thread(pair.id, all.at(-1).createdAt);
    assert.deepEqual(since.map((m) => m.id), [later.id], 'only what came after');
    await M.messages.markRead(pair.id);
    assert.equal((await M.messages.unread()).total, 0);
  });

  await check('a second cook cannot read or write the kid\'s pair with the cook', async () => {
    phone(cook2);
    assert.equal((await refused(M.messages.thread(pair.id))).code, 'not_found');
    assert.equal((await refused(M.messages.send(pair.id, { kind: 'text', body: 'x' }, key()))).code, 'not_found');
  });

  await check('a chat question: the cook sees it waiting, her reply answers it and is saved as a note; Undo opens it again', async () => {
    phone(kid);
    question = await M.messages.send(pair.id, { kind: 'question', libraryId: recipe.libraryId, stepOrder: 1, body: `How much salt? ${run}` }, key());
    phone(cook);
    const open = await M.messages.openChatQuestions();
    assert.ok(open.some((o) => o.message.id === question.id));
    const reply = await M.messages.send(pair.id, { kind: 'text', body: 'Two pinches.', replyTo: question.id, libraryId: recipe.libraryId, stepOrder: 1 }, key());
    assert.equal(reply.savedToRecipe, true);
    const notes = await M.messages.notes(recipe.libraryId);
    assert.ok(notes.some((n) => n.id === reply.noteId && n.answerText === 'Two pinches.'));
    assert.ok(!(await M.messages.openChatQuestions()).some((o) => o.message.id === question.id), 'answered');
    await M.messages.removeNote(reply.noteId);
    assert.ok((await M.messages.openChatQuestions()).some((o) => o.message.id === question.id), 'open again');
  });

  await check('a voice note: uploaded to S3, confirmed, sent once; its key can\'t be sent twice', async () => {
    phone(kid);
    const k = await upload('voice', 'audio/m4a', randomBytes(4096));
    const m = await M.messages.send(pair.id, { kind: 'voice', audioKey: k, durationS: 4 }, key());
    assert.ok(m.audioUrl, 'a read link');
    const e = await refused(M.messages.send(pair.id, { kind: 'voice', audioKey: k, durationS: 4 }, key()));
    assert.equal(e.code, 'not_found');
  });

  await check('"I made it" with a postcard: the photo lands on the cooked message', async () => {
    phone(kid);
    await M.messages.event({ libraryId: recipe.libraryId, kind: 'cooked', cookId: cook.profile_id });
    const cooked = await M.messages.send(pair.id, { kind: 'cooked', libraryId: recipe.libraryId }, key());
    const photo = await upload('photo', 'image/jpeg', randomBytes(2048));
    const card = await M.messages.postcard(cooked.id, photo, 5);
    assert.deepEqual([card.id, card.rating, !!card.photoUrl], [cooked.id, 5, true]);
  });

  await check('a cook-mode question on her ready recipe: the cook answers once, the kid sees it answered', async () => {
    phone(kid);
    const asked = await M.messages.ask({ recipeId: recipe._id, stepOrder: 1, text: `Lid on or off? ${run}` }, key());
    phone(cook);
    const open = await M.messages.openQuestions();
    const mine = open.find((q) => q.id === asked.questionId);
    assert.equal(mine?.status, 'asked_cook');
    await M.messages.answer(asked.questionId, { text: 'Off.' }, key());
    assert.equal((await refused(M.messages.answer(asked.questionId, { text: 'On.' }, key()))).code, 'answered');
    phone(kid);
    const forRecipe = await M.messages.recipeQuestions(recipe._id);
    const a = forRecipe.find((q) => q.id === asked.questionId);
    assert.deepEqual([a?.status, a?.answer?.text], ['answered', 'Off.']);
  });

  await check('send a recipe to the kid: a recipe message in their pair', async () => {
    phone(cook);
    const r = await M.messages.sendRecipe({ libraryId: recipe.libraryId, to: [kid.profile_id], note: 'Try this' }, key());
    assert.equal(r.sent.length, 1);
    phone(kid);
    const msgs = await M.messages.thread(r.sent[0].threadId);
    assert.ok(msgs.some((m) => m.id === r.sent[0].messageId && m.kind === 'recipe'));
  });

  await check('a share link opens with no session and names the dish', async () => {
    phone(cook);
    const s = await M.messages.share(recipe.libraryId);
    const opened = await M.messages.openShare(s.token);
    assert.equal(opened.libraryId, recipe.libraryId);
    return new URL(s.url).host;
  });

  await check('hearts on and off; an event counts once', async () => {
    phone(kid);
    await M.messages.setFavorite(recipe.libraryId, true);
    assert.ok((await M.messages.favorites()).includes(recipe.libraryId));
    await M.messages.setFavorite(recipe.libraryId, false);
    assert.ok(!(await M.messages.favorites()).includes(recipe.libraryId));
    const first = await M.messages.event({ libraryId: recipe.libraryId, kind: 'viewed' });
    const again = await M.messages.event({ libraryId: recipe.libraryId, kind: 'viewed' });
    assert.deepEqual([first.counted, again.counted], [true, false]);
  });

  await check('a push token registers and goes, as the phone\'s own person', async () => {
    phone(kid);
    const token = `ExponentPushToken[test-${run}]`;
    assert.deepEqual(await M.messages.registerPush({ token, platform: 'ios', tz: 'Asia/Kolkata' }, kid.profile_id), { ok: true });
    assert.deepEqual(await M.messages.removePush(token, kid.profile_id), { ok: true });
  });

  await check('the inbox poll reads the unread count once and hands it to the screen', async () => {
    phone(cook);
    const seen = [];
    const off = L.watchRead('aws-flows-unread', () => M.messages.unread(), 60_000, (u) => seen.push(u.total));
    await new Promise((r) => setTimeout(r, 1500));
    off();
    assert.equal(seen.length, 1);
    return `unread ${seen[0]}`;
  });
} finally {
  L.stopAllPolls();
  for (const p of [kid, cook2, cook].filter(Boolean)) {
    C.setAwsCredentials({ deviceKey: p.device_key, personId: p.profile_id });
    try {
      await A.accounts.deleteAccount();
    } catch (e) {
      console.error(`could not delete a test person: ${e.status} ${e.code}`);
    }
  }
}

console.log(`\n${passed} passed (test people made and deleted: two cooks and a kid)`);

// A recipe the team takes off the map, on AWS staging, through the app's own client (src/lib/aws). Only the team's
// `reports.js review recipe <id> remove` (a one-off ECS task, the AWS backend chat's) takes one down, so this runs in
// two steps with that in between:
//   node scripts/aws-takedown-flows.mjs make <file>    a test cook, a ready recipe, shared by her own tap; saved to <file>
//   node scripts/aws-takedown-flows.mjs down <file>    after `remove`: hiddenAt on the page, takenDown in the chooser,
//                                                      sharing again is 409 taken_down in the app's words
//   node scripts/aws-takedown-flows.mjs back <file>    after `keep`: neither is set, her tap shares it again, and her
//                                                      switch turns it off (unshare, #330); then deletes her
//   node scripts/aws-takedown-flows.mjs delete <file>  delete her without checking (a run given up)
// Files no report, so no alert email. Needs TEST_SIGNIN_KEY in the root .env (read here, never printed).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [STEP, FILE] = process.argv.slice(2);
if (!['make', 'down', 'back', 'delete'].includes(STEP) || !FILE) throw new Error('usage: aws-takedown-flows.mjs make|down|back|delete <file>');
const BASE = 'https://d2zh46br3dalyf.cloudfront.net';
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
const J = await import(pathToFileURL(join(root, 'src/lib/aws/jobs.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/aws/messages.ts')).href);
const W = await import(pathToFileURL(join(root, 'src/lib/aws/errorWords.ts')).href);

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
async function testSignIn(body) {
  const res = await fetch(`${BASE}/v1/test/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY }, body: JSON.stringify(body) });
  assert.equal(res.status, 200, `test sign-in answered ${res.status}`);
  return res.json();
}
const findRecipe = async (id) => (await J.recipes.all(20)).find((r) => r._id === id);
const findDish = async (id) => (await M.messages.shareDishes()).find((d) => d.recipeId === id);

if (STEP === 'make') {
  const testId = `takedown-${randomBytes(4).toString('hex')}`;
  const cook = await testSignIn({ test_id: testId, name: 'Takedown test cook', role: 'cook' });
  // Keep the test id before anything else, or she can't be signed back in to be deleted.
  writeFileSync(FILE, JSON.stringify({ testId }));
  C.setAwsCredentials({ deviceKey: cook.device_key, personId: cook.profile_id });
  const res = await fetch(`${BASE}/v1/test/recipe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY, authorization: `Bearer ${(await A.accounts.session()).sessionToken}` },
    body: '{}',
  });
  assert.equal(res.status, 201);
  const made = await res.json();
  const recipeId = made.recipeId ?? made.id ?? made._id;
  writeFileSync(FILE, JSON.stringify({ testId, recipeId }));
  await check('her own tap shares it; it reads shared, not taken down', async () => {
    assert.deepEqual(await M.messages.shareAsk(recipeId), { result: 'shared' });
    const r = await findRecipe(recipeId);
    assert.ok(r?.sharedAt, 'sharedAt');
    assert.equal(r?.hiddenAt, undefined);
    assert.equal((await findDish(recipeId))?.takenDown, false, 'takenDown is sent, and false');
  });
  console.log(`\nrecipe ${recipeId}: run \`reports.js review recipe ${recipeId} remove\`, then: down ${FILE}`);
  process.exit(0);
}

const { testId, recipeId } = JSON.parse(readFileSync(FILE, 'utf8'));
const cook = await testSignIn({ test_id: testId, name: 'Takedown test cook', role: 'cook' });
C.setAwsCredentials({ deviceKey: cook.device_key, personId: cook.profile_id });
if (STEP === 'down') {
  await check('the team took it down: hiddenAt set, sharedAt cleared, the chooser says takenDown', async () => {
    const r = await findRecipe(recipeId);
    assert.ok(r?.hiddenAt, 'hiddenAt');
    assert.equal(r?.sharedAt, undefined, 'sharedAt cleared');
    const d = await findDish(recipeId);
    assert.deepEqual([d?.takenDown, d?.shared], [true, false]);
  });
  await check('sharing it again is 409 taken_down, in the app\'s words', async () => {
    const e = await M.messages.shareAsk(recipeId).then(() => assert.fail('shared again'), (x) => x);
    assert.deepEqual([e.status, e.code], [409, 'taken_down']);
    assert.equal(W.errorWords(e), 'Our team took this recipe off the map after a report. It stays with your family.');
  });
  console.log(`\n${passed} passed. Run \`reports.js review recipe ${recipeId} keep\`, then: back ${FILE}`);
  process.exit(0);
}

try {
  if (STEP === 'back') {
    await check('the team kept it: hiddenAt cleared, not takenDown, still off the map until she shares it', async () => {
      const r = await findRecipe(recipeId);
      assert.equal(r?.hiddenAt, undefined, 'hiddenAt cleared');
      const d = await findDish(recipeId);
      assert.deepEqual([d?.takenDown, d?.shared], [false, false]);
    });
    await check('her tap shares it again', async () => {
      assert.deepEqual(await M.messages.shareAsk(recipeId), { result: 'shared' });
      assert.ok((await findRecipe(recipeId))?.sharedAt, 'sharedAt');
    });
    await check('her switch turns it off (unshare), twice is fine, and her tap puts it back', async () => {
      assert.deepEqual(await J.recipes.unshare(recipeId), { ok: true });
      assert.equal((await findRecipe(recipeId))?.sharedAt, undefined, 'off the map');
      assert.equal((await findDish(recipeId))?.shared, false);
      assert.deepEqual(await J.recipes.unshare(recipeId), { ok: true });
      assert.deepEqual(await M.messages.shareAsk(recipeId), { result: 'shared' });
      assert.ok((await findRecipe(recipeId))?.sharedAt, 'back on');
    });
  }
} finally {
  await A.accounts.deleteAccount();
  console.log(`\n${passed} passed (the test cook is deleted)`);
}

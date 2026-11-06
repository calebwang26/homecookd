// Community on AWS staging, through the app's own client (src/lib/aws), following COMMUNITY.md's "A dinner, end to end":
// two test families, a shared test recipe in the feed and on its page, a swap and "cook together", a dinner hosted (one
// Idempotency-Key, one dinner), asked to join, said yes to, its address shown only after, its invite link opened.
// It doesn't report or block: each one emails the team's alerts address on staging. Everyone made is deleted after.
//   node scripts/aws-community-flows.mjs [base url]      default: staging over HTTPS
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
const K = await import(pathToFileURL(join(root, 'src/lib/aws/community.ts')).href);

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
async function testRecipe() {
  const res = await fetch(`${BASE}/v1/test/recipe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY, authorization: `Bearer ${(await A.accounts.session()).sessionToken}` },
    body: '{}',
  });
  assert.equal(res.status, 201);
  const made = await res.json();
  return made.recipeId ?? made.id ?? made._id;
}
const phone = (a) => C.setAwsCredentials({ deviceKey: a.device_key, personId: a.profile_id });

const run = randomBytes(4).toString('hex');
let asha, nadia, ashaDish, nadiaDish, dinner, request;

try {
  await check('two families, each with a ready test recipe, shared by its cook\'s own tap', async () => {
    asha = await testSignIn({ test_id: `com-a-${run}`, name: `Asha ${run}`, role: 'cook' });
    nadia = await testSignIn({ test_id: `com-b-${run}`, name: `Nadia ${run}`, role: 'cook' });
    phone(asha);
    ashaDish = await testRecipe();
    assert.deepEqual(await M.messages.shareAsk(ashaDish), { result: 'shared' });
    phone(nadia);
    nadiaDish = await testRecipe();
    assert.deepEqual(await M.messages.shareAsk(nadiaDish), { result: 'shared' });
  });

  await check("the other family's feed lists it, and its page opens with the whitelist only", async () => {
    phone(nadia);
    const feed = await K.community.feed();
    const row = feed.recipes.find((r) => r.recipeId === ashaDish);
    assert.ok(row, 'in the feed');
    assert.equal(row.ours, false);
    const own = feed.recipes.find((r) => r.recipeId === nadiaDish);
    assert.equal(own?.ours, true, 'her own shared dish reads ours');
    const page = await K.community.recipe(ashaDish);
    assert.deepEqual(Object.keys(page).sort(), ['cookName', 'dish', 'familyName', 'ours', 'recipeId', 'steps', 'story'].sort());
    return `${row.familyName} · ${row.distanceLabel}`;
  });

  await check('a swap: Nadia asks, offering hers; asking again gives the same; Asha says yes', async () => {
    phone(nadia);
    const { swapId } = await K.community.requestSwap(ashaDish, nadiaDish);
    assert.equal((await K.community.requestSwap(ashaDish, nadiaDish)).swapId, swapId);
    assert.equal((await refused(K.community.requestSwap(nadiaDish))).code, 'own_family');
    phone(asha);
    const incoming = (await K.community.swaps()).find((s) => s.swapId === swapId);
    assert.deepEqual([incoming?.incoming, incoming?.status], [true, 'pending']);
    await K.community.respondSwap(swapId, true);
    assert.equal((await refused(K.community.respondSwap(swapId, true))).code, 'answered', 'once');
  });

  await check('"cook together" asked of Asha, and her yes', async () => {
    phone(nadia);
    const { swapId } = await K.community.cookTogether(ashaDish);
    phone(asha);
    await K.community.respondSwap(swapId, true);
    phone(nadia);
    assert.equal((await K.community.swaps()).find((s) => s.swapId === swapId)?.status, 'accepted');
  });

  await check('Asha hosts a dinner: one Idempotency-Key, one dinner, even sent twice', async () => {
    phone(asha);
    const key = `dinner-${randomUUID()}`;
    const body = { recipeId: ashaDish, startsAt: Date.now() + 3_600_000, placeName: 'Test kitchen', address: '1 Test St', seats: 2 };
    dinner = (await K.community.createDinner(body, key)).dinnerId;
    assert.equal((await K.community.createDinner(body, key)).dinnerId, dinner);
    const d = await K.community.dinner(dinner);
    assert.deepEqual([d.isHost, d.ours, d.address, d.seatsLeft], [true, true, '1 Test St', 2]);
  });

  await check('Nadia asks to join; the address is hidden until Asha says yes; then it shows', async () => {
    phone(nadia);
    const before = await K.community.dinner(dinner);
    assert.deepEqual([before.address, before.requests, before.isHost], [null, null, false]);
    request = (await K.community.join(dinner)).requestId;
    assert.equal((await refused(K.community.join(dinner))).code, 'already_asked');
    phone(asha);
    const host = await K.community.dinner(dinner);
    assert.ok(host.requests?.some((r) => r.requestId === request && r.status === 'pending'));
    await K.community.respond(request, true);
    phone(nadia);
    const after = await K.community.dinner(dinner);
    assert.deepEqual([after.address, after.myRequest?.status, after.seatsLeft], ['1 Test St', 'accepted', 1]);
    assert.ok((await K.community.myDinners()).some((x) => x.dinnerId === dinner), 'in her dinners');
  });

  await check('the invite link: the same link each time; opening it publicly names only the dish, host and time', async () => {
    phone(nadia);
    const link = await K.community.inviteLink(dinner);
    assert.equal((await K.community.inviteLink(dinner)).token, link.token);
    const before = (await K.community.dinner(dinner)).inviteOpens;
    const opened = await K.community.openInvite(link.token, `flows-device-${run}-0001`);
    assert.deepEqual(Object.keys(opened).sort(), ['dish', 'hostName', 'startsAt']);
    assert.equal((await K.community.dinner(dinner)).inviteOpens, before + 1);
    const bad = await refused(K.community.openInvite('x'.repeat(43), `flows-device-${run}-0002`));
    assert.equal(bad.code, 'not_found');
    return new URL(link.url).pathname;
  });

  await check('a family that never asked sees the dinner but no address, and can\'t make an invite link', async () => {
    const third = await testSignIn({ test_id: `com-c-${run}`, name: `Third ${run}`, role: 'cook' });
    try {
      phone(third);
      const d = await K.community.dinner(dinner);
      assert.deepEqual([d.address, d.requests], [null, null]);
      assert.equal((await refused(K.community.inviteLink(dinner))).code, 'not_a_guest');
    } finally {
      phone(third);
      await A.accounts.deleteAccount().catch(() => {});
    }
  });
} finally {
  for (const p of [nadia, asha].filter(Boolean)) {
    C.setAwsCredentials({ deviceKey: p.device_key, personId: p.profile_id });
    try {
      await A.accounts.deleteAccount();
    } catch (e) {
      console.error(`could not delete a test person: ${e.status} ${e.code}`);
    }
  }
}

console.log(`\n${passed} passed (test people made and deleted: three cooks in three families)`);

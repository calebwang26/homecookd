// Kids' asks on AWS staging, through the app's own client (src/lib/aws), following DISH.md's "Staging testing": a card
// made on the web (/dish/cards, as the site does), the kid claiming it in the app, Mom joining from her link and
// claiming her side, then her requests, her filming day, her voice recipe and its merge (fake models on staging), and
// a recording for the card. Test people from the staging-only test sign-in; everyone made is deleted after.
//   node scripts/aws-dish-flows.mjs [base url]      default: staging over HTTPS
// Needs TEST_SIGNIN_KEY in the root .env (read here, never printed). Uses 1 of /dish/cards' 6 per 10 minutes.
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
const D = await import(pathToFileURL(join(root, 'src/lib/aws/dish.ts')).href);
const J = await import(pathToFileURL(join(root, 'src/lib/aws/jobs.ts')).href);

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
const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
async function testSignIn(body) {
  const res = await fetch(`${BASE}/v1/test/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY }, body: JSON.stringify(body) });
  assert.equal(res.status, 200, `test sign-in answered ${res.status}`);
  return res.json();
}
const phone = (a) => C.setAwsCredentials({ deviceKey: a.device_key, personId: a.profile_id });

const run = randomBytes(4).toString('hex');
let kid, mom, other, kidToken, askToken, cardId;

try {
  await check('the kid makes a card on the web (as the site does), and sends it', async () => {
    const made = await post('/dish/cards', { dish: 'tomato egg', relation: 'mom', kidName: `Leo ${run}` });
    assert.equal(made.status, 201, `cards answered ${made.status} ${JSON.stringify(made.body)?.slice(0, 120)}`);
    kidToken = made.body.kidToken;
    askToken = new URL(made.body.card.askUrl).searchParams.get('t');
    assert.equal((await post('/dish/cards/sent', { kidToken, via: 'copy' })).status, 200);
    const q = made.body.card.guess?.questions?.[0];
    if (q) assert.equal((await post('/dish/cards/ask', { kidToken, questions: [{ id: q.id ?? 'q1', text: q.text }] })).status, 200);
    return made.body.card.dish;
  });

  await check('the kid signs in and claims the kid side: the card joins their family', async () => {
    await testSignIn({ test_id: `dish-kid-${run}` });
    kid = await testSignIn({ test_id: `dish-kid-${run}`, name: `Leo ${run}`, role: 'learner' });
    phone(kid);
    const c = await A.accounts.claimCard(kidToken);
    assert.deepEqual([c.side, c.taken], ['kid', false]);
    cardId = c.dishAskId;
  });

  await check("Mom opens her link: a join ticket; she signs in with it and claims the cook side", async () => {
    const opened = await A.accounts.openCard(askToken);
    assert.equal(opened.side, 'cook');
    assert.ok(opened.ticket, `joinable: ${opened.joinable}`);
    mom = await testSignIn({ test_id: `dish-mom-${run}`, link_ticket: opened.ticket, name: `Mom ${run}` });
    phone(mom);
    const c = await A.accounts.claimCard(askToken);
    assert.deepEqual([c.side, c.dishAskId, c.sameFamily], ['cook', cardId, true]);
  });

  await check('her requests list the card; one read by id gives the same; another cook in the family sees none of it', async () => {
    phone(mom);
    const list = await D.cravings.all();
    const ask = list.find((a) => a.id === cardId);
    assert.ok(ask, 'in her requests');
    assert.equal(ask.answered, false);
    assert.deepEqual((await D.cravings.get(cardId)).id, cardId);
    const link = await A.accounts.joinLink(mom.profile_id);
    other = await testSignIn({ test_id: `dish-other-${run}`, name: `Other Cook ${run}`, role: 'cook', join_token: new URL(link.url).searchParams.get('t') });
    phone(other);
    assert.ok(!(await D.cravings.all()).some((a) => a.id === cardId));
    assert.equal((await refused(D.cravings.get(cardId))).code, 'not_found');
    assert.equal((await refused(D.cravings.filmingDay(cardId, 0))).code, 'not_asked_of_you');
    return ask.dish;
  });

  await check('her filming day is set, and her craving link is one live link, reused', async () => {
    phone(mom);
    assert.deepEqual(await D.cravings.filmingDay(cardId, 0), { ok: true });
    assert.equal((await D.cravings.get(cardId)).filmingDay, 0);
    const a = await D.cravings.link('What do you miss?');
    const b = await D.cravings.link();
    assert.equal(a.url, b.url);
    return new URL(a.url).pathname;
  });

  await check('her voice recipe: a link, the PUT, the send; it writes, then her version is ready', async () => {
    phone(mom);
    const bytes = randomBytes(4096); // over 100 bytes: staging's fake Ink "hears" a line
    const up = await D.cravings.voiceUpload(cardId, 'audio/mp4', bytes.length);
    const put = await fetch(up.uploadUrl, { method: 'PUT', headers: up.uploadHeaders, body: bytes });
    assert.equal(put.status, 200);
    assert.deepEqual(await D.cravings.voiceRecipe(cardId, { audioKey: up.audioKey, durationS: 5 }), { ok: true });
    let ask = await D.cravings.get(cardId);
    for (let i = 0; i < 20 && ask.voiceRecipe === 'writing'; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      ask = await D.cravings.get(cardId);
    }
    assert.equal(ask.voiceRecipe, 'ready');
    assert.equal(ask.answered, true);
    // The same audioKey again changes nothing (DISH.md: safe to repeat).
    assert.deepEqual(await D.cravings.voiceRecipe(cardId, { audioKey: up.audioKey, durationS: 5 }), { ok: true });
    assert.equal((await D.cravings.get(cardId)).voiceRecipe, 'ready');
  });

  await check("the card in the app: its kid and its cook read it; another cook in the family gets 404", async () => {
    phone(kid);
    const mine = await D.dishCard(cardId);
    assert.deepEqual([mine.id, mine.side, mine.status], [cardId, 'kid', 'answered']);
    assert.ok(mine.version, "her version, after her voice recipe");
    phone(mom);
    assert.equal((await D.dishCard(cardId)).side, 'cook');
    phone(other);
    assert.equal((await refused(D.dishCard(cardId))).code, 'not_found');
    return `${mine.version.ingredients?.length ?? 0} ingredients in her version`;
  });

  await check("a craving link: the kid's card is born asked of her, in her family, and shows in her requests", async () => {
    phone(mom);
    const { url } = await D.cravings.link('What do you miss?');
    const cravingToken = new URL(url).searchParams.get('c');
    const peek = await post('/dish/craving/peek', { cravingToken });
    assert.equal(peek.status, 200, `peek answered ${peek.status}`);
    assert.equal(peek.body.message, 'What do you miss?');
    const made = await post('/dish/cards', { dish: 'dal', relation: 'mom', kidName: `Kid ${run}`, cravingToken });
    assert.equal(made.status, 201, `cards answered ${made.status} ${JSON.stringify(made.body)?.slice(0, 120)}`);
    const asks = await D.cravings.all();
    // Staging's fake models give every card the same fixed guess ("tomato egg"), so find it by the kid's name.
    const born = asks.find((x) => x.kidName === `Kid ${run}`);
    assert.ok(born, 'in her requests at once, with no claim');
    return peek.body.parentName;
  });

  await check('a recording for the card carries its dishAskId and publishes', async () => {
    phone(mom);
    const bytes = randomBytes(64 * 1024);
    const u = await J.jobs.newUpload([{ contentType: 'video/mp4', size: bytes.length, durationS: 3 }], `upload-${randomUUID()}`);
    const job = await J.jobs.create({ uploadId: u.uploadId, title: `Tomato egg ${run}`, dishAskId: cardId });
    assert.equal((await fetch(u.uploads[0].url, { method: 'PUT', headers: u.uploads[0].headers, body: bytes })).status, 200);
    await J.jobs.complete(u.uploadId);
    const res = await fetch(`${BASE}/v1/test/recipe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY, authorization: `Bearer ${(await A.accounts.session()).sessionToken}` },
      body: JSON.stringify({ jobId: job.jobId }),
    });
    assert.equal(res.status, 201);
    assert.equal((await J.recipes.get(job.recipeId)).status, 'ready');
  });

  await check("a card not asked of her is dropped from her job without an error", async () => {
    phone(other);
    const u = await J.jobs.newUpload([{ contentType: 'video/mp4', size: 1024, durationS: 1 }], `upload-${randomUUID()}`);
    const job = await J.jobs.create({ uploadId: u.uploadId, dishAskId: cardId });
    assert.ok(job.jobId);
    await J.jobs.cancel(job.jobId);
  });
} finally {
  for (const p of [other, mom, kid].filter(Boolean)) {
    C.setAwsCredentials({ deviceKey: p.device_key, personId: p.profile_id });
    try {
      await A.accounts.deleteAccount();
    } catch (e) {
      console.error(`could not delete a test person: ${e.status} ${e.code}`);
    }
  }
}

console.log(`\n${passed} passed (test people made and deleted: a kid, Mom, another cook)`);

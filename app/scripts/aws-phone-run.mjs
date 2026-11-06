// The staging side of the build-11 phone check (docs/build/qa/aws-phone/CHECKLIST.md), through the app's own client
// (src/lib/aws). The phone joins "Asha (test)"'s family by link and reports "Nadia (test)"'s dinner; this makes them,
// finishes the phone's recordings as Asha (staging runs no worker), messages the phone, and reads its voice note.
//   node scripts/aws-phone-run.mjs setup <file>    both test cooks, Nadia's shared recipe and dinner; prints both links
//   node scripts/aws-phone-run.mjs finish <file>   as Asha: finish the family's newest queued job (newestJob, #330)
//   node scripts/aws-phone-run.mjs message <file>  as Asha: a text to the phone's person (a push)
//   node scripts/aws-phone-run.mjs voice <file>    as Asha: the newest voice note from the phone, and its audio
//   node scripts/aws-phone-run.mjs delete <file>   delete both test cooks (the phone deletes its own account in Settings)
// Needs TEST_SIGNIN_KEY in the root .env (read here, never printed). Keep <file> until delete: it holds the test ids.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [STEP, FILE] = process.argv.slice(2);
if (!['setup', 'finish', 'message', 'voice', 'delete'].includes(STEP) || !FILE) throw new Error('usage: aws-phone-run.mjs setup|finish|message|voice|delete <file>');
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
const M = await import(pathToFileURL(join(root, 'src/lib/aws/messages.ts')).href);
const K = await import(pathToFileURL(join(root, 'src/lib/aws/community.ts')).href);

const PEOPLE = { asha: 'Asha (test)', nadia: 'Nadia (test)' };
async function testSignIn(who, testId) {
  const res = await fetch(`${BASE}/v1/test/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY },
    body: JSON.stringify({ test_id: testId, name: PEOPLE[who], role: 'cook' }),
  });
  assert.equal(res.status, 200, `test sign-in answered ${res.status}`);
  const p = await res.json();
  C.setAwsCredentials({ deviceKey: p.device_key, personId: p.profile_id });
  return p;
}
async function testRecipe(body) {
  const res = await fetch(`${BASE}/v1/test/recipe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY, authorization: `Bearer ${(await A.accounts.session()).sessionToken}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status >= 300) throw new Error(`test recipe answered ${res.status} ${text}`);
  return JSON.parse(text);
}
const at = () => new Date().toISOString();

if (STEP === 'setup') {
  const run = randomBytes(4).toString('hex');
  const ids = { asha: `phone-a-${run}`, nadia: `phone-n-${run}` };
  // Keep the test ids before anything else, or they can't be signed back in to be deleted.
  writeFileSync(FILE, JSON.stringify(ids));
  const asha = await testSignIn('asha', ids.asha);
  const family = (await A.accounts.joinLink(asha.profile_id)).url;
  await testSignIn('nadia', ids.nadia);
  const made = await testRecipe({});
  const recipeId = made.recipeId ?? made.id ?? made._id;
  assert.deepEqual(await M.messages.shareAsk(recipeId), { result: 'shared' });
  const body = { recipeId, startsAt: Date.now() + 3 * 86_400_000, placeName: 'Test kitchen', address: '1 Test St', seats: 4 };
  const dinnerId = (await K.community.createDinner(body, `dinner-${randomUUID()}`)).dinnerId;
  const dinner = (await K.community.inviteLink(dinnerId)).url;
  writeFileSync(FILE, JSON.stringify({ ...ids, ashaId: asha.profile_id, recipeId, dinnerId }));
  console.log(`${at()} setup done\nfamily link (Asha): ${family}\ndinner link (Nadia): ${dinner}\ndinner id: ${dinnerId}`);
  process.exit(0);
}

const state = JSON.parse(readFileSync(FILE, 'utf8'));
if (STEP === 'delete') {
  for (const who of ['asha', 'nadia']) {
    if (!state[who]) continue;
    try {
      await testSignIn(who, state[who]);
      await A.accounts.deleteAccount();
      console.log(`deleted ${PEOPLE[who]}`);
    } catch (e) {
      console.error(`could not delete ${PEOPLE[who]}: ${e.status ?? ''} ${e.code ?? e.message}`);
    }
  }
  process.exit(0);
}

const asha = await testSignIn('asha', state.asha);
const fam = await A.accounts.family(asha.profile_id);
const phonePeople = fam.profiles.filter((p) => p.id !== asha.profile_id);

if (STEP === 'finish') {
  console.log(`${at()} finished`, JSON.stringify(await testRecipe({ newestJob: true })));
} else if (STEP === 'message') {
  const to = phonePeople[0];
  assert.ok(to, "nobody else in Asha's family yet");
  const thread = await M.messages.openThread(to.id);
  const sent = await M.messages.send(thread.id, { kind: 'text', body: 'Test from Asha: does this notification arrive?' }, `phone-${randomUUID()}`);
  console.log(`${at()} sent ${sent.id} to ${to.name} at ${sent.createdAt}`);
} else if (STEP === 'voice') {
  const voices = [];
  for (const t of await M.messages.threads()) {
    for (const m of await M.messages.thread(t.id)) if (m.kind === 'voice' && m.senderId !== asha.profile_id) voices.push(m);
  }
  voices.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const v = voices.at(-1);
  assert.ok(v, 'no voice note from the phone yet');
  const audio = v.audioUrl ? await fetch(v.audioUrl) : null;
  const bytes = audio ? (await audio.arrayBuffer()).byteLength : 0;
  console.log(`${at()} voice ${v.id} at ${v.createdAt}, ${v.durationS ?? '?'} s; audio ${audio?.status ?? 'no url'}, ${bytes} bytes, ${audio?.headers.get('content-type') ?? ''}`);
}

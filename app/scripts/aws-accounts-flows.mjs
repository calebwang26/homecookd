// The Accounts flows on AWS staging, through the app's own client (src/lib/aws, and src/lib/moveApi.ts for moving to a
// new phone), with test people from the staging-only test sign-in (ACCOUNTS.md, "Staging testing"). It writes to
// staging and deletes everyone it made.
//   node scripts/aws-accounts-flows.mjs [base url]      default: staging over HTTPS
// Needs TEST_SIGNIN_KEY in the root .env (read here, never printed). Production refuses the route.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
const API = await import(pathToFileURL(join(root, 'src/lib/api.ts')).href);
const M = await import(pathToFileURL(join(root, 'src/lib/moveApi.ts')).href);

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

/** /v1/test/sign-in: /auth/apple's body with test_id in place of id_token. */
async function testSignIn(body) {
  const res = await fetch(`${BASE}/v1/test/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, `test sign-in answered ${res.status}`);
  return res.json();
}
/** Become this phone: its key and its own person. */
const phone = (a) => C.setAwsCredentials({ deviceKey: a.device_key, personId: a.profile_id });
/** The same, for moveApi, which reads the person from the app's api client (getApiAuth) as the screens do. */
const appPhone = (a) => API.setApiAuth({ deviceKey: a.device_key, profileId: a.profile_id });

const run = randomBytes(4).toString('hex');
const made = []; // {key, personId} to delete at the end
let cook, kid, nani, link, newPhone;

try {
  await check('a new cook signs up: a new family, and the person id is the same everywhere', async () => {
    const first = await testSignIn({ test_id: `app-cook-${run}` });
    assert.equal(first.needs_name, true, 'nothing is made without a name');
    cook = await testSignIn({ test_id: `app-cook-${run}`, name: `Test Cook ${run}`, role: 'cook' });
    assert.equal(cook.existing, false);
    made.push({ key: cook.device_key, personId: cook.profile_id });
    phone(cook);
    const s = await A.accounts.session();
    const me = await A.accounts.me();
    const fam = await A.accounts.family(cook.profile_id);
    assert.deepEqual([s.personId, s.role, me.person.id, fam.device_profile_id], [cook.profile_id, 'cook', cook.profile_id, cook.profile_id]);
    assert.equal(me.person.language, null, 'null is English');
    return fam.family.name;
  });

  await check('signing in again on a new phone is the same person', async () => {
    const again = await testSignIn({ test_id: `app-cook-${run}` });
    assert.deepEqual([again.existing, again.profile_id], [true, cook.profile_id]);
    made.push({ key: again.device_key, personId: again.profile_id });
    cook = again; // the newest key; the first one still works too
  });

  await check('the cook adds Nani, who has no phone, and acts as her with her own session', async () => {
    phone(cook);
    nani = await A.accounts.addPerson({ name: `Nani ${run}`, role: 'cook', relation: 'grandma' }, cook.profile_id);
    const s = await A.accounts.session(nani.id);
    const me = await A.accounts.me(nani.id);
    assert.deepEqual([s.personId, me.person.id, me.person.role], [nani.id, nani.id, 'cook']);
    const fam = await A.accounts.family(cook.profile_id);
    const row = fam.profiles.find((p) => p.id === nani.id);
    assert.deepEqual([row.has_phone, row.locked], [false, false]);
  });

  await check('the same name twice is refused (409), and nothing is retried', async () => {
    const e = await refused(A.accounts.addPerson({ name: `Nani ${run}`, role: 'cook' }, cook.profile_id));
    assert.deepEqual([e.status, e.kind], [409, 'refused']);
    return e.code || e.message;
  });

  await check('the family link: the same link comes back, and peek shows the family', async () => {
    link = await A.accounts.joinLink(cook.profile_id);
    const again = await A.accounts.joinLink(cook.profile_id);
    assert.equal(again.url, link.url);
    const t = new URL(link.url).searchParams.get('t');
    const peek = await A.accounts.peekLink(t);
    assert.deepEqual([peek.status, peek.kind], ['pending', 'link']);
    return new URL(link.url).host;
  });

  await check('a kid joins by the link: same family, role kid, and the cook sees them locked', async () => {
    const t = new URL(link.url).searchParams.get('t');
    kid = await testSignIn({ test_id: `app-kid-${run}`, name: `Test Kid ${run}`, join_token: t });
    assert.equal(kid.joined, true);
    made.push({ key: kid.device_key, personId: kid.profile_id });
    phone(kid);
    const s = await A.accounts.session();
    const me = await A.accounts.me();
    assert.equal(s.role, 'kid');
    phone(cook);
    const fam = await A.accounts.family(cook.profile_id);
    assert.equal(me.family.id, fam.family.id);
    assert.equal(fam.profiles.find((p) => p.id === kid.profile_id)?.locked, true, 'their own phone, not this one');
  });

  await check('acting as the kid from the cook\'s phone is refused: they use their own phone', async () => {
    phone(cook);
    const e = await refused(A.accounts.session(kid.profile_id));
    assert.deepEqual([e.status, e.kind], [403, 'refused']);
    return e.code || e.message;
  });

  await check('a new phone asks to be Nani (moveApi), and the cook lets it in from her own phone', async () => {
    // A phone with no person yet: an old family invite (POST /invites, then /invites/accept, as a 1.0 phone joins).
    phone(cook);
    const inv = await C.request('/invites', { auth: 'key', as: cook.profile_id, body: {} });
    const token = new URL(inv.invite.url).searchParams.get('t');
    const joined = await C.request('/invites/accept', { auth: 'none', body: { token, device_label: `Test phone ${run}` } });
    assert.equal(joined.profile_id, null, 'a phone with no person yet');
    newPhone = { device_key: joined.device_key, profile_id: null };
    appPhone(newPhone);
    const asked = await M.moveApi.ask(nani.id);
    assert.deepEqual([asked.status, asked.profile_id], ['pending', nani.id]);
    const waiting = await M.moveApi.mine();
    assert.deepEqual([waiting.id, waiting.status], [asked.id, 'pending']);
    assert.ok(waiting.asked.includes(`Test Cook ${run}`), 'the cook is one who can let it in');
    appPhone(cook);
    const list = await M.moveApi.list();
    assert.ok(list.some((r) => r.id === asked.id && r.profile.id === nani.id), 'the cook sees the ask');
    assert.deepEqual(await M.moveApi.approve(asked.id), { ok: true });
    const again = await refused(M.moveApi.decline(asked.id));
    assert.equal(again.status, 409, 'answered once');
    appPhone(newPhone);
    const done = await M.moveApi.mine();
    assert.deepEqual([done.status, done.let_in_by], ['approved', `Test Cook ${run}`]);
    newPhone = { ...newPhone, profile_id: nani.id };
    phone(newPhone);
    assert.equal((await A.accounts.family(nani.id)).device_profile_id, nani.id, 'the new phone is Nani\'s');
    phone(cook); // the next steps are the cook's
    return asked.id.slice(0, 8);
  });

  await check('turning the link off: peek says revoked, and the next link is new', async () => {
    const t = new URL(link.url).searchParams.get('t');
    await A.accounts.revokeJoinLink(cook.profile_id);
    assert.equal((await A.accounts.peekLink(t)).status, 'revoked');
    const fresh = await A.accounts.joinLink(cook.profile_id);
    assert.notEqual(fresh.url, link.url);
  });

  await check('signing a phone out kills its key: the next call is signed out, heard once', async () => {
    const spare = await testSignIn({ test_id: `app-cook-${run}` });
    phone(spare);
    await A.accounts.signOut();
    let heard = 0;
    const off = C.onDeadKey(() => (heard += 1));
    const e = await refused(A.accounts.family(spare.profile_id));
    assert.deepEqual([e.status, heard], [401, 1]);
    off();
  });
} finally {
  // Delete everyone: Nani (from her new phone once she moved to it, else from the cook's), then the kid, then the
  // cook (whose family then ends).
  const naniFrom = newPhone?.profile_id ? { key: newPhone.device_key, personId: nani.id } : nani && cook && { key: cook.device_key, personId: cook.profile_id, as: nani.id };
  const order = [naniFrom, kid && { key: kid.device_key, personId: kid.profile_id }, cook && { key: cook.device_key, personId: cook.profile_id }].filter(Boolean);
  for (const d of order) {
    C.setAwsCredentials({ deviceKey: d.key, personId: d.personId });
    try {
      assert.deepEqual(await A.accounts.deleteAccount(d.as), { deleted: true });
    } catch (e) {
      console.error(`could not delete a test person: ${e.status} ${e.message}`);
    }
  }
}

await check('after deleting, the cook\'s key is dead', async () => {
  C.setAwsCredentials({ deviceKey: cook.device_key, personId: cook.profile_id });
  const e = await refused(A.accounts.family(cook.profile_id));
  assert.equal(e.status, 401);
});

console.log(`\n${passed} passed (test people made and deleted: cook, Nani, kid; Nani moved to a new phone)`);

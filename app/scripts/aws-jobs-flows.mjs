// The Jobs flows on AWS staging, through the app's own client (src/lib/aws), with test people from the staging-only
// test sign-in (ACCOUNTS.md, "Staging testing"). It uploads real bytes to staging's S3 (made-up, 64 KiB: staging runs
// no worker, so a job stops at queued), and deletes everyone it made.
//   node scripts/aws-jobs-flows.mjs [base url]      default: staging over HTTPS
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
const J = await import(pathToFileURL(join(root, 'src/lib/aws/jobs.ts')).href);
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
  const res = await fetch(`${BASE}/v1/test/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-signin-key': KEY },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200, `test sign-in answered ${res.status}`);
  return res.json();
}
const phone = (a) => C.setAwsCredentials({ deviceKey: a.device_key, personId: a.profile_id });
/** One PUT of the bytes, as the phone's background upload does: exactly the headers it was given. */
async function put(link, bytes) {
  const res = await fetch(link.url, { method: 'PUT', headers: link.headers, body: bytes });
  return res.status;
}
/** The live poll's next answer for this person, through watchTopic. */
function nextJobs(as) {
  return new Promise((resolve, reject) => {
    const off = L.watchTopic('jobs', (d) => {
      off();
      resolve(d);
    }, { as, onStop: (why) => reject(new Error(`poll stopped: ${why}`)) });
  });
}

const run = randomBytes(4).toString('hex');
const bytes = randomBytes(64 * 1024);
const video = { contentType: 'video/mp4', size: bytes.length, durationS: 3 };
let cook, cook2, kid, nani;

try {
  await check('a cook signs up and gets her session', async () => {
    await testSignIn({ test_id: `jobs-cook-${run}` });
    cook = await testSignIn({ test_id: `jobs-cook-${run}`, name: `Jobs Cook ${run}`, role: 'cook' });
    phone(cook);
    assert.equal((await A.accounts.session()).role, 'cook');
  });

  let upload, job;
  const key = `upload-${randomUUID()}`;
  await check('links for one video, and the same Idempotency-Key gives the same upload', async () => {
    upload = await J.jobs.newUpload([video], key);
    const again = await J.jobs.newUpload([video], key);
    assert.equal(again.uploadId, upload.uploadId);
    assert.equal(upload.uploads[0].method, 'PUT');
    assert.equal(upload.uploadPath, `${upload.uploadId}/`);
    return `expires in ${upload.expiresInS}s`;
  });

  await check('the job is made before the bytes land: uploading, and the same uploadId answers the same job', async () => {
    job = await J.jobs.create({ uploadId: upload.uploadId, title: `Test Dal ${run}`, language: 'hi' });
    const again = await J.jobs.create({ uploadId: upload.uploadId, title: 'ignored' });
    assert.equal(again.jobId, job.jobId);
    const j = await J.jobs.get(job.jobId);
    assert.deepEqual([j.stage, j.title, j.uploadPath], ['uploading', `Test Dal ${run}`, `${upload.uploadId}/`]);
    return job.recipeId ? 'with a processing card' : 'no card (recipe writes off on staging)';
  });

  await check('/complete before the PUT lists the video as missing', async () => {
    const c = await J.jobs.complete(upload.uploadId);
    assert.deepEqual([c.complete, c.missing, c.cancelled], [false, [1], false]);
  });

  await check('a PUT of the wrong length is refused by S3; the exact bytes land', async () => {
    assert.notEqual(await put(upload.uploads[0], bytes.subarray(0, 100)), 200, 'the link is signed for one length');
    assert.equal(await put(upload.uploads[0], bytes), 200);
  });

  await check('/complete then says it is all in, and the job is queued', async () => {
    const c = await J.jobs.complete(upload.uploadId);
    assert.deepEqual([c.complete, c.missing, c.job?.jobId, c.job?.stage], [true, [], job.jobId, 'queued']);
  });

  await check('the live poll shows her queued job', async () => {
    const list = await nextJobs(null);
    const mine = list.find((j) => j._id === job.jobId);
    assert.equal(mine?.stage, 'queued');
    return `${list.length} job(s)`;
  });

  await check('a second cook and a kid in the family see none of it, and cannot stop it', async () => {
    const link = await A.accounts.joinLink(cook.profile_id);
    const t = new URL(link.url).searchParams.get('t');
    cook2 = await testSignIn({ test_id: `jobs-cook2-${run}`, name: `Second Cook ${run}`, role: 'cook', join_token: t });
    kid = await testSignIn({ test_id: `jobs-kid-${run}`, name: `Jobs Kid ${run}`, join_token: t });
    phone(cook2);
    assert.deepEqual((await J.jobs.list()).jobs, []);
    assert.deepEqual(await nextJobs(null), [], 'her live poll is empty');
    assert.equal((await refused(J.jobs.get(job.jobId))).code, 'not_found');
    assert.equal((await refused(J.jobs.cancel(job.jobId))).code, 'not_found');
    phone(kid);
    assert.deepEqual((await J.jobs.list()).jobs, []);
    assert.equal((await refused(J.jobs.newUpload([video], `kid-${randomUUID()}`))).code, 'forbidden', 'a kid cannot film');
  });

  await check('the cook stops it: failed, Cancelled, cancelledAt set; again is stopped: false', async () => {
    phone(cook);
    assert.deepEqual(await J.jobs.cancel(job.jobId), { stopped: true });
    const j = await J.jobs.get(job.jobId);
    assert.equal(j.stage, 'failed');
    assert.ok(j.cancelledAt);
    assert.deepEqual(await J.jobs.cancel(job.jobId), { stopped: false });
  });

  await check('a stop before the job exists: the upload is cancelled, and a job for it is then refused', async () => {
    const u = await J.jobs.newUpload([video], `upload-${randomUUID()}`);
    assert.deepEqual(await J.jobs.cancelUpload(u.uploadId), { stopped: false });
    const e = await refused(J.jobs.create({ uploadId: u.uploadId }));
    assert.deepEqual([e.status, e.code], [400, 'invalid']);
    assert.equal((await J.jobs.complete(u.uploadId)).cancelled, true);
  });

  await check('checked before sending, and the api agrees: a size of 0 is refused', async () => {
    assert.equal(J.checkVideos([{ ...video, size: 0 }]), 'size');
    const e = await refused(J.jobs.newUpload([{ ...video, size: 0 }], `upload-${randomUUID()}`));
    assert.equal(e.code, 'invalid');
  });

  await check('a phone-less person films from the cook\'s phone with her own session and her own jobs', async () => {
    phone(cook);
    nani = await A.accounts.addPerson({ name: `Nani ${run}`, role: 'cook' }, cook.profile_id);
    C.setAwsCredentials({ personId: nani.id });
    const u = await J.jobs.newUpload([video], `upload-${randomUUID()}`);
    const j = await J.jobs.create({ uploadId: u.uploadId });
    assert.ok((await J.jobs.list()).jobs.some((x) => x._id === j.jobId));
    C.setAwsCredentials({ personId: cook.profile_id });
    assert.ok(!(await J.jobs.list()).jobs.some((x) => x._id === j.jobId), 'not in the cook\'s own list');
    C.setAwsCredentials({ personId: nani.id });
    await J.jobs.cancel(j.jobId);
  });

  await check('her recipes: none yet (no worker on staging), and the list answers', async () => {
    phone(cook);
    const all = await J.recipes.all();
    return `${all.length} recipe(s)`;
  });
} finally {
  L.stopAllPolls();
  const order = [
    nani && cook && { key: cook.device_key, personId: cook.profile_id, as: nani.id },
    kid && { key: kid.device_key, personId: kid.profile_id },
    cook2 && { key: cook2.device_key, personId: cook2.profile_id },
    cook && { key: cook.device_key, personId: cook.profile_id },
  ].filter(Boolean);
  for (const d of order) {
    C.setAwsCredentials({ deviceKey: d.key, personId: d.personId });
    try {
      await A.accounts.deleteAccount(d.as);
    } catch (e) {
      console.error(`could not delete a test person: ${e.status} ${e.code}`);
    }
  }
}

console.log(`\n${passed} passed (test people made and deleted: two cooks, Nani, a kid)`);

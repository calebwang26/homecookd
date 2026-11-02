// The Accounts routes on AWS staging, through the app's own client (src/lib/aws). Only calls that change nothing
// but rate-limit counters: is the api up, and does every refusal come back the way the app reads it?
//   node scripts/aws-accounts-staging.mjs [base url]      default: staging's load balancer (plain HTTP)
// It makes 1 unknown-key call of the 20 per 10 minutes staging allows per address. The signed-in paths
// (sign-up, join, leave, delete) wait for the staging test sign-in (ACCOUNTS.md, "Staging testing").
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE = (process.argv[2] || 'http://homecookd-staging-950685515.us-west-2.elb.amazonaws.com').replace(/\/+$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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
const show = (e) => `${e.status} ${e.code || '-'} ${e.kind} "${e.message}"${e.requestId ? ' id' : ''}`;
const token = (n) => randomBytes(n).toString('base64url').slice(0, n);

console.log(`AWS api at ${BASE}`);
await check('GET /health answers ok', async () => {
  assert.equal(await (await fetch(`${BASE}/health`)).text(), 'ok');
});
await check('GET /ready: the database is reachable', async () => {
  assert.deepEqual(await (await fetch(`${BASE}/ready`)).json(), { database: 'ok' });
});
await check('an unknown path is a 404 the app reads as down (no_route) or, before the error-shape PR, not_found', async () => {
  const e = await refused(C.request('/v1/no-such-route-here', { auth: 'none' }));
  assert.equal(e.status, 404);
  assert.ok(['no_route', 'not_found'].includes(e.code), e.code);
  return show(e);
});
await check('a /v1 route with no session is signed_out', async () => {
  const e = await refused(C.request('/v1/me', { auth: 'none' }));
  assert.deepEqual([e.status, e.kind], [401, 'signed_out']);
  return show(e);
});
await check('GET /family with a made-up key is a 401, and the client drops that key', async () => {
  let heard = 0;
  C.onDeadKey(() => (heard += 1));
  C.setAwsCredentials({ deviceKey: token(43), personId: randomUUID() });
  const e = await refused(A.accounts.family());
  assert.deepEqual([e.status, e.kind, heard, C.awsPersonId()], [401, 'signed_out', 1, null]);
  C.onDeadKey(null);
  return show(e);
});
await check('POST /v1/sessions/start with a made-up key is "This phone was signed out."', async () => {
  C.setAwsCredentials({ deviceKey: token(43), personId: randomUUID() });
  const e = await refused(A.accounts.session());
  assert.deepEqual([e.status, e.kind], [401, 'signed_out']);
  return show(e);
});
await check('POST /invites/peek of a link that does not exist is a 404 refusal', async () => {
  const e = await refused(A.accounts.peekLink(token(22)));
  assert.deepEqual([e.status, e.kind], [404, 'refused']);
  return show(e);
});
await check('POST /link/open of a card that does not exist is a 404 refusal', async () => {
  const e = await refused(A.accounts.openCard(token(22)));
  assert.deepEqual([e.status, e.kind], [404, 'refused']);
  return show(e);
});
await check('POST /invites/peek with no token is a 400 refusal, never retried', async () => {
  const e = await refused(C.request('/invites/peek', { auth: 'none', body: {} }));
  assert.deepEqual([e.status, e.kind], [400, 'refused']);
  return show(e);
});

console.log(`\n${passed} passed`);

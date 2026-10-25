// Unit tests for staying signed in (docs/agents/memory/never-signed-out-by-a-crash.md). TS run by
// Node's type stripping, with the network and the phone's keychain faked:
//   src/lib/api.ts      only the server's exact "This phone was signed out." (a 401) forgets this
//                       phone's key; a gateway's 401, a 500 or no network leave it alone
//   src/lib/storage.ts  secretRead: a keychain that can't answer (a locked phone, a launch in the
//                       background) throws instead of looking like "nothing saved"
//   node scripts/test-signin.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The keychain: a map, and a switch that makes it fail like a locked phone's.
globalThis.__keychain = { items: new Map(), locked: false };
const js = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const store = `
  const k = globalThis.__keychain;
  const gate = () => { if (k.locked) throw new Error('User interaction is not allowed.'); };
  export const getItemAsync = async (key) => { gate(); return k.items.has(key) ? k.items.get(key) : null; };
  export const setItemAsync = async (key, v) => { gate(); k.items.set(key, v); };
  export const deleteItemAsync = async (key) => { gate(); k.items.delete(key); };`;
const FAKES = {
  'react-native': js("export const Platform = { OS: 'ios' };"),
  'expo-secure-store': js(store),
  '@react-native-async-storage/async-storage': js(`const m = new Map(); export default {
    getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) };`),
};
registerHooks({
  resolve(spec, ctx, next) {
    if (FAKES[spec]) return { url: FAKES[spec], shortCircuit: true };
    if (spec.startsWith('./') && ctx.parentURL?.includes('/src/lib/') && !/\.[a-z]+$/.test(spec)) {
      return next(pathToFileURL(join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`)).href, ctx);
    }
    return next(spec, ctx);
  },
});

const A = await import(pathToFileURL(join(root, 'src/lib/api.ts')).href);
const S = await import(pathToFileURL(join(root, 'src/lib/storage.ts')).href);

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

/** Every fetch answers this, and what was sent is kept. */
function answer(status, body) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, headers: init?.headers ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return sent;
}

/** Signed in with key k1; resolves to how often the session heard "signed out". */
async function familyAfter(status, body) {
  A.setApiAuth({ deviceKey: 'k1', code: null, profileId: null });
  let heard = 0;
  A.setSignedOutHandler(() => (heard += 1));
  const sent = answer(status, body);
  const err = await A.api.family().then(() => null, (e) => e);
  A.setSignedOutHandler(null);
  return { heard, err, sent, key: A.getApiAuth().key };
}

await test('only a 401 with exactly "This phone was signed out." counts as signed out', () => {
  assert.equal(A.isSignedOutAnswer(401, { error: A.SIGNED_OUT }), true);
  assert.equal(A.isSignedOutAnswer(401, { msg: 'Invalid JWT' }), false, 'the Supabase gateway (verify_jwt on by mistake)');
  assert.equal(A.isSignedOutAnswer(401, { error: 'Family code not recognised' }), false);
  assert.equal(A.isSignedOutAnswer(401, null), false, 'a proxy page, no JSON');
  assert.equal(A.isSignedOutAnswer(403, { error: A.SIGNED_OUT }), false);
  assert.equal(A.isSignedOutAnswer(500, { error: A.SIGNED_OUT }), false);
});

await test('the server signed this phone out: the key is dropped and the session hears it once', async () => {
  const r = await familyAfter(401, { error: A.SIGNED_OUT });
  assert.equal(r.heard, 1);
  assert.equal(r.key, null);
  assert.equal(r.err?.status, 401);
  assert.equal(r.sent[0].headers['x-device-key'], 'k1');
});

await test('a gateway 401, a proxy page or a 500 never signs anyone out', async () => {
  for (const [status, body] of [
    [401, { msg: 'Invalid JWT' }],
    [401, '<html>401 Unauthorized</html>'],
    [500, { error: 'Something went wrong on our side. Please try again.' }],
    [503, 'upstream connect error'],
  ]) {
    const r = await familyAfter(status, body);
    assert.equal(r.heard, 0, `${status} ${JSON.stringify(body)}`);
    assert.equal(r.key, 'k1', 'the key stays');
    assert.ok(r.err instanceof A.ApiError);
  }
});

await test('no network never signs anyone out', async () => {
  A.setApiAuth({ deviceKey: 'k1', code: null, profileId: null });
  let heard = 0;
  A.setSignedOutHandler(() => (heard += 1));
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };
  const err = await A.api.family().then(() => null, (e) => e);
  A.setSignedOutHandler(null);
  assert.equal(err?.kind, 'network');
  assert.equal(heard, 0);
  assert.equal(A.getApiAuth().key, 'k1');
});

await test('a keychain that cannot answer is not "nothing saved"', async () => {
  const k = globalThis.__keychain;
  k.items.set('homecookd.deviceKey', 'k1');
  assert.equal(await S.secretRead('deviceKey'), 'k1');
  k.locked = true;
  await assert.rejects(S.secretRead('deviceKey'), /not allowed/, 'secretRead says it could not read');
  assert.equal(await S.secretGet('deviceKey'), null, 'secretGet (other callers) still never throws');
  k.locked = false;
  assert.equal(await S.secretRead('deviceKey'), 'k1', 'unlocked: the key was there all along');
  k.items.clear();
  assert.equal(await S.secretRead('deviceKey'), null, 'really nothing saved');
  k.items.set('edible.deviceKey', 'old');
  assert.equal(await S.secretRead('deviceKey'), 'old', 'a key saved before the rename');
  assert.equal(k.items.get('homecookd.deviceKey'), 'old', 'moved to the new name');
});

console.log(`\n${passed} passed`);

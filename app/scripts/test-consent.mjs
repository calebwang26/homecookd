// Unit tests for "Before we start" (src/lib/aiConsent.ts): the yes saved on the phone under a versioned
// key, when the root layout sends someone to /consent, and the web dev aids that skip it. TS run by
// Node's type stripping, with the phone's storage faked.
//   node scripts/test-consent.mjs
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

globalThis.__DEV__ = false;
globalThis.__kv = new Map();
const js = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const FAKES = {
  react: js('export const useSyncExternalStore = (_s, get) => get();'),
  'react-native': js("export const Platform = { OS: 'ios' }; export const AppState = { currentState: 'active' };"),
  'expo-secure-store': js('export const getItemAsync = async () => null; export const setItemAsync = async () => {}; export const deleteItemAsync = async () => {};'),
  '@react-native-async-storage/async-storage': js(`const m = globalThis.__kv; export default {
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

const C = await import(pathToFileURL(join(root, 'src/lib/aiConsent.ts')).href);

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
const SAVED = 'homecookd.aiConsent.v1';
const settle = () => new Promise((r) => setTimeout(r, 0));

await test('the key is versioned: aiConsent.v1', () => {
  assert.equal(C.AI_CONSENT_KEY, 'aiConsent.v1');
});

await test('nothing saved: loading while it reads (the gate waits), then needed', async () => {
  assert.equal(C.getAiConsent(), 'loading');
  await settle();
  assert.equal(C.getAiConsent(), 'needed');
});

await test('I agree: saved as the ISO time of the tap, and given from then on', async () => {
  const at = new Date('2026-10-25T18:30:00.000Z');
  await C.agreeToAi(at);
  assert.equal(globalThis.__kv.get(SAVED), '2026-10-25T18:30:00.000Z');
  assert.equal(C.getAiConsent(), 'given');
  assert.equal(await C.readAiConsent(), 'given');
});

await test('a yes under an older version, or anything that is not a time, asks again', async () => {
  globalThis.__kv.clear();
  globalThis.__kv.set('homecookd.aiConsent.v0', '2026-10-01T00:00:00.000Z');
  globalThis.__kv.set('homecookd.aiConsent', '2026-10-01T00:00:00.000Z');
  assert.equal(await C.readAiConsent(), 'needed');
  for (const junk of ['yes', 'true', '', 'later']) {
    globalThis.__kv.set(SAVED, junk);
    assert.equal(await C.readAiConsent(), 'needed', junk);
  }
  assert.equal(C.isAgreed(null), false);
});

await test('signing out forgets the yes', async () => {
  await C.agreeToAi();
  await C.forgetAiConsent();
  assert.equal(globalThis.__kv.has(SAVED), false);
  assert.equal(C.getAiConsent(), 'needed');
});

await test('the gate: signed in (or offline with the last family) and no yes -> /consent', () => {
  for (const status of ['ready', 'offline']) {
    for (const p of ['/', '/kid/home', '/parent/home', '/record', '/recording', '/cook/biryani', '/recipe/biryani', '/chat/abc']) {
      assert.equal(C.consentFirst('needed', status, p), true, `${status} ${p}`);
    }
  }
});

await test('the gate leaves sign-in, the /i /r /d links and the page itself alone', () => {
  for (const p of ['/join', '/join-code', '/i', '/r', '/d', '/consent']) assert.equal(C.consentFirst('needed', 'ready', p), false, p);
});

await test('the gate waits: signed out, still loading, the yes not read yet, or already given', () => {
  assert.equal(C.consentFirst('needed', 'needs-code', '/kid/home'), false);
  assert.equal(C.consentFirst('needed', 'loading', '/'), false);
  assert.equal(C.consentFirst('loading', 'ready', '/'), false);
  assert.equal(C.consentFirst('given', 'ready', '/kid/home'), false);
});

await test('web dev aids skip it (?as=, ?profiles=, ?preview=) unless consent=ask', () => {
  assert.equal(C.devSkipsConsent('?as=leo'), true);
  assert.equal(C.devSkipsConsent('?profiles=locked&nosplash=1'), true);
  assert.equal(C.devSkipsConsent('?preview=made&as=mom'), true);
  assert.equal(C.devSkipsConsent('?profiles=locked&consent=ask'), false);
  assert.equal(C.devSkipsConsent(''), false);
  assert.equal(C.devSkipsConsent('?nosplash=1&fixture=pending'), false);
});

console.log(`\n${passed} passed`);

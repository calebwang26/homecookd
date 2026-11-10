// Unit tests for asking before anything goes to the AI companies (src/lib/aiConsent.ts): the yes saved
// on the phone under a versioned key, ensureAiConsent() answering at once or through the one sheet, and
// a check that every way someone's videos, voice or photos reach an AI service asks (or refuses)
// before it sends, while browsing never does. TS run by Node's type stripping, with the phone's
// storage faked.
//   node scripts/test-consent.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
const SAVED = 'homecookd.aiConsent.v2';
const settle = () => new Promise((r) => setTimeout(r, 0));
/** The sheet is up (what AiConsentHost shows). */
const asking = () => C.useAiConsentAsking();
/** A promise's state without waiting for it. */
const peek = async (p) => {
  let out = 'pending';
  p.then((v) => (out = v));
  await settle();
  return out;
};

await test('the key is versioned: aiConsent.v2 (Claude took over the recipe, so a yes to the old list asks again)', () => {
  assert.equal(C.AI_CONSENT_KEY, 'aiConsent.v2');
});

await test('nothing saved: loading while it reads, then needed, and no sheet until something asks', async () => {
  assert.equal(C.getAiConsent(), 'loading');
  await settle();
  assert.equal(C.getAiConsent(), 'needed');
  assert.equal(asking(), false);
});

await test('first use: the sheet rises, and "OK, continue" saves the time of the tap and lets the action go on', async () => {
  const ok = C.ensureAiConsent();
  assert.equal(await peek(ok), 'pending');
  assert.equal(asking(), true);
  await C.answerAiConsent(true);
  assert.equal(await ok, true);
  assert.equal(asking(), false);
  assert.ok(C.isAgreed(globalThis.__kv.get(SAVED)));
  assert.equal(C.getAiConsent(), 'given');
});

await test('a saved yes: true at once, with no sheet', async () => {
  const ok = C.ensureAiConsent();
  assert.equal(asking(), false);
  assert.equal(await ok, true);
  assert.equal(C.askAiConsentNow(), true);
  await C.requireAiConsent();
});

await test('the yes saved as an ISO time', async () => {
  await C.agreeToAi(new Date('2026-10-26T18:30:00.000Z'));
  assert.equal(globalThis.__kv.get(SAVED), '2026-10-26T18:30:00.000Z');
  assert.equal(await C.readAiConsent(), 'given');
});

await test('signing out forgets the yes, and an open sheet answers no', async () => {
  await C.forgetAiConsent();
  assert.equal(globalThis.__kv.has(SAVED), false);
  assert.equal(C.getAiConsent(), 'needed');
  const ok = C.ensureAiConsent();
  await settle();
  assert.equal(asking(), true);
  await C.forgetAiConsent();
  assert.equal(await ok, false);
  assert.equal(asking(), false);
});

await test('"Not now": false, nothing saved, and the next use asks again', async () => {
  const ok = C.ensureAiConsent();
  await settle();
  await C.answerAiConsent(false);
  assert.equal(await ok, false);
  assert.equal(globalThis.__kv.has(SAVED), false);
  assert.equal(C.getAiConsent(), 'needed');
  const again = C.ensureAiConsent();
  await settle();
  assert.equal(asking(), true);
  await C.answerAiConsent(false);
  assert.equal(await again, false);
});

await test('a sheet dropped unseen (held behind another for 30 s: BottomSheet onDropped, which is its onClose, "Not now") saves nothing; the next use asks as the first time', async () => {
  // AiConsentSheet passes no onDropped, so a drop calls its onClose: answerAiConsent(false).
  const ok = C.ensureAiConsent();
  await settle();
  const before = new Map(globalThis.__kv);
  await C.answerAiConsent(false);
  assert.equal(await ok, false, 'nothing is sent');
  assert.deepEqual(new Map(globalThis.__kv), before, 'no key written: no time, no asked flag, no "don\'t ask again"');
  assert.equal(C.getAiConsent(), 'needed');
  const again = C.ensureAiConsent();
  await settle();
  assert.equal(asking(), true, 'Start recording asks again');
  await C.answerAiConsent(true);
  assert.equal(await again, true);
  await C.forgetAiConsent();
});

await test('two asks at once share one sheet and its one answer', async () => {
  const a = C.ensureAiConsent();
  const b = C.ensureAiConsent();
  await settle();
  assert.equal(asking(), true);
  await C.answerAiConsent(true);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  await C.forgetAiConsent();
});

await test('a hold (askAiConsentNow): false and the sheet rises, until there is a yes', async () => {
  assert.equal(C.askAiConsentNow(), false);
  await settle();
  assert.equal(asking(), true);
  await C.answerAiConsent(true);
  assert.equal(C.askAiConsentNow(), true);
  await C.forgetAiConsent();
});

await test('the senders refuse without a yes, and never raise the sheet', async () => {
  await assert.rejects(C.requireAiConsent(), C.NoAiConsent);
  assert.equal(asking(), false);
  assert.equal(await C.hasAiConsent(), false);
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

// ---------------------------------------------------------------------------------------------
// Every way in asks (or refuses) before it sends. Read from the source: `gate` must come before `send`.

const src = (p) => readFileSync(join(root, 'src', p), 'utf8');
/** The text of `fn`'s body, from its declaration to the next top-level declaration. */
const body = (text, fn) => {
  const at = text.indexOf(fn);
  assert.ok(at >= 0, `${fn} not found`);
  const end = text.slice(at + fn.length).search(/\n(export |function |const [A-Z])/);
  return end < 0 ? text.slice(at) : text.slice(at, at + fn.length + end);
};
const before = (where, text, gate, send) => {
  const g = text.indexOf(gate);
  const s = text.indexOf(send);
  assert.ok(g >= 0, `${where}: no ${gate}`);
  assert.ok(s >= 0, `${where}: no ${send}`);
  assert.ok(g < s, `${where}: ${gate} must come before ${send}`);
};

await test('uploads and jobs: Record, Send and sendDraft ask or refuse before anything goes', () => {
  const record = src('app/record.tsx');
  before('record open', body(record, 'const open = async'), 'ensureAiConsent()', 'setSheet(true)');
  const start = body(record, 'const start = async');
  before('record start', start, 'ensureAiConsent()', 'pick.library(');
  before('record start', start, 'ensureAiConsent()', 'startRecording(');
  assert.match(record, /onPress=\{\(\) => void open\(\)\}/);
  before('send', body(src('app/send.tsx'), 'const send = async'), 'ensureAiConsent()', 'sendKept(');
  before('stopped early', body(src('components/record/StoppedEarlyCard.tsx'), 'const send = async'), 'ensureAiConsent()', 'sendDraft(');
  const draft = src('components/record/sendDraft.ts');
  before('sendDraft', body(draft, 'export async function sendDraft'), 'await requireAiConsent()', 'startUpload(');
  before('ensureJob', body(draft, 'export function ensureJob'), "getAiConsent() !== 'given'", 'tryJob(row)');
});

await test('the Convex calls that reach the AI companies refuse without a yes', () => {
  const convex = src('lib/live/convex.ts');
  for (const fn of ['createJob', 'startRecording', 'answerQuestion', 'sharePhoto']) {
    assert.match(convex, new RegExp(`export async function ${fn}\\([^\\n]*\\{\\n  await requireAiConsent\\(\\);`), fn);
  }
  const community = src('lib/live/community.ts');
  assert.match(community, /export async function setShare\([^\n]*\{\n {2}if \(on\) await requireAiConsent\(\);/);
  assert.match(community, /export async function askToShare\([^\n]*\{\n {2}await requireAiConsent\(\);/);
});

await test('the live voice lines (/cook, /record) and homie’s /speak open only with a yes', () => {
  const cook = body(src('lib/live/voice.ts'), 'const connect = useCallback');
  before('voice /cook', cook, 'hasAiConsent()', 'if (real && !agreed)');
  before('voice /cook', cook, 'if (real && !agreed)', '/cook?session=');
  const record = body(src('lib/live/homie.ts'), 'const connect = useCallback');
  before('homie /record', record, 'hasAiConsent()', 'if (!stub && (!token || !agreed)) return lost();');
  before('homie /record', record, 'return lost();', '/record?session=');
  before('speak', body(src('lib/live/speak.ts'), 'async function fetchSpeech'), '!(await hasAiConsent())', '/speak`');
});

await test('cook mode: hands-free starts only after the yes, and a tap on homie asks first', () => {
  const cook = src('app/cook/[id].tsx');
  assert.match(cook, /auto: voiceHere && settled && consent === 'given'/);
  before('cook tap', body(cook, 'const potTap'), "tap === 'toggle' && consent !== 'given'", 'voice.toggle()');
  assert.match(cook, /consent !== 'needed' \|\| aiAsked\.current\) return;\n\s+aiAsked\.current = true;\n\s+void ensureAiConsent\(\)/);
});

await test('answering by voice, the voice recipe for a kid’s ask, the dish photo and the Community map ask first', () => {
  const rows = src('components/parent/LiveQuestions.tsx');
  before('Answer row', rows, 'ensureAiConsent()', "pathname: '/answer/[id]'");
  assert.match(rows, /mayStart=\{askAiConsentNow\}/);
  before('hold to talk', body(src('components/postcard/HoldToTalk.tsx'), 'const down = async'), 'mayStart && !mayStart()', 'rec.start()');
  const answer = src('app/answer/[id].tsx');
  assert.match(answer, /ready: !preview && agreed &&/);
  assert.match(answer, /ensureAiConsent\(\)\.then\(\(ok\) => \{\n\s+if \(!ok\) goBack\(\);/);
  const voiceRecipe = src('app/request/voice.tsx');
  before('voice recipe start', body(voiceRecipe, 'const start = async'), 'ensureAiConsent()', 'rec.start()');
  before('voice recipe send', body(voiceRecipe, 'const send = async'), 'ensureAiConsent()', 'sendVoiceRecipe(');
  before('postcard', body(src('components/postcard/PostcardStep.tsx'), 'const pick = async'), 'await ensureAiConsent()', 'sharePhoto(');
  before('map ask', body(src('components/community/ShareSteps.tsx'), 'const put = async'), 'ensureAiConsent()', 'askToShare(');
  before('map switch', body(src('components/community/ShareNearbyRow.tsx'), 'const flip = async'), 'ensureAiConsent()', 'setShare(');
});

await test('no screen after sign-in: no /consent route, no gate, home and the tabs never wait for a yes', () => {
  assert.equal(existsSync(join(root, 'src/app/consent.tsx')), false);
  const layout = src('app/_layout.tsx');
  assert.doesNotMatch(layout, /'\/consent'|name="consent"|consentFirst/);
  assert.match(layout, /<AiConsentHost \/>/);
  // The background resend waits for the yes and never asks on its own.
  assert.match(layout, /\{aiOk \? <ResendUnsent \/> : null\}/);
  assert.doesNotMatch(src('components/record/useResendUnsent.ts'), /ensureAiConsent|askAiConsentNow/);
  // Signing out still forgets it.
  assert.match(layout, /if \(status === 'needs-code'\) void forgetAiConsent\(\);/);
  for (const p of ['app/index.tsx', 'app/kid/_layout.tsx', 'app/parent/_layout.tsx', 'lib/messaging.ts', 'app/recipe/[id]/index.tsx']) {
    assert.doesNotMatch(src(p), /aiConsent/, `${p} must not ask`);
  }
});

await test('the sheet names only what each company does now: no cooking help or read-aloud (homie is off), and 1.1 on AWS names just Claude and Cartesia', async () => {
  const { EN } = await import(pathToFileURL(join(root, 'src/lib/words/en/index.ts')).href);
  for (const k of ['common.ai.line', 'common.ai.claude', 'common.ai.cartesia']) {
    assert.doesNotMatch(EN[k], /helps you cook|reads steps aloud|listen while you cook/i, k);
  }
  assert.match(EN['common.ai.claude'], /writes the recipe/);
  assert.match(EN['common.ai.cartesia'], /voice notes/);
  const sheet = src('components/consent/AiConsentSheet.tsx');
  assert.match(sheet, /\.\.\.\(AWS_ON\s*\?\s*\[\]/, 'Moss and Gemini are left out under the switch');
});

console.log(`\n${passed} passed`);

// Unit tests for the cook app's words (src/lib/words): every English word in every language, in its script, with
// the same {holes} and "homie"/"homecookd" kept; t() fills holes and falls back to English; the phone's language
// tag maps to ours; the language screen's tile order.
//   node scripts/test-words.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});

const W = await import(pathToFileURL(join(root, 'src/lib/words/words.ts')).href);
const { EN } = await import(pathToFileURL(join(root, 'src/lib/words/en/index.ts')).href);
const { TRANSLATIONS } = await import(pathToFileURL(join(root, 'src/lib/words/tr/index.ts')).href);

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

const holes = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');
const SCRIPTS = {
  hi: /\p{Script=Devanagari}/u, gu: /\p{Script=Gujarati}/u, ta: /\p{Script=Tamil}/u,
  te: /\p{Script=Telugu}/u, pa: /\p{Script=Gurmukhi}/u, ur: /\p{Script=Arabic}/u, zh: /\p{Script=Han}/u,
  ko: /\p{Script=Hangul}/u, ar: /\p{Script=Arabic}/u, tl: /[a-z]/i, es: /[a-z]/i, pt: /[a-z]/i,
};
const keys = Object.keys(EN);
/** App names and example names, which read the same in every script. */
const AS_IS = new Set(['share.app.messages', 'share.app.instagram', 'share.app.whatsapp', 'profiles.self.learnerPlaceholder']);

test('the English words: every area keyed by its name, no empty word, holes well formed', () => {
  assert.ok(keys.length > 50, `${keys.length} words`);
  for (const k of keys) {
    assert.match(k, /^(common|signin|profiles|parent|messages|share|request)\.[\w.]+$/, k);
    assert.ok(EN[k].trim(), `${k} is empty`);
    assert.doesNotMatch(EN[k].replace(/\{\w+\}/g, ''), /[{}]/, `${k}: a broken hole`);
  }
});

test('every language has every word, in its script, with the same holes, keeping homie and homecookd', () => {
  assert.deepEqual(Object.keys(TRANSLATIONS).sort(), W.UI_LANGUAGES.filter((c) => c !== 'en').sort());
  for (const [code, script] of Object.entries(SCRIPTS)) {
    const tr = TRANSLATIONS[code];
    const missing = keys.filter((k) => !tr[k]);
    assert.deepEqual(missing, [], `${code} is missing ${missing.length}: draft them with node scripts/draft-words.mjs --only=${code}`);
    for (const k of keys) {
      const t = tr[k];
      assert.equal(holes(t), holes(EN[k]), `${code} ${k}: holes`);
      for (const brand of ['homie', 'homecookd']) if (EN[k].includes(brand)) assert.ok(t.includes(brand), `${code} ${k}: keeps ${brand}`);
      // Words that are only holes, a brand or a number read the same everywhere.
      if (!AS_IS.has(k) && /[a-z]{3}/i.test(EN[k].replace(/\{\w+\}|homie|homecookd/g, ''))) assert.match(t, script, `${code} ${k}: in its script: ${t}`);
    }
    for (const k of Object.keys(tr)) assert.ok(k in EN, `${code} has a word the app no longer has: ${k}`);
  }
});

test('t() fills holes, falls back to English, and reads English for unknown languages', () => {
  const key = keys.find((k) => /\{\w+\}/.test(EN[k])) ?? keys[0];
  const hole = (EN[key].match(/\{(\w+)\}/) ?? [])[1];
  const filled = W.wordsFor('ta')(key, hole ? { [hole]: 'Shreya' } : undefined);
  if (hole) assert.ok(filled.includes('Shreya') && !filled.includes('{'), filled);
  assert.equal(W.wordsFor('xx')(keys[0]), EN[keys[0]]);
  assert.equal(W.wordsFor(null)(keys[0]), EN[keys[0]]);
  assert.equal(W.english(keys[0]), EN[keys[0]]);
  assert.equal(W.fill('Hi {name}, {n} new', { name: 'Aaji', n: 2 }), 'Hi Aaji, 2 new');
  assert.equal(W.fill('Hi {name}', {}), 'Hi ');
});

test('the phone’s language: ours or null', () => {
  assert.equal(W.uiLanguageOf('ta-IN'), 'ta');
  assert.equal(W.uiLanguageOf('fil-PH'), 'tl');
  assert.equal(W.uiLanguageOf('zh-Hans-CN'), 'zh');
  assert.equal(W.uiLanguageOf('pa_IN'), 'pa');
  assert.equal(W.uiLanguageOf('en-US'), 'en');
  assert.equal(W.uiLanguageOf('fr-FR'), null, 'French is in the picker, not yet in the app’s words');
  assert.equal(W.uiLanguageOf(undefined), null);
  assert.ok(W.isRtl('ur') && W.isRtl('ar') && !W.isRtl('ta'));
});

test('Marathi was dropped (Oct 26): a cook who saved it reads Hindi; no Marathi tile or table', () => {
  assert.ok(!W.UI_LANGUAGES.includes('mr'));
  assert.ok(!('mr' in TRANSLATIONS));
  for (const key of ['parent.tab.home', 'parent.home.record', 'profiles.language.entry']) assert.equal(W.wordsFor('mr')(key), W.wordsFor('hi')(key), key);
  assert.equal(W.uiLanguageOf('mr-IN'), 'hi', 'a Marathi phone reads Hindi too');
  assert.ok(!W.tileOrder('mr-IN').includes('mr'));
  assert.equal(W.tileOrder('mr-IN')[0], 'hi');
});

test('the language screen: the phone’s language, then English, then the rest, each once', () => {
  const ta = W.tileOrder('ta');
  assert.deepEqual(ta.slice(0, 2), ['ta', 'en']);
  assert.equal(ta.length, W.UI_LANGUAGES.length);
  assert.equal(new Set(ta).size, ta.length);
  assert.deepEqual(W.tileOrder('en').slice(0, 2), ['en', 'zh'], 'an English phone: English, then by speakers');
  assert.equal(W.tileOrder('fr')[0], 'en', 'a language we don’t have: English first');
});

console.log(`\n${passed} passed`);

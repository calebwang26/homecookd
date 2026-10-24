// Unit tests for src/lib/languages.ts (pure TS, run by Node's type stripping).
//   node scripts/test-languages.mjs
import assert from 'node:assert/strict';

const { LANGUAGES, languageName, matchLanguages } = await import('../src/lib/languages.ts');

const SONIC = 'en fr de es pt zh ja it ko nl pl ru sv tr tl bg ro ar cs el fi hr ms sk da uk hu no vi th he ka id hi mr bn gu kn ml pa ta te or ur'.split(' ');

assert.equal(LANGUAGES.length, 30);
assert.equal(LANGUAGES[0].code, 'en');
assert.equal(new Set(LANGUAGES.map((l) => l.code)).size, 30, 'codes are unique');
for (const l of LANGUAGES) {
  assert.ok(SONIC.includes(l.code), `${l.code} is a Sonic 3.6 language`);
  assert.ok(l.name && l.native, `${l.code} has both names`);
}
assert.deepEqual(LANGUAGES.filter((l) => l.inkLive).map((l) => l.code).sort(), ['en', 'es', 'fr', 'hi', 'ja']);

const marathi = matchLanguages('mar');
assert.equal(marathi[0].code, 'mr');
assert.equal(`${marathi[0].name} · ${marathi[0].native}`, 'Marathi · मराठी');
assert.equal(matchLanguages('MARATHI')[0].code, 'mr');
assert.equal(matchLanguages('मरा')[0].code, 'mr', 'native names match too');
assert.equal(matchLanguages('español')[0].code, 'es');
assert.deepEqual(matchLanguages('  ').map((l) => l.code), LANGUAGES.map((l) => l.code));
// Prefix matches come before substring ones: "ta" → Tamil, Tagalog first; Gujarati / Kannada... later.
const ta = matchLanguages('ta').map((l) => l.code);
assert.deepEqual(ta.slice(0, 2), ['ta', 'tl']);
assert.ok(ta.includes('it'), '"Italian" contains "ta"');
assert.deepEqual(matchLanguages('zzz'), []);

assert.equal(languageName('mr'), 'Marathi');
assert.equal(languageName('MR'), 'Marathi');
assert.equal(languageName(undefined), 'English');
assert.equal(languageName('xx'), 'xx');

console.log('test-languages: all passed');

// Unit tests for src/lib/languages.ts (pure TS, run by Node's type stripping).
//   node scripts/test-languages.mjs
import assert from 'node:assert/strict';

const { LANGUAGES, activeLanguage, languageName, matchLanguages } = await import('../src/lib/languages.ts');

const SONIC = 'en fr de es pt zh ja it ko nl pl ru sv tr tl bg ro ar cs el fi hr ms sk da uk hu no vi th he ka id hi mr bn gu kn ml pa ta te or ur'.split(' ');

assert.equal(LANGUAGES.length, 28);
assert.equal(LANGUAGES[0].code, 'en');
assert.equal(new Set(LANGUAGES.map((l) => l.code)).size, 28, 'codes are unique');
// Odia is hidden from the picker (Cartesia can't hear it), but a cook who picked it still reads as "Odia".
assert.ok(!LANGUAGES.some((l) => l.code === 'or') && matchLanguages('odia').length === 0);
assert.equal(languageName('or'), 'Odia');
for (const l of LANGUAGES) {
  assert.ok(SONIC.includes(l.code), `${l.code} is a Sonic 3.6 language`);
  assert.ok(l.name && l.native, `${l.code} has both names`);
}
assert.deepEqual(LANGUAGES.filter((l) => l.inkLive).map((l) => l.code).sort(), ['en', 'es', 'fr', 'hi', 'ja']);

// Marathi was dropped (Caleb, Oct 26): hidden like Odia, still named, and used as Hindi.
assert.ok(!LANGUAGES.some((l) => l.code === 'mr') && matchLanguages('marathi').length === 0 && matchLanguages('मराठी').length === 0);
assert.equal(activeLanguage('mr'), 'hi');
assert.equal(activeLanguage('MR'), 'hi');
assert.equal(activeLanguage('gu'), 'gu');
assert.equal(activeLanguage(undefined), null);
const gujarati = matchLanguages('guj');
assert.equal(`${gujarati[0].name} · ${gujarati[0].native}`, 'Gujarati · ગુજરાતી');
assert.equal(matchLanguages('GUJARATI')[0].code, 'gu');
assert.equal(matchLanguages('ગુજ')[0].code, 'gu', 'native names match too');
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

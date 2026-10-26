// Drafts the cook app's words in each language with Claude (src/lib/words/en → src/lib/words/tr/<code>.ts).
// Only keys a language doesn't have yet are drafted, so a new English word costs one small call per language.
//   node scripts/draft-words.mjs                 every language, missing keys only
//   node scripts/draft-words.mjs --only=ta,zh    some languages
//   node scripts/draft-words.mjs --redo=parent.  draft these keys again (a key prefix), e.g. after an English change
// Needs ANTHROPIC_API_KEY (the repo's root .env is read; the key is never printed or written). The drafts still need
// a native speaker's check: TODO(caleb) in tr/index.ts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const words = join(root, 'src/lib/words');
const { EN } = await import(pathToFileURL(join(words, 'en/index.ts')).href);
const { TRANSLATIONS } = await import(pathToFileURL(join(words, 'tr/index.ts')).href);

/** How each language is written for a grandparent (memory cook-languages; homie's own lines follow the same). */
const LANGUAGES = {
  hi: 'Hindi (Devanagari)',
  gu: 'Gujarati (Gujarati script)',
  ta: 'Tamil (Tamil script)',
  te: 'Telugu (Telugu script)',
  pa: 'Punjabi (Gurmukhi)',
  ur: 'Urdu (Urdu script)',
  zh: 'Mandarin Chinese in simplified characters',
  ko: 'Korean, polite speech',
  tl: 'Tagalog, with po/opo for respect',
  es: 'Latin American Spanish, with usted',
  pt: 'Brazilian Portuguese',
  ar: 'Modern Standard Arabic, simple and warm',
};
const INDIAN = new Set(['hi', 'gu', 'ta', 'te', 'pa', 'ur']);
const BATCH = 60;
const PARALLEL = 4; // languages at once; each sends its batches together

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const only = arg('only')?.split(',');
const redo = arg('redo');

function env(name) {
  if (process.env[name]) return process.env[name];
  for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
    const file = join(dir, '.env');
    if (!existsSync(file)) continue;
    const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  }
  throw new Error(`${name} isn't set`);
}
const apiKey = env('ANTHROPIC_API_KEY');

const holes = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(' ');

function system(code) {
  return `You translate the on-screen words of homecookd, a family cooking app, into ${LANGUAGES[code]}. The reader is a parent or grandparent (often in their 60s, not techy) who films themself cooking a family dish for a child far from home. "homie" is the app's small helper: her voice is a young woman's, so wherever the language marks gender, homie is feminine. Speak to the reader with the language's polite, respectful forms, warmly, the way a younger relative would; short, plain, everyday words, no slang or tech jargon.
You get a JSON object of key → English. The key names say where the words appear (a button, a title, a toast). Answer with the same keys, each the translation.
Rules:
- Keep every {hole} exactly as written (same name, inside braces), as many times as the English has it. A hole is filled with a person's name in Latin letters (Shreya), a dish name or a number; pick grammar that works for any name, girl or boy.${INDIAN.has(code) ? '\n- Put a space between a hole and an ending that follows it ("{name} ला", "{name} को"), as names stay in Latin letters.' : ''}
- Keep "homie" and "homecookd" exactly, lowercase, in Latin letters. Keep app and company names in English (Settings, Photos, Apple, Google, Gemini, Claude, Cartesia, Moss, Meta Muse Spark, App Store).
- Keep it about as short as the English: buttons and labels stay short. Keep the end punctuation style (no full stop where the English has none, an ellipsis where it has one).
- Translate only; add nothing.`;
}

async function draft(code, batch, note = '') {
  const keys = Object.keys(batch);
  const schema = { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])), required: keys, additionalProperties: false };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      system: system(code),
      messages: [{ role: 'user', content: JSON.stringify(batch, null, 1) + note }],
      output_config: { format: { type: 'json_schema', schema } },
    }),
  });
  if (!res.ok) throw new Error(`${code}: Claude ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (body.stop_reason !== 'end_turn') throw new Error(`${code}: stopped (${body.stop_reason})`);
  return JSON.parse(body.content.map((b) => (b.type === 'text' ? b.text : '')).join(''));
}

/** Problems a draft has, by key: a hole lost or added, homie or homecookd dropped. */
function problems(batch, out) {
  const bad = {};
  for (const [k, en] of Object.entries(batch)) {
    const t = out[k] ?? '';
    if (!t.trim()) bad[k] = 'empty';
    else if (holes(t) !== holes(en)) bad[k] = `holes ${holes(en) || 'none'} expected, got ${holes(t) || 'none'}`;
    else for (const brand of ['homie', 'homecookd']) if (en.includes(brand) && !t.includes(brand)) bad[k] = `keep "${brand}"`;
  }
  return bad;
}

async function draftChecked(code, batch) {
  let out = await draft(code, batch);
  let bad = problems(batch, out);
  if (Object.keys(bad).length) {
    const again = Object.fromEntries(Object.keys(bad).map((k) => [k, batch[k]]));
    const fixed = await draft(code, again, `\n\nLast time these broke a rule: ${JSON.stringify(bad)}`);
    out = { ...out, ...fixed };
    bad = problems(batch, out);
  }
  for (const k of Object.keys(bad)) delete out[k]; // still broken: it reads in English, and the test says which
  if (Object.keys(bad).length) console.warn(`${code}: left in English: ${JSON.stringify(bad)}`);
  // The same space rule as the recording screen's words: a Latin name, then the ending.
  if (INDIAN.has(code)) for (const k of Object.keys(out)) out[k] = out[k].replace(/\}(?=[^\s\x00-\x7f])/g, '} ');
  return out;
}

const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

function write(code, merged) {
  const name = LANGUAGES[code].split(' (')[0].split(',')[0];
  const lines = Object.keys(EN)
    .filter((k) => merged[k])
    .map((k) => `  ${quote(k)}: ${quote(merged[k])},`);
  const text = `// ${name}: the cook app's words, Claude's drafts (scripts/draft-words.mjs). TODO(caleb): a native speaker's check.
import type { Translation } from '.';

const words: Translation = {
${lines.join('\n')}
};

export default words;
`;
  writeFileSync(join(words, `tr/${code}.ts`), text);
}

async function language(code) {
  const have = { ...(TRANSLATIONS[code] ?? {}) };
  if (redo) for (const k of Object.keys(have)) if (k.startsWith(redo)) delete have[k];
  for (const k of Object.keys(have)) if (!(k in EN)) delete have[k]; // a word the app no longer has
  const missing = Object.keys(EN).filter((k) => !have[k]);
  const batches = [];
  for (let i = 0; i < missing.length; i += BATCH) batches.push(Object.fromEntries(missing.slice(i, i + BATCH).map((k) => [k, EN[k]])));
  for (const out of await Promise.all(batches.map((b) => draftChecked(code, b)))) Object.assign(have, out);
  write(code, have);
  console.log(`${code}: ${missing.length} drafted, ${Object.keys(have).length}/${Object.keys(EN).length} words`);
}

const queue = Object.keys(LANGUAGES).filter((c) => !only || only.includes(c));
const failed = [];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    for (let code = queue.shift(); code; code = queue.shift()) await language(code).catch((e) => failed.push(`${code}: ${e.message}`));
  }),
);
if (failed.length) {
  console.error(failed.join('\n'));
  process.exit(1);
}

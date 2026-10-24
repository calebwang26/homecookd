// Smoke test for the app's API client (src/lib/api.ts) against the deployed backend, acting as the
// TEST family (code in docs/build/.test-family-code, gitignored). Never touches the demo family and
// never prints the code.
//
//   node scripts/api-smoke.mjs            (from app/)
//   node scripts/api-smoke.mjs --signup   also exercises POST /signup (creates a throwaway family)
//
// Node 24 strips the TypeScript types, so this imports and runs the real src/lib/api.ts.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, '..');
const repo = join(appDir, '..');

// API base from app/.env (public value), unless already set.
if (!process.env.EXPO_PUBLIC_API_URL) {
  const env = existsSync(join(appDir, '.env')) ? readFileSync(join(appDir, '.env'), 'utf8') : '';
  const m = /^EXPO_PUBLIC_API_URL=(.+)$/m.exec(env);
  process.env.EXPO_PUBLIC_API_URL = (m?.[1] ?? 'https://aaxyabymvwxlxrxwxgwv.supabase.co/functions/v1/api').trim();
}
const codeFile = join(repo, 'docs/build/.test-family-code');
if (!existsSync(codeFile)) {
  console.error('Missing docs/build/.test-family-code (the test family code).');
  process.exit(2);
}
const TEST_CODE = readFileSync(codeFile, 'utf8').trim();

const { api, ApiError, setApiAuth } = await import('../src/lib/api.ts');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    pass++;
    console.log(`PASS  ${name}${note ? `  (${note})` : ''}  ${Date.now() - t}ms`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}: ${e instanceof ApiError ? `${e.status} ${e.kind} ${e.message}` : e?.message ?? e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const RECIPE = 'gordon-gnocchi';
setApiAuth({ code: TEST_CODE, profileId: null });

let profiles = [];
await check('GET /family', async () => {
  const r = await api.family();
  assert(r.family?.id && Array.isArray(r.profiles), 'bad shape');
  profiles = r.profiles;
  return `${r.profiles.length} profiles`;
});

// Make sure there is one cook and one learner to talk between.
async function ensure(role, name) {
  const have = profiles.find((p) => p.role === role);
  if (have) return have;
  const p = await api.createProfile({ name, role, relation: role === 'cook' ? 'Test cook' : 'Test learner' });
  profiles.push(p);
  return p;
}
let cook, kid;
await check('POST /profiles (or reuse)', async () => {
  cook = await ensure('cook', 'Smoke Cook');
  kid = await ensure('learner', 'Smoke Kid');
  return `${cook.name} + ${kid.name}`;
});
if (!cook || !kid) process.exit(1);

await check('POST /profiles duplicate -> 409', async () => {
  try {
    await api.createProfile({ name: cook.name, role: 'cook' });
  } catch (e) {
    assert(e instanceof ApiError && e.status === 409, `expected 409, got ${e.status}`);
    return e.message;
  }
  throw new Error('no error');
});

await check('wrong family code -> 401 ApiError', async () => {
  try {
    await api.family({ code: 'NOPE-NOPE' });
  } catch (e) {
    assert(e instanceof ApiError && e.status === 401 && e.unauthorized, `got ${e.status}`);
    return e.message;
  }
  throw new Error('no error');
});

await check('unknown profile -> 403', async () => {
  try {
    await api.unread({ profileId: '00000000-0000-0000-0000-000000000000' });
  } catch (e) {
    assert(e instanceof ApiError && e.status === 403, `got ${e.status}`);
    return e.message;
  }
  throw new Error('no error');
});

setApiAuth({ profileId: kid.id });
let threadId;
let last;
await check('GET /unread', async () => `total ${(await api.unread()).total}`);
await check('GET /threads', async () => `${(await api.threads()).length} threads`);
await check('POST /threads (get or create)', async () => {
  const a = await api.openThread(cook.id);
  const b = await api.openThread(cook.id);
  assert(a.id === b.id, 'not idempotent');
  threadId = a.id;
  return `other=${a.other.name}`;
});
await check('POST message text', async () => {
  last = await api.sendMessage(threadId, { kind: 'text', body: `Smoke test ${new Date().toISOString()}` });
  assert(last.kind === 'text' && last.thread_id === threadId, 'bad message');
});
await check('POST message step', async () => {
  const m = await api.sendMessage(threadId, { kind: 'step', recipe_id: RECIPE, step_order: 2, body: 'How thick should the dough be?' });
  assert(m.step_order === 2 && m.recipe_id === RECIPE, 'bad step message');
  last = m;
});
await check('POST message bad recipe -> 404', async () => {
  try {
    await api.sendMessage(threadId, { kind: 'recipe', recipe_id: 'no-such-recipe-xyz' });
  } catch (e) {
    assert(e instanceof ApiError && e.status === 404, `got ${e.status}`);
    return e.message;
  }
  throw new Error('no error');
});
await check('GET messages (all, then after)', async () => {
  const all = await api.messages(threadId);
  assert(all.length >= 2, 'too few');
  const after = await api.messages(threadId, all[all.length - 1].created_at);
  assert(after.length === 0, `after returned ${after.length}`);
  return `${all.length} messages`;
});

// Voice: generate a 1 s m4a (ffmpeg if present, else a few bytes), upload, send.
await check('voice upload + voice message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'homecookd-smoke-'));
  const file = join(dir, 'hello.m4a');
  let bytes;
  try {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-b:a', '32k', file]);
    bytes = readFileSync(file);
  } catch {
    bytes = Buffer.from('not really audio');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const up = await api.voiceUpload('audio/m4a');
  assert(up.path && up.upload_url && up.headers, 'bad voice-upload');
  const put = await fetch(up.upload_url, { method: 'PUT', headers: up.headers, body: bytes });
  assert(put.ok, `PUT ${put.status}`);
  const m = await api.sendMessage(threadId, { kind: 'voice', audio_path: up.path, duration_s: 1, transcript: 'A smoke test hello.' });
  assert(m.kind === 'voice' && m.audio_url, 'no signed audio_url');
  const got = await fetch(m.audio_url);
  assert(got.ok, `signed GET ${got.status}`);
  const back = Buffer.from(await got.arrayBuffer());
  assert(back.length === bytes.length, 'bytes differ');
  return `${bytes.length} bytes round-trip`;
});

await check('POST /threads/:id/read (as the cook)', async () => {
  const before = (await api.unread({ profileId: cook.id })).total;
  await api.markRead(threadId, { profileId: cook.id });
  const after = (await api.unread({ profileId: cook.id })).total;
  assert(after <= before, 'unread went up');
  return `cook unread ${before} -> ${after}`;
});

await check('POST /send-recipe', async () => {
  const r = await api.sendRecipe({ recipe_id: RECIPE, to: [cook.id], note: 'Smoke: try this' });
  assert(r.sent.length === 1 && r.sent[0].thread_id === threadId, 'bad send');
});

let token;
await check('POST /shares (stable link)', async () => {
  const a = await api.createShare(RECIPE);
  const b = await api.createShare(RECIPE);
  assert(a.token === b.token && a.url.endsWith(a.token), 'not stable');
  token = a.token;
  return a.url.replace(a.token, '<token>');
});
await check('GET /shares/:token (public, no code)', async () => {
  setApiAuth({ code: null });
  try {
    const s = await api.share(token);
    assert(s.recipe_id === RECIPE && s.recipe_url, 'bad share');
    assert(!('family_id' in s), 'leaks ids');
    return `sender=${s.sender?.name ?? 'none'}`;
  } finally {
    setApiAuth({ code: TEST_CODE });
  }
});
await check('GET /shares/bad -> 404', async () => {
  try {
    await api.share('zzzzzzzzzz');
  } catch (e) {
    assert(e instanceof ApiError && e.status === 404, `got ${e.status}`);
    return e.message;
  }
  throw new Error('no error');
});

await check('POST /events viewed + cooked', async () => {
  const v = await api.event(RECIPE, 'viewed');
  const c = await api.event(RECIPE, 'cooked');
  assert(v.ok && c.ok, 'not ok');
  return `viewed counted=${v.counted}, cooked counted=${c.counted}`;
});
await check('POST message cooked', async () => {
  const m = await api.sendMessage(threadId, { kind: 'cooked', recipe_id: RECIPE, body: 'Smoke: made it!' });
  assert(m.kind === 'cooked', 'bad');
});
await check('GET /recipes/:id/activity', async () => {
  const a = await api.activity(RECIPE);
  assert(Array.isArray(a.cooked) && Array.isArray(a.viewed), 'bad shape');
  return `cooked ${a.cooked.length}, viewed ${a.viewed.length}, last_sent ${a.last_sent_at ? 'yes' : 'no'}`;
});

await check('pending send -> job published -> delivered once', async () => {
  const job = `smoke-${Date.now().toString(36)}`;
  const p = await api.pendingSend({ job_id: job, recipient_ids: [kid.id] }, { profileId: cook.id });
  assert(p.ok, 'pending not ok');
  const d1 = await api.jobPublished(job, RECIPE);
  const d2 = await api.jobPublished(job, RECIPE);
  assert(d1.delivered === 1 && d2.already === true, `delivered ${d1.delivered}, again ${JSON.stringify(d2)}`);
  return 'delivered 1, repeat already';
});

await check('kid inbox shows the thread with unread', async () => {
  const threads = await api.threads();
  const t = threads.find((x) => x.id === threadId);
  assert(t && t.last, 'thread missing');
  return `unread ${t.unread}, last ${t.last.kind}, dish ${t.recipe_id}`;
});

if (process.argv.includes('--signup')) {
  await check('POST /signup (public)', async () => {
    const s = await api.signup({ name: 'Smoke', email: 'smoke@example.com', share_token: token });
    assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(s.family_code), 'bad code format');
    return s.family_name;
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Proves the CI simulator hooks (EXPO_PUBLIC_E2E=1: app/+native-intent.tsx's e2e/sign-in link, the fake camera) never
// reach a store build. Two iOS exports with Metro's cache cleared:
//   1. production-aws, exactly as eas.json's profile bakes it (no app/.env): must hold none of MARKS;
//      it then also goes through check-app-export.mjs, which refuses that mark itself.
//   2. the same with EXPO_PUBLIC_E2E=1 (and a clip URL): must hold them all (so 1 isn't passing only because the hooks went missing).
//   node scripts/check-e2e-stripped.mjs            about 3 minutes; needs app/node_modules
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
/** Strings only the EXPO_PUBLIC_E2E code holds: the sign-in link, the stand-in camera's clip, its label. */
const MARKS = ['e2e/sign-in', 'e2e-clip', 'Test camera'];

const build = JSON.parse(readFileSync(path.join(APP, 'eas.json'), 'utf8')).build;
const prodEnv = { ...build.production.env, ...build['production-aws'].env };

function exportWith(extra) {
  const out = mkdtempSync(path.join(tmpdir(), 'hc-e2e-'));
  // No EXPO_PUBLIC_ value from this shell: only the profile's, and `extra`.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('EXPO_PUBLIC_')));
  Object.assign(env, { EXPO_NO_DOTENV: '1' }, prodEnv, extra);
  execFileSync('npx', ['expo', 'export', '--clear', '--platform', 'ios', '--output-dir', out], { cwd: APP, env, stdio: 'ignore' });
  return out;
}
const files = (d, acc = []) => {
  for (const n of readdirSync(d)) {
    const f = path.join(d, n);
    if (statSync(f).isDirectory()) files(f, acc);
    else if (/\.(js|hbc)$/.test(f)) acc.push(f);
  }
  return acc;
};
const found = (d) => {
  const text = files(d).map((f) => readFileSync(f, 'latin1')).join('\n');
  return MARKS.filter((m) => text.includes(m));
};

const store = exportWith({});
const e2e = exportWith({ EXPO_PUBLIC_E2E: '1', EXPO_PUBLIC_E2E_CLIP_URL: 'https://example.invalid/e2e/clip-5s.mp4' });
try {
  const failures = [];
  const inStore = found(store);
  const inE2e = found(e2e);
  if (inStore.length) failures.push(`the production-aws export holds ${inStore.map((m) => `"${m}"`).join(', ')}`);
  const missing = MARKS.filter((m) => !inE2e.includes(m));
  if (missing.length) failures.push(`the EXPO_PUBLIC_E2E=1 export lacks ${missing.map((m) => `"${m}"`).join(', ')}: the hooks went missing, so (1) proves nothing`);
  const host = new URL(prodEnv.EXPO_PUBLIC_AWS_URL).host;
  try {
    execFileSync('node', [path.join(ROOT, 'scripts/check-app-export.mjs'), store, '--aws', host], { stdio: 'inherit' });
  } catch {
    failures.push('check-app-export.mjs refused the production-aws export');
  }
  for (const f of failures) console.error(`FAIL: ${f}.`);
  if (failures.length) process.exit(1);
  console.log(`ok: the production-aws export holds none of ${MARKS.join(', ')}; the EXPO_PUBLIC_E2E=1 export holds all of them.`);
} finally {
  for (const d of [store, e2e]) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
}

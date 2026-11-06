#!/usr/bin/env node
// Checks a local app export before safe-eas-update.sh publishes it. It prints no value.
//   node scripts/check-app-export.mjs app/<export dir> --aws <host>   the AWS build: the export must hold this api host
//   node scripts/check-app-export.mjs app/<export dir> --no-aws <host> any other channel: it must not
// It always refuses an export holding something shaped like a key, or app/.env's family code.
// The key shapes are the same as check-merge-safe.mjs's on aws-migration.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_SHAPES = [
  /sk-ant-[A-Za-z0-9_-]{10,}/, /AIza[0-9A-Za-z_-]{30,}/, /\btk_[A-Za-z0-9]{20,}/, /\bsk_(?:live|car)_[A-Za-z0-9]{10,}/, /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"role"\s*:\s*"service_role"/, /\b(?:prod|preview|dev):[a-z0-9-]+\|[A-Za-z0-9+/=_-]{20,}/,
];

const [out, mode, host] = process.argv.slice(2);
if (!out || !['--aws', '--no-aws'].includes(mode) || !host) {
  console.error('usage: check-app-export.mjs <export dir> --aws|--no-aws <api host>');
  process.exit(2);
}
const dir = path.resolve(ROOT, out);
if (!existsSync(dir)) {
  console.error(`REFUSED: no export at ${dir}`);
  process.exit(1);
}

const listAll = (d, acc = []) => {
  for (const name of readdirSync(d)) {
    const full = path.join(d, name);
    if (statSync(full).isDirectory()) listAll(full, acc);
    else acc.push(full);
  }
  return acc;
};
const files = listAll(dir).filter((f) => /\.(js|hbc|json|map|html)$/.test(f));
const failures = [];
const rel = (f) => path.relative(ROOT, f);

const envFile = path.join(ROOT, 'app', '.env');
const codeLine = existsSync(envFile) ? readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('EXPO_PUBLIC_FAMILY_CODE=')) : undefined;
const familyCode = codeLine?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');

let hostSeen = false;
for (const file of files) {
  const text = readFileSync(file, 'latin1');
  for (const shape of KEY_SHAPES) if (shape.test(text)) failures.push(`${rel(file)} holds something shaped like a key (${shape.source.slice(0, 12)}...).`);
  if (familyCode && text.includes(familyCode)) failures.push(`${rel(file)} holds app/.env's family code.`);
  if (text.includes(host)) hostSeen = true;
}
if (mode === '--aws' && !hostSeen) failures.push(`the export doesn't hold ${host}, so the AWS switch didn't make it into the bundle.`);
if (mode === '--no-aws' && hostSeen) failures.push(`the export holds ${host}: it was built with the AWS switch on, and this channel's phones aren't on AWS.`);

for (const f of failures) console.error(`REFUSED: ${f} Value not shown.`);
if (failures.length) process.exit(1);
console.log(`App export: ${files.length} file(s) read; ${mode === '--aws' ? 'the AWS api address is in it' : 'no AWS api address'}; no key shapes${familyCode ? ' or family code' : ''}.`);

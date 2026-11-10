// journey-scrub.mjs on made-up logs in the shapes iOS really writes: node --test scripts/journey-scrub.test.mjs
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { leftover, scrub, scrubFile } from './journey-scrub.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'journey-scrub.mjs');
const KEY = 'kid-device-key-0123456789abcdef';
const TOKEN = 'familytoken0123456789';
// The failed S3 PUT as run 42852281034 logged it (made-up values, the same fields, cut short at the line's end as iOS cut it).
const PUT =
  '2026-11-10 16:29:14.144574+0000  localhost homecookd[29891]: (CFNetwork) [com.apple.CFNetwork:Default] Task <0078996E>.<1> finished with error [-1] Error Domain=NSURLErrorDomain Code=-1 "unknown error" UserInfo={NSErrorFailingURLStringKey=https://homecookd-staging-uploads-000000000000.s3.us-west-2.amazonaws.com/jobs/j1/clip-1.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=ASIAEXAMPLEEXAMPLE00%2F20261110%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Date=20261110T162914Z&X-Amz-Expires=900&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEXAMPLEtokenEXAMPLE';

test('an S3 address keeps its host and path, and loses its whole query string', () => {
  const out = scrub(PUT);
  assert.match(out, /NSErrorFailingURLStringKey=https:\/\/homecookd-staging-uploads-000000000000\.s3\.us-west-2\.amazonaws\.com\/jobs\/j1\/clip-1\.mp4\?\*\*\*$/);
  assert.doesNotMatch(out, /ASIA|IQoJ|X-Amz-Credential=A/);
  assert.equal(leftover(out), null);
});

test('the same URL whole (not cut short), followed by more of the error, loses only the query string', () => {
  const whole = `${PUT}&X-Amz-Signature=abc123def, NSErrorFailingURLKey=https://x.s3.amazonaws.com/k?X-Amz-Date=1, _kCFStreamErrorCodeKey=-1}`;
  const out = scrub(whole);
  assert.match(out, /clip-1\.mp4\?\*\*\*, NSErrorFailingURLKey=https:\/\/x\.s3\.amazonaws\.com\/k\?\*\*\*, _kCFStreamErrorCodeKey=-1\}$/);
});

test('X-Amz values outside a URL (a header, an encoded query) go too', () => {
  const out = scrub('sent x-amz-security-token: IQoJsecret and "X-Amz-Credential=ASIAX%2F1&X-Amz-Date=2" upload');
  assert.equal(out, 'sent x-amz-security-token: *** and "X-Amz-Credential=***&X-Amz-Date=***" upload');
  assert.equal(leftover(out), null);
});

test('the exact values (keys, the link token, test ids) become ***, wherever they are', () => {
  const out = scrub(`Opening URL (homecookd://e2e/sign-in?key=${KEY}) and homecookd://i?t=${TOKEN} for j1-1-kid`, [KEY, TOKEN, 'j1-1-kid']);
  assert.equal(out, 'Opening URL (homecookd://e2e/sign-in?key=***) and homecookd://i?t=*** for ***');
});

test('a log with nothing to mask is unchanged', () => {
  const line = '2026-11-10 16:27:22.068039+0000  localhost homecookd[29891]: (CFNetwork) Task <BF44>.<1> summary for task success {response_status=403}';
  assert.equal(scrub(line, [KEY]), line);
});

function log(text) {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'scrub-')), 'Record, film, send', 'logs');
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'device-simulator.log');
  writeFileSync(f, text);
  return f;
}

test('scrubFile rewrites the log in place and says nothing', () => {
  const f = log(`${PUT}\nkey=${KEY}\n`);
  assert.equal(scrubFile(f, [KEY]), null);
  const text = readFileSync(f, 'utf8');
  assert.doesNotMatch(text, new RegExp(`${KEY}|ASIA|IQoJ`));
});

test("it fails closed: a log it can't read is deleted, and says which", () => {
  const f = log(`key=${KEY}\n`);
  chmodSync(f, 0o000);
  const line = scrubFile(f, [KEY]);
  assert.equal(line, 'dropped Record, film, send/device-simulator.log: it couldn’t be read and rewritten');
  assert.equal(existsSync(f), false);
});

test('the CLI takes the values from JOURNEY_SCRUB_VALUES (one a line, blank lines ignored) and prints only drops', () => {
  const f = log(`${PUT}\nkey=${KEY} t=${TOKEN}\n`);
  const r = spawnSync(process.execPath, [SCRIPT, f], { env: { ...process.env, JOURNEY_SCRUB_VALUES: `${KEY}\n\n${TOKEN}\n` }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(readFileSync(f, 'utf8').includes(KEY) || readFileSync(f, 'utf8').includes(TOKEN), false);
  const none = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(none.status, 0);
});

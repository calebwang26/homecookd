// Runs the real CloudFront Function against the real build: node --test infra/modules/web/rewrite.test.mjs (after cd web && npm run build).
// serve() stands in for CloudFront and S3: the Apple path skips the function (see main.tf), a missing key is the error
// page with a 404, and S3 percent-decodes keys.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { AASA_PATH, PATHS } from './paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const out = join(root, 'web', 'out');
const source = readFileSync(join(here, 'rewrite.js'), 'utf8');

assert.ok(existsSync(join(out, 'index.html')), 'Build the site first: cd web && npm ci && npm run build');

const context = {};
vm.createContext(context);
vm.runInContext(source, context);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(out, full).split(sep).join('/')];
  });
}
const files = walk(out);
const fileSet = new Set(files);

// The shape CloudFront hands a function: raw values, a repeated key collapsed into multiValue.
function parseQuery(raw) {
  const params = {};
  for (const pair of raw ? raw.split('&') : []) {
    const at = pair.indexOf('=');
    const key = at === -1 ? pair : pair.slice(0, at);
    const value = at === -1 ? '' : pair.slice(at + 1);
    if (params[key]) {
      params[key].multiValue = params[key].multiValue || [{ value: params[key].value }];
      params[key].multiValue.push({ value });
    } else {
      params[key] = { value };
    }
  }
  return params;
}

function run(uri, rawQuery = '') {
  // JSON keeps the event's objects inside the function's own context.
  context.__event = JSON.stringify({ version: '1.0', request: { method: 'GET', uri, querystring: parseQuery(rawQuery), headers: {}, cookies: {} } });
  return JSON.parse(vm.runInContext('JSON.stringify(handler(JSON.parse(__event)))', context));
}

function serve(pathAndQuery) {
  const at = pathAndQuery.indexOf('?');
  const uri = at === -1 ? pathAndQuery : pathAndQuery.slice(0, at);
  const query = at === -1 ? '' : pathAndQuery.slice(at + 1);
  const result = uri === AASA_PATH ? { uri } : run(uri, query);
  if (result.statusCode) return { status: result.statusCode, location: result.headers.location.value, headers: result.headers };
  const key = decodeURIComponent(result.uri).slice(1);
  return fileSet.has(key) ? { status: 200, file: key } : { status: 404, file: '404.html' };
}

test('the function stays inside what the CloudFront runtime supports', () => {
  assert.ok(Buffer.byteLength(source) < 10240, 'CloudFront Functions must be under 10 KB');
  assert.equal(typeof context.handler, 'function', 'the runtime calls a top-level function named handler');

  const acorn = createRequire(join(root, 'web', 'package.json'))('acorn');
  acorn.parse(source, { ecmaVersion: 5 }); // throws on anything newer than ES5.1, all of which the runtime supports

  // Only methods the runtime 2.0 docs list.
  const allowed = new Set(['keys', 'forEach', 'push', 'join', 'replace', 'indexOf', 'slice', 'lastIndexOf', 'test']);
  const code = source.replace(/\/\/.*$/gm, '');
  for (const [, name] of code.matchAll(/\.(\w+)\(/g)) assert.ok(allowed.has(name), `${name} isn't on the checked list`);
  assert.doesNotMatch(code, /\b(require|process|setTimeout|eval|fetch|console)\b/);
});

test('every path in the table answers as it does on Vercel', () => {
  for (const want of PATHS) {
    const got = serve(want.path);
    assert.equal(got.status, want.status, `${want.path} status`);
    if (want.location) assert.equal(got.location, want.location, `${want.path} location`);
    if (want.file) assert.equal(got.file, want.file, `${want.path} file`);
  }
});

test('every file in the real export is reachable, and only by its right address', () => {
  assert.ok(files.length > 500, `only ${files.length} files: is this the full build?`);
  const pages = [];
  for (const file of files) {
    if (file.endsWith('.html')) {
      pages.push(file);
      assert.deepEqual(serve(`/${file}`), { status: 404, file: '404.html' }, `/${file} must not be served directly`);
      continue;
    }
    assert.deepEqual(serve(`/${file}`), { status: 200, file }, `/${file}`);
    assert.deepEqual(serve(`/${file}?_rsc=abc`), { status: 200, file }, `/${file} with a query string`);
    const moved = serve(`/${file}/`);
    assert.equal(moved.status, 308, `/${file}/`);
    assert.equal(moved.location, `/${file}`, `/${file}/`);
  }

  assert.ok(pages.includes('miss.html') && pages.includes('a.html'), 'the v2 pages should be in the export');
  for (const page of pages) {
    const clean = page === 'index.html' ? '/' : `/${page.slice(0, -'.html'.length)}`;
    if (clean === '/404') {
      assert.deepEqual(serve(clean), { status: 404, file: '404.html' });
      continue;
    }
    assert.deepEqual(serve(clean), { status: 200, file: page }, clean);
    assert.deepEqual(serve(`${clean}?s=abc&lite=1`), { status: 200, file: page }, `${clean} with a query string`);
    if (clean !== '/') assert.deepEqual(serve(`${clean}/abc`).status, 404, `${clean}/abc`);
    if (clean !== '/') assert.equal(serve(`${clean}/?k=abc`).location, `${clean}?k=abc`, `${clean}/ keeps its query`);
  }

  // Every route web/src/app defines has its page in the export, so none of them was left out of the table above.
  const routes = ['index', 'a', 'd', 'i', 'learn', 'miss', 'privacy', 'r', 'teach', 'terms', '_not-found', '404'];
  for (const name of routes) assert.ok(fileSet.has(`${name}.html`), `${name}.html`);
  assert.equal(pages.length, routes.length, `new page in the export: ${pages}`);
});

test('the Apple file is served exactly, with or without the function in front of it', () => {
  assert.ok(fileSet.has(AASA_PATH.slice(1)));
  const direct = run(AASA_PATH); // the path main.tf doesn't send through the function, in case that ever changes
  assert.equal(direct.statusCode, undefined, 'no redirect');
  assert.equal(direct.uri, AASA_PATH, 'not rewritten');

  const aasa = JSON.parse(readFileSync(join(out, AASA_PATH.slice(1)), 'utf8'));
  assert.deepEqual(aasa.applinks.details[0].appIDs, ['73UV499FKN.com.salik.homecookd']);
  const claimed = aasa.applinks.details[0].components.map((c) => c['/']);
  for (const path of ['/i', '/r', '/d']) assert.ok(claimed.includes(path), path);

  const tf = readFileSync(join(here, 'main.tf'), 'utf8');
  assert.match(tf, /path = "\/\.well-known\/apple-app-site-association", class = "aasa", rewrite = false, compress = false/);
  assert.match(tf, /"Content-Type"\s*=\s*"application\/json"/);
});

test('query strings survive a redirect untouched', () => {
  assert.equal(run('/r/').headers.location.value, '/r');
  assert.equal(run('/r/', 's=abc').headers.location.value, '/r?s=abc');
  assert.equal(run('/miss/', 'k=a%2Fb%3D%3D').headers.location.value, '/miss?k=a%2Fb%3D%3D');
  assert.equal(run('/a/', 't=x+y').headers.location.value, '/a?t=x+y');
  assert.equal(run('/r/', 'x=1&x=2').headers.location.value, '/r?x=1&x=2');
  assert.equal(run('/r/', 'flag').headers.location.value, '/r?flag');
  assert.equal(run('/r/', 'utm_source=a&aud=kid&from=app').headers.location.value, '/r?utm_source=a&aud=kid&from=app');
  assert.equal(run('/r/').statusCode, 308);
  assert.equal(run('/r/').headers['cache-control'].value, 'public, max-age=0, must-revalidate');
});

test('a redirect can never leave the site', () => {
  for (const uri of ['//example.com/', '///example.com/', '//example.com', '/\\example.com/', '//', '/\\/example.com/']) {
    const location = run(uri).headers.location.value;
    assert.match(location, /^\/([^/\\]|$)/, `${uri} -> ${location}`);
  }
  assert.equal(run('/\\example.com/').headers.location.value, '/%5Cexample.com'); // as on Vercel
  assert.equal(run('//').headers.location.value, '/');
});

test('the sync script gives every file a type, and refuses what it cannot type', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-sync-'));
  try {
    const log = join(dir, 'calls.jsonl');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    // A stand-in for the aws command that records its arguments and uploads nothing.
    writeFileSync(
      join(bin, 'aws'),
      `#!/usr/bin/env node\nrequire('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
    );
    chmodSync(join(bin, 'aws'), 0o755);
    const script = join(root, 'infra', 'scripts', 'web-sync.sh');
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };

    execFileSync('bash', [script, out, 'test-bucket'], { env });
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

    const typed = new Map();
    for (const call of calls) {
      const at = call.indexOf('--include');
      if (at !== -1) typed.set(call[at + 1].slice(2), call[call.indexOf('--content-type') + 1]);
    }
    for (const file of files) {
      if (`/${file}` === AASA_PATH) continue;
      assert.ok(typed.get(file.slice(file.lastIndexOf('.') + 1)), `no type for ${file}`);
    }
    for (const want of PATHS) {
      if (!want.type || want.status !== 200 || want.path.startsWith(AASA_PATH)) continue;
      assert.equal(typed.get(want.file.slice(want.file.lastIndexOf('.') + 1)), want.type, want.file);
    }

    const aasaCall = calls.find((call) => call[1] === 'cp');
    assert.equal(aasaCall[3], `s3://test-bucket${AASA_PATH}`);
    assert.equal(aasaCall[aasaCall.indexOf('--content-type') + 1], 'application/json');

    const includes = calls.filter((call) => call.includes('--include')).map((call) => call[call.indexOf('--include') + 1]);
    assert.equal(includes.at(-1), '*.html', 'pages go up last');
    const last = calls.at(-1);
    assert.ok(last.includes('--delete') && last.includes('--size-only'), 'removing old files comes last');
    assert.equal(last[last.indexOf('--exclude') + 1], '_next/static/*', 'old chunks stay for pages already open');
    assert.ok(!last.includes('--content-type'));

    const unknownType = join(dir, 'unknown');
    mkdirSync(join(unknownType, '.well-known'), { recursive: true });
    writeFileSync(join(unknownType, '.well-known', 'apple-app-site-association'), '{}');
    writeFileSync(join(unknownType, 'surprise.xyz'), 'x');
    const refused = spawnSync('bash', [script, unknownType, 'test-bucket'], { env, encoding: 'utf8' });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /surprise\.xyz/);

    const noAasa = join(dir, 'no-aasa');
    mkdirSync(noAasa);
    assert.equal(spawnSync('bash', [script, noAasa, 'test-bucket'], { env }).status, 1);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, calls.length, 'a refused sync uploads nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

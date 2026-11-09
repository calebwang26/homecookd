// safe-eas-update.sh's canary order and simulator gate, in a fake checkout: npx, the export check, check-canary.mjs and
// check-sim.mjs are stubs, so nothing is exported or published. node --test scripts/safe-eas-update.test.mjs
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A checkout at app.json `version` whose canary check exits `canary` and simulator check exits `sim` (0 allowed, 1 refused). */
function checkout(version, canary, sim = 0) {
  const root = mkdtempSync(path.join(tmpdir(), 'safe-eas-'));
  mkdirSync(path.join(root, 'scripts'));
  mkdirSync(path.join(root, 'app'));
  mkdirSync(path.join(root, 'bin'));
  copyFileSync(path.join(HERE, 'safe-eas-update.sh'), path.join(root, 'scripts/safe-eas-update.sh'));
  writeFileSync(path.join(root, 'app/app.json'), JSON.stringify({ expo: { version } }));
  writeFileSync(path.join(root, 'app/eas.json'), JSON.stringify({ build: { production: { env: {} }, 'production-aws': { env: { EXPO_PUBLIC_BACKEND: 'aws' } } } }));
  writeFileSync(path.join(root, 'scripts/check-app-export.mjs'), '');
  writeFileSync(
    path.join(root, 'scripts/check-canary.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(root, 'canary-ran'))}, '');\nprocess.exit(${canary});\n`,
  );
  writeFileSync(
    path.join(root, 'scripts/check-sim.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(path.join(root, 'sim-ran'))}, '');\nprocess.exit(${sim});\n`,
  );
  // npx: every call is logged, one argument per line, and does nothing.
  writeFileSync(path.join(root, 'bin/npx'), `#!/bin/bash\nprintf '%s\\n' "$@" '--' >> ${JSON.stringify(path.join(root, 'npx.log'))}\n`);
  chmodSync(path.join(root, 'bin/npx'), 0o755);
  return root;
}

function run(root, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('EXPO_PUBLIC_')));
  const r = spawnSync('bash', [path.join(root, 'scripts/safe-eas-update.sh'), ...args], {
    env: { ...env, PATH: `${path.join(root, 'bin')}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  const log = existsSync(path.join(root, 'npx.log')) ? readFileSync(path.join(root, 'npx.log'), 'utf8') : '';
  const update = log.split('--\n').find((c) => c.startsWith('eas-cli\nupdate\n'));
  const message = update?.split('\n')[update.split('\n').indexOf('--message') + 1];
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    published: !!update,
    exported: log.split('--\n').some((c) => c.startsWith('expo\nexport\n')),
    message,
    canaryRan: existsSync(path.join(root, 'canary-ran')),
    simRan: existsSync(path.join(root, 'sim-ran')),
  };
}

test('1.1.1 publishes once the simulator check allows it, without the canary check', () => {
  const r = run(checkout('1.1.1', 1, 0), ['production-aws', 'A fix', '--caleb-ok']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.canaryRan, false);
  assert.equal(r.simRan, true);
  assert.equal(r.exported, true);
  assert.equal(r.published, true);
  assert.equal(r.message, 'A fix');
});

test('1.1.1 is refused while the simulator check refuses, and nothing is exported or published', () => {
  const r = run(checkout('1.1.1', 0, 1), ['production-aws', 'A fix', '--caleb-ok']);
  assert.equal(r.code, 1);
  assert.equal(r.exported, false);
  assert.equal(r.published, false);
  assert.match(r.out, /REFUSED: 1\.1\.1 publishes only app code that passed the iOS journeys/);
});

test('--no-sim "<reason>" publishes 1.1.1 anyway, and the reason goes into the message', () => {
  const r = run(checkout('1.1.1', 0, 1), ['production-aws', 'A fix', '--caleb-ok', '--no-sim', 'the runner image lost Xcode 26.5']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.published, true);
  assert.equal(r.message, 'A fix (no simulator run: the runner image lost Xcode 26.5)');
});

test('--check-only on 1.1.1 still checks the export, says it would be refused, and publishes nothing', () => {
  const r = run(checkout('1.1.1', 0, 1), ['production-aws', 'A fix', '--check-only']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /publishing it would be refused until the journeys pass/);
  assert.match(r.out, /Checked, and nothing published/);
  assert.equal(r.published, false);
});

test('1.1.0 has no simulator gate (the canary covers it), and --no-sim is refused there and off production-aws', () => {
  const r = run(checkout('1.1.0', 0, 1), ['production-aws', 'A fix', '--caleb-ok']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.simRan, false);
  assert.equal(r.published, true);
  const old = run(checkout('1.1.0', 0, 1), ['production-aws', 'A fix', '--caleb-ok', '--no-sim', 'why']);
  assert.equal(old.code, 1);
  assert.equal(old.published, false);
  assert.match(old.out, /--no-sim is only for production-aws publishes from main/);
  const staging = run(checkout('1.1.1', 0, 1), ['aws-staging', 'A fix', '--no-sim', 'why']);
  assert.equal(staging.code, 1);
  assert.equal(staging.simRan, false);
  assert.match(run(checkout('1.1.1', 0, 1), ['production-aws', 'A fix', '--caleb-ok', '--no-sim']).out, /needs a reason/);
});

test('aws-staging and staging never run the simulator check', () => {
  for (const ch of ['aws-staging', 'staging']) {
    const r = run(checkout('1.1.1', 0, 1), [ch, 'A fix']);
    assert.equal(r.code, 0, r.out);
    assert.equal(r.simRan, false);
    assert.equal(r.published, true);
  }
});

test('1.1.0 is refused while the canary check refuses, and nothing is exported or published', () => {
  const r = run(checkout('1.1.0', 1), ['production-aws', 'A fix', '--caleb-ok']);
  assert.equal(r.code, 1);
  assert.equal(r.canaryRan, true);
  assert.equal(r.published, false);
  assert.match(r.out, /REFUSED: 1\.1\.0 reaches every App Store phone/);
});

test('1.1.0 publishes once the canary check allows it, with the message as given', () => {
  const r = run(checkout('1.1.0', 0), ['production-aws', 'A fix', '--caleb-ok']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.published, true);
  assert.equal(r.message, 'A fix');
});

test('--canary-ok "<reason>" publishes 1.1.0 anyway, and the reason goes into the message', () => {
  const r = run(checkout('1.1.0', 1), ['production-aws', 'A fix', '--caleb-ok', '--canary-ok', 'crash on launch for everyone']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.published, true);
  assert.equal(r.message, 'A fix (canary skipped: crash on launch for everyone)');
});

test('--check-only on 1.1.0 still checks the export, says it would be refused, and publishes nothing', () => {
  const r = run(checkout('1.1.0', 1), ['production-aws', 'A fix', '--check-only']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /publishing it to 1\.1\.0 would be refused/);
  assert.match(r.out, /Checked, and nothing published/);
  assert.equal(r.published, false);
});

test('--canary-ok is refused without a reason, and anywhere but production-aws 1.1.0', () => {
  assert.match(run(checkout('1.1.0', 1), ['production-aws', 'A fix', '--caleb-ok', '--canary-ok']).out, /needs a reason/);
  const staging = run(checkout('1.1.0', 0), ['aws-staging', 'A fix', '--canary-ok', 'why']);
  assert.equal(staging.code, 1);
  assert.match(staging.out, /only for production-aws at runtime 1\.1\.0/);
  const newer = run(checkout('1.1.1', 0), ['production-aws', 'A fix', '--caleb-ok', '--canary-ok', 'why']);
  assert.equal(newer.code, 1);
  assert.equal(newer.published, false);
});

test('an unknown argument is refused', () => {
  const r = run(checkout('1.1.1', 0), ['production-aws', 'A fix', '--caleb-ok', '--force']);
  assert.equal(r.code, 1);
  assert.match(r.out, /unknown argument --force/);
});

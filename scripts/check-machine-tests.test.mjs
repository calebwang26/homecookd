// node --test scripts/check-machine-tests.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, namedTest } from './check-machine-tests.mjs';

const files = {
  'web/src/components/mom/questionMachine.ts': '// A table.\n// state-machine-test: questionMachine.test.ts\nexport {};\n',
  'web/src/components/mom/questionMachine.test.ts': 'test',
  'app/src/lib/sheets/machine.ts': '// state-machine-test: app/scripts/test-sheets.mjs\n',
  'app/scripts/test-sheets.mjs': 'test',
  'pipeline/claude.py': '"""Batches."""\n# state-machine-test: test_claude.py\n',
  'pipeline/test_claude.py': 'test',
  'web/src/plain.ts': 'export const x = 1; // mentions state-machine-test: in a sentence on line 1? no: not a header line\n',
  'web/src/late.ts': `${'\n'.repeat(45)}// state-machine-test: late.test.ts\n`,
  'web/src/ghost.ts': '// state-machine-test: ghost.test.ts\n',
};
const read = (f) => files[f] ?? null;
const exists = (f) => f in files;

test('the named test resolves next to the file, or from the repo root when it has a slash', () => {
  assert.equal(namedTest('web/src/components/mom/questionMachine.ts', files['web/src/components/mom/questionMachine.ts']), 'web/src/components/mom/questionMachine.test.ts');
  assert.equal(namedTest('app/src/lib/sheets/machine.ts', files['app/src/lib/sheets/machine.ts']), 'app/scripts/test-sheets.mjs');
  assert.equal(namedTest('pipeline/claude.py', files['pipeline/claude.py']), 'pipeline/test_claude.py');
});

test('only a whole header line counts', () => {
  assert.equal(namedTest('web/src/plain.ts', files['web/src/plain.ts']), null);
  assert.equal(namedTest('web/src/late.ts', files['web/src/late.ts']), null);
});

test('a machine changed with its test passes', () => {
  assert.deepEqual(check(['web/src/components/mom/questionMachine.ts', 'web/src/components/mom/questionMachine.test.ts'], read, exists), []);
  assert.deepEqual(check(['app/src/lib/sheets/machine.ts', 'app/scripts/test-sheets.mjs', 'pipeline/claude.py', 'pipeline/test_claude.py'], read, exists), []);
});

test('a machine changed without its test fails, naming both', () => {
  const p = check(['web/src/components/mom/questionMachine.ts'], read, exists);
  assert.equal(p.length, 1);
  assert.match(p[0], /questionMachine\.ts changed without web\/src\/components\/mom\/questionMachine\.test\.ts/);
  assert.equal(check(['pipeline/claude.py'], read, exists).length, 1);
});

test('a marker naming a missing test fails', () => {
  assert.match(check(['web/src/ghost.ts'], read, exists)[0], /doesn't exist/);
});

test('only the test changed, a plain file, or a deleted machine: nothing to say', () => {
  assert.deepEqual(check(['web/src/components/mom/questionMachine.test.ts', 'web/src/plain.ts', 'gone/machine.ts'], read, exists), []);
});

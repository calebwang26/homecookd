// ios-journeys.yml's scrub and its keyed journeys, read from the workflow file itself: every value a journey's people
// bring reaches the scrub, in both rounds. node --test scripts/journey-workflow.test.mjs
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = readFileSync(path.join(ROOT, '.github/workflows/ios-journeys.yml'), 'utf8');

/** One step's text, from its "- name:" line to the next step's. */
function step(name) {
  const start = WORKFLOW.indexOf(`      - name: ${name}\n`);
  assert.ok(start >= 0, `no step "${name}"`);
  const next = WORKFLOW.indexOf('\n      - name: ', start + 1);
  return WORKFLOW.slice(start, next < 0 ? undefined : next);
}

const scrub = step('Drop what echoes a key or a link');
// SECRETS=( … ): every value journey-scrub.mjs masks in the kept logs.
const secrets = /SECRETS=\(([\s\S]*?)\)\n/.exec(scrub)?.[1] ?? '';
// The last check's loop: any file still holding one of these is dropped.
const lastCheck = /for v in ([\s\S]*?); do/.exec(scrub)?.[1] ?? '';

test("the scrub masks both rounds' keys and join tokens, journey 5's included", () => {
  for (const v of ['KID_KEY', 'COOK_KEY', 'KID5_KEY', 'KID_KEY_2', 'COOK_KEY_2', 'KID5_KEY_2']) {
    assert.ok(secrets.includes(`"\${${v}:-}"`), `SECRETS lacks ${v}`);
    assert.ok(lastCheck.includes(`"\${${v}:-}"`), `the last check lacks ${v}`);
  }
  for (const link of ['FAMILY_LINK', 'FAMILY5_LINK', 'FAMILY_LINK_2', 'FAMILY5_LINK_2']) {
    assert.ok(secrets.includes(`"\${${link}#*t=}"`), `SECRETS lacks ${link}'s token`);
    assert.ok(lastCheck.includes(`"\${${link}#*t=}"`), `the last check lacks ${link}'s token`);
  }
});

test("the scrub masks every test id of both rounds (they're the people's names on staging)", () => {
  assert.match(scrub, /R="j\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
  for (const who of ['cook', 'kid', 'cook5', 'kid5']) {
    assert.ok(secrets.includes(`"$R-${who}"`), `SECRETS lacks $R-${who}`);
    assert.ok(secrets.includes(`"$R-r2-${who}"`), `SECRETS lacks $R-r2-${who}`);
  }
});

test("journey 5's key reaches Maestro in both rounds, through journey-maestro.sh", () => {
  const maestro = readFileSync(path.join(ROOT, 'scripts/journey-maestro.sh'), 'utf8');
  assert.match(maestro, /-e "KID5_KEY=\$\{KID5_KEY:-\}"/);
  assert.match(step('Journeys again (Maestro lost the simulator)'), /KID5_KEY=\$\{KID5_KEY_2:-\}/);
});

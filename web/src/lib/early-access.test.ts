// npm test: the early-access form's three modes (Bug hunt, Nov 10: the live form thanked people for addresses it
// never sent anywhere).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { earlyAccessMode } from './early-access.ts';

test('a production build with no endpoint shows no form, so it can never say "You\'re on the list."', () => {
  assert.equal(earlyAccessMode(undefined, 'production'), 'off');
  assert.equal(earlyAccessMode('', 'production'), 'off');
  assert.equal(earlyAccessMode('   ', 'production'), 'off');
});

test('with an endpoint the form posts, in any build', () => {
  assert.equal(earlyAccessMode('https://example.invalid/early-access', 'production'), 'post');
  assert.equal(earlyAccessMode('https://example.invalid/early-access', 'development'), 'post');
});

test('a dev build with no endpoint keeps the demo thank-you', () => {
  assert.equal(earlyAccessMode(undefined, 'development'), 'demo');
  assert.equal(earlyAccessMode(undefined, undefined), 'demo');
});

// Unit tests for a dish card's link in the app (docs/build/V2-LINKING.md 2.2, 2.6, 2.7). TS run by Node's
// type stripping, no network:
//   src/lib/auth/links.ts  parseInviteInput takes /miss?k= and /a?t= (https, www, the build's web host,
//                          homecookd://, edible://, homecookd.app with no scheme, inside a pasted text),
//                          refuses other hosts, bare 22-character tokens and wrong lengths, and still
//                          reads invites (/i), recipe links (/r) and codes as before
//   src/lib/linkClaim.ts   POST /link/open's answer, links.claim's answer, planClaim for every journey of
//                          2.3 and 2.7, and the ?claim= hand-off through /join
//   node scripts/test-links.mjs
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The build's own web host (EXPO_PUBLIC_WEB_URL): its links count like homecookd.app's.
process.env.EXPO_PUBLIC_WEB_URL = 'https://preview.homecookd.test';

// The app imports siblings without an extension ('../api'); resolve them to .ts.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && ctx.parentURL && !/\.[a-z]+$/.test(spec)) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});

const { parseInviteInput } = await import(pathToFileURL(join(root, 'src/lib/auth/links.ts')).href);
const C = await import(pathToFileURL(join(root, 'src/lib/linkClaim.ts')).href);

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

const K = 'Ab3dEf6hIj9kLm2nOp5qRs'; // 22 base62: a kid token
const T = 'Zy8xWv7uTs6rQp5oNm4lKj'; // 22 base62: an ask token
assert.equal(K.length, 22);
assert.equal(T.length, 22);

test('a kid’s card: /miss?k= from every place a link comes from', () => {
  const card = { kind: 'card', token: K };
  for (const text of [
    `https://homecookd.app/miss?k=${K}`,
    `https://www.homecookd.app/miss?k=${K}`,
    `https://preview.homecookd.test/miss?k=${K}`,
    `http://homecookd.app/miss?k=${K}`,
    `homecookd://miss?k=${K}`,
    `edible://miss?k=${K}`,
    `homecookd.app/miss?k=${K}`,
    `HTTPS://HOMECOOKD.APP/miss?k=${K}`,
    `https://homecookd.app/miss/?k=${K}`,
    `https://homecookd.app/miss?utm_source=sms&k=${K}`,
    `https://homecookd.app/miss?k=${K}#top`,
    `Mom, open this in the app: https://homecookd.app/miss?k=${K}. Love you`,
    `I miss your tomato egg\nhomecookd.app/miss?k=${K}`,
  ]) {
    assert.deepEqual(parseInviteInput(text), card, text);
  }
});

test('Mom’s ask: /a?t= the same ways', () => {
  const ask = { kind: 'ask', token: T };
  for (const text of [
    `https://homecookd.app/a?t=${T}`,
    `https://www.homecookd.app/a?t=${T}`,
    `https://preview.homecookd.test/a?t=${T}`,
    `homecookd://a?t=${T}`,
    `edible://a?t=${T}`,
    `homecookd.app/a?t=${T}`,
    `Caleb wants your tomato egg: https://homecookd.app/a?t=${T}`,
  ]) {
    assert.deepEqual(parseInviteInput(text), ask, text);
  }
});

test('never a bare 22-character token, another host, a wrong length or the wrong param', () => {
  for (const text of [
    K,
    ` ${T} `,
    `https://evil.example/miss?k=${K}`,
    `https://homecookd.app.evil.example/miss?k=${K}`,
    `https://evilhomecookd.app/miss?k=${K}`,
    `https://evil.example/a?t=${T}`,
    `evilhomecookd.app/miss?k=${K}`,
    `me@homecookd.app/miss?k=${K}`,
    `https://homecookd.app/miss?k=${K.slice(1)}`, // 21
    `https://homecookd.app/miss?k=${K}x`, // 23
    `https://homecookd.app/a?t=${T.slice(0, 16)}`, // an invite token's length
    `https://homecookd.app/miss?k=${K.slice(0, 21)}_`,
    `https://homecookd.app/miss?k=${K.slice(0, 21)}-`,
    `https://homecookd.app/miss?t=${K}`, // the ask's param on the card's page
    `https://homecookd.app/a?k=${T}`,
    `https://homecookd.app/miss?c=${K}`, // a craving link stays on the web
    'https://homecookd.app/miss',
    `https://homecookd.app/missing?k=${K}`,
    `https://homecookd.app/about?t=${T}`,
    `https://homecookd.app/i?t=${K}`, // a card token is no invite
  ]) {
    assert.equal(parseInviteInput(text), null, text);
  }
});

test('invites, recipe links and codes read as before', () => {
  const tok = 'aB3dE6gH9jK2mN5p'; // 16
  assert.deepEqual(parseInviteInput(`https://homecookd.app/i?t=${tok}`), { kind: 'token', token: tok });
  assert.deepEqual(parseInviteInput(`homecookd://i?t=${tok}`), { kind: 'token', token: tok });
  assert.deepEqual(parseInviteInput(`Dad, join our family table on homecookd: https://homecookd.app/i?t=${tok}&c=K7QM2X`), { kind: 'token', token: tok });
  assert.deepEqual(parseInviteInput('https://homecookd.app/i?c=k7qm2x'), { kind: 'code', code: 'K7QM2X' });
  assert.deepEqual(parseInviteInput('https://homecookd.app/r?s=share-tok_1'), { kind: 'share', share: 'share-tok_1' });
  assert.deepEqual(parseInviteInput(tok), { kind: 'token', token: tok });
  assert.deepEqual(parseInviteInput('k7qm 2x'), { kind: 'code', code: 'K7QM2X' });
  assert.equal(parseInviteInput('https://evil.example/i?t=' + tok), null);
  assert.equal(parseInviteInput(''), null);
  assert.equal(parseInviteInput(null), null);
});

// ---- linkClaim

/** POST /link/open's answer for a card side, with `over` changed. */
const opened = (over = {}) =>
  C.parseLinkInfo({
    side: 'kid',
    dish: 'tomato egg',
    kidName: 'Caleb',
    relation: 'Mom',
    familyName: 'The Wangs',
    taken: false,
    ticket: null,
    language: null,
    joinable: 'no_family',
    ...over,
  });
const IN = { signedIn: true, picked: true };
const OUT = { signedIn: false, picked: false };

test('parseLinkInfo: what /link/open says, cleaned; anything else is null', () => {
  assert.deepEqual(opened({ kidName: '  Caleb  ', dish: ' tomato   egg ', ticket: ' tk.sig ', joinable: 'yes', language: 'mr' }), {
    side: 'kid',
    dish: 'tomato egg',
    kidName: 'Caleb',
    relation: 'Mom',
    familyName: 'The Wangs',
    taken: false,
    ticket: 'tk.sig',
    language: 'mr',
    joinable: 'yes',
  });
  // An older server that doesn't say why: a ticket means yes, none means not now.
  assert.equal(opened({ joinable: undefined, ticket: 't.s' }).joinable, 'yes');
  assert.equal(opened({ joinable: 'maybe' }).joinable, 'off');
  // Convex sends the card's relation as stored ("mom"); she's named and shown as "Mom".
  assert.equal(opened({ relation: 'grandma' }).relation, 'Grandma');
  assert.equal(opened({ kidName: '', relation: null, ticket: 42 }).kidName, null);
  assert.equal(opened({ ticket: 42 }).ticket, null);
  assert.equal(opened({ side: 'mom' }), null);
  assert.equal(opened({ dish: '  ' }), null);
  assert.equal(C.parseLinkInfo(null), null);
  assert.equal(C.parseLinkInfo('nope'), null);
});

test('parseClaimed: links.claim’s answer, or null', () => {
  assert.deepEqual(C.parseClaimed({ dishAskId: 'k1', side: 'cook', sameFamily: true, taken: false }), {
    dishAskId: 'k1',
    side: 'cook',
    sameFamily: true,
    taken: false,
  });
  assert.equal(C.parseClaimed({ dishAskId: '', side: 'kid' }), null);
  assert.equal(C.parseClaimed({ dishAskId: 'k1', side: 'x' }), null);
  assert.equal(C.parseClaimed(null), null);
});

test('planClaim: a dead link, signed in or not', () => {
  assert.deepEqual(C.planClaim(null, IN), { kind: 'dead' });
  assert.deepEqual(C.planClaim(null, OUT), { kind: 'dead' });
});

test('planClaim: signed in claims whatever the card says (2.6 step 2, 2.7 another family)', () => {
  for (const over of [{}, { ticket: 't.s', joinable: 'yes' }, { joinable: 'taken', taken: true }, { side: 'cook' }, { joinable: 'window' }]) {
    assert.deepEqual(C.planClaim(opened(over), IN), { kind: 'claim' }, JSON.stringify(over));
  }
  // In a family, nobody picked yet (a cold start): "Who's in the kitchen?" first, then the link again.
  assert.deepEqual(C.planClaim(opened({ ticket: 't.s', joinable: 'yes' }), { signedIn: true, picked: false }), { kind: 'pick' });
});

test('planClaim: signed out with a ticket joins as that side, named from the card', () => {
  assert.deepEqual(C.planClaim(opened({ ticket: 't.s', joinable: 'yes' }), OUT), { kind: 'join', ticket: 't.s', name: 'Caleb', role: 'learner' });
  assert.deepEqual(C.planClaim(opened({ side: 'cook', ticket: 't.s', joinable: 'yes' }), OUT), { kind: 'join', ticket: 't.s', name: 'Mom', role: 'cook' });
  // No name on the card: the screen asks for one.
  assert.deepEqual(C.planClaim(opened({ kidName: null, ticket: 't.s', joinable: 'yes' }), OUT), { kind: 'join', ticket: 't.s', name: null, role: 'learner' });
});

test('planClaim: signed out, that side claimed once: ask for an invite (one join per side, ever)', () => {
  assert.deepEqual(C.planClaim(opened({ joinable: 'taken', taken: true }), OUT), { kind: 'taken', name: 'Caleb' });
  assert.deepEqual(C.planClaim(opened({ side: 'cook', joinable: 'taken', taken: false }), OUT), { kind: 'taken', name: 'Mom' });
});

test('planClaim: signed out, no ticket: sign in first (no family yet, past 30 days, links off)', () => {
  for (const joinable of ['no_family', 'window', 'off', 'yes']) {
    assert.deepEqual(C.planClaim(opened({ joinable }), OUT), { kind: 'signIn', name: 'Caleb', role: 'learner' }, joinable);
    assert.deepEqual(C.planClaim(opened({ side: 'cook', joinable }), OUT), { kind: 'signIn', name: 'Mom', role: 'cook' }, joinable);
  }
});

test('planClaim: the journeys of 2.3 end in one family', () => {
  // Kid saves first (installs): no family yet, so Apple sign-in starts one and the card joins it.
  assert.equal(C.planClaim(opened({ joinable: 'no_family' }), OUT).kind, 'signIn');
  // ...then Mom answers on the web and installs from /a: a ticket into the kid's family, as a cook.
  assert.deepEqual(C.planClaim(opened({ side: 'cook', ticket: 'tk', joinable: 'yes' }), OUT), { kind: 'join', ticket: 'tk', name: 'Mom', role: 'cook' });
  // Kid stays on the web; Mom installs first: she signs in and starts the family...
  assert.deepEqual(C.planClaim(opened({ side: 'cook', joinable: 'no_family' }), OUT), { kind: 'signIn', name: 'Mom', role: 'cook' });
  // ...and the kid later installs from their card into hers. A craving card (born in her family) too.
  assert.deepEqual(C.planClaim(opened({ ticket: 'tk', joinable: 'yes' }), OUT), { kind: 'join', ticket: 'tk', name: 'Caleb', role: 'learner' });
});

test('claim links through /join: only /miss?k= and /a?t= come back, with a checked name and role', () => {
  assert.equal(C.claimHref('card', K), `/miss?k=${K}`);
  assert.equal(C.claimHref('ask', T), `/a?t=${T}`);
  assert.deepEqual(C.signInHref(`/miss?k=${K}`, { name: 'Caleb', role: 'learner' }), {
    pathname: '/join',
    params: { claim: `/miss?k=${K}`, role: 'learner', name: 'Caleb' },
  });
  assert.deepEqual(C.signInHref(`/a?t=${T}`, { name: null, role: 'cook' }), { pathname: '/join', params: { claim: `/a?t=${T}`, role: 'cook' } });

  assert.equal(C.claimFromParam(`/miss?k=${K}`), `/miss?k=${K}`);
  assert.equal(C.claimFromParam([`/a?t=${T}`]), `/a?t=${T}`);
  for (const bad of [undefined, '', '/parent/home', '//evil.example', `https://homecookd.app/miss?k=${K}`, `/miss?k=${K}&x=1`, `/miss?k=${K.slice(1)}`, `/a?k=${T}`, `/i?t=${K}`]) {
    assert.equal(C.claimFromParam(bad), null, String(bad));
  }
  assert.equal(C.roleFromParam('learner'), 'learner');
  assert.equal(C.roleFromParam('cook'), 'cook');
  assert.equal(C.roleFromParam('admin'), null);
  assert.equal(C.roleFromParam(undefined), null);
  assert.equal(C.nameFromParam('  Auntie   Lin '), 'Auntie Lin');
  assert.equal(C.nameFromParam('x'.repeat(60)), 'x'.repeat(40));
  assert.equal(C.nameFromParam('   '), null);
});

console.log(`\n${passed} passed`);

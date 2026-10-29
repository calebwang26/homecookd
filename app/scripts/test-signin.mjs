// Unit tests for staying signed in (docs/agents/memory/never-signed-out-by-a-crash.md). TS run by
// Node's type stripping, with the network and the phone's keychain faked:
//   src/lib/api.ts      only the server's exact "This phone was signed out." (a 401) forgets this
//                       phone's key; a gateway's 401, a 500 or no network leave it alone
//   src/lib/storage.ts  secretRead: a keychain that can't answer (a locked phone, a launch in the
//                       background) throws instead of looking like "nothing saved"; secretReadRetried
//                       waits for the front only while the app isn't in front (never stuck in front)
//   src/lib/auth/apple.ts  "Delete my account" asks Apple to confirm (so Convex can revoke the Sign in
//                       with Apple) only for this phone's own Apple account, on iOS, once Convex has the
//                       key; a cancelled or failed Apple sheet gives no code and the deletion goes on
// Joining only by a link (docs/build/JOIN-SIMPLE.md):
//   src/lib/auth/join.ts   a sign-in sends one link (join_token or link_ticket), the card's role and
//                       `move`; a refusal says which card to show (a taken name, a used card side, gone)
//   src/lib/api.ts      POST /auth/apple carries them and passes needs_move back; POST /join-links
//   src/lib/auth/pickup.ts the invisible pickup: reads the clipboard only when iOS says a link is there,
//                       at most once per launch, and opens only a homecookd join link
//   the sources         no family codes, no Paste invite, no /join-code, no /auth/link; the boot swap of
//                       an old saved code stays; the system Apple button; Google on Android only
//   node scripts/test-signin.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The keychain: a map, and a switch that makes it fail like a locked phone's.
globalThis.__keychain = { items: new Map(), locked: false };
globalThis.__appState = { currentState: 'active' };
// Apple's sheet: whether it can show, what it was asked for, and how it ends.
globalThis.__apple = { available: true, asked: [], code: 'code-1', fail: null };
const js = (code) => `data:text/javascript,${encodeURIComponent(code)}`;
const store = `
  const k = globalThis.__keychain;
  const gate = () => { if (k.locked) throw new Error('User interaction is not allowed.'); };
  export const getItemAsync = async (key) => { gate(); return k.items.has(key) ? k.items.get(key) : null; };
  export const AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK';
  export const setItemAsync = async (key, v, options) => { gate(); k.items.set(key, v); k.lastOptions = options; };
  export const deleteItemAsync = async (key) => { gate(); k.items.delete(key); };`;
const FAKES = {
  'react-native': js("export const Platform = { OS: 'ios' }; export const AppState = globalThis.__appState;"),
  'expo-secure-store': js(store),
  '@react-native-async-storage/async-storage': js(`const m = new Map(); export default {
    getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) };`),
  'expo-apple-authentication': js(`const a = globalThis.__apple;
    export const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 };
    export const isAvailableAsync = async () => a.available;
    export const formatFullName = () => '';
    export const signInAsync = async (options) => {
      a.asked.push(options);
      if (a.fail) throw a.fail;
      return { authorizationCode: a.code, identityToken: 'id-token', fullName: null };
    };`),
};
registerHooks({
  resolve(spec, ctx, next) {
    if (FAKES[spec]) return { url: FAKES[spec], shortCircuit: true };
    if (spec.startsWith('.') && ctx.parentURL?.includes('/src/lib/') && !/\.[a-z]+$/.test(spec)) {
      return next(pathToFileURL(join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`)).href, ctx);
    }
    return next(spec, ctx);
  },
});

const A = await import(pathToFileURL(join(root, 'src/lib/api.ts')).href);
const S = await import(pathToFileURL(join(root, 'src/lib/storage.ts')).href);
const P = await import(pathToFileURL(join(root, 'src/lib/auth/apple.ts')).href);
const J = await import(pathToFileURL(join(root, 'src/lib/auth/join.ts')).href);
/** A fresh copy of the pickup module: its "once per launch" starts over, like a new launch. */
let launches = 0;
const freshPickup = () => import(`${pathToFileURL(join(root, 'src/lib/auth/pickup.ts')).href}?launch=${++launches}`);

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

/** Every fetch answers this, and what was sent is kept. */
function answer(status, body) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, headers: init?.headers ?? {} });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return sent;
}

/** Signed in with key k1; resolves to how often the session heard "signed out". */
async function familyAfter(status, body) {
  A.setApiAuth({ deviceKey: 'k1', code: null, profileId: null });
  let heard = 0;
  A.setSignedOutHandler(() => (heard += 1));
  const sent = answer(status, body);
  const err = await A.api.family().then(() => null, (e) => e);
  A.setSignedOutHandler(null);
  return { heard, err, sent, key: A.getApiAuth().key };
}

await test('only a 401 with exactly "This phone was signed out." counts as signed out', () => {
  assert.equal(A.isSignedOutAnswer(401, { error: A.SIGNED_OUT }), true);
  assert.equal(A.isSignedOutAnswer(401, { msg: 'Invalid JWT' }), false, 'the Supabase gateway (verify_jwt on by mistake)');
  assert.equal(A.isSignedOutAnswer(401, { error: 'Family code not recognised' }), false);
  assert.equal(A.isSignedOutAnswer(401, null), false, 'a proxy page, no JSON');
  assert.equal(A.isSignedOutAnswer(403, { error: A.SIGNED_OUT }), false);
  assert.equal(A.isSignedOutAnswer(500, { error: A.SIGNED_OUT }), false);
});

await test('the server signed this phone out: the key is dropped and the session hears it once', async () => {
  const r = await familyAfter(401, { error: A.SIGNED_OUT });
  assert.equal(r.heard, 1);
  assert.equal(r.key, null);
  assert.equal(r.err?.status, 401);
  assert.equal(r.sent[0].headers['x-device-key'], 'k1');
});

await test('a gateway 401, a proxy page or a 500 never signs anyone out', async () => {
  for (const [status, body] of [
    [401, { msg: 'Invalid JWT' }],
    [401, '<html>401 Unauthorized</html>'],
    [500, { error: 'Something went wrong on our side. Please try again.' }],
    [503, 'upstream connect error'],
  ]) {
    const r = await familyAfter(status, body);
    assert.equal(r.heard, 0, `${status} ${JSON.stringify(body)}`);
    assert.equal(r.key, 'k1', 'the key stays');
    assert.ok(r.err instanceof A.ApiError);
  }
});

await test('no network never signs anyone out', async () => {
  A.setApiAuth({ deviceKey: 'k1', code: null, profileId: null });
  let heard = 0;
  A.setSignedOutHandler(() => (heard += 1));
  globalThis.fetch = async () => {
    throw new TypeError('Network request failed');
  };
  const err = await A.api.family().then(() => null, (e) => e);
  A.setSignedOutHandler(null);
  assert.equal(err?.kind, 'network');
  assert.equal(heard, 0);
  assert.equal(A.getApiAuth().key, 'k1');
});

await test('a keychain that cannot answer is not "nothing saved"', async () => {
  const k = globalThis.__keychain;
  k.items.set('homecookd.deviceKey', 'k1');
  assert.equal(await S.secretRead('deviceKey'), 'k1');
  k.locked = true;
  await assert.rejects(S.secretRead('deviceKey'), /not allowed/, 'secretRead says it could not read');
  assert.equal(await S.secretGet('deviceKey'), null, 'secretGet (other callers) still never throws');
  k.locked = false;
  assert.equal(await S.secretRead('deviceKey'), 'k1', 'unlocked: the key was there all along');
  k.items.clear();
  assert.equal(await S.secretRead('deviceKey'), null, 'really nothing saved');
  k.items.set('edible.deviceKey', 'old');
  assert.equal(await S.secretRead('deviceKey'), 'old', 'a key saved before the rename');
  assert.equal(k.items.get('homecookd.deviceKey'), 'old', 'moved to the new name');
  k.items.clear();
});

await test('a keychain that keeps failing: wait for the front only while the app is not in front', async () => {
  const k = globalThis.__keychain;
  k.items.set('homecookd.deviceKey', 'k1');
  k.locked = true;
  globalThis.__appState.currentState = 'background';
  assert.equal(await S.secretReadRetried('deviceKey', [0, 0]), undefined, 'launched in the background while locked: ask again later');
  globalThis.__appState.currentState = 'active';
  assert.equal(await S.secretReadRetried('deviceKey', [0, 0]), null, 'in front and still failing: sign in again, never stuck');
  k.locked = false;
  assert.equal(await S.secretReadRetried('deviceKey', [0, 0]), 'k1');
  k.items.clear();
});

await test('a new key is saved readable after the first unlock; an existing key still reads', async () => {
  const k = globalThis.__keychain;
  k.items.set('homecookd.deviceKey', 'old-key'); // saved before Oct 24, "while unlocked"
  assert.equal(await S.secretRead('deviceKey'), 'old-key');
  await S.secretSet('deviceKey', 'k2', { afterFirstUnlock: true });
  assert.equal(globalThis.__keychain.lastOptions?.keychainAccessible, 'AFTER_FIRST_UNLOCK');
  assert.equal(await S.secretRead('deviceKey'), 'k2');
  k.items.clear();
});

await test('"Delete my account" asks Apple only for its own Apple account here, on iOS, once Convex is ready', () => {
  const yes = { own: true, os: 'ios', appleProfileId: 'p-leo', personId: 'p-leo', ready: true };
  assert.equal(P.asksApple(yes), true);
  assert.equal(P.asksApple({ ...yes, own: false }), false, 'someone else on this phone (Grandma)');
  assert.equal(P.asksApple({ ...yes, os: 'android' }), false);
  assert.equal(P.asksApple({ ...yes, os: 'web' }), false);
  assert.equal(P.asksApple({ ...yes, appleProfileId: null }), false, 'Google, an invite, a family code, or signed in before this build');
  assert.equal(P.asksApple({ ...yes, appleProfileId: 'p-mom' }), false, 'Apple signed in someone else');
  assert.equal(P.asksApple({ ...yes, personId: null }), false);
  assert.equal(P.asksApple({ ...yes, ready: false }), false, 'Convex has no Sign in with Apple key yet');
  assert.equal(P.appleAccountHere({ ...yes, ready: false }), true, 'worth asking Convex whether it is ready');
});

await test('Apple confirms with no scopes and hands back a fresh code; cancelled or failed gives none', async () => {
  const a = globalThis.__apple;
  assert.equal(await P.confirmToRevoke(), 'code-1');
  assert.deepEqual(a.asked.at(-1), { requestedScopes: [] });
  a.fail = Object.assign(new Error('The user canceled the authorization attempt.'), { code: 'ERR_REQUEST_CANCELED' });
  assert.equal(await P.confirmToRevoke(), null, 'cancelled: the deletion goes on');
  a.fail = Object.assign(new Error('The authorization attempt failed.'), { code: 'ERR_REQUEST_FAILED' });
  assert.equal(await P.confirmToRevoke(), null);
  a.fail = null;
  a.code = null;
  assert.equal(await P.confirmToRevoke(), null, 'no code from Apple');
  a.code = 'code-1';
  a.available = false;
  const asked = a.asked.length;
  assert.equal(await P.confirmToRevoke(), null);
  assert.equal(a.asked.length, asked, 'no sheet where Apple sign-in is unavailable');
  a.available = true;
});

// ---- Joining only by a link

const JOIN = 'Ab3dEf6hIj9kLm2nOp5qRs'; // a family join link's token: 22 base62
const OLD = 'aB3dE6gH9jK2mN5p'; // an older one-use invite's: 16

await test('a sign-in from a link sends one link, the card’s role and move', () => {
  assert.deepEqual(J.linkFields(), {}, 'no link: a known person signs in, someone new starts a family');
  assert.deepEqual(J.linkFields({ joinToken: JOIN, role: 'learner', name: 'Asha' }), { join_token: JOIN, role: 'learner' }, 'the name goes on its own');
  assert.deepEqual(J.linkFields({ joinToken: ` ${OLD} ` }), { join_token: OLD }, 'an older invite rides the same field');
  assert.deepEqual(J.linkFields({ linkTicket: 'tk.sig', role: 'cook' }), { link_ticket: 'tk.sig' }, 'a ticket’s side sets the role');
  assert.deepEqual(J.linkFields({ joinToken: JOIN, linkTicket: 'tk.sig' }), { join_token: JOIN }, 'one link at most');
  assert.deepEqual(J.linkFields({ joinToken: JOIN, move: true }), { join_token: JOIN, move: true });
  assert.deepEqual(J.linkFields({ linkTicket: 'tk.sig', move: true }), { link_ticket: 'tk.sig', move: true });
  assert.deepEqual(J.linkFields({ move: true }), {}, 'no link, nothing to move to');
  assert.deepEqual(J.linkFields({ joinToken: '  ', linkTicket: '' }), {});
  assert.equal(J.cleanName('  Auntie   Lin '), 'Auntie Lin');
  assert.equal(J.cleanName('x'.repeat(60)).length, 40);
  assert.equal(J.cleanName(null), '');
});

await test('a refused sign-in says which card to show', () => {
  const err = (status, body) => new A.ApiError(body?.error ?? 'x', status, 'http', body);
  const LINK_USED = 'This link already brought someone in. Ask them for an invite.';
  assert.equal(J.signInFailure(err(409, { error: LINK_USED, code: 'LINK_USED' })).why, 'link-used');
  assert.equal(J.signInFailure(err(409, { error: LINK_USED })).why, 'link-used', 'by its sentence, if the code is missing');
  const name = J.signInFailure(err(409, { error: 'Asha is already in this family. Pick another name.' }));
  assert.deepEqual(name, { status: 'error', error: 'Asha is already in this family. Pick another name.', why: 'name' });
  assert.deepEqual(J.signInFailure(err(410, { error: 'This invite expired.', status: 'expired' })), {
    status: 'error',
    error: 'This invite expired.',
    why: 'gone',
    invite: 'expired',
  });
  assert.equal(J.signInFailure(err(410, { error: 'This invite was already used.' })).invite, 'used');
  assert.equal(J.signInFailure(err(403, { error: 'This link didn’t work. Open it again.' })).why, 'bad-ticket');
  assert.equal(J.signInFailure(err(404, { error: 'That invite link doesn’t work.' })).why, 'not-found');
  assert.equal(J.signInFailure(err(400, { error: 'Type a name first.' })).why, 'name');
  assert.equal(J.signInFailure(err(500, { error: 'Something went wrong on our side.' })).why, undefined);
  assert.deepEqual(J.signInFailure(new TypeError('Network request failed')), { status: 'error', error: 'Something went wrong. Try again.' });
});

await test('POST /auth/apple carries the link, the name, the role and move, and passes needs_move back', async () => {
  A.setApiAuth({ deviceKey: null, code: null, profileId: null });
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ existing: true, needs_move: true, from_family: 'Wang family', to_family: 'Pawar family' }), { status: 200 });
  };
  const res = await A.api.authApple({ id_token: 'id', name: 'Asha', device_label: 'iPhone', ...J.linkFields({ joinToken: JOIN, role: 'learner', move: true }) });
  assert.match(bodies[0].url, /\/auth\/apple$/);
  assert.deepEqual(bodies[0].body, { id_token: 'id', name: 'Asha', device_label: 'iPhone', join_token: JOIN, role: 'learner', move: true });
  assert.ok(!('share_token' in bodies[0].body), 'a recipe link joins nobody now');
  assert.deepEqual(res, { existing: true, needs_move: true, from_family: 'Wang family', to_family: 'Pawar family' });
});

await test('POST /join-links: the family’s join link, asked as the person who shares it', async () => {
  A.setApiAuth({ deviceKey: 'k1', code: null, profileId: 'p-mom' });
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, init });
    return new Response(JSON.stringify({ url: `https://homecookd.app/i?t=${JOIN}`, expires_at: '2026-11-05T00:00:00Z' }), { status: 200 });
  };
  const link = await A.api.joinLink();
  assert.equal(link.url, `https://homecookd.app/i?t=${JOIN}`);
  assert.match(sent[0].url, /\/join-links$/);
  assert.equal(sent[0].init.method, 'POST');
  assert.equal(sent[0].init.headers['x-device-key'], 'k1');
  assert.equal(sent[0].init.headers['x-profile-id'], 'p-mom');
  A.setApiAuth({ deviceKey: null, code: null, profileId: null });
});

/** A clipboard that says whether it holds a link, and counts how often it was read. */
function clipboard({ hasUrl = true, url = null, text = null } = {}) {
  const c = { reads: 0, asks: 0 };
  c.hasUrl = async () => {
    c.asks += 1;
    if (hasUrl instanceof Error) throw hasUrl;
    return hasUrl;
  };
  c.readUrl = async () => {
    c.reads += 1;
    return url;
  };
  c.readText = async () => text;
  return c;
}

await test('the invisible pickup: no link on the clipboard, nothing is read', async () => {
  const { pickUpLink } = await freshPickup();
  const c = clipboard({ hasUrl: false, url: `https://homecookd.app/i?t=${JOIN}` });
  assert.equal(await pickUpLink(c), null);
  assert.equal(c.reads, 0, 'no "Allow Paste" without a link there');
  const failing = clipboard({ hasUrl: new Error('not on this phone') });
  assert.equal(await pickUpLink(failing), null);
  assert.equal(failing.reads, 0);
});

await test('the invisible pickup opens a join link, a dish card or an ask, once per launch', async () => {
  let { pickUpLink } = await freshPickup();
  const c = clipboard({ url: `https://homecookd.app/i?t=${JOIN}` });
  assert.equal(await pickUpLink(c), `/i?t=${JOIN}`);
  assert.equal(await pickUpLink(c), null, 'read once per launch');
  assert.equal(c.reads, 1);
  ({ pickUpLink } = await freshPickup());
  assert.equal(await pickUpLink(clipboard({ url: `homecookd://i?t=${OLD}` })), `/i?t=${OLD}`, 'an older invite');
  ({ pickUpLink } = await freshPickup());
  assert.equal(await pickUpLink(clipboard({ url: `https://homecookd.app/miss?k=${JOIN}` })), `/miss?k=${JOIN}`);
  ({ pickUpLink } = await freshPickup());
  // iOS gave no URL object (the link came as text): the text is read instead.
  assert.equal(await pickUpLink(clipboard({ url: null, text: `Mom wants your dal: homecookd.app/a?t=${JOIN}` })), `/a?t=${JOIN}`);
});

await test('the invisible pickup leaves anything else alone, silently, and reads it only once', async () => {
  for (const url of ['https://example.com/recipes', `https://evil.example/i?t=${JOIN}`, 'https://homecookd.app/i?c=K7QM2X', 'https://homecookd.app/r?s=share-tok_1', JOIN]) {
    const { pickUpLink } = await freshPickup();
    const c = clipboard({ url });
    assert.equal(await pickUpLink(c), null, url);
    assert.equal(await pickUpLink(clipboard({ url: `https://homecookd.app/i?t=${JOIN}` })), null, 'no second read this launch');
  }
  // Mount and a return to the front at the same moment: one read.
  const { pickUpLink } = await freshPickup();
  const c = clipboard({ url: `https://homecookd.app/i?t=${JOIN}` });
  const both = await Promise.all([pickUpLink(c), pickUpLink(c)]);
  assert.deepEqual(both.sort(), [null, `/i?t=${JOIN}`].sort());
  assert.equal(c.reads, 1);
});

const src = (p) => readFileSync(join(root, 'src', p), 'utf8');

await test('no family codes, no Paste invite, no /join-code, no /auth/link; old phones stay signed in', () => {
  assert.equal(existsSync(join(root, 'src/app/join-code.tsx')), false);
  assert.equal(existsSync(join(root, 'src/components/signin/PasteInvite.tsx')), false);
  const session = src('lib/session.tsx');
  assert.doesNotMatch(session, /joinFamily|joinByLink|acceptInvite|authLink|share_token|shareToken/);
  assert.match(session, /const swapCode = useCallback/, 'the boot swap of an old saved family code stays');
  assert.match(session, /if \(!key && code\) await swapCode\(code\);/);
  assert.match(session, /ENV_CODE/, 'the build’s dev-aid code stays');
  assert.doesNotMatch(src('lib/api.ts'), /authLink|\/auth\/link|inviteAccept/);
  const layout = src('app/_layout.tsx');
  assert.doesNotMatch(layout, /join-code/);
  assert.match(layout, /setLinksMoved\(linksMoved\);/, 'a move’s receipt reaches Convex');
  for (const f of ['app/join.tsx', 'app/i.tsx', 'app/index.tsx', 'components/signin/index.ts', 'components/signin/ClaimLink.tsx', 'components/signin/handoff.ts']) {
    assert.doesNotMatch(src(f), /join-code|PasteInvite|haveFamilyCode|signin\.paste|signin\.code\./, f);
  }
  const join_ = src('app/join.tsx');
  assert.doesNotMatch(join_, /params\.s\b|peekShare|shareToken/, 'a recipe link joins nobody');
  assert.match(join_, /useLinkPickup\(status === 'needs-code' && step === 'start'/, 'the pickup runs only signed out, on the start');
});

await test('every Apple step is the system button; Google shows on Android only', () => {
  const buttons = src('components/signin/ProviderButtons.tsx');
  assert.match(buttons, /AppleAuthenticationButtonType\.SIGN_IN/);
  assert.doesNotMatch(buttons, /AppleAuthenticationButtonType\.CONTINUE/);
  assert.match(buttons, /google: google && Platform\.OS === 'android'/);
  for (const f of ['components/signin/JoinCard.tsx', 'components/signin/MoveCard.tsx']) assert.match(src(f), /<ProviderButtons /, f);
  // "Join <B>" is a plain button; the sign-in shows only once they tapped it.
  assert.match(src('components/signin/MoveCard.tsx'), /confirmed \? \(\s*<ProviderButtons[\s\S]*?\) : \(\s*<ActionButton/);
});

console.log(`\n${passed} passed`);

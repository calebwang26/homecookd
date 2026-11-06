// Unit tests for the Community screens' words and picks (src/components/community/labels.ts), the map's
// choosers (choices.ts), the dinner invite (invite.ts) and the map's geometry (mapLayout.ts):
//   time labels   "Dinner tonight · 7 pm", "Friday · 7 pm", Tomorrow across a daylight-saving change,
//                 weekday names, dates past a week
//   seat text     "2 of 6 seats taken", "4 seats left", "1 seat left", "Full"
//   map card      "About 1 mi away", "Mama Ngozi · Nigerian"
//   circle labels "Jollof Rice by Mama Ngozi, under a mile away", "3 dishes in your building"
//   "You"         the sun dot (open requests to my dinners, swaps asked of us) and its label
//   map geometry  lat/lng -> x/y, one circle per grid cell, no overlaps, neighborhood names
//   choosers      Connect (join, swap, cook together), Share your recipe (on the map, host), which dish,
//                 "Grandma Rajani said not now" for a day, the offer
//   swaps         "You’re swapping Kanda Poha ↔ Jollof Rice with the Okafor family", "Cooking Jollof Rice
//                 together with the Okafor family" and the asks
//   privacy note  "Rajani’s video and voice stay in the family. Neighbors see the recipe text, …"
//   dinner page   "Jollof Rice Night", "4 going" (with invite opens) and its faces, the one button
//                 ("2 asked to join" for the host first, then "Invite friends")
//   invite        "Come to Jollof Rice Night with Mom: <url>", the Convex site URL, the token check, the
//                 reply's shape, this phone's id, what /d says
//   next dinner   hosting, then in, then asked, then the soonest open one; never past, called off
//                 or declined
//   host form     day chips, time chips, the moment they make, today or tomorrow
//   errors        a ConvexError's sentence, else the fallback
//   report        "Report this recipe", the three reasons, "Block the Pawar family", the thank-you (report.ts)
//   node scripts/test-community-ui.mjs
// The labels read the phone's clock, so the zone is pinned (New York has a DST change on Nov 1 2026).
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The app's siblings ('./labels') resolve to .ts, as Metro does.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec) && ctx.parentURL) {
      const p = join(dirname(fileURLToPath(ctx.parentURL)), `${spec}.ts`);
      if (existsSync(p)) return next(pathToFileURL(p).href, ctx);
    }
    return next(spec, ctx);
  },
});
const community = (file) => import(pathToFileURL(join(root, 'src/components/community', file)).href);
const L = await community('labels.ts');
const G = await community('mapLayout.ts');
const C = await community('choices.ts');
const V = await community('invite.ts');
const R = await community('report.ts');

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

const at = (month, day, hour, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();
// Saturday Oct 24 2026, 10 am.
const NOW = at(10, 24, 10);

test('clock words', () => {
  assert.equal(L.shortClock(at(10, 24, 19)), '7 pm');
  assert.equal(L.shortClock(at(10, 24, 19, 30)), '7:30 pm');
  assert.equal(L.shortClock(at(10, 24, 12)), '12 pm');
  assert.equal(L.shortClock(at(10, 24, 0, 5)), '12:05 am');
});

test('day words', () => {
  assert.equal(L.dayWord(at(10, 24, 19), NOW), 'Tonight');
  assert.equal(L.dayWord(at(10, 24, 17), NOW), 'Tonight');
  assert.equal(L.dayWord(at(10, 24, 12), NOW), 'Today');
  assert.equal(L.dayWord(at(10, 25, 19), NOW), 'Tomorrow');
  assert.equal(L.dayWord(at(10, 27, 19), NOW), 'Tuesday');
  assert.equal(L.dayWord(at(10, 30, 19), NOW), 'Friday');
  assert.equal(L.dayWord(at(10, 31, 19), NOW), 'Oct 31');
  // Clocks go back on Nov 1: that day is 25 hours long, and it's still one day.
  const lateOct31 = at(10, 31, 23, 30);
  assert.equal(L.daysFrom(lateOct31, at(11, 1, 19)), 1);
  assert.equal(L.dayWord(at(11, 1, 19), lateOct31), 'Tomorrow');
  assert.equal(L.dayWord(at(11, 2, 0, 30), lateOct31), 'Monday');
});

test('the dinner card and page say when', () => {
  assert.equal(L.cardWhen(at(10, 24, 19), NOW), 'Dinner tonight · 7 pm');
  assert.equal(L.cardWhen(at(10, 24, 12), NOW), 'Dinner today · 12 pm');
  assert.equal(L.cardWhen(at(10, 25, 18, 30), NOW), 'Dinner tomorrow · 6:30 pm');
  assert.equal(L.cardWhen(at(10, 27, 19, 30), NOW), 'Dinner Tuesday · 7:30 pm');
  assert.equal(L.dinnerWhen(at(10, 30, 19), NOW), 'Friday · 7 pm');
  assert.equal(L.dinnerWhen(at(10, 24, 19, 30), NOW), 'Tonight · 7:30 pm');
  assert.equal(L.dinnerWhen(at(10, 25, 18), NOW), 'Tomorrow · 6 pm');
});

test('seat text', () => {
  assert.equal(L.seatLine(6, 4), '2 of 6 seats taken');
  assert.equal(L.seatLine(6, 0), '6 of 6 seats taken');
  assert.equal(L.seatLine(1, 1), '0 of 1 seat taken');
  assert.equal(L.seatLine(undefined, 4), '4 seats left');
  assert.equal(L.seatLine(null, 1), '1 seat left');
  assert.equal(L.seatLine(undefined, 0), 'Full');
  assert.equal(L.seatLine(6, -1), '6 of 6 seats taken');
});

test("the map card's words", () => {
  assert.equal(L.awayLabel('About 1 mi'), 'About 1 mi away');
  assert.equal(L.awayLabel('Under a mile'), 'Under a mile away');
  assert.equal(L.awayLabel('In your building'), 'In your building');
  assert.equal(L.awayLabel(''), '');
  assert.equal(L.cookLine('Mama Ngozi', 'Nigerian'), 'Mama Ngozi · Nigerian');
  assert.equal(L.cookLine('Mama Ngozi', null), 'Mama Ngozi');
  assert.equal(L.cookLine(' ', 'Filipino'), 'Filipino');
});

test('what VoiceOver says for a circle, and the shared circle', () => {
  const jollof = { dish: 'Jollof Rice', cookName: 'Mama Ngozi', distanceLabel: 'Under a mile' };
  assert.equal(L.spotLabel([jollof]), 'Jollof Rice by Mama Ngozi, under a mile away');
  assert.equal(L.spotLabel([{ ...jollof, cookName: '' }]), 'Jollof Rice, under a mile away');
  const floor = [
    { dish: 'Pork Dumplings', cookName: 'Mei', distanceLabel: 'In your building' },
    { dish: 'Tomato Egg', cookName: 'Caleb', distanceLabel: 'In your building' },
    { dish: 'Chicken Karahi', cookName: 'Salik', distanceLabel: 'In your building' },
  ];
  assert.equal(L.spotLabel(floor), '3 dishes, in your building: Pork Dumplings by Mei, Tomato Egg by Caleb and Chicken Karahi by Salik');
  assert.equal(L.spotLabel(floor.slice(0, 2)), '2 dishes, in your building: Pork Dumplings by Mei and Tomato Egg by Caleb');
  assert.equal(L.spotLabel([]), '');
  assert.equal(L.clusterTitle(3, 'In your building'), '3 dishes in your building');
  assert.equal(L.clusterTitle(2, 'About 1 mi'), '2 dishes about 1 mi away');
});

test('the sun dot on "You": open requests to dinners I host', () => {
  const pending = { requestId: 'r', guestName: 'Leo', status: 'pending' };
  const mine = [
    { isHost: true, startsAt: at(10, 24, 19), status: 'open', requests: [pending, { ...pending, status: 'accepted' }] },
    { isHost: true, startsAt: at(10, 23, 19), status: 'open', requests: [pending] }, // already happened
    { isHost: true, startsAt: at(10, 25, 19), status: 'cancelled', requests: [pending] },
    { isHost: false, startsAt: at(10, 25, 19), status: 'open', requests: null },
  ];
  assert.equal(L.newRequests(mine, NOW), 1);
  assert.equal(L.newRequests([], NOW), 0);
  assert.equal(L.youLabel(1), 'You, 1 new request');
  assert.equal(L.youLabel(2), 'You, 2 new requests');
  assert.equal(L.youLabel(0), 'You');
});

// ---- The map's geometry (src/components/community/mapLayout.ts) ----

const HERE = { lat: 42.36, lng: -71.09 }; // convex/lib/geo.ts DEMO_LOCATION
const SIZE = 358; // a 390 pt phone, 16 pt each side
const grid = (n) => Math.round(n * 100) / 100;
const cell = (north, east) => ({ lat: grid(HERE.lat + north / 100), lng: grid(HERE.lng + east / 100) });

test('lat/lng to map x/y: the middle is me, north is up, east is right', () => {
  assert.deepEqual(G.project(HERE, HERE, SIZE), { x: SIZE / 2, y: SIZE / 2 });
  const north = G.project(cell(1, 0), HERE, SIZE);
  const east = G.project(cell(0, 1), HERE, SIZE);
  assert.ok(Math.abs(north.x - SIZE / 2) < 1e-9 && north.y < SIZE / 2);
  assert.ok(east.x > SIZE / 2 && Math.abs(east.y - SIZE / 2) < 1e-9);
  // Farther is farther out, on a square-root scale; 3 mi (the seeded neighbors' farthest) still fits.
  const r = (p) => Math.hypot(p.x - SIZE / 2, p.y - SIZE / 2);
  assert.ok(r(G.project(cell(2, 0), HERE, SIZE)) > r(north));
  const edge = SIZE / 2 - G.PHOTO / 2;
  assert.ok(r(G.project(cell(-4, 0), HERE, SIZE)) < edge); // 2.76 mi south
  // Anything past HALF_MILES sits on the edge in its direction, still inside the border.
  const far = G.project({ lat: 43.5, lng: -71.09 }, HERE, SIZE);
  assert.ok(Math.abs(r(far) - r(G.project({ lat: 42.36 + G.HALF_MILES / 69, lng: -71.09 }, HERE, SIZE))) < 0.5);
  assert.ok(far.y > G.PHOTO / 2 && far.y < SIZE / 2);
  assert.equal(G.cellKey({ lat: 42.36, lng: -71.09 }), '42.36,-71.09');
  assert.equal(G.cellKey({ lat: 42.3649, lng: -71.0851 }), '42.36,-71.09');
});

// The seeded neighbors (convex/seedCommunity.ts, grid steps north/east) and three floormates at the venue.
const SEEDED = [
  { dish: 'Pork Dumplings', approx: HERE },
  { dish: 'Tomato Egg', approx: HERE },
  { dish: 'Chicken Karahi', approx: HERE },
  ...[[1, 0], [0, 1], [-1, -1], [2, 0], [-2, 1], [0, -4], [3, 2], [-4, 0]].map(([n, e], i) => ({ dish: `n${i}`, approx: cell(n, e) })),
];

test('one circle per grid cell: the floormates share one with all three dishes', () => {
  const spots = G.layoutSpots(SEEDED, HERE, SIZE);
  assert.equal(spots.length, 9);
  assert.deepEqual(spots[0].members.map((m) => m.dish), ['Pork Dumplings', 'Tomato Egg', 'Chicken Karahi']);
  assert.equal(spots[0].key, '42.36,-71.09');
  assert.ok(spots.slice(1).every((s) => s.members.length === 1));
  assert.deepEqual(G.layoutSpots(SEEDED, null, SIZE), []);
  assert.deepEqual(G.layoutSpots([], HERE, SIZE), []);
});

test('no circle covers another, "You", or the border', () => {
  for (const size of [311, 330, 358, 420]) {
    const spots = G.layoutSpots(SEEDED, HERE, size);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) >= G.PHOTO, `${size}: ${spots[i].key} / ${spots[j].key}`);
      }
      const s = spots[i];
      assert.ok(Math.hypot(s.x - size / 2, s.y - size / 2) >= G.PHOTO / 2 + G.YOU_CLEAR - 0.5, `${size}: ${s.key} on You`);
      assert.ok(s.x >= G.PHOTO / 2 && s.x <= size - G.PHOTO / 2 && s.y >= G.PHOTO / 2 && s.y <= size - G.PHOTO / 2, `${size}: ${s.key} off the map`);
    }
  }
  // The floormates' circle (in the middle with me) moves up and to the right, as in the mockup.
  const building = G.layoutSpots(SEEDED, HERE, SIZE)[0];
  assert.ok(building.x > SIZE / 2 && building.y < SIZE / 2);
});

test('neighborhood names: at their real places, never under a circle or "You", off the map elsewhere', () => {
  const spots = G.layoutSpots(SEEDED, HERE, SIZE);
  const areas = G.placeAreas(HERE, SIZE, spots);
  assert.ok(areas.length > 0);
  const boxes = areas.map((a) => G.nameBox(a.name, a.x, a.y));
  boxes.forEach((box, i) => {
    assert.ok(box.x0 >= 0 && box.y0 >= 0 && box.x1 <= SIZE && box.y1 <= SIZE, `${areas[i].name} on the map`);
    for (const t of [...G.takenBoxes(spots, SIZE), ...boxes.filter((_, j) => j !== i)]) assert.ok(!G.overlaps(box, t), areas[i].name);
  });
  // Each name is within a small nudge of its real place; Harvard Square is north-west of MIT.
  for (const a of areas) {
    const real = G.project(G.MAP_AREAS.find((m) => m.name === a.name).at, HERE, SIZE, G.PHOTO / 2 + 6, false);
    assert.ok(Math.hypot(a.x - real.x, a.y - real.y) <= 32, a.name);
  }
  const harvard = G.project({ lat: 42.3734, lng: -71.1189 }, HERE, SIZE);
  assert.ok(harvard.x < SIZE / 2 && harvard.y < SIZE / 2);
  assert.deepEqual(G.placeAreas({ lat: 37.77, lng: -122.42 }, SIZE), []); // San Francisco: none of these
  assert.deepEqual(G.placeAreas(null, SIZE), []);
});

test('the privacy note names the one line she said and an AI guess at where it’s from (homie is off)', () => {
  const guess = 'and an AI guess at where it’s from.';
  assert.equal(L.privacyNote('Rajani'), `Rajani’s video and voice stay in the family. Neighbors see the recipe text, one line Rajani said ${guess}`);
  assert.equal(L.privacyNote('James'), `James’ video and voice stay in the family. Neighbors see the recipe text, one line James said ${guess}`);
  assert.equal(L.privacyNote(null), `The cook’s video and voice stay in the family. Neighbors see the recipe text, one line the cook said ${guess}`);
  assert.equal(L.whose('Lolo Rey'), 'Lolo Rey’s');
  assert.equal(L.whose(' '), 'The cook’s');
});

test('place kinds: campus kitchen first, home last', () => {
  assert.deepEqual(
    L.PLACE_KINDS.map((p) => p.key),
    ['campus_kitchen', 'community_center', 'cafe', 'home'],
  );
  assert.equal(L.placeLabel('cafe'), 'Café');
});

const dinner = (over = {}) => ({
  dinnerId: 'd1',
  hostName: 'Shreya',
  isHost: false,
  seats: 6,
  seatsLeft: 6,
  inviteOpens: 0,
  startsAt: at(10, 24, 19),
  status: 'open',
  myRequest: null,
  requests: null,
  ...over,
});

test('the dinner page: its title, who is going, and its one button', () => {
  assert.equal(L.nightTitle('Jollof Rice'), 'Jollof Rice Night');
  assert.equal(L.nightTitle(' Taco Night '), 'Taco Night');
  const hosting = dinner({
    isHost: true,
    seatsLeft: 3,
    requests: [
      { requestId: 'r1', guestName: 'Serene', status: 'accepted' },
      { requestId: 'r2', guestName: 'Leo', status: 'pending' },
      { requestId: 'r3', guestName: 'Maya', status: 'declined' },
      { requestId: 'r4', guestName: 'caleb', status: 'accepted' },
      { requestId: 'r5', guestName: 'Amy', status: 'accepted' },
    ],
  });
  // The host knows the guests' names; the host counts as going.
  assert.deepEqual(L.goingFaces(hosting, 'Shreya'), { faces: ['S', 'S', 'C'], count: 4, label: '4 going' });
  assert.deepEqual(L.goingFaces(dinner({ seatsLeft: 3, myRequest: { requestId: 'r', status: 'accepted' } }), 'Caleb'), { faces: ['S', 'C'], count: 4, label: '4 going' });
  assert.deepEqual(L.goingFaces(dinner({ seatsLeft: 4, myRequest: { requestId: 'r', status: 'pending' } }), 'Caleb'), { faces: ['S'], count: 3, label: '3 going' });
  assert.deepEqual(L.goingFaces(dinner({ hostName: 'आजी' }), ''), { faces: ['आ'], count: 1, label: '1 going' });
  // Every phone that opened the invite link is going too (no face: nobody knows who they are).
  assert.deepEqual(L.goingFaces({ ...hosting, inviteOpens: 3 }, 'Shreya'), { faces: ['S', 'S', 'C'], count: 7, label: '7 going' });
  assert.deepEqual(L.goingFaces(dinner({ inviteOpens: 2 }), ''), { faces: ['S'], count: 3, label: '3 going' });
  assert.equal(L.goingCount(dinner({ seatsLeft: 4, inviteOpens: 5 })), 8);
  assert.equal(L.goingCount(dinner({ inviteOpens: undefined })), 1); // an older server without the field

  const later = at(10, 24, 19);
  assert.deepEqual(L.dinnerAction(dinner(), NOW), { kind: 'ask' });
  assert.deepEqual(L.dinnerAction(dinner({ myRequest: { requestId: 'r', status: 'pending' } }), NOW), { kind: 'waiting', label: 'Asked · waiting' });
  assert.deepEqual(L.dinnerAction(dinner({ myRequest: { requestId: 'r', status: 'accepted' } }), NOW), { kind: 'invite' });
  assert.deepEqual(L.dinnerAction(dinner({ isHost: true }), NOW), { kind: 'invite' });
  // One step at a time: while people wait on the host's answer, that's the host's button.
  assert.deepEqual(L.dinnerAction(hosting, NOW), { kind: 'requests', count: 1, label: '1 asked to join' });
  const two = { ...hosting, requests: [...hosting.requests, { requestId: 'r6', guestName: 'Ana', status: 'pending' }] };
  assert.deepEqual(L.dinnerAction(two, NOW), { kind: 'requests', count: 2, label: '2 asked to join' });
  assert.deepEqual(L.dinnerAction({ ...hosting, requests: hosting.requests.filter((r) => r.status !== 'pending') }, NOW), { kind: 'invite' });
  assert.deepEqual(L.dinnerAction(hosting, later), { kind: 'note', text: 'This dinner already happened.' });
  assert.deepEqual(L.dinnerAction(dinner({ myRequest: { requestId: 'r', status: 'declined' } }), NOW), { kind: 'note', text: 'Shreya can’t fit you this time.' });
  assert.deepEqual(L.dinnerAction(dinner({ seatsLeft: 0, status: 'full' }), NOW), { kind: 'note', text: 'Every seat is taken.' });
  assert.deepEqual(L.dinnerAction(dinner({ isHost: true }), later), { kind: 'note', text: 'This dinner already happened.' });
  assert.deepEqual(L.dinnerAction(dinner({ status: 'cancelled' }), NOW), { kind: 'note', text: 'This dinner was called off.' });
});

// ---- The map's choosers (src/components/community/choices.ts) ----

const feedDinner = (over = {}) => ({ dinnerId: 'd1', startsAt: at(10, 30, 19), seatsLeft: 2, hostName: 'Mama Ngozi', distanceLabel: 'Under a mile', ...over });
const rowsOf = (rows) => rows.map((r) => [r.title, r.line, r.primary, !!r.disabled]);

test('Connect: join her dinner (when there is one), swap recipes, cook together; the first one you can press green', () => {
  const recipe = { distanceLabel: 'Under a mile', dish: 'Jollof Rice', cookName: 'Mama Ngozi', familyName: 'The Okafor family' };
  const base = { recipe, dinner: feedDinner(), myRequest: null, swap: null, cook: null, now: NOW };
  assert.equal(C.dishTitle('Mama Ngozi', 'Jollof Rice'), 'Mama Ngozi’s Jollof Rice');
  assert.equal(C.dishTitle('', 'Jollof Rice'), 'Jollof Rice');
  assert.deepEqual(rowsOf(C.connectRows(base)), [
    ['Join Mama Ngozi’s dinner', 'Friday · 7 pm · 2 seats left', true, false],
    ['Swap recipes', 'Teach each other your family dishes', false, false],
    ['Cook together', 'Ask Mama Ngozi to make it with you', false, false],
  ]);
  assert.deepEqual(rowsOf(C.connectRows({ ...base, dinner: null })), [
    ['Swap recipes', 'Teach each other your family dishes', true, false],
    ['Cook together', 'Ask Mama Ngozi to make it with you', false, false],
  ]);
  // Hosting your own dinner is only under "Share your recipe": never on someone else's dish.
  assert.ok(C.connectRows(base).every((r) => r.key !== 'host'));
  const cookRow = (cook) => rowsOf(C.connectRows({ ...base, cook }))[2];
  assert.deepEqual(cookRow('pending'), ['Cook together', 'Asked · waiting', false, true]);
  assert.deepEqual(cookRow('declined'), ['Cook together', 'They said not this time', false, true]);
  // They said yes: the next step is a dinner of it together.
  assert.deepEqual(cookRow('accepted'), ['Host a dinner', 'Cooking Jollof Rice together with the Okafor family', false, false]);
  assert.equal(C.connectRows({ ...base, cook: 'accepted' })[2].key, 'cook');
  assert.equal(C.connectRows({ ...base, recipe: { ...recipe, cookName: ' ' } })[2].line, 'Ask them to make it with you');
  // The dinner is where its host is: a different distance from the dish says so.
  assert.equal(C.joinLine(feedDinner({ hostName: 'Shreya', distanceLabel: 'About 2 mi' }), 'Under a mile', NOW), 'Friday · 7 pm · 2 seats left · About 2 mi away');
  assert.equal(C.joinLine(feedDinner({ seatsLeft: 1 }), 'Under a mile', NOW), 'Friday · 7 pm · 1 seat left');
  assert.equal(C.connectRows({ ...base, dinner: feedDinner({ hostName: ' ' }) })[0].title, 'Join their dinner');
  const line = (over) => C.connectRows({ ...base, ...over }).map((r) => r.line);
  assert.equal(line({ myRequest: 'pending' })[0], 'Asked · waiting');
  assert.equal(line({ myRequest: 'accepted' })[0], 'You’re in · Friday · 7 pm');
  assert.equal(line({ myRequest: 'declined' })[0], 'Mama Ngozi can’t fit you this time');
  const swapRow = (swap) => rowsOf(C.connectRows({ ...base, swap }))[1];
  assert.deepEqual(swapRow('pending'), ['Swap recipes', 'Asked · waiting', false, true]);
  assert.deepEqual(swapRow('accepted'), ['Swap recipes', 'You’re swapping recipes', false, false]);
  assert.deepEqual(swapRow('declined'), ['Swap recipes', 'They said not this time', false, true]);
  // A row that only says how things stand is never the green button: the next one you can press is.
  assert.deepEqual(rowsOf(C.connectRows({ ...base, dinner: null, swap: 'pending' })), [
    ['Swap recipes', 'Asked · waiting', false, true],
    ['Cook together', 'Ask Mama Ngozi to make it with you', true, false],
  ]);
  assert.deepEqual(rowsOf(C.connectRows({ ...base, dinner: null, swap: 'declined', cook: 'pending' })), [
    ['Swap recipes', 'They said not this time', false, true],
    ['Cook together', 'Asked · waiting', false, true],
  ]);
});

const dish = (over = {}) => ({ recipeId: 'r1', dish: 'Kanda Poha', cookName: 'Grandma Rajani', mine: false, shared: false, asked: false, notNowAt: null, ...over });

test('Share your recipe: put it on the map (the cook is asked first), host a dinner', () => {
  assert.deepEqual(C.shareChoices([dish()], NOW), {
    title: 'Share Grandma Rajani’s Kanda Poha',
    rows: [
      { key: 'map', title: 'Put it on the map', line: 'We ask Grandma Rajani first. The video stays private.', primary: true, disabled: false },
      { key: 'host', title: 'Host a dinner', line: 'Pick a time and place. Neighbors ask to join.', primary: false },
    ],
  });
  const mapRow = (dishes) => rowsOf(C.shareChoices(dishes, NOW).rows)[0];
  assert.deepEqual(mapRow([dish({ asked: true })]), ['Put it on the map', 'Asked Grandma Rajani', false, true]);
  assert.deepEqual(mapRow([dish({ shared: true })]), ['Put it on the map', 'It’s on the map.', false, true]);
  // The map row only says how things stand: "Host a dinner" is the green button.
  assert.deepEqual(rowsOf(C.shareChoices([dish({ asked: true })], NOW).rows)[1], ['Host a dinner', 'Pick a time and place. Neighbors ask to join.', true, false]);
  assert.deepEqual(mapRow([dish({ mine: true })]), ['Put it on the map', 'Neighbors see the recipe text, one line you said and an AI guess at where it’s from.', true, false]);
  assert.equal(C.shareChoices([dish({ mine: true })], NOW).title, 'Share your Kanda Poha');
  assert.deepEqual(mapRow([]), ['Put it on the map', 'Your family hasn’t recorded a dish yet.', false, true]);
  assert.deepEqual(mapRow(null), ['Put it on the map', 'One moment…', false, true]);
  const two = [dish(), dish({ recipeId: 'r2', dish: 'Varan', cookName: 'Dad', shared: true })];
  assert.equal(C.shareChoices(two, NOW).title, 'Share your family’s dish');
  assert.deepEqual(mapRow(two), ['Put it on the map', 'Pick a dish. We ask its cook first.', true, false]);
  assert.deepEqual(mapRow(two.map((d) => ({ ...d, shared: true }))), ['Put it on the map', 'Your family’s dishes are on the map.', false, true]);
  assert.deepEqual(rowsOf(C.dishRows(two, NOW)), [
    ['Kanda Poha', 'We ask Grandma Rajani first. The video stays private.', false, false],
    ['Varan', 'It’s on the map.', false, true],
  ]);
});

test('after she says not now, the kid sees it and can’t ask again for a day', () => {
  const hourAgo = NOW - 3_600_000;
  const no = dish({ notNowAt: hourAgo });
  assert.equal(C.ASK_AGAIN_MS, 24 * 3_600_000);
  assert.ok(C.saidNotNow(no, NOW));
  assert.deepEqual(rowsOf(C.shareChoices([no], NOW).rows), [
    ['Put it on the map', 'Grandma Rajani said not now', false, true],
    ['Host a dinner', 'Pick a time and place. Neighbors ask to join.', true, false],
  ]);
  assert.deepEqual(rowsOf(C.dishRows([no, dish({ recipeId: 'r2', dish: 'Varan', cookName: 'the cook', notNowAt: hourAgo })], NOW)), [
    ['Kanda Poha', 'Grandma Rajani said not now', false, true],
    ['Varan', 'The cook said not now', false, true],
  ]);
  // A day later the ask is back; a fresh ask or her yes win over an old "not now".
  const dayLater = hourAgo + C.ASK_AGAIN_MS;
  assert.ok(!C.saidNotNow(no, dayLater));
  assert.deepEqual(rowsOf(C.shareChoices([no], dayLater).rows)[0], ['Put it on the map', 'We ask Grandma Rajani first. The video stays private.', true, false]);
  assert.ok(!C.saidNotNow({ ...no, asked: true }, NOW));
  assert.ok(!C.saidNotNow({ ...no, shared: true }, NOW));
  assert.equal(C.mapLine({ ...no, asked: true }, NOW), 'Asked Grandma Rajani');
});

test('a dish the team took off the map says so, and nobody can put it back on', () => {
  const down = dish({ mine: true, takenDown: true });
  assert.deepEqual(rowsOf(C.shareChoices([down], NOW).rows)[0], ['Put it on the map', 'Our team took it off the map after a report.', false, true]);
  assert.deepEqual(rowsOf(C.dishRows([down, dish({ recipeId: 'r2', dish: 'Varan' })], NOW)).map((r) => r.slice(1)), [
    ['Our team took it off the map after a report.', false, true],
    ['We ask Grandma Rajani first. The video stays private.', false, false],
  ]);
});

test('a swap offers one of our shared dishes, or none yet', () => {
  assert.deepEqual(rowsOf(C.offerRows([dish({ shared: true }), dish({ recipeId: 'r2', dish: 'Varan', mine: true, shared: true })])), [
    ['Kanda Poha', 'Grandma Rajani’s recipe', true, false],
    ['Varan', 'Your recipe', false, false],
    ['Just ask', 'Offer one of yours later', false, false],
  ]);
  assert.deepEqual(rowsOf(C.offerRows([])), [['Just ask', 'Offer one of yours later', true, false]]);
});

test('swap words, both ways, and the asks that light the sun dot', () => {
  const swap = (over) => ({
    swapId: 's1',
    kind: 'swap',
    status: 'pending',
    incoming: false,
    ourDish: { recipeId: 'a', dish: 'Kanda Poha' },
    theirDish: { recipeId: 'b', dish: 'Jollof Rice' },
    familyName: 'The Okafor family',
    ...over,
  });
  assert.equal(C.swapLine(swap({ status: 'accepted' })), 'You’re swapping Kanda Poha ↔ Jollof Rice with the Okafor family');
  assert.equal(C.swapLine(swap({ status: 'accepted', ourDish: null })), 'You’re swapping Jollof Rice with the Okafor family');
  assert.equal(C.swapLine(swap({ status: 'accepted', ourDish: null, theirDish: null, familyName: 'Mei’s family' })), 'You’re swapping recipes with Mei’s family');
  assert.equal(C.swapLine(swap({})), 'Asked the Okafor family to swap');
  assert.equal(C.swapLine(swap({ status: 'declined' })), 'The Okafor family said not this time');
  const asked = swap({ incoming: true, familyName: 'The Pawar family', ourDish: { recipeId: 'b', dish: 'Dumplings' }, theirDish: { recipeId: 'a', dish: 'Kanda Poha' } });
  assert.equal(C.swapLine(asked), 'The Pawar family would swap their Kanda Poha for your Dumplings.');
  assert.equal(C.swapLine({ ...asked, theirDish: null }), 'The Pawar family would like to swap for your Dumplings.');
  assert.equal(C.midSentence('The Pawar family'), 'the Pawar family');
  assert.equal(C.newSwaps([asked, { ...asked, status: 'accepted' }, swap({}), asked]), 2);

  // "Cook together": the dish is theirs (we asked) or ours (they asked).
  const cook = swap({ kind: 'cook', ourDish: null });
  assert.equal(C.swapLine({ ...cook, status: 'accepted' }), 'Cooking Jollof Rice together with the Okafor family');
  assert.equal(C.swapLine(cook), 'Asked the Okafor family to cook together');
  assert.equal(C.swapLine({ ...cook, status: 'declined' }), 'The Okafor family said not this time');
  const askedUs = swap({ kind: 'cook', incoming: true, familyName: 'The Pawar family', ourDish: { recipeId: 'b', dish: 'Jollof Rice' }, theirDish: null });
  assert.equal(C.swapLine(askedUs), 'The Pawar family would like to cook your Jollof Rice together.');
  assert.equal(C.swapLine({ ...askedUs, status: 'accepted' }), 'Cooking Jollof Rice together with the Pawar family');
  assert.equal(C.swapLine({ ...askedUs, status: 'declined' }), 'You said not this time to the Pawar family');
  assert.equal(C.newSwaps([askedUs, cook]), 1); // their ask lights the sun dot like a swap's
  assert.equal(C.cookingTogetherLine(' ', ''), 'Cooking it together with them');
});

// ---- "Invite friends" (src/components/community/invite.ts) ----

test('Invite friends: the message, the Convex site, the link check and what the opener is told', () => {
  const url = 'https://homecookd.app/d?t=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
  assert.equal(V.inviteText('Jollof Rice', 'Mom', url), `Come to Jollof Rice Night with Mom: ${url}`);
  assert.equal(V.inviteText('Taco Night', ' ', url), `Come to Taco Night: ${url}`);

  assert.equal(V.siteUrl('https://grand-dragon-649.convex.cloud'), 'https://grand-dragon-649.convex.site');
  assert.equal(V.siteUrl(' https://grand-dragon-649.convex.cloud/ '), 'https://grand-dragon-649.convex.site');
  for (const bad of ['', undefined, 'http://grand-dragon-649.convex.cloud', 'https://evil.example/convex.cloud', 'https://a.convex.cloud.evil.example']) {
    assert.equal(V.siteUrl(bad), '');
  }

  assert.ok(V.isInviteToken('abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'));
  for (const bad of ['short', 'has spaces in it at all, nope', 'a/b/c/d/e/f/g/h/i/j/k/l', 12, null, 'x'.repeat(65)]) assert.ok(!V.isInviteToken(bad));

  const reply = { dish: 'Jollof Rice', hostName: 'Mom', startsAt: at(10, 30, 19) };
  assert.deepEqual(V.parseOpened(reply), reply);
  assert.deepEqual(V.parseOpened({ ...reply, address: '362 Memorial Dr' }), reply); // only the three fields, ever
  for (const bad of [null, 'x', { ...reply, dish: ' ' }, { ...reply, startsAt: 'Friday' }, { ...reply, hostName: null }, { ...reply, startsAt: Infinity }]) {
    assert.equal(V.parseOpened(bad), null);
  }

  const ids = new Set(Array.from({ length: 50 }, () => V.randomId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{24}$/); // what POST /invite/open accepts (16 to 64)

  assert.deepEqual(V.openedWords(reply, NOW), { title: 'You’re going to Jollof Rice Night', host: 'Hosted by Mom', when: 'Friday · 7 pm' });
  assert.deepEqual(V.openedWords({ ...reply, startsAt: at(10, 24, 9) }, NOW), { title: 'Jollof Rice Night already happened', host: 'Hosted by Mom', when: '' });
  assert.equal(V.openedWords({ ...reply, hostName: '' }, NOW).host, '');
});

test('the next dinner on top', () => {
  const feed = [
    { dinnerId: 'f-late', startsAt: at(10, 25, 19), seatsLeft: 2 },
    { dinnerId: 'f-soon', startsAt: at(10, 24, 19), seatsLeft: 3 },
    { dinnerId: 'f-full', startsAt: at(10, 24, 18), seatsLeft: 0 },
    { dinnerId: 'f-past', startsAt: at(10, 24, 9), seatsLeft: 3 },
  ];
  assert.deepEqual(L.pickNextDinner([], feed, NOW), { feed: feed[1] });
  assert.equal(L.pickNextDinner([], [], NOW), null);

  const asked = dinner({ dinnerId: 'asked', startsAt: at(10, 24, 18), myRequest: { requestId: 'r', status: 'pending' } });
  const inIt = dinner({ dinnerId: 'in', startsAt: at(10, 26, 19), myRequest: { requestId: 'r', status: 'accepted' } });
  const hosting = dinner({ dinnerId: 'host', startsAt: at(10, 27, 19), isHost: true });
  assert.deepEqual(L.pickNextDinner([asked, inIt, hosting], feed, NOW), { mine: hosting });
  assert.deepEqual(L.pickNextDinner([asked, inIt], feed, NOW), { mine: inIt });
  assert.deepEqual(L.pickNextDinner([asked], feed, NOW), { mine: asked });

  // Past, called off and declined dinners never show; a declined one is skipped in the feed too.
  const pastHost = dinner({ dinnerId: 'old', startsAt: at(10, 23, 19), isHost: true });
  const offHost = dinner({ dinnerId: 'off', isHost: true, status: 'cancelled' });
  const saidNo = dinner({ dinnerId: 'f-soon', myRequest: { requestId: 'r', status: 'declined' } });
  assert.deepEqual(L.pickNextDinner([pastHost, offHost, saidNo], feed, NOW), { feed: feed[0] });
  // A dinner I'm in that's full still shows (it's mine).
  const fullIn = dinner({ dinnerId: 'full-in', status: 'full', seatsLeft: 0, myRequest: { requestId: 'r', status: 'accepted' } });
  assert.deepEqual(L.pickNextDinner([fullIn], [], NOW), { mine: fullIn });
});

test('host form: days and times', () => {
  assert.deepEqual(
    L.dayOptions(NOW).map((d) => d.label),
    ['Today', 'Tomorrow', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
  );
  assert.deepEqual(
    L.TIMES.map((t) => t.label),
    ['5 pm', '5:30 pm', '6 pm', '6:30 pm', '7 pm', '7:30 pm', '8 pm', '8:30 pm', '9 pm'],
  );
  assert.equal(L.startsAt(NOW, 0, 19, 0), at(10, 24, 19));
  assert.equal(L.startsAt(NOW, 9, 19, 30), at(11, 2, 19, 30)); // into November, past the DST change
  assert.equal(L.firstOpenDay(at(10, 24, 18), 19, 0), 0);
  assert.equal(L.firstOpenDay(at(10, 24, 19), 19, 0), 1);
  assert.equal(L.firstOpenDay(at(10, 24, 19, 30), 19, 0), 1);
});

test('error words', () => {
  assert.equal(L.errorText({ data: 'That dinner is full.' }), 'That dinner is full.');
  assert.equal(L.errorText(new Error('[CONVEX M(dinners:requestJoin)] Server Error')), 'Couldn’t do that. Try again.');
  assert.equal(L.errorText(null, 'Nope.'), 'Nope.');
  assert.equal(L.errorText({ data: { code: 1 } }), 'Couldn’t do that. Try again.');
});

test('report or block: the sheet’s words', () => {
  assert.equal(R.REPORT_LINK, 'Report or block');
  assert.equal(R.reportTitle('recipe'), 'Report this recipe');
  assert.equal(R.reportTitle('dinner'), 'Report this dinner');
  assert.deepEqual(R.REPORT_REASONS.map((r) => r.label), ['Not about food', 'Rude or hurtful', 'Something else']);
  assert.deepEqual(R.REPORT_REASONS.map((r) => r.key), ['not_food', 'rude', 'other']);
  assert.equal(R.blockLabel('The Pawar family'), 'Block the Pawar family');
  assert.equal(R.blockLabel("Mei's family"), "Block Mei's family");
  assert.equal(R.blockLabel(' '), 'Block this family');
  assert.equal(R.BLOCK_LINE, 'You won’t see each other in Community.');
  assert.equal(`${R.REPORTED.title} ${R.REPORTED.subtitle}`, 'Thanks. We’ll look at it within a day.');
  assert.equal(R.TEAM_EMAIL, 'team@homecookd.app');
  // Plain short copy: no em dashes anywhere in it.
  const all = [R.REPORT_LINK, R.BLOCK_LINE, R.REPORTED.title, R.REPORTED.subtitle, R.BLOCKED.title, ...R.REPORT_REASONS.map((r) => r.label)];
  assert.ok(all.every((s) => !s.includes('—')));
});

test('the cook’s share row reads in her words, with no homie (homie is off)', () => {
  const row = readFileSync(join(root, 'src/components/community/ShareNearbyRow.tsx'), 'utf8');
  assert.doesNotMatch(row.replace(/^\s*\/\/.*$/gm, ''), /homie|'Share with people nearby'|'Off the map'/);
  assert.match(row, /t\('share\.nearby\.whatNeighborsSee'\)/);
});

console.log(`\n${passed} passed`);

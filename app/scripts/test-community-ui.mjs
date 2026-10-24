// Unit tests for the Community screens' words and picks (src/components/community/labels.ts) and the
// map's geometry (src/components/community/mapLayout.ts):
//   time labels   "Dinner tonight · 7 pm", "Tonight · 7:00 pm · 6 seats", Tomorrow across a
//                 daylight-saving change, weekday names, dates past a week
//   seat text     "2 of 6 seats taken", "4 seats left", "1 seat left", "Full"
//   map card      "About 1 mi away", "Mama Ngozi · Nigerian", "Dinner Friday · 7 pm · 2 seats left"
//   circle labels "Jollof Rice by Mama Ngozi, under a mile away", "3 dishes in your building"
//   "You"         the sun dot (open requests to my dinners) and its label
//   map geometry  lat/lng -> x/y, one circle per grid cell, no overlaps, neighborhood names
//   host line     "Hosted by Shreya · the Pawar family"
//   privacy note  "Rajani’s video and voice stay in the family. …"
//   who's coming  the host's view (names) and a guest's ("You", "+2")
//   next dinner   hosting, then in, then asked, then the soonest open one; never past, called off
//                 or declined
//   host form     day chips, time chips, the moment they make, today or tomorrow
//   errors        a ConvexError's sentence, else the fallback
//   node scripts/test-community-ui.mjs
// The labels read the phone's clock, so the zone is pinned (New York has a DST change on Nov 1 2026).
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const L = await import(pathToFileURL(join(root, 'src/components/community/labels.ts')).href);
const G = await import(pathToFileURL(join(root, 'src/components/community/mapLayout.ts')).href);

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
  assert.equal(L.longClock(at(10, 24, 19)), '7:00 pm');
  assert.equal(L.longClock(at(10, 24, 9, 5)), '9:05 am');
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
  assert.equal(L.detailWhen(at(10, 24, 19), 6, NOW), 'Tonight · 7:00 pm · 6 seats');
  assert.equal(L.detailWhen(at(10, 25, 19), 1, NOW), 'Tomorrow · 7:00 pm · 1 seat');
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
  assert.equal(L.dinnerLine(at(10, 30, 19), 2, NOW), 'Dinner Friday · 7 pm · 2 seats left');
  assert.equal(L.dinnerLine(at(10, 24, 19, 30), 1, NOW), 'Dinner tonight · 7:30 pm · 1 seat left');
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
  for (const size of [311, 358, 420]) {
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

test('host line', () => {
  assert.equal(L.hostLine('Shreya', 'The Pawar family'), 'Hosted by Shreya · the Pawar family');
  assert.equal(L.hostLine('Shreya', 'Rajani’s family'), 'Hosted by Shreya · Rajani’s family');
  assert.equal(L.hostLine('Shreya', null), 'Hosted by Shreya');
  assert.equal(L.hostLine(' ', ''), 'Hosted by a neighbor');
});

test('the privacy note', () => {
  assert.equal(L.privacyNote('Rajani', true), 'Rajani’s video and voice stay in the family. You’ll see the story and the recipe text.');
  assert.equal(L.privacyNote('Lolo Rey', false), 'Lolo Rey’s video and voice stay in the family.');
  assert.equal(L.privacyNote('James', false), 'James’ video and voice stay in the family.');
  assert.equal(L.privacyNote('', false), 'The cook’s video and voice stay in the family.');
  assert.equal(L.privacyNote(null, true), 'The cook’s video and voice stay in the family. You’ll see the story and the recipe text.');
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
  startsAt: at(10, 24, 19),
  status: 'open',
  myRequest: null,
  requests: null,
  ...over,
});

test("who's coming", () => {
  const hosting = dinner({
    isHost: true,
    seatsLeft: 4,
    requests: [
      { requestId: 'r1', guestName: 'Serene', status: 'accepted' },
      { requestId: 'r2', guestName: 'Leo', status: 'pending' },
      { requestId: 'r3', guestName: 'Maya', status: 'declined' },
      { requestId: 'r4', guestName: 'Caleb', status: 'accepted' },
    ],
  });
  assert.deepEqual(L.whoComing(hosting), ['You · host', 'Serene', 'Caleb']);
  assert.deepEqual(L.whoComing(dinner({ seatsLeft: 3, myRequest: { requestId: 'r', status: 'accepted' } })), ['Shreya · host', 'You', '+2']);
  assert.deepEqual(L.whoComing(dinner({ seatsLeft: 5, myRequest: { requestId: 'r', status: 'accepted' } })), ['Shreya · host', 'You']);
  assert.deepEqual(L.whoComing(dinner({ seatsLeft: 4, myRequest: { requestId: 'r', status: 'pending' } })), ['Shreya · host', '+2']);
  assert.deepEqual(L.whoComing(dinner()), ['Shreya · host']);
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

console.log(`\n${passed} passed`);

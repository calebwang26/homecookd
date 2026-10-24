// Unit tests for the Community screens' words and picks (src/components/community/labels.ts):
//   time labels   "Dinner tonight · 7 pm", "Tonight · 7:00 pm · 6 seats", Tomorrow across a
//                 daylight-saving change, weekday names, dates past a week
//   seat text     "2 of 6 seats taken", "4 seats left", "1 seat left", "Full"
//   family line   "Okafor family · Under a mile"
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

test('family card line', () => {
  assert.equal(L.familyLine('The Okafor family', 'Under a mile'), 'Okafor family · Under a mile');
  assert.equal(L.familyLine('Rajani’s family', 'In your building'), 'Rajani’s family · In your building');
  assert.equal(L.familyLine('Theo’s family', 'About 3 mi'), 'Theo’s family · About 3 mi');
  assert.equal(L.familyLine('The Pawar family', ''), 'Pawar family');
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

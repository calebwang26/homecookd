// Unit tests for the weekly "film it" reminder's pure logic (src/lib/reminders.ts, Phase 5): the expo-notifications
// weekly trigger for each day and part of the day (expo counts Sunday as 1), the notification's words and the
// Record link it opens (URL-encoded, at most 300 characters so lib/push.ts pushUrl opens it), and the kv value.
//   node scripts/test-reminders.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerHooks({
  resolve(spec, ctx, next) {
    const base = spec.startsWith('@/') ? join(root, 'src', spec.slice(2)) : spec.startsWith('.') && ctx.parentURL ? join(dirname(fileURLToPath(ctx.parentURL)), spec) : null;
    if (base && !/\.[a-z]+$/.test(base) && existsSync(`${base}.ts`)) return next(pathToFileURL(`${base}.ts`).href, ctx);
    return next(spec, ctx);
  },
});

const R = await import(pathToFileURL(join(root, 'src/lib/reminders.ts')).href);
const { EN } = await import(pathToFileURL(join(root, 'src/lib/words/en/index.ts')).href);

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

/** lib/push.ts pushUrl's rule: an in-app path ('/', not '//'), no backslash, at most 300 characters. */
const pushOpens = (url) => typeof url === 'string' && url.length <= 300 && !url.includes('\\') && url.startsWith('/') && !url.startsWith('//');
const params = (url) => new URL(url, 'https://homecookd.app').searchParams;

test('the weekly trigger: day 0 (Sunday) is expo weekday 1 … Saturday is 7, at each part’s time', () => {
  const hours = { morning: 9, afternoon: 16, evening: 18 };
  for (let day = 0; day <= 6; day++) {
    for (const part of R.REMINDER_PARTS) {
      assert.deepEqual(R.weeklyTrigger(day, part), { type: 'weekly', weekday: day + 1, hour: hours[part], minute: 0 }, `${day} ${part}`);
    }
  }
  assert.equal(R.weeklyTrigger(0, 'morning').weekday, 1, 'Sunday is 1 in expo');
  assert.equal(R.weeklyTrigger(6, 'evening').weekday, 7, 'Saturday is 7');
  // 'weekly' is expo-notifications' SchedulableTriggerInputTypes.WEEKLY.
  assert.equal(R.weeklyTrigger(3, 'afternoon', 'default').channelId, 'default');
  for (const bad of [-1, 7, 1.5, NaN]) assert.throws(() => R.weeklyTrigger(bad, 'morning'), RangeError);
});

test('Morning, Afternoon and Evening are 9 am, 4 pm and 6 pm, marked as Caleb’s defaults', () => {
  assert.deepEqual(R.PART_TIME, { morning: { hour: 9, minute: 0 }, afternoon: { hour: 16, minute: 0 }, evening: { hour: 18, minute: 0 } });
  assert.match(readFileSync(join(root, 'src/lib/reminders.ts'), 'utf8'), /TODO\(caleb\): the defaults for Morning, Afternoon and Evening/);
  assert.deepEqual(R.REMINDER_PARTS, ['morning', 'afternoon', 'evening']);
});

test('the notification: "Making braised pork today?" / "Tap record for Caleb.", opening Record as her', () => {
  const c = R.reminderContent({ askId: 'k57abc', dish: 'braised pork', kidName: 'Caleb', profileId: 'p-mom' });
  assert.equal(c.title, 'Making braised pork today?');
  assert.equal(c.body, 'Tap record for Caleb.');
  assert.deepEqual(c.data, { url: '/record?dish=braised%20pork&from=Caleb&ask=k57abc', profile_id: 'p-mom' });
  assert.ok(pushOpens(c.data.url));
  // Spaces around a name or dish are dropped.
  assert.equal(R.reminderContent({ askId: 'a', dish: '  dal  ', kidName: ' Leo ', profileId: 'p' }).title, 'Making dal today?');
});

test('the Record link is URL-encoded and reads back exactly', () => {
  const cases = [
    { dish: 'mac & cheese', from: 'Leo', ask: 'a1' },
    { dish: 'Aaji’s “kanda poha” #2 / ?', from: 'Shreya P.', ask: 'k9z' },
    { dish: 'कांदा पोहे', from: 'श्रेया', ask: 'x' },
    { dish: 'back\\slash', from: 'a=b', ask: 'a&b' },
  ];
  for (const c of cases) {
    const url = R.recordUrl(c);
    assert.ok(url.startsWith('/record?dish='), url);
    assert.ok(pushOpens(url), url);
    assert.doesNotMatch(url, /\s|\\/, 'no space or backslash left in it');
    const p = params(url);
    assert.equal(p.get('dish'), c.dish);
    assert.equal(p.get('from'), c.from);
    assert.equal(p.get('ask'), c.ask);
    assert.deepEqual([...p.keys()], ['dish', 'from', 'ask'], 'no stray parameter from an & in a name');
  }
});

test('a very long dish (or name) is cut so pushUrl still opens it; the ask always survives', () => {
  const long = 'slow-cooked pork belly with eggs, rock sugar and dark soy, the way Nai Nai made it every winter '.repeat(5);
  const url = R.recordUrl({ dish: long, from: 'Caleb', ask: 'k57abc' });
  assert.ok(url.length <= R.MAX_URL && R.MAX_URL === 300, `${url.length}`);
  assert.ok(pushOpens(url));
  const p = params(url);
  assert.ok(p.get('dish').length > 50 && long.startsWith(p.get('dish')), p.get('dish'));
  assert.equal(p.get('from'), 'Caleb');
  assert.equal(p.get('ask'), 'k57abc');

  // Devanagari takes 9 characters a letter once encoded: cut by whole letters, never mid-letter.
  const hindi = 'मसालेदार '.repeat(40);
  const h = R.recordUrl({ dish: hindi, from: 'श्रेया', ask: 'k1' });
  assert.ok(h.length <= 300, `${h.length}`);
  assert.ok(hindi.startsWith(params(h).get('dish')));
  assert.equal(params(h).get('from'), 'श्रेया');

  // Even a name too long for the link: cut too, the ask kept.
  const both = R.recordUrl({ dish: 'x'.repeat(400), from: 'y'.repeat(400), ask: 'k1' });
  assert.ok(both.length <= 300 && params(both).get('ask') === 'k1', both);
  // The notification uses the same link.
  assert.ok(R.reminderContent({ askId: 'k57abc', dish: long, kidName: 'Caleb', profileId: 'p' }).data.url.length <= 300);
});

test('the words: "Remind me on Sundays", "Every Sunday at 4 pm", the day chips', () => {
  assert.equal(R.dayShort(0), 'Sun');
  assert.equal(R.dayShort(6), 'Sat');
  assert.equal(R.dayName(3), 'Wednesday');
  assert.equal(R.dayPlural(0), 'Sundays');
  assert.equal(EN['request.reminder.remindOn'].replace('{days}', R.dayPlural(0)), 'Remind me on Sundays');
  assert.equal(R.everyLine(0, 'afternoon'), 'Every Sunday at 4 pm');
  assert.equal(R.everyLine(5, 'morning'), 'Every Friday at 9 am');
  assert.equal(R.everyLine(6, 'evening'), 'Every Saturday at 6 pm');
  assert.deepEqual(R.REMINDER_PARTS.map((p) => R.partName(p)), ['Morning', 'Afternoon', 'Evening']);
});

test('one reminder per ask in kv reminder.<askId>, read back only when it is ours', () => {
  assert.equal(R.reminderKey('k57abc'), 'reminder.k57abc');
  const good = { notificationId: 'n-1', day: 0, part: 'afternoon' };
  assert.deepEqual(R.parseReminder(good), good);
  assert.deepEqual(R.parseReminder({ ...good, extra: 1 }), good);
  for (const bad of [null, undefined, 'n-1', {}, { ...good, notificationId: '' }, { ...good, day: 7 }, { ...good, day: '0' }, { ...good, part: 'night' }]) {
    assert.equal(R.parseReminder(bad), null, JSON.stringify(bad));
  }
});

console.log(`\n${passed} passed`);

// Offline checks for Month in the kitchen's pure slide builder (supabase/functions/api/recap.ts;
// handoff 3.7): an empty month, each kid & cook slide's presence and absence, honest counts (own
// dishes, other cooks' dishes & other months left out; samples counted, but never as her voice),
// questions answered from answersFor()'s first answers, rows with cook_id counted when the library is
// unreachable or no longer lists the dish, month boundaries in the recipient's time zone, memorial
// profiles, and the 1st-of-month push line. No database, no network, no clock.
//
// Run: npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/recap_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1.0.13";
import {
  computeRecap,
  isMonth,
  type Recap,
  type RecapAnswers,
  type RecapEvent,
  type RecapFavorite,
  type RecapInput,
  type RecapMessage,
  type RecapProfile,
  recapPush,
  type RecipeInfo,
  type Slide,
} from "../functions/api/recap.ts";

const LA = "America/Los_Angeles";
const NY = "America/New_York";
const MOM = "mom";
const DAD = "dad";
const GRAN = "gran"; // memorial
const LEO = "leo";
const MAYA = "maya";

const PROFILES: RecapProfile[] = [
  { id: MOM, name: "Mom", role: "cook" },
  { id: DAD, name: "Dad", role: "cook" },
  { id: GRAN, name: "Grandma", role: "cook", memorial: true },
  { id: LEO, name: "Leo", role: "learner" },
  { id: MAYA, name: "Maya", role: "learner" },
];

const RECIPES = new Map<string, RecipeInfo>([
  ["mom-dumplings", { title: "Dumplings", cook_name: "Mom", sample: false }],
  ["mom-soup", { title: "Winter Soup", cook_name: " mom ", sample: false }],
  ["dad-chili", { title: "Sunday Chili", cook_name: "Dad", sample: false }],
  ["dad-ribs", { title: "Ribs", cook_name: "Dad", sample: false }],
  ["dad-sample", { title: "Sample Stew", cook_name: "Dad", sample: true }],
  ["gran-buns", { title: "Steamed Buns", cook_name: "Grandma", sample: false }],
  ["leo-toast", { title: "Toast", cook_name: "Leo", sample: false }],
  ["gordon-eggs", { title: "Eggs", cook_name: "Gordon", sample: true }],
]);

const pad = (n: number) => String(n).padStart(2, "0");
/** Midday in LA on that October day. */
const oct = (d: number) => `2026-10-${pad(d)}T19:00:00Z`;
const SEPT = "2026-09-30T19:00:00Z";

const ev = (profile_id: string, recipe_id: string, kind: string, created_at: string, extra: Partial<RecapEvent> = {}): RecapEvent => ({
  profile_id, recipe_id, kind, created_at, cook_id: null, ...extra,
});
const heard = (profile_id: string, recipe_id: string, created_at: string, duration_s: number | string, clip_start_s: number | string | null, cook_id: string | null = null) =>
  ev(profile_id, recipe_id, "heard", created_at, { duration_s, clip_start_s, cook_id });
const card = (id: string, sender_id: string, recipe_id: string, created_at: string, photo: boolean, thread_with: string): RecapMessage => ({
  id, sender_id, kind: "cooked", recipe_id, photo_path: photo ? `fam/${id}.jpg` : null, thread_with, created_at,
});
const text = (id: string, sender_id: string, kind: string, created_at: string, thread_with: string | null = null): RecapMessage => ({
  id, sender_id, kind, created_at, thread_with,
});
const fav = (profile_id: string, recipe_id: string, created_at: string): RecapFavorite => ({ profile_id, recipe_id, created_at });

const recap = (over: Partial<RecapInput> = {}): Recap =>
  computeRecap({
    month: "2026-10", tz: LA, role: "learner", me: LEO, profiles: PROFILES,
    events: [], messages: [], favorites: [], recipes: RECIPES, answers: new Map(), ...over,
  });
const types = (r: Recap) => ("empty" in r ? [] : r.slides.map((s) => s.type));
const slide = <T extends Slide["type"]>(r: Recap, type: T) =>
  ("empty" in r ? undefined : r.slides.find((s) => s.type === type)) as Extract<Slide, { type: T }> | undefined;
const photoIds = (photos: { message_id: string }[] | undefined) => photos?.map((p) => p.message_id);

// --- a kid's month ----------------------------------------------------------------------------

const KID_EVENTS: RecapEvent[] = [
  ev(LEO, "dad-chili", "cooked", oct(3), { cook_id: DAD }),
  ev(LEO, "dad-chili", "cooked", oct(17), { cook_id: DAD }),
  ev(LEO, "mom-dumplings", "cooked", oct(20)), // cook from the library name
  ev(LEO, "dad-sample", "cooked", oct(21), { cook_id: DAD }), // a sample under Dad's name counts
  ev(LEO, "leo-toast", "cooked", oct(22)), // his own dish
  ev(LEO, "gordon-eggs", "cooked", oct(23)), // not family
  ev(LEO, "dad-chili", "cooked", SEPT, { cook_id: DAD }), // September
  ev(MAYA, "dad-chili", "cooked", oct(5), { cook_id: DAD }), // someone else
  ev(LEO, "mom-soup", "viewed", oct(6)),
  ev(LEO, "mom-dumplings", "started", oct(20)),
  heard(LEO, "mom-dumplings", oct(8), 900, 30, MOM),
  heard(LEO, "mom-dumplings", oct(9), "600", "30", MOM), // numeric columns may arrive as strings
  heard(LEO, "dad-chili", oct(10), 900, 12, DAD),
  heard(LEO, "dad-chili", oct(11), 2, 12, DAD), // under 3 s
  heard(LEO, "dad-sample", oct(13), 600, 0, DAD), // a sample's audio isn't Dad's voice
  heard(LEO, "gordon-eggs", oct(12), 500, 0), // not family
];
const KID_FAVS: RecapFavorite[] = [
  fav(LEO, "mom-dumplings", oct(5)),
  fav(LEO, "dad-chili", oct(6)),
  fav(LEO, "gordon-eggs", oct(7)), // not a family dish
  fav(LEO, "dad-sample", oct(7)), // counts
  fav(LEO, "leo-toast", oct(7)),
  fav(LEO, "mom-soup", "2026-09-20T19:00:00Z"),
  fav(MAYA, "mom-soup", oct(7)),
];
const KID_MESSAGES: RecapMessage[] = [
  card("p1", LEO, "dad-chili", oct(3), true, DAD),
  card("p2", LEO, "dad-chili", oct(17), true, DAD),
  card("c3", LEO, "mom-dumplings", oct(20), false, MOM),
  card("p4", LEO, "dad-sample", oct(21), true, DAD),
  card("p0", LEO, "dad-chili", SEPT, true, DAD),
  card("g0", LEO, "gordon-eggs", oct(23), true, DAD), // not a family dish
  card("m1", MAYA, "dad-chili", oct(5), true, DAD),
];

Deno.test("kid: a full month gives every slide, in order, with real numbers", () => {
  const r = recap({ events: KID_EVENTS, favorites: KID_FAVS, messages: KID_MESSAGES });
  assertEquals(r, {
    month: "2026-10",
    role: "learner",
    slides: [
      { type: "cover", title: "Your October in the kitchen" },
      {
        type: "cooked", title: "You cooked 4 family dishes", value: 4,
        photos: [
          { message_id: "p1", photo_path: "fam/p1.jpg", recipe_id: "dad-chili", at: oct(3) },
          { message_id: "p2", photo_path: "fam/p2.jpg", recipe_id: "dad-chili", at: oct(17) },
          { message_id: "p4", photo_path: "fam/p4.jpg", recipe_id: "dad-sample", at: oct(21) },
        ],
      },
      { type: "most_made", title: "Most made: Dad's Sunday Chili, twice", value: 2, recipe_id: "dad-chili", cook_id: DAD },
      {
        type: "voices", title: "40 minutes of family voices", value: 40, seconds: 2400,
        clip: { recipe_id: "mom-dumplings", cook_id: MOM, start_s: 30, plays: 2 },
      },
      { type: "hearts_left", title: "Hearts you left: 3", value: 3 },
      {
        type: "then_now", title: "Then & now",
        photos: [
          { message_id: "p1", photo_path: "fam/p1.jpg", recipe_id: "dad-chili", at: oct(3) },
          { message_id: "p4", photo_path: "fam/p4.jpg", recipe_id: "dad-sample", at: oct(21) },
        ],
      },
      { type: "close", title: "See you at the table in November." },
    ],
  });
  assertEquals(recapPush(r), { title: "Your October in the kitchen", body: "4 dishes & 40 minutes of family voices." });
});

Deno.test("empty month: nothing at all, other months only, or nothing that counts -> {empty: true}, no push", () => {
  assertEquals(recap(), { empty: true });
  assertEquals(recapPush(recap()), null);
  assertEquals(recap({ month: "2026-08", events: KID_EVENTS, favorites: KID_FAVS, messages: KID_MESSAGES }), { empty: true });
  const noneCount = [
    heard(LEO, "dad-sample", oct(3), 300, 0, DAD), // a sample's audio isn't her voice
    ev(LEO, "leo-toast", "cooked", oct(3)),
    ev(LEO, "gordon-eggs", "cooked", oct(3)),
    ev(LEO, "unknown-dish", "cooked", oct(3)), // not in the library & no cook_id: nobody's dish
    ev(LEO, "mom-soup", "viewed", oct(3)),
    ev(LEO, "mom-soup", "started", oct(3)),
    heard(LEO, "mom-soup", oct(3), 59, 0, MOM), // under a minute
  ];
  assertEquals(recap({ events: noneCount, favorites: [fav(LEO, "gordon-eggs", oct(3))] }), { empty: true });
});

Deno.test("kid: one dish once -> cooked only (singular), no most made, no then & now", () => {
  const r = recap({
    events: [ev(LEO, "mom-soup", "cooked", oct(4))],
    messages: [card("p1", LEO, "mom-soup", oct(4), true, MOM)],
  });
  assertEquals(types(r), ["cover", "cooked", "close"]);
  assertEquals(slide(r, "cooked")?.title, "You cooked 1 family dish");
  assertEquals(photoIds(slide(r, "cooked")?.photos), ["p1"]);
  assertEquals(recapPush(r)?.body, "1 dish.");
});

Deno.test("kid: most made says '3 times'; then & now is the first postcard beside the latest", () => {
  const r = recap({
    events: [4, 11, 18].map((d) => ev(LEO, "dad-chili", "cooked", oct(d), { cook_id: DAD })),
    messages: [
      card("late", LEO, "dad-chili", oct(18), true, DAD),
      card("first", LEO, "dad-chili", oct(4), true, DAD),
      card("mid", LEO, "dad-chili", oct(11), true, DAD),
    ],
  });
  assertEquals(slide(r, "most_made")?.title, "Most made: Dad's Sunday Chili, 3 times");
  assertEquals(photoIds(slide(r, "cooked")?.photos), ["first", "mid", "late"]);
  assertEquals(photoIds(slide(r, "then_now")?.photos), ["first", "late"]);
});

Deno.test("kid: most made ties go to the dish made most recently", () => {
  const r = recap({
    events: [
      ev(LEO, "dad-chili", "cooked", oct(2), { cook_id: DAD }),
      ev(LEO, "dad-chili", "cooked", oct(9), { cook_id: DAD }),
      ev(LEO, "mom-soup", "cooked", oct(3)),
      ev(LEO, "mom-soup", "cooked", oct(12)),
    ],
  });
  assertEquals(slide(r, "most_made")?.recipe_id, "mom-soup");
  assertEquals(slide(r, "most_made")?.title, "Most made: Mom's Winter Soup, twice");
});

Deno.test("kid: minutes of family voices need a full minute and round down", () => {
  const voices = (secs: number[]) => recap({ events: secs.map((s, i) => heard(LEO, "mom-soup", oct(i + 1), s, 10 * i, MOM)) });
  assertEquals(types(voices([59])), []);
  assertEquals(slide(voices([30, 30]), "voices")?.title, "1 minute of family voices");
  assertEquals(slide(voices([119]), "voices")?.value, 1);
  assertEquals(slide(voices([60, 60, 59]), "voices")?.value, 2);
  assertEquals(recapPush(voices([60]))?.body, "1 minute of family voices.");
});

Deno.test("kid: the most-played clip is by plays, then time listened", () => {
  const r = recap({
    events: [
      heard(LEO, "mom-soup", oct(1), 50, 0, MOM),
      heard(LEO, "mom-soup", oct(2), 50, 0, MOM),
      heard(LEO, "dad-chili", oct(3), 600, 40, DAD),
      heard(LEO, "dad-chili", oct(4), 5, null, DAD), // a clip with no start
    ],
  });
  assertEquals(slide(r, "voices")?.clip, { recipe_id: "mom-soup", cook_id: MOM, start_s: 0, plays: 2 });
  const tie = recap({ events: [heard(LEO, "mom-soup", oct(1), 70, 0, MOM), heard(LEO, "dad-chili", oct(2), 90, null, DAD)] });
  assertEquals(slide(tie, "voices")?.clip, { recipe_id: "dad-chili", cook_id: DAD, start_s: null, plays: 1 });
});

Deno.test("kid: hearts alone make a recap; only hearts on family dishes this month count", () => {
  const r = recap({ favorites: KID_FAVS });
  assertEquals(types(r), ["cover", "hearts_left", "close"]);
  assertEquals(slide(r, "hearts_left")?.value, 3);
  // The slide's own words, never "1 heart left." (that reads like a countdown).
  assertEquals(recapPush(r)?.body, "Hearts you left: 3.");
  assertEquals(recapPush(recap({ favorites: [fav(LEO, "mom-soup", oct(2))] }))?.body, "Hearts you left: 1.");
});

Deno.test("kid: a memorial cook's dish still counts (it's the kid's month, and names her dish)", () => {
  const r = recap({ events: [ev(LEO, "gran-buns", "cooked", oct(2)), ev(LEO, "gran-buns", "cooked", oct(9))] });
  assertEquals(slide(r, "most_made")?.title, "Most made: Grandma's Steamed Buns, twice");
});

// --- a cook's month ---------------------------------------------------------------------------

const COOK_EVENTS: RecapEvent[] = [
  ev(LEO, "dad-chili", "cooked", oct(3), { cook_id: DAD }),
  ev(LEO, "dad-chili", "cooked", oct(17), { cook_id: DAD }),
  ev(MAYA, "dad-chili", "cooked", oct(12)), // cook from the library name
  ev(MOM, "dad-ribs", "cooked", oct(25), { cook_id: DAD }),
  ev(DAD, "dad-chili", "cooked", oct(14), { cook_id: DAD }), // himself
  ev(GRAN, "dad-chili", "cooked", oct(2), { cook_id: DAD }), // memorial: never shown acting
  ev(LEO, "dad-sample", "cooked", oct(15), { cook_id: DAD }), // a sample of his counts
  ev(LEO, "mom-dumplings", "cooked", oct(20)), // Mom's dish
  ev(LEO, "dad-chili", "cooked", SEPT, { cook_id: DAD }),
  ev("sam", "dad-chili", "cooked", oct(4), { cook_id: DAD }), // not in the family anymore
  ev(LEO, "dad-ribs", "viewed", oct(4)),
];
const COOK_FAVS: RecapFavorite[] = [
  fav(LEO, "dad-chili", oct(5)),
  fav(MAYA, "dad-chili", oct(6)),
  fav(LEO, "dad-ribs", oct(7)),
  fav(DAD, "dad-chili", oct(8)),
  fav(GRAN, "dad-ribs", oct(8)),
  fav(MAYA, "dad-sample", oct(8)), // counts (1 heart, not the most)
  fav(LEO, "mom-dumplings", oct(8)),
  fav(MAYA, "dad-ribs", "2026-09-12T19:00:00Z"),
];
const COOK_MESSAGES: RecapMessage[] = [
  card("p1", LEO, "dad-chili", oct(3), true, DAD),
  card("m1", MAYA, "dad-chili", oct(12), true, DAD),
  card("x1", LEO, "mom-dumplings", oct(20), true, MOM),
  card("g1", GRAN, "dad-chili", oct(2), true, DAD),
  card("s1", LEO, "dad-sample", oct(15), true, DAD), // a sample of his counts
  card("n1", MOM, "dad-ribs", oct(25), false, DAD),
  card("o1", LEO, "dad-chili", SEPT, true, DAD),
];
/** answersFor()'s Map for the questions October's messages reply to: question id -> first valid answer. */
const COOK_ANSWERS: RecapAnswers = new Map([
  ["q1", { by: DAD, at: oct(2) }], // a September question, first answered in October
  ["q2", { by: DAD, at: oct(11) }], // Maya's 1:1 step question (it had words)
  ["q6", { by: DAD, at: SEPT }], // answered in September; his October reply isn't an answer
  ["q7", { by: MOM, at: oct(14) }], // a circle question Mom answered first, though Dad replied later
  ["q8", { by: DAD, at: "2026-11-01T08:30:00Z" }], // Nov 1 01:30 PDT: November
]);
const cookRecap = (me: string, over: Partial<RecapInput> = {}) =>
  recap({ role: "cook", me, events: COOK_EVENTS, favorites: COOK_FAVS, messages: COOK_MESSAGES, answers: COOK_ANSWERS, ...over });

Deno.test("cook: a full month gives every slide, in order, about her dishes only", () => {
  const r = cookRecap(DAD);
  assertEquals(r, {
    month: "2026-10",
    role: "cook",
    slides: [
      { type: "cover", title: "Your October in the kitchen" },
      {
        // Mom making his ribs counts, but the faces are the kids' only: Leo first cooked his on Oct 3,
        // Maya on Oct 12. Who, never how often (no count per kid).
        type: "dishes_cooked", title: "Your dishes were cooked 5 times", value: 5,
        faces: [{ profile_id: LEO }, { profile_id: MAYA }],
      },
      { type: "most_loved", title: "Most loved: Sunday Chili (♥ 2)", value: 2, recipe_id: "dad-chili" },
      {
        type: "postcards", title: "Postcards you got: 3", value: 3,
        photos: [
          { message_id: "p1", photo_path: "fam/p1.jpg", recipe_id: "dad-chili", at: oct(3) },
          { message_id: "m1", photo_path: "fam/m1.jpg", recipe_id: "dad-chili", at: oct(12) },
          { message_id: "s1", photo_path: "fam/s1.jpg", recipe_id: "dad-sample", at: oct(15) },
        ],
      },
      { type: "answered", title: "Questions you answered: 2", value: 2 },
      { type: "close", title: "See you at the table in November." },
    ],
  });
  assertEquals(recapPush(r), { title: "Your October in the kitchen", body: "Your dishes were cooked 5 times." });
});

Deno.test("cook: Mom never sees Dad's numbers", () => {
  const r = cookRecap(MOM);
  assertEquals(types(r), ["cover", "dishes_cooked", "most_loved", "postcards", "answered", "close"]);
  assertEquals(slide(r, "dishes_cooked")?.title, "Your dishes were cooked once");
  assertEquals(slide(r, "dishes_cooked")?.faces, [{ profile_id: LEO }]);
  assertEquals(slide(r, "most_loved")?.recipe_id, "mom-dumplings");
  assertEquals(photoIds(slide(r, "postcards")?.photos), ["x1"]);
  assertEquals(slide(r, "answered")?.value, 1);
});

Deno.test("cook: each slide only when it has data", () => {
  assertEquals(recap({ role: "cook", me: DAD }), { empty: true });
  const onlyAnswers = recap({ role: "cook", me: DAD, answers: new Map([["q", { by: DAD, at: oct(2) }]]) });
  assertEquals(types(onlyAnswers), ["cover", "answered", "close"]);
  assertEquals(recapPush(onlyAnswers)?.body, "Questions you answered: 1.");
  const onlyHearts = recap({ role: "cook", me: DAD, favorites: [fav(LEO, "dad-ribs", oct(1))] });
  assertEquals(types(onlyHearts), ["cover", "most_loved", "close"]);
  assertEquals(slide(onlyHearts, "most_loved")?.title, "Most loved: Ribs (♥ 1)");
  const onlyPostcard = recap({ role: "cook", me: DAD, messages: [card("p", LEO, "dad-chili", oct(1), true, DAD)] });
  assertEquals(types(onlyPostcard), ["cover", "postcards", "close"]);
  assertEquals(recapPush(onlyPostcard)?.body, "Postcards you got: 1.");
});

Deno.test("cook: dishes cooked counts everyone else at the table; the faces are the kids' only", () => {
  const byMom = recap({ role: "cook", me: DAD, events: [ev(MOM, "dad-ribs", "cooked", oct(25), { cook_id: DAD })] });
  assertEquals(slide(byMom, "dishes_cooked"), { type: "dishes_cooked", title: "Your dishes were cooked once", value: 1, faces: [] });
  // A removed member's cooking is left out on purpose, from the faces and the count.
  const removed = PROFILES.map((p) => (p.id === MAYA ? { ...p, removed_at: "2026-10-20T00:00:00Z" } : p));
  const events = [ev(LEO, "dad-chili", "cooked", oct(3), { cook_id: DAD }), ev(MAYA, "dad-chili", "cooked", oct(4), { cook_id: DAD })];
  const r = recap({ role: "cook", me: DAD, profiles: removed, events });
  assertEquals(slide(r, "dishes_cooked")?.value, 1);
  assertEquals(slide(r, "dishes_cooked")?.faces, [{ profile_id: LEO }]);
});

Deno.test("cook: the kids' faces never rank them: first cook of the month first, each once, no counts", () => {
  // Maya cooked one of Dad's dishes first, once; Leo three times after her. The faces follow who came
  // first, not who cooked most, and carry no count that a screen could sort or print.
  const events = [
    ev(LEO, "dad-chili", "cooked", oct(20), { cook_id: DAD }),
    ev(MAYA, "dad-ribs", "cooked", oct(4), { cook_id: DAD }),
    ev(LEO, "dad-chili", "cooked", oct(9), { cook_id: DAD }),
    ev(LEO, "dad-ribs", "cooked", oct(28), { cook_id: DAD }),
  ];
  const faces = slide(recap({ role: "cook", me: DAD, events }), "dishes_cooked")?.faces;
  assertEquals(faces, [{ profile_id: MAYA }, { profile_id: LEO }]);
  assert(faces!.every((f) => Object.keys(f).join() === "profile_id"), "no count per kid");
  // The same rows in any order give the same faces.
  assertEquals(slide(recap({ role: "cook", me: DAD, events: [...events].reverse() }), "dishes_cooked")?.faces, faces);
});

Deno.test("a sample dish under a family cook's name counts (table.ts's rule too), but never as her voice", () => {
  // Every family dish in the test library is a sample today: the kid & the cook still get their month.
  const events = [
    ev(LEO, "dad-sample", "cooked", oct(3), { cook_id: DAD }),
    ev(LEO, "dad-sample", "cooked", oct(10), { cook_id: DAD }),
    heard(LEO, "dad-sample", oct(11), 300, 0, DAD),
  ];
  const favorites = [fav(LEO, "dad-sample", oct(4))];
  const messages = [card("s1", LEO, "dad-sample", oct(3), true, DAD), card("s2", LEO, "dad-sample", oct(10), true, DAD)];
  const kid = recap({ events, favorites, messages });
  assertEquals(types(kid), ["cover", "cooked", "most_made", "hearts_left", "then_now", "close"], "no voices slide");
  assertEquals(slide(kid, "most_made")?.title, "Most made: Dad's Sample Stew, twice");
  assertEquals(recapPush(kid)?.body, "2 dishes.");
  const dad = recap({ role: "cook", me: DAD, events, favorites, messages });
  assertEquals(types(dad), ["cover", "dishes_cooked", "most_loved", "postcards", "close"]);
  assertEquals(slide(dad, "dishes_cooked")?.faces, [{ profile_id: LEO }]);
  // The same listening on Dad's real chili is his voice.
  const real = events.map((e) => ({ ...e, recipe_id: "dad-chili" }));
  assertEquals(slide(recap({ events: real }), "voices")?.value, 5);
});

Deno.test("cook: questions answered are answersFor()'s first answers that are hers, given this month", () => {
  const answered = (answers: RecapAnswers, over: Partial<RecapInput> = {}) =>
    slide(recap({ role: "cook", me: DAD, answers, ...over }), "answered")?.value;
  assertEquals(answered(COOK_ANSWERS), 2, "q1 & q2; not September's q6, Mom's q7 or November's q8");
  // A circle question another cook answered first isn't Dad's, though he replied after her.
  assertEquals(answered(new Map([["q", { by: MOM, at: oct(3) }]])), undefined);
  // Replies alone never count: a step shared without words isn't a question, so answersFor leaves it out
  // of the Map, and Dad's reply to it (reply_to and all) makes no slide.
  const step = text("st", MAYA, "step", oct(10), DAD);
  const reply = { ...text("re", DAD, "voice", oct(11), MAYA), reply_to: "st" } as RecapMessage;
  assertEquals(recap({ role: "cook", me: DAD, messages: [step, reply] }), { empty: true });
  // The month is the recipient's: Oct 31 23:30 PDT is November in New York. A bad timestamp counts nothing.
  const late = new Map([["q", { by: DAD, at: "2026-11-01T06:30:00Z" }]]);
  assertEquals(answered(late, { tz: LA }), 1);
  assertEquals(answered(late, { tz: NY }), undefined);
  assertEquals(answered(late, { tz: NY, month: "2026-11" }), 1);
  assertEquals(answered(new Map([["q", { by: DAD, at: "not a date" }]])), undefined);
  // A kid's recap never reads it.
  assertEquals(recap({ answers: new Map([["q", { by: LEO, at: oct(2) }]]) }), { empty: true });
});

Deno.test("cook: most loved ties go to the dish hearted most recently", () => {
  const r = recap({ role: "cook", me: DAD, favorites: [fav(LEO, "dad-chili", oct(9)), fav(MAYA, "dad-ribs", oct(3))] });
  assertEquals(slide(r, "most_loved")?.recipe_id, "dad-chili");
});

// --- the library ------------------------------------------------------------------------------

Deno.test("library unreachable (libraryIndex's empty Map): rows with cook_id still count, the rest waits", () => {
  const none = new Map<string, RecipeInfo>();
  const events = [
    ev(LEO, "dad-chili", "cooked", oct(3), { cook_id: DAD }),
    ev(LEO, "dad-chili", "cooked", oct(10), { cook_id: DAD }),
    ev(LEO, "dad-ribs", "cooked", oct(17), { cook_id: DAD }),
    ev(LEO, "mom-soup", "cooked", oct(18)), // no cook_id: only the library's cook_name says whose
    heard(LEO, "dad-chili", oct(11), 600, 0, DAD), // can't be checked for a sample: not counted as his voice
  ];
  const favorites = [fav(LEO, "dad-chili", oct(4))]; // favorites carry no cook_id
  const messages = [card("p1", LEO, "dad-chili", oct(3), true, DAD), card("p2", LEO, "dad-chili", oct(10), true, DAD)];

  const kid = recap({ recipes: none, events, favorites, messages });
  assertEquals(types(kid), ["cover", "cooked", "close"], "no most made without a title; no voices, hearts or postcards");
  assertEquals(slide(kid, "cooked"), { type: "cooked", title: "You cooked 3 family dishes", value: 3, photos: [] });
  assertEquals(recapPush(kid)?.body, "3 dishes.");
  const dad = recap({ role: "cook", me: DAD, recipes: none, events, favorites, messages });
  assertEquals(types(dad), ["cover", "dishes_cooked", "close"]);
  assertEquals(slide(dad, "dishes_cooked")?.faces, [{ profile_id: LEO }]);
  assertEquals(recapPush(dad)?.body, "Your dishes were cooked 3 times.");

  // The same rows once the library is back: the whole month.
  const full = recap({ events, favorites, messages });
  assertEquals(types(full), ["cover", "cooked", "most_made", "voices", "hearts_left", "then_now", "close"]);
  assertEquals(slide(full, "cooked")?.value, 4);
  assertEquals(types(recap({ role: "cook", me: DAD, events, favorites, messages })), [
    "cover", "dishes_cooked", "most_loved", "postcards", "close",
  ]);
});

Deno.test("a dish since dropped from the library counts when its row names a family cook; no most made", () => {
  const events = [
    ev(LEO, "dad-retired", "cooked", oct(3), { cook_id: DAD }),
    ev(LEO, "dad-retired", "cooked", oct(10), { cook_id: DAD }),
    ev(LEO, "dad-chili", "cooked", oct(12), { cook_id: DAD }),
    ev(LEO, "dad-retired", "cooked", oct(13), { cook_id: MAYA }), // a learner isn't a cook
    ev(LEO, "dad-retired", "cooked", oct(14), { cook_id: "sam" }), // not in the family
    ev(LEO, "dad-retired", "cooked", oct(15), { cook_id: GRAN }), // a memorial cook's dish still counts
    heard(LEO, "dad-retired", oct(16), 600, 0, DAD), // can't be checked for a sample: not his voice
  ];
  const r = recap({ events });
  assertEquals(types(r), ["cover", "cooked", "close"], "dad-retired was made most, but has no title to name");
  assertEquals(slide(r, "cooked")?.value, 4);
  assertEquals(slide(recap({ role: "cook", me: DAD, events }), "dishes_cooked")?.value, 3);
  // cook_id is the row's own record, so it wins over the library's cook_name.
  assertEquals(slide(recap({ role: "cook", me: DAD, events: [ev(LEO, "mom-soup", "cooked", oct(3), { cook_id: DAD })] }), "dishes_cooked")?.value, 1);
});

Deno.test("push: a kid's month without dishes or minutes uses the slide's own words", () => {
  const postcards = [card("p1", LEO, "dad-chili", oct(3), true, DAD), card("p2", LEO, "dad-chili", oct(10), true, DAD)];
  const onlyPostcards = recap({ messages: postcards }); // the cooked events never arrived
  assertEquals(types(onlyPostcards), ["cover", "then_now", "close"]);
  assertEquals(recapPush(onlyPostcards)?.body, "Your first postcard beside your latest.");
  const heartsToo = recap({ messages: postcards, favorites: [fav(LEO, "dad-chili", oct(4))] });
  assertEquals(recapPush(heartsToo)?.body, "Hearts you left: 1.");
});

// --- month boundaries, memorial, inputs -------------------------------------------------------

Deno.test("month boundaries are the recipient's: Oct 31 23:30 PDT is November in New York", () => {
  const lateOct = [ev(LEO, "dad-chili", "cooked", "2026-11-01T06:30:00Z", { cook_id: DAD })]; // Nov 1 02:30 EDT
  assertEquals(slide(recap({ events: lateOct, tz: LA }), "cooked")?.value, 1);
  assertEquals(recap({ events: lateOct, tz: NY }), { empty: true });
  assertEquals(slide(recap({ events: lateOct, tz: NY, month: "2026-11" }), "cooked")?.value, 1);
  const earlyOct = [ev(LEO, "dad-chili", "cooked", "2026-10-01T05:00:00Z", { cook_id: DAD })]; // Sep 30 22:00 PDT
  assertEquals(recap({ events: earlyOct, tz: LA }), { empty: true });
  assertEquals(slide(recap({ events: earlyOct, tz: NY }), "cooked")?.value, 1);
  assertEquals(slide(recap({ events: lateOct, tz: "Not/AZone" }), "cooked")?.value, 1, "a bad zone falls back to LA");
});

Deno.test("December closes on January", () => {
  const r = recap({ month: "2026-12", events: [ev(LEO, "dad-chili", "cooked", "2026-12-24T19:00:00Z", { cook_id: DAD })] });
  assertEquals(types(r), ["cover", "cooked", "close"]);
  assert(!("empty" in r));
  assertEquals(r.slides[0].title, "Your December in the kitchen");
  assertEquals(r.slides[2].title, "See you at the table in January.");
});

Deno.test("memorial, removed or unknown recipient: no recap at all", () => {
  assertEquals(cookRecap(GRAN, { events: [...COOK_EVENTS, ev(LEO, "gran-buns", "cooked", oct(3))] }), { empty: true });
  const removed = PROFILES.map((p) => (p.id === LEO ? { ...p, removed_at: "2026-10-20T00:00:00Z" } : p));
  assertEquals(recap({ profiles: removed, events: KID_EVENTS }), { empty: true });
  assertEquals(recap({ me: "nobody", events: KID_EVENTS }), { empty: true });
});

Deno.test("month must be YYYY-MM; a malformed one is empty, never a throw (the route answers 400 first)", () => {
  assert(isMonth("2026-10"));
  for (const bad of ["2026-13", "2026-1", "26-10", "2026-10-01", "", null]) assert(!isMonth(bad), String(bad));
  for (const bad of ["2026-13", "2026-00", "Oct", "", "2026-10' or 1=1"]) {
    assertEquals(recap({ month: bad, events: KID_EVENTS, favorites: KID_FAVS, messages: KID_MESSAGES }), { empty: true }, bad);
  }
});

Deno.test("only the handoff's slides (no cookbook offer yet), no guilt words", () => {
  const kid = recap({ events: KID_EVENTS, favorites: KID_FAVS, messages: KID_MESSAGES });
  const cook = cookRecap(DAD);
  assertEquals(
    new Set(types(kid)),
    new Set(["cover", "cooked", "most_made", "voices", "hearts_left", "then_now", "close"]),
  );
  assertEquals(new Set(types(cook)), new Set(["cover", "dishes_cooked", "most_loved", "postcards", "answered", "close"]));
  for (const r of [kid, cook]) {
    assert(!("empty" in r));
    for (const s of r.slides) assert(!/\b(lost|expired|broken|missed|cookbook)\b/i.test(s.title), s.title);
    assert(!/\b(lost|expired|broken|missed)\b/i.test(recapPush(r)!.body));
    assert(!/\bhearts? left\b/i.test(recapPush(r)!.body), "no countdown-like '1 heart left'");
  }
});

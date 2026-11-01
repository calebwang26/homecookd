# Live updates on the new api

Oct 31, 2026. A draft for review. Nothing live points at this: the route exists only on `aws-migration`, and no app calls it.

**The answer: plain polling with a cheap "anything new?" check.** A phone calls `GET /v1/live/<topic>?since=<version>` and gets back
either "nothing new" or the current state, plus when to ask next. There's no open connection, no new table, no new dependency and
no migration. Built for job progress: `api/src/modules/live/`, `api/src/modules/jobs/`, tests in `api/test/live.test.ts`.

## What the app subscribes to today

One helper, `useLive` (`app/src/lib/live/convex.ts:208`, the `onUpdate` at `:238`), opens all 20. It stays subscribed while its
component is mounted, in or out of focus. "Home" means always on for that role: a cook has 6 plus `people:me`, and a kid has 1.

| Subscription | Reads | Mounted | Changes when | How fresh it must be | Plan |
|---|---|---|---|---|---|
| `jobs:forFamily` | jobs, newest 20 | cook Home, Recipes | each stage, 2 s apart at the very most | 5-10 s while watching a bar | **Built.** 5 s while a job moves, else 30 s |
| `questions:forRecipe` | questions on a recipe, up to 100 | kid cook mode | an answer arrives | 5-10 s, she's mid-step | 10 s on that screen |
| `questions:openForCook` | her open questions, up to 100 | cook Home | a kid asks | 30 s | 30 s |
| `live:recording` | one recording | recording screen | start, end, 30 s windows | 2 s: drives filming and "ended" | 2 s on that screen |
| `liveEvents:forRecording` | events, up to 2,000 | glasses recording | one write per 30 s | 10-30 s | 10 s, with a cursor |
| `liveEvents:frame` | newest frame | glasses recording | about 7 a second | Under 5 s, or it says "Glasses paused" | Open question 4 |
| `dishAsks:get` | one card | dish screen | merges, her answer | 30 s | 15 s on that screen |
| `dinners:get` | one dinner, its requests | dinner screen, card | join, respond | 30 s | 30 s on that screen |
| `recipes:list` | recipes, up to 100, whole | both Homes, about 13 places | job finishes, edits | focus, plus when a job finishes | focus, 60 s, needs a lean check (below) |
| `cravings:forCook` | her asks, up to 50 | cook Home | a kid asks | 60 s | focus, 60 s |
| `messages:madeMyDish` | 14 days, up to 200 | cook Home | a kid's photo | 60 s | focus, 60 s |
| `glasses:videos` | recordings, returns 10 | cook Home | any recording write | 60 s | focus, 60 s |
| `community:feed`, `dinners:mine`, `community:mySwaps`, `shareRequests:familyDishes` | up to 300 rows across families; 50-100 for the rest | Community tab, hidden today | shares, joins | 60 s | focus, 60 s |
| `community:recipe`, `community:blocked`, `people:me` | one row or own list | their screens; `me` on every cook screen | rare, or her own action | focus | focus only |
| `homie:news` | three lists, returns 3 facts | off (`HOMIE_ON = false`) | often | 60 s | focus, 60 s, if homie returns |

Chat isn't a subscription. It already polls Supabase: 3 s in an open thread with an `after` cursor, 8 s for the inbox, 15 s for the
unread badge (`app/src/lib/messaging.ts`, `session.tsx`). The app has about a dozen polling loops today, and `usePolling`
(`messaging.ts:98`) already stops in the background.

## Why polling

| | Polling (chosen) | Server-sent events | WebSocket |
|---|---|---|---|
| Delivery | Within one interval: 5 s | About 1 s | About 1 s |
| Fan-out across tasks | None needed: any task reads Postgres | LISTEN/NOTIFY with a connection per task outside the pool, triggers so the worker's writes count, or a poll per task | The same |
| "The api keeps no state in memory" | Holds | Broken: tasks hold streams, timers | Broken |
| Session ended mid-way | Next poll refused | Needs a timer per stream | Needs a timer per socket |
| Missed while away | Impossible: the next poll is the state | Needs a re-read on reconnect, which is a poll | The same |
| Deploy | One failed poll, retried | Every stream dropped, all reconnect | The same |
| Phone on bad network | One request with a timeout | Heartbeats to spot a dead connection | Heartbeats, and a token in the first message |
| React Native | `fetch` | No `EventSource`; `expo/fetch` streams, which nothing here has tried | Built in |
| Requests at 10x | 25-250 polls/s, 50-500 queries/s | No polls; about 17 queries/s rechecking 500 sessions every 30 s, plus reads on change | The same |
| New code | A route and a client loop | All of the above, and the catch-up poll | All of the above, and a library |

Streaming wins on one thing: fewer requests at 10x. It costs more moving parts for data that SYSTEM-DESIGN.md says "may be slightly
old", when "a delay is harmless". Any stream still needs a re-read on reconnect, so it's polling plus more.

**What polling gives up:** a poll costs a session check and a read even when nothing changed, and the request count grows with
every phone on screen. Hence the numbers below, and the point at which to look again: when polls pass a third of api CPU at the real
peak, first merge the slow topics into one request (open question 3), and only then consider push. `version` and `since` wouldn't
change for that.

**The check is the read.** The route reads the list (a page of small columns, by index), hashes it, and compares with `since`. A
`max(updated_at)` check would save a little, but `updated_at` has no trigger and depends on every writer remembering it, and it
misses a deleted row. The hash can't miss a change. Reads too heavy for this, like `recipes:list` with whole recipes, need their own
version query first: see "How later areas plug in".

**A 200 with `changed: false`, not a 304.** iOS's URL loading has its own cache and handling of conditional requests, and I can't
test that here. A plain 200 can't be swallowed. It's also how the server sends `pollAfterMs` on every answer.

## The contract

```
GET /v1/live/jobs?since=<version>      Authorization: Bearer <session token>

200 {"changed":false,"version":"…","pollAfterMs":29120}
200 {"changed":true,"version":"…","pollAfterMs":5230,"data":[LiveJob, …]}     no-store; data is the app's LiveJob, newest 20
401 signed_out         stop polling
410 live_off           this topic went back to Convex
429 rate_limited       Retry-After
503 unavailable        Retry-After: 5-15 s, spread; keep what's on screen
```

- **Who's asking:** every poll runs the same `requireSession` as every other route. The family comes only from the session; there's
  no family or job id to ask for. Any member sees the family's jobs, as `jobs.forFamily` does today (the "cook only" is in the app).
- **A session ended or a person deleted:** nothing is served from that moment. The phone's next poll, at most 5.5 s later while a
  job moves or 33 s when idle, gets a 401 and stops. A request already past its session check when it happens can still finish.
  Moving to another family counts too. While sessions still live on Convex, add the sync's delay: open question 1.
- **Rate limits (`service.ts`, in each task's memory):** 120 polls a minute per person, all topics together, and 30 refused
  calls a minute per address, after which that address stops reaching Postgres for the rest of the minute. There's no connection, so
  the per-person cap is on polls. Only refusals count against an address, so a carrier's shared address can't slow families
  down. N tasks allow N times these. `hit()` would be exact, but it'd add a write to every poll, and a brake that needs the
  database is no use when the database is the problem. This is my one exception to "no state in memory": losing it is harmless.
- **Stepping aside:** when 100 requests are already waiting for a connection, a poll gets a 503 without touching Postgres, so polls
  can't starve sign-in and messages.
- **Logs:** per-poll lines are off. Each task writes one line a minute: `{"live":{"polls","changed","refused","limited","shed","failed"}}`.
  A test checks that no token, title, error text or id appears. No new store of family data, so `/privacy` and deletion are unchanged.
- **Settings:** `LIVE_POLL_FLOOR_MS` slows every phone without an app release. `LIVE_OFF=jobs` sends a topic back to Convex.
  `LIVE_PERSON_PER_MIN`, `LIVE_REFUSED_IP_PER_MIN`. Not in Terraform yet: the defaults run with no setting.
- **Queries:** `findSession` by `sessions.token_hash` (unique); `recentJobs` by `jobs_family_recent`, limit 20. A test checks that both indexes
  can serve them, with sequential scans off. It hasn't run on real-sized tables.

## Load

**Assumptions:** at the peak, 10% of daily users have the app open at once. (500 people × 15 minutes a day × 25% of it in the busiest
hour gives 31 at once; I rounded up to 50 because traffic is spiky.) 10x is 500. Only the app in the foreground polls. Each poll is
two indexed queries, so queries are twice polls.

| Peak | 500 daily users (50 phones) | 10x (500 phones) |
|---|---|---|
| Job progress alone: 10% watching a moving job, the rest idle, 0.05 polls/s a phone | 2.5 polls/s, 5 queries/s | 25 polls/s, 50 queries/s |
| Ceiling: every topic moved, plus today's Supabase polls, 0.5 polls/s a phone | 25 polls/s, 50 queries/s | 250 polls/s, 500 queries/s |

The ceiling is deliberately high. Using the plan above, a cook on Home is 0.23 polls/s, a kid in cook mode 0.32 and a phone in an open chat 0.43.

**Connections:** polling holds none between requests, so it adds nothing to the count: each task's pool of 10, plus the worker. A query
of about 1 ms at 500 a second keeps fewer than one connection busy. RDS's limit is about 80-110 on `db.t4g.micro` (staging) and about 400 on
`db.t4g.medium` (production); those come from AWS's formula as I remember it, not from our instances. The streaming designs would add one
connection per task outside the pool.

**Measured with `api/scripts/live-load.ts`. These aren't AWS numbers.** One api process, Postgres 17 in Docker, the load on the same M1 Pro with
other agents busy on it, and no TLS or load balancer. Jobs per family: 5-6.

| Run | Polls/s | p50 / p95 / p99, ms | Told to wait | Api CPU, one core |
|---|---|---|---|---|
| 50 phones, the server's pace (500 daily users, job progress alone) | 2.8 | 7 / 17 / 42 | 0 | 0.6% |
| 500 phones, the server's pace (10x) | 26.6 | 6 / 16 / 36 | 0 | 2% |
| 500 phones, every 2 s (the 10x ceiling) | 249 | 6 / 30 / 97 | 0 of 14,961 | 7% |
| 500 phones, every 1 s | 462 | 5 / 40 / 371 | 184, all in one 5 s stall | 14% |
| 50 phones, no pause (the limit) | 3,324 | 13 / 27 / 48 | 0 | 58% |
| 500 phones at the same instant, every 5 s | 92 | 4 / 82 / 335 | 390 of the first 500, none after | 4% |

- **How fresh:** at the server's pace, a phone saw a write after 2.5 s at the median, 5 s at p95, and 5.4 s at worst.
- **A deploy with one task** (500 phones, every 2 s): the stop took 42 ms, the new api answered in 1.7 s, and the first good poll came at 1.7 s. 436 polls
  failed once, the next 20 s stayed at the normal rate, and none was told to wait. (A run before the stop fix told 62 to wait.) A real deploy has a second task.
- **A Postgres restart** (0.5 s, same load): 215 told to wait, a good poll within 0.6 s, the process survived.
- **Postgres itself:** 18% of a core at 249 polls/s (one `docker stats` sample). Each read touched 4-10 cached blocks. On tables this small the planner picks
  a sequential scan or another family index and sorts the few rows.
- **How much to trust this:** the limit run varied by two times (1,506/s when the laptop was busier). With the stepping-aside threshold at 50, two earlier
  runs at 250 polls/s told 3.7% and 0.27% of polls to wait after stalls of a few hundred ms. I raised it to 100, and that's one clean run, not proof.

**What this says about AWS, as an estimate:** the 500-user ceiling is easy. The first limits at the 10x ceiling are the small things: staging's 0.25 vCPU task (0.3 ms
of M1 per poll may be well over 1 ms there, so plan several tasks or larger ones), and `db.t4g.medium`'s burstable baseline, which about half a vCPU of steady
queries would exceed (from memory: 20% per vCPU). The pre-launch load test (50 RPS, SYSTEM-DESIGN.md) needs polls in its mix, since they could be half of it at 500 users.

## How later areas plug in

Add a line to `topics` in `api/src/modules/live/routes.ts`: a name, two rates, and a `read` from that area's own service. The app adds
one line to `POLLED`. The session check, limits, stepping aside, logs and failure answers come with it.

- **Messages:** sending stays an ordinary POST with an idempotency key, which fails visibly and retries (the CAP table). Polling only
  reads. Keep today's rates and `after` cursor: `read` takes `since` as the cursor and returns only newer rows, so `version` is the
  newest message's id rather than a hash. Unread and inbox are plain topics. This moves polls off Supabase rather than adding them.
- **Recording state:** a topic with a recording id in its path, the row checked against the session's family (`requireFamily`), at 2 s
  while the screen is open. A route with a path parameter is a small addition to the helper.
- **`recipes:list`:** add `updated_at` kept by a trigger in migration 030 or later, and let a topic give a cheap `version` first, so whole
  recipes load only when something changed. Don't hash 100 whole recipes on every poll.
- **Everything marked "focus, 60 s":** the same topic with `idleMs: 60_000`. Most of them could be plain reads on focus.

## The app change (not made; `app/` is untouched)

**1. New file `app/src/lib/live/poll.ts`.** One poller per topic and session, because `recipes:list` alone mounts in about 13 places
and Convex shared those for free.

```ts
import { AppState } from 'react-native';

const LIVE_API = (process.env.EXPO_PUBLIC_LIVE_API_URL ?? '').replace(/\/+$/, '');
const TIMEOUT_MS = 8_000;

/** Convex function name -> topic on the new api. A name moves here when its area switches over. */
export const POLLED: Record<string, string> = LIVE_API ? { 'jobs:forFamily': 'jobs' } : {};
/** Topics the server has sent back to Convex (410) until the app next starts. */
export const backOnConvex = new Set<string>();

type Listener = (value: unknown) => void;
type Poller = { listeners: Set<Listener>; offs: Set<() => void>; hasValue: boolean; value?: unknown; stop: () => void };
const pollers = new Map<string, Poller>();

const backoffMs = (failures: number) => Math.min(60_000, 5_000 * 2 ** (failures - 1)) * (0.5 + Math.random() / 2);

function startPoller(key: string, topic: string, sessionToken: string): Poller {
  let since = '';
  let failures = 0;
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = (ms: number) => {
    if (!stopped) timer = setTimeout(tick, ms);
  };
  const tick = async () => {
    // Backgrounded: stop here. Coming back to the app asks at once (below). A failed poll keeps what's on screen.
    if (stopped || running || AppState.currentState !== 'active') return;
    running = true;
    const abort = new AbortController();
    const giveUp = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${LIVE_API}/v1/live/${topic}?since=${since}`, {
        headers: { authorization: `Bearer ${sessionToken}` },
        signal: abort.signal,
      });
      if (res.status === 200) {
        const body = (await res.json()) as { changed: boolean; version: string; pollAfterMs: number; data?: unknown };
        failures = 0;
        if (body.changed && !stopped) {
          since = body.version;
          poller.value = body.data;
          poller.hasValue = true;
          poller.listeners.forEach((listener) => listener(body.data));
        }
        later(body.pollAfterMs);
      } else if (res.status === 401) {
        // Signed out or deleted: stop. A new sign-in changes credentialVersion, and useLive starts over.
      } else if (res.status === 410) {
        backOnConvex.add(topic);
        poller.offs.forEach((off) => off());
      } else {
        failures += 1;
        const told = Number(res.headers.get('retry-after')) * 1000;
        later(Math.max(told || 0, backoffMs(failures)));
      }
    } catch {
      failures += 1;
      later(backoffMs(failures));
    } finally {
      clearTimeout(giveUp);
      running = false;
    }
  };
  const resume = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    if (timer) clearTimeout(timer);
    void tick();
  });
  const poller: Poller = {
    listeners: new Set(),
    offs: new Set(),
    hasValue: false,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      resume.remove();
      pollers.delete(key);
    },
  };
  void tick();
  return poller;
}

/** `onOff` runs if the server sends this topic back to Convex. Returns the way to stop watching. */
export function watchTopic<T>(topic: string, sessionToken: string, onData: (value: T) => void, onOff: () => void): () => void {
  const key = `${topic}:${sessionToken}`;
  const poller = pollers.get(key) ?? startPoller(key, topic, sessionToken);
  pollers.set(key, poller);
  const listener = onData as Listener;
  poller.listeners.add(listener);
  poller.offs.add(onOff);
  if (poller.hasValue) onData(poller.value as T); // a second screen doesn't wait for the next change
  return () => {
    poller.listeners.delete(listener);
    poller.offs.delete(onOff);
    if (poller.listeners.size === 0) poller.stop();
  };
}
```

**2. In `useLive` (`app/src/lib/live/convex.ts`):**

```diff
+import { backOnConvex, POLLED, watchTopic } from './poll';
 ...
   const argsKey = JSON.stringify(args);
+  const topic = POLLED[name];
+  const focused = useFocusedSafe(); // export it from lib/messaging.ts
+  // A polled topic stops when its screen isn't showing; a Convex subscription never did.
+  const paused = !!topic && !focused && !backOnConvex.has(topic);
   useEffect(() => {
-    if (!enabled) return;
+    if (!enabled || paused) return;
     if (isStub || !client) return fallback(setValue);
 ...
-        off = client.onUpdate(ref<'query'>(name), { ...args, sessionToken }, (v) => setValue(v as T), (e) => {
-          if (!isMissing(e)) return console.warn(`[convex] ${name}`, String(e));
-          if (!soft) return goStub(e);
-          if (alive && !offStub) offStub = fallback(setValue);
-        });
+        const onConvex = () => client.onUpdate(ref<'query'>(name), { ...args, sessionToken }, (v) => setValue(v as T), (e) => {
+          if (!isMissing(e)) return console.warn(`[convex] ${name}`, String(e));
+          if (!soft) return goStub(e);
+          if (alive && !offStub) offStub = fallback(setValue);
+        });
+        off = topic && !backOnConvex.has(topic)
+          ? watchTopic<T>(topic, sessionToken, setValue, () => { off?.(); off = onConvex(); })
+          : onConvex();
       });
 ...
-  }, [name, isStub, meId, credentialVersion, enabled, argsKey]);
+  }, [name, isStub, meId, credentialVersion, enabled, argsKey, paused]);
```

**3.** `EXPO_PUBLIC_LIVE_API_URL` in the build. Without it `POLLED` is empty and nothing changes. A new topic reaches phones by EAS Update.

No screen changes: `LiveJob` is unchanged. The job row keeps Convex's `_id` and `_creationTime` names on purpose.

`poll.ts` ran against the real local api in plain Node, with a stand-in for `AppState`: first value, two screens sharing one poller, a change arriving,
no update when nothing changed, stopping in the background, a task going away and the final state after, a 401, a 410. It typechecks on its own. The
`useLive` diff hasn't been compiled, and none of it has run in the app or on a phone.

**The way back:** `LIVE_OFF=jobs` on the api sends phones to Convex on their next poll, with no app release. It only makes sense while
Convex still has the data, so it goes with the area's own switch back.

## When things are down

| What fails | What a phone sees | What happens |
|---|---|---|
| One api task | One failed poll at most | Retries in 2.5-5 s and lands on another task. Nothing was held on the old one |
| A deploy | The same | Polls in flight finish; a kept-alive connection doesn't hold the stop up (tested) |
| Postgres down or failing over | Last good state; 503s | Phones return 5-15 s after their last 503. The server gives no old answers: with no session check it refuses, and only the phone keeps the old state |
| Postgres slow | Last good state; some 503s | Polls step aside, and the rest of the api keeps its connections |
| The phone's network | Last good state | 8 s timeout, backoff to 60 s. Coming back to the app asks at once |
| App in the background | Nothing | No polling, no connection to keep alive. Coming back asks at once |
| A session ended | Last good state | 401, polling stops |

**No storm:** there's nothing to reconnect. Phones are already spread by ±10% on every poll, the Retry-After is spread over 10 s, and
backoff is randomized, so after an outage the return is limited by the slowest of those.

**Two bugs in the new api, fixed here, neither ever live:**

- `api/src/db.ts` had no `error` listener on the pool, so Postgres dropping an idle connection (any restart or failover) ended the process, on
  every task at once. Reproduced, fixed, tested.
- A connection that finished a request just after a stop began stayed open for the full keep-alive (`KEEP_ALIVE_MS`, about an hour), so the stop hung until
  ECS killed the task. The new test hung on it, and with the fix in `app.ts` it stops in about 100 ms with 10 polls in flight.

## Open questions, with recommendations

1. **Sessions must reach Postgres before the jobs area switches.** Every poll checks a session, and `sessions` isn't in M1's one-way
   sync (`families`, `people`, `recipes`), while "Sessions" is the last area to move. Calling Convex on each poll would be an outside
   call on the hottest route. **Recommendation:** add `sessions` (hashes only) to the sync, with a sign-out or deletion reaching
   Postgres within a minute, the rule M1 already sets for deletions. A new session not yet copied gets a 401, and polling stops until the
   next app focus, so the sync has to be quick or the first poll needs one retry. This is the biggest open risk in this design.
2. **Rates.** 5 s and 30 s are my reading of "slightly old". **Recommendation:** keep them; the floor setting raises them without a release,
   and Caleb should watch one real job's bar on them before they're final.
3. **One request per tick, or one per topic?** A cook's Home would have 6 topics. Merging them into `GET /v1/live?since=…` cuts requests
   about 5 times but not reads. **Recommendation:** not now. The numbers don't need it, and it's the first step when they do.
4. **Glasses frames.** At about 7 a second this is the one subscription polling fits badly, and each write deletes the last file, so
   a stored link may already be dead. The glasses VM has been stopped since Oct 25. **Recommendation:** decide when the glasses come back. A
   1 s poll keeping the last few frames is probably enough, and a dedicated socket stays possible for that one screen.
5. **ALB 5xx alarm.** A 503 from stepping aside counts as a 5xx. **Recommendation:** leave it. If Postgres is slow enough to shed, someone should
   know. The alarm's threshold still has to be set when it's built.
6. **Kids and `jobs`.** Server-side, any family member may read jobs, as in Convex. **Recommendation:** keep it for the behavior tests, and decide
   separately. Titles and errors only, no recipes or stories.

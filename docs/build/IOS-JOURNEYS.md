# iOS journeys in CI

The app on an iOS simulator, on every PR that touches `app/`, so a sheet that freezes the screen (#402, #410) fails a check
before it reaches a phone. Workflow: `.github/workflows/ios-journeys.yml`. Journeys: `app/e2e/journeys/*.yaml` (Maestro).
Plan approved by the Master Agent, Nov 8, 2026, in three steps:

1. **The spike (this file's first PR).** The workflow builds the app for the simulator from the PR's own commit
   (`expo prebuild`, `pod install`, `xcodebuild -configuration Release -sdk iphonesimulator`, no signing and no EAS; no ccache until a build passes)
   against AWS staging. It boots an iPhone simulator, installs Maestro (a pinned release whose sha256 is checked) and runs
   one journey: a fresh install opens on the first screen, and a made-up family link opens the dead-link card from
   staging. Each phase's time goes into the run's summary. Three runs, cold then warm, report the real times. The gate is
   off.
2. **E2E hooks in the app (App screens' files, reviewed here).** Compiled in only when `EXPO_PUBLIC_E2E === '1'`, so store
   builds drop them. A deep link signs a test person in through staging's `/v1/test/sign-in`; production's api has no such
   route (404). A fake camera films a bundled clip, because a simulator has none. `check-app-export.mjs` refuses a
   production-aws export holding `e2e/sign-in`.
3. **Journeys 2–5 and the gate.**
   - Messages → New message → Add family → Copy link → X → a chat → Home (journey 3, `03-add-family-copy-link.yaml`;
     "Journey 3" below).
   - Record → film 5 s → send.
   - Family link → name → sign in (journey 2, `02-family-link.yaml`; "Test people" below).
   - A shared recipe's video plays.
   - Kid Home.

   `safe-eas-update.sh production-aws --caleb-ok` (1.1.1) then needs a passing run on a commit with the same `app/` tree as
   HEAD, or `--no-sim "<reason>"` (#444).

**Time.** Baseline: the spike's timed runs on `55e9d973b` (run 42571326165) took **40m09s and 42m23s**. A third attempt
was cancelled by a merge from main. The Release build took about 25 min, the new simulator's boot about 9 (7m21s of it
iOS's one-time "Data Migration"), and the journeys 2–4. So:

- The simulator starts booting right after Xcode is picked, and boots while the app builds.
- The build is arm64 only (a Release build for the generic simulator also builds x86_64).
- The built app is kept in the Actions cache, keyed by the native fingerprint (`@expo/fingerprint`: native packages,
  plugins, the app config, the icon and splash; never `app/src`). A PR that changes only JS reuses it and bundles its own
  JS in, exactly as Xcode's bundle phase does (`expo export:embed`, then the same `hermesc`). That's what an EAS Update
  does to a phone. A native change builds again.
- The CI build turns expo-updates off (`EXUpdatesEnabled` NO), so the journeys always run the commit's own JS, never a
  published update. (A build made without EAS sends no channel, and EAS answers that with a 400; the app code doesn't
  call expo-updates.)

After those changes (#446), all green:

| Run | Path | Total | Build, or JS into the reused app | Boot wait + install | Journeys |
|---|---|---|---|---|---|
| 42582941443, attempt 1 (PR #446) | full native build | 34m43s | 21m01s | 19s | 2m19s |
| 42582941443, attempt 2 | reused app, JS bundled in | 16m53s | 4m07s | 45s | 5m55s |
| 42582941443, attempt 3 | reused app, JS bundled in | 12m53s | 1m17s | 1m36s | 3m42s |
| 42583031923 (main, `b3593850e`) | full native build | 34m16s | 21m22s | 33s | 2m32s |

What these runs show:
- A JS-only change, which is nearly every PR, takes 13–17 min. A native change still takes about 35.
- The build's timing summary is mostly C and Objective-C compiling: 693 tasks, 2241 s of CPU on 3 cores. Swift adds 653 s.
- Booting during the build slows `npm ci` and the build while it runs, so it saves 6–8 min, not the full 9.
- Next for the native path: ccache, and dwarf only (no dSYM).

**ccache (the native path).**
- It runs as Xcode's compiler launcher: `C_COMPILER_LAUNCHER=<ccache>` on the `xcodebuild` line, with
  `CLANG_ENABLE_EXPLICIT_MODULES=NO` (one of the two choices Xcode's own note gives for a launcher). React Native's
  `ccache.conf` (sloppiness for Clang modules, depend mode) is written into ccache's own config file, so the compiles
  find it without any environment.
- React Native's own route (`USE_CCACHE=1` at `pod install`, the same switch as `apple.ccacheEnabled`) did nothing here.
  It sets CC and CXX to a wrapper that runs `$CCACHE_BINARY clang`, and Xcode 26 exports `CCACHE_BINARY` to script
  phases but not to compile tasks. So the wrapper ran plain clang, and ccache saw no calls in three runs (42596435076,
  42601059072, 42605096278: builds of 22m31s, 16m49s and 23m01s, all without the cache). Xcode also turned explicit
  modules off for the wrapper, so those runs had the same build shape as this one.
- ccache is pinned at 4.14.2, checked by sha256 and downloaded with the job's token.
- Its folder, ccache's own default, is kept in the Actions cache: each native build saves a new copy and restores the
  newest.
- The build is dwarf only (`DEBUG_INFORMATION_FORMAT=dwarf`): a simulator run never reads a dSYM.
- The job summary's title gives ccache's hits and misses; the build step's "ccache" group has the full stats.
- To time a native build when the app is already cached:
  `gh workflow run ios-journeys.yml --ref <branch> -f native_build=true`.

**Required check (Master Agent, Nov 9).** The workflow runs on every PR, because a required check has to report on all
of them. Its jobs:
- `scope` (ubuntu, seconds): skips the simulator when the PR changes neither `app/` nor the workflow. Its test is the
  same as `check-sim`'s: the merge commit's `app/` tree against its base's. It says so in one line in the summary.
- `journeys`: the simulator run.
- `ios-journeys`: the check main requires. It's green when the journeys passed or were skipped, and red when they failed
  or were cancelled.

Pushes to main still run only on `app/` or workflow changes, and a newer push still cancels an older run.

Rules for the public repo: never `pull_request_target`, so a fork's PR gets no secrets and skips what needs them. The logs
never print a family link, a test id or a key (`::add-mask::`). Journey 2's test people (`scripts/journey-people.mjs`) are
deleted in `if: always()`. `TEST_SIGNIN_KEY` is an Actions secret, set by Caleb on Nov 9.

A link from outside goes through `app/e2e/flows/open-link.yaml`. iOS asks "Open in homecookd?" first, and a tap on its
Open sometimes closes the dialog without handing the link to the app (runs 5 and 7 tapped the same point, and only run 5's
link arrived). The subflow tries open, tap and wait up to three times. A link that carries a key is echoed in Maestro's
own files, so only screenshots and `report.xml` are kept from those journeys (see "Test people").

**The trust-check stall and Try again (Master Agent, Nov 9).** Twice on Nov 9 (runs 42592011253 and 42614847250) the
journey ended on "We can't reach homecookd." The app's request reached CloudFront and got its certificate within about
20 ms. Then the simulator's certificate check (trustd) stopped answering every process, not only the app, for a minute or
more after boot, and the app gave up after its own 10 s. Opening the same link again doesn't ask the api again, so the
subflow's retries didn't help. Now:
- An attempt that finds that card, on a link this subflow opened, taps the card's own Try again, which asks the api
  again, and waits for the expected screen. Without the card, the attempt opens the link as before. So the three attempts
  cover about a minute.
- The card still up after the last attempt fails the journey.
- After a sign-in the same stall shows as the family's load failing: "Who's in the kitchen?" with "We can't reach your
  kitchen" (journey 3, run 42759943404). Its card's Try again loads the family again, under the same rules: only with
  that card up, on a link this subflow opened, and the card still up after the last attempt fails the journey (Master
  Agent, Nov 9).
- Each tap saves a screenshot naming its card: `try-again-N` on "We can't reach homecookd.", `try-again-kitchen-N` on
  "We can't reach your kitchen.". Opening the link again with no card to tap (the link didn't land, or the app sat on
  the screen it was on) is a retry too: `open-again-N`, taken before the link opens, so it shows the stuck screen and
  never the link, and the summary warns "passed after N re-opens of the link: the link didn't land or the app stalled
  (the kept simulator log says which)", titled "Journey retry" like the taps. Without it a run passed silently: every
  keyed run approved up to #467 re-opened the sign-in link once in each signed-in journey (42803587900, 42807178364,
  42811383192). **That re-open isn't a stall:** the simulator-only sign-in hook (#435) adopts the key and the family
  loads (GET /family 200), but the app isn't routed off the first screen until the link opens again. Scratch run
  42820907631 had zero certificate FAILs and still one re-open each in journeys 2, 3 and 4. The link's own `/` came
  while still signed out, so SessionGate sent it back to the first screen, which decides only once. Now the hook goes
  in to "Who's in the kitchen?" once its adopt settles, as a real sign-in does (session.tsx, test builds only), so an
  `open-again-N` in a signed-in journey again means a link that didn't land or a stall. The certificate
  stall is a separate thing (runs 42815821906, 42786504171, 42790025629). In 42811383192 both happened: journey 3's
  sign-in sat inside a real one (13 certificate FAILs, 12:17:56–12:18:53, first true check 12:19:04), while journey 2's
  re-open came with no FAIL at all. A journey that passed only after a tap gets a warning and a line in the job summary
  that names the card ("passed after 1 "Try again" retry on "We can't reach your kitchen.", trust-check stall"), so a
  real api outage can't hide behind a green run (`scripts/journey-retries.mjs`).
- To check it: `gh workflow run ios-journeys.yml --ref <branch> -f stall_api=first-try` must pass with that line, and
  `-f stall_api=all` must fail. Both point the api's host at 192.0.2.1 (an address that never answers) on the runner;
  `first-try` brings it back 15 s after the app's first try.
- If the stall comes back with the retry in place, the next fix is on the simulator's side (reset trustd, or warm the
  certificate check before the journeys), not more taps. It came back: see the next section.

**The stall's cause: the push daemon's storm (Master Agent, Nov 9).** It came back twice with the retry in place, both on
runs that reused the built app, where the journeys start a few minutes after boot instead of about 20: run 42759943404
(attempt 1, about 05:13Z: "We can't reach your kitchen" after a sign-in) and run 42766011110. The simulator's log from
run 42766011110, minute by minute:

| Minute (UTC) | apsd TLS checks | trustd signature checks | the app's checks false / true |
|---|---|---|---|
| 06:18 | 609 | 1,232 | 0 / 0 |
| 06:19 | 425 | 858 | 3 / 1 |
| 06:20 | 1 | 0 | 9 / 0 |
| 06:21 | 0 | 0 | 6 / 0 |

- apsd, the simulator's push daemon, reconnected to Apple's sandbox push servers (`N-courier.sandbox.push.apple.com`)
  about 600 times a minute, and each TLS connection cost trustd two signature checks (2,090 in all, 06:18:20–06:19:46).
- The app's first check at 06:19:34 answered true. From 06:19:49 every one of its connections sat in "Asyncing for
  external verify block" and came back `result: false` 6–10 s later, through at least 06:22:55. trustd took each new
  connection and logged nothing else: it had stopped answering.
- A good check before the journeys isn't enough on its own: #460's first PR run (42775448005) passed the warm-up in 27 s,
  then the launch journey needed a Try again and journey 2 failed with the card up.

**A second cause: trustd's pinning database (Master Agent, Nov 10).** With the push storm gone, journey 3 still failed after
sign-in on reused-app runs 42786504171 and 42790025629 (apsd: 0 checks). The kept log: the warm-up's Safari check passed
(09:12:22), and about 70 s later trustd started answering its own reads of its certificate-pinning rules with `database
is locked in "SELECT DISTINCT policies,transparentConnection FROM rules WHERE policyName=?"`: 942 times, 09:13:33–09:17:40,
one trustd process. Every check reads that table, so each one waited until the app's TLS gave up ("Certificate
verification result: FAIL", 7.5 s). Then it cleared. It looks like trustd rebuilding that database after its first
check since boot. On a native run the 20-minute build hides it; a reused-app run starts the journeys inside it.

So the journeys have these lines of defense, in this order:
1. **No push storm.** "Start booting a simulator" points Apple's push hosts (`init`, `courier`, `0-…99-courier`, sandbox
   and production) at 127.0.0.1 in the runner's `/etc/hosts` before the boot. The simulator resolves through it, so apsd's
   connections are refused at once and never reach TLS or trustd. No journey uses push.
2. **trustd's first check right after boot.** "Start booting a simulator" leaves a background job that waits for the
   boot, then opens the staging api in Safari once, so trustd's first check (and the rebuild it seems to start) happens
   during npm ci, Pods and the build. Its first version ran in 1 of 3 proof runs. It used `bootstatus -b`, which may
   race the boot started just above (not proven); it now waits with plain `bootstatus` and logs to the runner. The
   summary says whether it ran.
3. **"Wait for the simulator's trust check"**, before the seed step (so no link or key exists yet). It watches trustd's
   log for "database is locked" from the moment it starts. Safari opens the staging api, and the step watches Safari's
   own processes for a certificate check that answers true: up to 60 s a try, restarting trustd between tries, 3
   restarts at most. Then, counted from that answer, it restarts Safari and opens the api every 8 s (each visit a new
   check) until 30 s pass with no lock and at least 100 s have passed since this trustd's first check: the early one
   after boot or its last restart in this step, whichever is later, since nothing shows a restarted trustd skips the
   rebuild. 6 minutes at most. Only real log lines count (they start with a date): `log stream` first prints a line
   repeating its predicate, "… database is locked", which the first version counted as a locked read.
   This gate is what protects the journeys; step 2 only makes the wait shorter. Either failure says "The simulator,
   not the app or this PR … Re-run the job", and no journey runs on a stalled simulator. The job summary gets, on
   every run, the seconds waited, the try, the restarts and how long the database was locked (0 s too); the logs stay
   on the runner.
4. **Try again** in `open-link.yaml` (above), for anything that still slips through. A journey that needed it gets a
   warning, never a silent pass.

**A link open iOS gives up on (fault four, Master Agent, Nov 10).** Maestro's `openLink` runs `xcrun simctl openurl`.
Sometimes lsd stops waiting for SpringBoard after exactly 10 s (`_LSDispatchWithTimeout`, Code=60). simctl then fails,
but SpringBoard still delivers the link seconds later. Maestro's `retry` and `optional` catch only Maestro's own errors,
so this throw ends the journey ("Unknown error" in report.xml) on a link that landed. Every one seen on Nov 10, from the
kept simulator logs:

| Run (attempt) | Journey | Open (UTC) | iOS gave up | App got the link | Gate: trustd restarts |
|---|---|---|---|---|---|
| 42847823481 (1), #473 | Family link, name, sign in | 15:58:14 | +10.0 s | +53.0 s | 1 |
| 42847823481 (2), #473 | Family link, name, sign in | 16:18:37 | +10.0 s | +15.8 s | 1 |
| 42847823481 (2), #473 | Launch, then a link that doesn't work | 16:19:46 | +10.0 s | +21.5 s | 1 |
| 42851642925, #471 | Record, film, send | 16:25:24 | +10.0 s | +16.4 s | 0 |
| 42872308399 (2), #476 | Family link, name, sign in | 19:36:28 | +10.0 s | +14.2 s | 0 |

A fifth slow open in 42851642925 didn't throw: journey 3's sign-in link (16:20:53) first reached SpringBoard 64 s later,
and the journey passed after two re-opens. So a trustd restart in the gate isn't needed for it (0 in 42851642925).
GitHub's notice on these jobs said macOS arm64 runners were under capacity pressure, and all of them fall between
15:58 and 16:26 UTC; that is a guess at a cause, not a finding.

The fix: `scripts/journey-xcrun.sh` is Maestro's `xcrun` in the Journeys step (first on its PATH). Every call goes straight
to the real one, except a `simctl openurl` that fails. That open counts as opened only when the step's log stream shows
lsd's Code=60 timeout and the app receiving a link (its own `UIOpenURLAction` line) within 30 s of the open, the time
`open-link.yaml` would wait for its screen anyway. Then the flow goes on, and its own wait for that screen is still the
proof. Anything else fails as before, with simctl's own error. Each failed open, passed or not, gets a "Journey retry"
warning naming the journey, when iOS gave up and when the link landed (`journey-retries.mjs`, from report.xml's times).
The 30 s run from the open to the app's own line, not to simctl returning, and a link that never arrives fails as before.
Of the five above, the four that landed within 30 s would have passed with a warning, and 42847823481's first would
still fail. A link that starts the app arrives at launch, without that line, so a failed open of one isn't excused.

Every open is logged, not only the failed ones, so a slow open shows even when nothing threw (the 64 s one above). The
"Link opens" table, in the job summary and the job log (`gh run view --log`; a summary needs a signed-in browser), lists each: the journey, when, how long simctl took or how it failed, and when the app
got the link, which includes iOS's "Open in homecookd?" dialog and Maestro's tap on it when iOS asked (0.0–0.4 s without
the dialog and 12.6–17.2 s with it in 42872308399). An open whose link took more than 30 s is also a warning. The stream
keeps only those two kinds of line, neither holds the link, and it stays on the runner. The `openurl_fault` input treats
the first open as one iOS gave up on, to check the landing check on a real simulator.

**Test people (journey 2, Master Agent, Nov 9).** `app/e2e/journeys/02-family-link.yaml`: a family link, a name, then
signed in to that family.
- Before Maestro starts, the step "Seed the journey test people" runs `scripts/journey-people.mjs setup` on AWS staging.
  It makes a cook, "Asha (test)", and her family link, then signs in a kid, "Leo (test)", who joins by that link.
- Test ids are `j<run id>-<attempt>-cook|kid`. They're written to `$RUNNER_TEMP/journey-people.json` before the first
  sign-in, never under /tmp.
- The family link (in the app's `homecookd://i?t=` form) and the kid's device key are masked first. They reach Maestro as
  `FAMILY_LINK` and `KID_KEY`. `TEST_SIGNIN_KEY` itself never reaches Maestro or the app.
- The journey opens the link, checks the join card ("Join Asha (test)'s family", the two chips), types a name and stops at
  the Apple button: a simulator can't do Sign in with Apple. Then it opens `homecookd://e2e/sign-in?key=…`, the
  simulator-only hook (#435), and the app lands in Asha's family as the kid. The workflow builds with
  `EXPO_PUBLIC_E2E=1` for that hook; without it the link falls through to the first screen (run 42741853080).
- **A fork's PR** has no `TEST_SIGNIN_KEY`: the seed step says so in the job summary and Maestro runs without journey 2
  (`--exclude-tags needs-key`). The run passes. To check that path: `gh workflow run ios-journeys.yml --ref <branch> -f
  no_key=true`.
- **A key that's set but refused** (rotated, or staging lost it) fails the seed step with "TEST_SIGNIN_KEY was refused by
  staging", so it can't pass as a fork's skip. Fix: set the repo secret again from `.env`.
- **What's kept:** Maestro writes every `-e` value into each flow's `commands.json`, not only journey 2's (run
  42736006425). So when the keyed journeys ran, "Drop what echoes a key or a link" removes every flow's `commands.json`,
  Maestro's own logs and the screen dumps. Each flow keeps its screenshots and the simulator's log
  (`logs/device-simulator.log`), where each exact value (both device keys, the link's token, the two test ids) becomes
  `***`: that log is what shows a stall's cause (Master Agent, Nov 9). `report.xml` stays. On a fork's PR the launch
  journey keeps its files: its made-up link is no secret. Then any file still holding a device key or the token goes,
  with a warning.
- **Deleting them:** "Delete the journey test people" runs in `if: always()` (after a `stall_api` run takes its hosts
  entry out). A runner that dies never gets there, so `.github/workflows/journey-people-sweep.yml` runs every 6 hours on
  ubuntu. It finds the last day's runs that started seeding and didn't finish deleting, and deletes their people by
  their ids, the same day. The step names are the sweep's keys: rename both or neither. A GitHub answer of 5xx, or no
  answer, is tried again (three tries, 2 s then 5 s apart): run 42840432828, the first scheduled sweep, stopped on a
  single 502 and deleted nothing.

**Journey 3 (Master Agent, Nov 9).** `app/e2e/journeys/03-add-family-copy-link.yaml`: the path that froze 1.1 twice,
#402 (an invisible sheet took every tap after Add family) and #410 (the screen stopped redrawing after Copy link).
- The cook from the seed ("Asha (test)") signs in through the hook with `COOK_KEY`, her masked device key.
- A new cook first picks her language ("Your language": English) and passes her one-time welcome ("Not now").
- Then: Messages → New message (the family, with Leo) → Add family → Copy link ("Copied", the link from staging) →
  Close → New message → Message Leo (test) → the chat ("Say hello to Leo (test).") → Back → Home.
- Every step after a sheet closes taps something and waits for the next screen, so a frozen screen fails the journey.
- Maestro runs the journeys in no fixed order (run 42763382649: 03, 02, then 00), so every journey starts with
  `flows/launch-fresh.yaml`: a fresh install with `clearState` and `clearKeychain` (the keychain holds the session, and
  `clearState` leaves it), then the signed-out first screen. Journey 3's Copy link leaves a homecookd link on the
  clipboard, and the next fresh app's first screen picks it up: iOS asks "homecookd would like to paste from homecookd"
  over the screen (run 42778668467). That's the app working, so the subflow answers Don't Allow Paste.

If Maestro is flaky on the sheets after three runs, the journeys move to an XCUITest target (approved without asking).

This Mac has no Xcode or Simulator, so the journeys run only in CI.

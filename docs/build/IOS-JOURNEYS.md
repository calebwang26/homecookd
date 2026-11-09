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
   - Messages → New message → Add family → Copy link → X → a chat → Home.
   - Record → film 5 s → send.
   - Family link → name → sign in.
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
- Next for the native path: ccache through React Native's own `apple.ccacheEnabled`, and dwarf only (no dSYM).

**ccache (the native path).**
- It goes through React Native's own route: `USE_CCACHE=1` at `pod install` (the same switch as `apple.ccacheEnabled`).
  That makes CC and CXX React Native's `ccache-clang` wrappers, with React Native's `ccache.conf`. It isn't a compiler
  launcher, which clashed with Xcode's explicit modules in the spike.
- ccache is pinned at 4.14.2, checked by sha256 and downloaded with the job's token.
- Its folder is kept in the Actions cache: each native build saves a new copy and restores the newest. The folder is
  ccache's own default, asked of ccache. Xcode runs compile tasks without the job's environment, so a `CCACHE_DIR` set in
  the workflow never reaches them (the first timed run filled a folder nobody cached).
- The build is dwarf only (`DEBUG_INFORMATION_FORMAT=dwarf`): a simulator run never reads a dSYM.
- The job summary's title gives ccache's hits and misses.
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
never print a family link, a test id or a key (`::add-mask::`). A seeded family (`app/scripts/aws-phone-run.mjs setup`) is
deleted in `if: always()`. `TEST_SIGNIN_KEY` is an Actions secret, set by Caleb.

A link from outside goes through `app/e2e/flows/open-link.yaml`. iOS asks "Open in homecookd?" first, and a tap on its
Open sometimes closes the dialog without handing the link to the app (runs 5 and 7 tapped the same point, and only run 5's
link arrived). The subflow tries open, tap and wait up to three times. A link that carries a key is echoed in Maestro's
own logs, so those journeys never upload `commands.json` or `maestro.log`.

If Maestro is flaky on the sheets after three runs, the journeys move to an XCUITest target (approved without asking).

This Mac has no Xcode or Simulator, so the journeys run only in CI.

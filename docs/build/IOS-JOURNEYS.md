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

   `safe-eas-update.sh production-aws --caleb-ok` then needs a green run on the checkout's HEAD, or `--no-sim "<reason>"`.

Rules for the public repo: never `pull_request_target`, so a fork's PR gets no secrets and skips what needs them. The logs
never print a family link, a test id or a key (`::add-mask::`). A seeded family (`app/scripts/aws-phone-run.mjs setup`) is
deleted in `if: always()`. `TEST_SIGNIN_KEY` is an Actions secret, set by Caleb.

If Maestro is flaky on the sheets after three runs, the journeys move to an XCUITest target (approved without asking).

This Mac has no Xcode or Simulator, so the journeys run only in CI.

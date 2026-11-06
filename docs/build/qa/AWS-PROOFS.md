# Proving the 1.1 app on AWS staging

How the app's AWS work (Accounts, Jobs and recording, Messages and questions) was proven, so whoever picks up the next
area, or reruns these, can do the same. The contracts are in `docs/build/contracts/` on `aws-migration`. The app's AWS code
is `app/src/lib/aws/`, used only when `EXPO_PUBLIC_BACKEND=aws`.

Each area gets the same four proofs, in this order:

1. **Unit tests with a fake server.** No network. They check paths, bodies, keys, error reading, retries and polls.
2. **A flows script against staging.** It uses the app's own client and real test people, and deletes them after.
3. **The web build at phone size, switch on, against staging.** Screenshots go in this folder, one subfolder per area.
4. **With the switch off, every existing app test.** This shows today's builds are untouched.

A fifth proof is a phone with the switch on (section 5). It runs on the `aws-staging` build profile and channel, never
`staging` or `production`.

## 1. Unit tests (no network)

```bash
cd app && node scripts/test-aws.mjs            # client, errors, Accounts, api.ts under the switch, error words
cd app && node scripts/test-aws-jobs.mjs       # Jobs client and live polls
cd app && node scripts/test-aws-messages.mjs   # Messages client, polled reads, the legacy adapter
```

## 2. Flows on staging

They need `TEST_SIGNIN_KEY` in the root `.env`. The scripts read it and never print it. It's for staging only: production
refuses the route. Each script makes its own test people and deletes them at the end, even when a check fails.

```bash
cd app && node scripts/aws-accounts-staging.mjs   # read-only: health, errors, made-up keys and tokens
cd app && node scripts/aws-accounts-flows.mjs     # sign-up, join by link, phone-less people, sign-out, delete
cd app && node scripts/aws-jobs-flows.mjs         # S3 upload (one PUT and 5 parts), job, poll, stops, a finished recipe
cd app && node scripts/aws-messages-flows.mjs     # chat, questions, uploads, postcards, shares, share asks, delivery
cd app && node scripts/aws-dish-flows.mjs         # a web card claimed by kid and Mom, her requests, voice recipe, dishAskId
cd app && node scripts/aws-community-flows.mjs    # feed, swaps, a dinner end to end, its invite link (no reports or blocks: on staging they email the team)
cd app && node scripts/aws-takedown-flows.mjs make <file>   # then down and back (AWS backend takes it down and keeps it in between), or off alone
```

Things staging has for testing:
- **`POST /v1/test/sign-in`** (header `x-test-signin-key`): `/auth/apple`'s body with `test_id` in place of `id_token`.
  The same `test_id` is the same person each time. **Keep each test id** until that person is deleted, or you can't get
  back in to delete them.
- **`POST /v1/test/recipe`** (same header, plus a session): makes a ready recipe in the caller's family, or finishes a
  queued job with `{jobId}` the way the worker publishes. Staging runs no worker.
- **Small part sizes:** a video over 20 MiB comes back in 5 MiB parts, so a 25 MiB file tests parts. Production uses
  5 GiB and 64 MiB.
- No AI on staging: the photo note is `not_set_up`, and a share answer reads "unclear". Prove the yes paths another way
  (the cook's own tap shares her dish), or ask Caleb for a real-AI window.

## 3. The web build at phone size

`.claude/launch.json` is local and not committed. Add configs like these, with one port per "phone". Staging's CORS allows
`localhost:8081` to `8083`.

```json
{ "name": "homecookd-web-aws",   "runtimeExecutable": "bash", "port": 8083,
  "runtimeArgs": ["-c", "cd app && EXPO_PUBLIC_BACKEND=aws EXPO_PUBLIC_AWS_URL=https://d2zh46br3dalyf.cloudfront.net npx expo start --web --port 8083 --clear"] },
{ "name": "homecookd-web-aws-2", "runtimeExecutable": "bash", "port": 8082,
  "runtimeArgs": ["-c", "cd app && EXPO_PUBLIC_BACKEND=aws EXPO_PUBLIC_AWS_URL=https://d2zh46br3dalyf.cloudfront.net npx expo start --web --port 8082"] }
```

Signing a browser in: Sign in with Apple doesn't run on the web build. Make the test person with a small script (test
sign-in, and anything else the proof needs: a family link, a test recipe, a queued job), and keep its key and test id in
a scratch file. Then, in that port's tab, put the key where the app keeps it and reload:

```js
localStorage.clear(); localStorage.setItem("homecookd.deviceKey", "<the test key>");
localStorage.setItem("homecookd.deviceVia", "person"); location.href = "/";
```

Each port is its own origin, so it's its own phone. Two ports give a kid and a cook talking to each other (the Messages
proof). Set the tab to 375×812 (the preview's mobile preset), and pick a language on first open.

To see what the page really called, run this in the tab:

```js
[...new Set(performance.getEntriesByType('resource').filter(e => e.name.includes('cloudfront')).map(e => e.name + ' ' + e.responseStatus))]
```

Calls for an area that hasn't moved yet answer 404 (for example `/threads` before Messages moved). That's expected:
under the switch, nothing falls back to Supabase or Convex.

What the web build can and can't upload:
- **Voice notes and photos: yes.** Staging's `private` bucket allows PUTs from `localhost:8081` to `8083` (#314). Proven
  Nov 3 from `localhost:8083`: a voice note and a photo, each link, PUT and confirm answering 200.
- **Videos: no.** The `uploads` bucket has no CORS, by design. The flows script proves them.
- Pushes.
- The in-app camera.

Those wait for a phone build.

When you're done, delete every test person (`POST /v1/account/delete` with their session), stop the servers, and put the
tab back to desktop size.

## 4. Switch off

```bash
cd app && npx tsc --noEmit && npx expo lint
cd app && for t in test-aws test-aws-jobs test-aws-messages test-signin test-links test-consent test-who test-hearts test-recap test-table test-cooking test-voice-ui test-community-ui test-parent-jobs test-recording-ui test-doors test-words test-retention; do node scripts/$t.mjs > /dev/null && echo "ok $t" || echo "FAIL $t"; done
```

## 5. A phone with the switch on

`app/eas.json` has an `aws-staging` build profile. It extends `staging` (store distribution, the same Convex and voice
URLs, build number auto-incremented), adds `EXPO_PUBLIC_BACKEND=aws` and staging's `EXPO_PUBLIC_AWS_URL`, and updates on
its own channel, `aws-staging`. App Store, web & builds runs the build:

```bash
cd app && npx eas-cli build -p ios --profile aws-staging --auto-submit
scripts/safe-eas-update.sh aws-staging "<what changed>"                   # JS-only fixes to this build only
```

An EAS Update doesn't read `eas.json`'s build env. The bundle is exported from your shell and `app/.env`, so always
publish with `scripts/safe-eas-update.sh`, never a bare `eas update`. Here is what the script does:
- **For `aws-staging`:** it sets the switch and staging's URL for the export, then checks that the bundle holds that
  address.
- **For any other channel:** it refuses if the switch is set in your shell, and refuses a bundle that holds that address.
- **For `production`:** it always refuses.
- **Every export:** it runs with `--clear`, because Metro's cache would otherwise carry the last export's env over.

`--check-only` exports and checks without publishing.

The rules:
- The build goes to the internal TestFlight group only.
- It's never attached to the version in App Review, and never sent to external testers.
- A switch-on update goes only to `--channel aws-staging`. On `staging` it would move testers' phones to AWS, and on
  `production` it would reach the reviewed build.

To check what the profile resolves to: `cd app && npx eas-cli config --profile aws-staging -p ios`.

The Convex and voice URLs carried over from `production` stay set, but with the switch on the app reads nothing from
Convex. The voice URL is used only by homie, which is off (`HOMIE_ON = false`). Where the voice service runs for 1.1 is
still open.

The build lands in TestFlight under version 1.0.0, like builds 7 and 9, because `app.json` is at 1.0.0 and the runtime
follows the app version. Uploading a build doesn't attach it to the review, and nobody selects it. Calling it 1.1.0 would
be a version bump in `app.json`, which changes the runtime for every channel. That's the Master Agent's call.

What the phone proves, which the web build can't:
- **Filming and uploading from the device.** One clip in a single PUT, and one over 20 MiB in parts, each ending in a
  finished recipe. Use `POST /v1/test/recipe {jobId}`: staging runs no worker.
- **Pushes arriving.** For example a kid's message, a question and a finished recipe.
- **Voice notes from the mic.**
- **A report reaching the team's alerts email.** One report, made on purpose and named as a test.

The step-by-step for the person holding the phone: [aws-phone/CHECKLIST.md](aws-phone/CHECKLIST.md). Build 11's run, Nov 3: [aws-phone/README.md](aws-phone/README.md). Sign in with Apple
works against staging, so the phone joins a test cook's family by link. Delete every test person when you're done, the
phone's staging account too.

The api's own load and scale-in proofs (120 requests a second, then 1,500 at once) are in `docs/build/AWS-MIGRATION.md` on
`aws-migration`, "The run after the slow scale-in".

## Per area

| Area | Screenshots and notes | PRs |
|---|---|---|
| Accounts | `aws-accounts/` | #286, #287, #288, #290, #293 |
| Jobs and recording | `aws-jobs/` | #301, #302, #304 |
| Messages and questions | `aws-messages/` | #307, #308, #312 |
| Kids' asks | `aws-dish/` | #320, #324 |
| Community | `aws-community/` | #326 |
| Takedown and share off | `aws-takedown/` | #333 |
| A phone on staging (build 11) | `aws-phone/` | #341, #342, this PR |

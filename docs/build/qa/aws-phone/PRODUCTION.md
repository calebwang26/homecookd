# Build 15 on production: results

[PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md), "Build 15: the morning check". Caleb replies in the App screens &
recording tab; the chat fills this in, with the api's log lines for each time.

Build 15: production-aws, version 1.0.0, from main `df4337659` (the app is the same as at `5716d1f57`; #377 and #378 changed no app files), TestFlight internal testers only, not attached to any
App Store version. Expo build `a4d1f0f4-7ec2-4bb5-b36d-f910989288b1`; submission `25b0ff72` (finished 01:42 PT, Nov 7).

| # | Step | Result | Time | Notes |
|---|---|---|---|---|
| 1 | Install build 15 | ✅ | Nov 8 | Caleb, Nov 8, after his steak recipe: "I can see the video. Everything's good" (relayed by the Master Agent) |
| 2 | "Tap to start": the camera shows the shot, not filming | ✅ | Nov 8 | Caleb, Nov 8, after his steak recipe: "I can see the video. Everything's good" (relayed by the Master Agent) |
| 3 | Hearts on Uncle Ray's Swordfish Steak and Chicken Biryani save and stay | ✅ | Nov 8 | Caleb, Nov 8, after his steak recipe: "I can see the video. Everything's good" (relayed by the Master Agent) |
| 4 | Uncle Ray's video plays (from media.homecookd.app) | ✅ | Nov 8 | Caleb, Nov 8, after his steak recipe: "I can see the video. Everything's good" (relayed by the Master Agent) |
| 5 | A recording becomes a recipe (real models) | ✅ | Nov 7, 20:40Z | A 10-minute cut of Caleb's steak footage, imported from Photos: job `3bcd2cba`, recipe in 3 min 52 s on the 4 vCPU worker, $0.26 (Master Agent, from production's logs) |
| 6 | The push for the finished recipe | ✅ | Nov 7, 20:40Z | Sent 13 s after step 5's recipe (production's log); Caleb, Nov 8, after his steak recipe: "I can see the video. Everything's good" (relayed by the Master Agent) |

## The next build

A build 16 from main `0c001cc5e` was started and cancelled on Nov 8 (EAS id `3a3b4943`, nothing reached App Store
Connect): Caleb is adding more changes first. The next build (17, most likely) carries #382 (the bundled recipes name
media.homecookd.app, not GCS), #388 (no date on parent Home), #392 (no homie follow-up questions on Home) and whatever
else lands, and 1.1 submits with it. Re-check on it: Home (no date, no homie questions), one heart, the steak's video.

### Build 17: the re-check

| # | Check | Result | Time | Notes |
|---|---|---|---|---|
| 1 | Home has no date line | ✅ | Nov 8, 13:40 PT | |
| 2 | Home has no "homie asks about your …" card | ✅ | Nov 8, 13:40 PT | |
| 3 | One heart on a recipe saves and stays | ✅ | Nov 8, 13:40 PT | |
| 4 | Uncle Ray's Swordfish Steak video plays | ✅ | Nov 8, 13:40 PT | |

Caleb, relayed by the Master Agent: "Did all the checks and it all works. Home has no date line, no homie asks about
your card, one heart on the recipe sticks, and Uncle Ray's Swordfish Steak video plays." He is submitting 1.1 with
build 17.

One thing Caleb saw on build 15: his steak recipe brought eight "homie asks about your swordfish steak" questions to
Home. The api stops making them (AWS backend), and #392 hides any that already exist.

## Checked from the Mac before the morning

- Nov 7, the app's web build of main with `EXPO_PUBLIC_BUCKET_URL=https://media.homecookd.app` (as build 15 has), a staging
  test cook, deleted after: `media.homecookd.app/library.json` answered 200, and the Recipes tab listed all 10 dishes
  with "Uncle Ray" among the cooks. `/recipe/weed-steak` read "Uncle Ray's Swordfish Steak · by Uncle Ray · 12 steps", and
  its Full video played from `https://media.homecookd.app/weed-steak/play.mp4` (206, 7.5 s in, no error).
- In build 15, until production's list arrives, the app also fetches the bundled entries' GCS addresses (`app/assets/data/library.json`
  still names storage.googleapis.com). If GCS goes off, those fail and each recipe falls back to production's address. Build 16 (#382) names media.homecookd.app instead.
- CloudFront served `library.json` from cache without `access-control-allow-origin` (recipe.json, posters and videos have
  it). The iPhone app doesn't need it; a browser does. Fixed in #384 (CloudFront always adds the CORS headers), live after
  Caleb's morning apply.

## The full step-8 check

Not started. It follows the morning check, on build 15.

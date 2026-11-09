# Phone check: the 1.1 build on production (CUTOVER step 8)

This is for Caleb, with an iPhone. It takes about 30 minutes. The build is the `production-aws` profile: version 1.0.0
with a new build number (15 since Nov 7), from main, talking only to `https://api.homecookd.app`. It's the
build CUTOVER step 9 submits, so nothing is rebuilt between this check and the submission. Unlike the staging run
([CHECKLIST.md](CHECKLIST.md)), this one uses real models, real pushes and the real alerts email.

## 1.1.1: before it goes to App Review

Fill this in as fixes land; the first `production-aws` build of 1.1.1 is checked on Caleb's phone before it's submitted.

1. **No pot at launch** (#405, native, so only in a new build). Install the first 1.1.1 build from TestFlight **over**
   the 1.1 already on the phone (build 18 or 20; don't delete it first, or the old snapshot goes with it and this
   proves nothing). Fully close the app, then open it, three times. Each time the first thing on screen is the egg on
   sage; the 1.0 cooking pot never flashes. 📸 or a screen recording of one launch.
2. **New message → Add family** (#402; also goes out by OTA to 1.1). Messages → New message → Add family: the invite
   sheet shows. Close it, then tap a chat: it opens.
3. **Copy link, then the screen still updates** (#410; its OTA to 1.1.0 waits on this step, from draft #411). Messages
   → New message → Add family → **Copy link**: the button shows "Copied" with a check. Close the sheet with the X → tap
   a chat: it opens and you see it → back → tap **Home**: Home shows. Then Recipes → any dish → share → **Copy link**
   → close → tap around: everything you tap shows. A frozen picture while taps still do things is the bug.
   📸 or a screen recording if anything stops updating.

## Build 15: the morning check (Nov 7)

About 15 minutes, in this order. Build 15 is from main `df4337659` (13 and 14 were numbers spent on uploads that never finished): filming waits for your tap (#375), and recipes,
hearts and videos come from `media.homecookd.app` (#376). Write the time of each step. Reply in the App screens & recording
tab with the step number, ✅ or ❌, the time, and a screenshot for anything that looked wrong; the chat fills in
[PRODUCTION.md](PRODUCTION.md).

1. **Install build 15.** TestFlight → homecookd → 15, over build 12. Open it; you're still signed in.
2. **"Tap to start".** Home → Record a new recipe → Start recording. The camera shows the shot and **isn't filming**:
   the line under the red button says "Tap to start". Wait 10 seconds: still not filming. 📸 Then tap ×, back to Home.
3. **Two hearts.** Recipes → **Uncle Ray's Swordfish Steak** → the heart. Then **Chicken Biryani** → the heart. Both
   stay filled, with no "Couldn't save that heart". Leave the app and come back: both still filled.
4. **A video from production.** Open Uncle Ray's Swordfish Steak → Full video. It plays. (That dish's new name exists only on
   `media.homecookd.app`, so this proves build 15 reads production's media.) 📸 the video playing.
5. **A recording to a recipe.** Record → Start recording → tap the red button → film a real dish for a minute or two,
   talking as you go → I'm done → send it. 📸 the "processing" card. It becomes a recipe in a few minutes (real
   models). 📸 the recipe, and play one step's video. If it's still processing after 15 minutes, say so: the worker
   runs on its own once #377 is applied; until then AWS backend starts it when your job lands.
6. **A push.** If the app asks "Want a note when … writes back?" after the send, tap Yes, then Allow (if you allowed
   notifications on build 12, it won't ask). Lock the phone. The finished recipe from step 5 sends a notification. 📸 the lock screen.

The full step-8 check below (a family link, someone with no phone, sign out and in, messages, the reviewer's path,
delete account) comes after this, on build 15.

## Before you start (App screens & recording does this)

- The build starts only when production's `/ready` answers and `api.homecookd.app` resolves (the Master Agent says
  when). It goes to the internal TestFlight group only, until step 9.
- The APNs key is on the Expo project (docs/build/LAUNCH-LINKS.md 6c), or step 7 below waits for it.
- No test sign-in route exists on production: every person here is made through the app, and deleted through it.
- A second phone, or a second Apple ID on a TestFlight phone, makes steps 3 and 6 easier. If there isn't one, the chat
  says which steps use the web instead.

Write down the time of each step, to the minute. The chat matches it against production's logs.

## On the phone

1. **Install the build.** TestFlight → homecookd → the new build number the chat names. Install it over whatever is there.
2. **Sign in.** Open homecookd, start a family as a cook, give your name, Sign in with Apple. 📸 Home.
3. **A family link.** Tap your name at the top of Home ("Who's in the kitchen?"), then the **+** under the cooks or
   the ones who miss it, and send the invite link to yourself. Open it on the second phone (or in Safari on a Mac for
   the web's `/i` page) and join with a name. 📸 both sides showing the new person.
4. **Add someone with no phone.** Your name → **+** → **No phone? Add them to this phone** (a grandparent, say). 📸 the profile.
5. **Sign out and back in.** Your name → **Account & privacy** → **Sign out of this phone** → **Sign out**, then Sign in
   with Apple again. Same family, same people. 📸 Home.
6. **A recording, all the way to a recipe.** Record → Start recording: the camera shows the shot and doesn't film
   yet ("Tap to start"). 📸 that screen. Set the phone up, tap the record button, and film a real dish for a minute or two,
   with talking. Send it. This uses the
   real models, so it takes a few minutes. 📸 the "processing" card, then 📸 the finished recipe with its steps, and play
   one step's video.
7. **Notifications.** When the app asks "Want a note when … writes back?", tap Yes, then Allow. Lock the phone. From the
   second phone (or the person from step 3), send a message. 📸 the lock-screen notification. The recipe from step 6
   sends one too when it's ready: 📸 it.
8. **Messages.** Reply with text and with a voice note. 📸 the thread on both sides.
9. **The reviewer's path.** On the TEST family, follow the 1.1 reviewer notes in "homecookd App Store submission for
   Salik" exactly as written: the TEST family link, the reviewer's name, Sign in with Apple, then each thing the notes say
   to try. 📸 each screen the notes name. Anything that doesn't match the notes word for word is a failure.
10. **Delete account.** Your name → **Account & privacy** → the red **Delete my account** (the path in the reviewer
    notes), and the same for the step 3 person on their phone. 📸 the screen after. The
    TEST family's reviewer is deleted the same way afterwards, unless the notes say to leave them.

## The chat checks, at the same time

- Production's logs for each step's calls, by the times you wrote down; no 5xx.
- The job in step 6 runs on the real worker and publishes; the push in step 7 has an Expo ticket and receipt.
- Production's alarms stay quiet (no report is filed in this check).
- After step 10: the deleted people are gone from the api, and their recordings are purged.

## What to send back

The 📸 screenshots, each with its time, and anything that looked wrong, even small. For a step that failed: what you
tapped, what you saw, and the time. A failure means a fix and a new build, then this check again (CUTOVER step 8,
"Back"). The results go in `docs/build/qa/aws-phone/PRODUCTION.md`.

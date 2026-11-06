# Phone check: the 1.1 build on production (CUTOVER step 8)

This is for Caleb, with an iPhone. It takes about 30 minutes. The build is the `production-aws` profile: version 1.0.0
with a new build number, from main after `aws-migration` merges in, talking only to `https://api.homecookd.app`. It's the
build CUTOVER step 9 submits, so nothing is rebuilt between this check and the submission. Unlike the staging run
([CHECKLIST.md](CHECKLIST.md)), this one uses real models, real pushes and the real alerts email.

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
3. **A family link.** On the profiles screen ("Who's in the kitchen?"), tap **Invite family** and send the link to yourself. Open it on the second phone (or in Safari on a Mac for
   the web's `/i` page) and join with a name. 📸 both sides showing the new person.
4. **Add someone with no phone.** Profiles → **Invite family** → **No phone? Add them to this phone** (a grandparent, say). 📸 the profile.
5. **Sign out and back in.** Profiles → **Sign out**, then Sign in with Apple again. Same family, same people. 📸 Home.
6. **A recording, all the way to a recipe.** Record a real dish for a minute or two, with talking. Send it. This uses the
   real models, so it takes a few minutes. 📸 the "processing" card, then 📸 the finished recipe with its steps, and play
   one step's video.
7. **Notifications.** When the app asks "Want a note when … writes back?", tap Yes, then Allow. Lock the phone. From the
   second phone (or the person from step 3), send a message. 📸 the lock-screen notification. The recipe from step 6
   sends one too when it's ready: 📸 it.
8. **Messages.** Reply with text and with a voice note. 📸 the thread on both sides.
9. **The reviewer's path.** On the TEST family, follow the 1.1 reviewer notes in "homecookd App Store submission for
   Salik" exactly as written: the TEST family link, the reviewer's name, Sign in with Apple, then each thing the notes say
   to try. 📸 each screen the notes name. Anything that doesn't match the notes word for word is a failure.
10. **Delete account.** Profiles → your face → **Delete your account**, and the same for the step 3 person on their phone. 📸 the screen after. The
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

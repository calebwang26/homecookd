# Phone check: build 11 on AWS staging

This is for Caleb, or a tester, with an iPhone. It takes about 20 minutes. Build 11 is the `aws-staging` build: version
1.0.0, from main `612a775`, talking only to AWS staging (`https://d2zh46br3dalyf.cloudfront.net`). Nothing here touches
the live app, the version in App Review, or real families.

What it proves, which the web build can't: filming and uploading from the phone, pushes arriving, voice notes from the
mic, and a report reaching the team's alerts email.

## Before you start (App screens & recording does this)

When you say you're ready, the App screens & recording chat makes two test families on staging and sends you two links:

- **A family link** from "Asha (test)", a test cook. You join her family, so she can message you and finish your
  recordings. Staging runs no worker, so a recording stops at "processing" until the chat finishes it. Asha can't see
  your recording while it's processing, so the chat finishes the family's newest queued job as her:
  `POST /v1/test/recipe {newestJob: true}` (#330). That's why you tell it after each recording, one at a time.
- **A dinner link** (`/d/…`) from "Nadia (test)", a test cook in another family. You report her dinner.

## On the phone

Write down the time of each step, to the minute. The chat matches it against staging's logs.

1. **Install build 11.** In TestFlight, homecookd → Previous builds, if needed → **11**. The build plain staging testers
   get is 9; it doesn't talk to AWS. If homecookd is already installed, install 11 over it.
2. **Join Asha's family.** Staging's links are on a cloudfront host the app doesn't claim, so the chat sends them as
   `homecookd://` links: paste one into Safari's address bar, Go, then Open. Give your
   name, choose cook, and Sign in with Apple. On staging this makes a staging account under your Apple ID, which the
   chat deletes at the end. Allow notifications when asked.
   📸 Home after joining.
3. **Film a short recording.** Record, then a clip of 10 to 20 seconds, then send it.
   📸 The "processing" card. Tell the chat, and it finishes the recording.
   📸 The finished recipe.
4. **Film a long recording.** Over 20 MB, which on staging uploads in parts: about a minute at the camera's normal
   setting. Send it, and leave the app open until the upload finishes.
   📸 The "processing" card. Then 📸 the finished recipe after the chat finishes it.
5. **Get notifications.** Lock the phone. The chat sends you a message from Asha.
   📸 The notification on the lock screen.
   When each recipe is finished there's a notification too: 📸 one of those.
6. **Record a voice note.** In your chat with Asha, hold the mic, say a sentence, and send it.
   📸 The voice note in the thread. The chat plays it back on Asha's side.
7. **Send one test report.** Open the dinner page link (`homecookd://dinner/<id>`; the public `/d` invite screen has
   no report). At the foot of the dinner page: Report or block → Report → any
   reason. 📸 The "Thanks" sheet. Don't block.
8. **Check the alerts inbox.** The staging alarm emails the team's alerts address within about 5 minutes.
   📸 The email with its time. Tell the chat the report is in, and AWS backend closes it.

## What to send back

The screenshots marked 📸, each with the time you took it, and anything that looked wrong, even small. For a step that
failed: what you tapped, what you saw, and the time. The chat writes them up in `docs/build/qa/aws-phone/README.md` and
deletes every test person afterwards, including your staging account.

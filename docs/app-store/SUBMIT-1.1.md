# Submitting 1.1 (the AWS build): CUTOVER.md step 9, prepared

Written Nov 5, 2026 (App Store, web & builds), after Apple approved 1.0 and it was held as Pending Developer Release.
Nothing here has been done in App Store Connect. Caleb or Salik does each step there; App Store, web & builds keeps
this file and the handoff doc ("homecookd App Store submission for Salik") in step. The listing text and screenshot plan
are in `LISTING-1.1.md`.

## Caleb's morning: submit 1.1 in ten minutes (CUTOVER.md step 9)

Do these in order. Section 1 explains why the steps go this way; sections 3 and 4 hold the text to paste.

**Before App Store Connect:**

1. On your phone: TestFlight → homecookd → install **1.0.0 (17)** and use it with your own account as usual (Home, a
   recipe, film something short). If anything's wrong, stop here and tell the Master Agent.
2. On the Mac, copy the reviewer link. In a homecookd Claude chat, type `! pbcopy < docs/build/.test-family-link` (or in
   Terminal: `pbcopy < ~/GitHub/homecookd/homecookd/docs/build/.test-family-link`). Paste it into a note in Notes on your
   phone (Universal Clipboard) and tap it. homecookd opens on **"You're in <your family>. Join Test family instead?"**.
   Close it without joining: joining would move your account into the reviewer's family. Don't use Safari's address
   bar for this: typed there, the link opens the website, whose /i still asks the old backend until CUTOVER step 10.

**In App Store Connect:**

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** → **homecookd** → in the sidebar under iOS
   App, **1.0 Pending Developer Release**.
2. In the banner at the top, click **remove this version from review**, then **Remove**. The status becomes
   **Developer Rejected**. 1.0 was never on sale, so nothing public changes.
3. Scroll to **Build**. Hover over build 6 and click the red **−** to remove it. Click **Add Build** (or **+**), pick
   **17**, then **Done**.
   **If 17 isn't offered, stop.** Send Apple the message in section 1 from **Contact Us** (App Review), and tell the
   Master Agent. Nothing else needs to be undone.
4. **Previews and Screenshots** → the **6.9" Display** tab. Delete 1.0's seven (hover over each → ×). Then drag in the
   seven from `docs/app-store/screenshots/1.1/` in name order, 01 to 07. If any other iPhone size tab still has 1.0's,
   delete those too. Apple scales the 6.9" ones down.
5. Paste from `LISTING-1.1.md`: **Promotional Text** and **Description**. Keywords stay as they are. There's no "What's
   New" box on an app's first version, so skip it. Its text waits for the next update.
6. **App Review Information:** uncheck **Sign-in required**. Replace **Notes** with section 3's text. Copy the link again
   (the same `pbcopy` command) and paste it where it says `<TEST JOIN LINK>`. The contact fields stay.
7. **App Store Version Release:** leave **Manually release this version** selected. Then **Save** (top right).
8. Sidebar → **App Privacy** → **Edit** under Data Types. Check **Diagnostics → Other Diagnostic Data**, then answer:
   App Functionality, **not** linked to the user, **not** used for tracking. **Save**, then **Publish** (section 4).
9. Back to **1.0**. Click **Add for Review**, then **Submit to App Review**. The status should read **Waiting for
   Review**.
10. Tell the Master Agent "submitted". When Apple approves, it waits for you to press Release.

## 1. How 1.0's pending release becomes the 1.1 submission

App Store Connect won't start a new version while 1.0 waits as Pending Developer Release (CUTOVER.md, open question 1),
so the AWS build goes into **the same version, 1.0.0, with a new build number**. `app/app.json` already says 1.0.0, and
`runtimeVersion` follows it, so nothing in the app changes for this.

**Apple's documented path** ([Remove a submission from review](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review/), App Store Connect Help, read Nov 5):

1. Apps → homecookd → the 1.0 version in the sidebar.
2. In the banner at the top, click **remove this version from review**, then **Remove**. Apple lists Pending Developer
   Release among the states this works from. 1.0 becomes **Developer Rejected**; it was never on sale, so nothing public
   changes.
3. The version is editable again: in Build, remove build 6 and pick the step-8 production build (1.0.0, its new number).
4. Paste the 1.1 listing (`LISTING-1.1.md`), screenshots, reviewer notes (section 3) and App Privacy change (section 4).
5. Check **Manually release this version** is still set, then **Add for Review** and **Submit**. Review starts over.

Not "Cancel This Release" ([release options](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/)): that only stops a release, it doesn't open the version for a new build.

**Risk, and the fallback.** Developer forum threads from past years report versions that got stuck after a developer
reject, unable to take a build, and only Apple Support fixed it ([one](https://developer.apple.com/forums/thread/821386),
[another](https://developer.apple.com/forums/thread/53463)). Apple's help page doesn't mention this. If step 3 offers no
build, stop and send Apple the question below (App Store Connect → Contact Us → App Review / Distribution). It's
Caleb's or Salik's to send, from their account:

> Our app homecookd (Apple ID 6825621614) version 1.0 was approved and is Pending Developer Release, set to manual
> release. We never released it. We've rebuilt the app's backend and want version 1.0's first public release to be
> a newer build. We removed the version from review as described in "Remove a submission from review", and it now shows
> Developer Rejected, but we can't select our new build (1.0.0, build 17). Could you confirm the supported way to
> submit a new build for this same version, or whether we should create version 1.1 instead?

The other way out, if Apple says so: release nothing, and create version 1.1 once 1.0 is Developer Rejected. Then
`app/app.json` goes to 1.1.0 by PR first (the update channel follows the version).

## 2. What has to exist before Submit

| Needed | Who | State on Nov 7 |
|---|---|---|
| The step-8 production build, proven on a phone (CUTOVER.md step 8) | App screens & recording | Build 17 (`production-aws`, main `f49ef7ba7`), on App Store Connect Nov 7 at 13:19 PT, TestFlight internal, on no version yet. It's build 15 (which Caleb phone-checked, PRODUCTION-CHECKLIST.md) plus #382, #388 and #392; Caleb re-checks 17 for five minutes before submitting. 13, 14 and 16 never made a build, so pick 17 |
| The TEST family on production: Mom, Dad, Grandma, Leo, Maya, Reviewer, and Chicken Biryani (step 7) | AWS backend | Made Nov 7: "Test family", with all six people (Mom, Dad and Grandma cook; Leo, Maya and Reviewer learn). The Chicken Biryani is a real production job, ready at 09:32Z with 13 steps, its video and poster served from media.homecookd.app |
| The reviewer's join link that never expires, on production | AWS backend | Made Nov 7, in the gitignored `docs/build/.test-family-link` (main checkout), never in a tracked file or a chat. Checked Nov 7 on `api.homecookd.app/invites/peek`: pending, no expiry, family "Test family", so the card reads "Join Test family". To turn it off: `node dist/reviewerLink.js revoke <family id>` (infra/README.md 8.3) |
| A request already waiting in the TEST family ("Leo wants your Sunday eggs"), so the reviewer sees it without a second phone | AWS backend, with the family | Sent Nov 7: Leo asked Mom "Will you teach me your Sunday eggs?" through the app's own request |
| The APNs key on Expo, so pushes are real | Salik (LAUNCH-LINKS.md 6c) | Done Nov 6: key `S3J2G3P3H3` on Expo |
| App Privacy: Diagnostics added (section 4) | Caleb or Salik | Not done: the morning section, step 8 |
| The listing and seven screenshots (`LISTING-1.1.md`) | Caleb or Salik; App screens shoots | Text written (#355). Screenshots shot Nov 6 (#374), framed and captioned Nov 7 in `screenshots/1.1/`; 06 may be reshot (its README) |

## 3. Reviewer notes for 1.1

Replaces 1.0's notes in App Store Connect (App Review Information → Notes). `<TEST JOIN LINK>` is the production link
in the gitignored `docs/build/.test-family-link` (main checkout). It's pasted into App Store Connect only, never into
this file or a chat. Wording matches the app's consent sheet (#357) and /privacy (#354, #358).

```text
homecookd turns a family member's cooking into a recipe the rest of the family can follow.

HOW TO SIGN IN
The app has no passwords. You join our test family with its link and your own Apple ID:
1. On the review device, tap this link (from a note or a message): <TEST JOIN LINK>
   It opens homecookd on "Join Test family". Or copy the link and open homecookd: it picks the link up by itself.
   Please don't type it into Safari's address bar: that opens our website, not the app.
2. Type any name, pick "I cook" to see the cook's side (or "I miss the food" for the family's side), then tap Sign in with Apple.
3. You're in the test family, with its recipes (Chicken Biryani) and the faces of Mom, Dad, Grandma, Leo and Maya.

WHAT TO TRY
- As a cook: Home shows "Leo wants your Sunday eggs", a request from his kid. Open it to see Leo's guess, then "Film it next time you make it" (with a reminder) or "Tell Leo how you make it now" (a 2-minute voice version).
- Record a dish with the camera, or answer a family question with a voice note.
- Open a recipe. Each step plays the moment from the cook's video, and the cook's words stay in the recipe.
- The family's side starts on the web: homecookd.app/miss (no account) names a dish and sends Mom a link she answers by voice.
- The first time you film, upload a video, record a voice answer or send a request, a short sheet "homecookd uses AI for this" names the AI services: Anthropic Claude watches your videos and photos, writes the recipe, and translates your family's questions into your language; Cartesia writes down what you say in your videos and voice notes. Tap "OK, continue" to allow it, or "Not now" to cancel that action without sending anything.

PRIVACY AND SAFETY
- Nothing is sent to an AI service until the person taps "OK, continue"; "Not now" cancels. Signing out withdraws it.
- Delete account: tap your name at the top of Home, then "Account & privacy", then the red "Delete my account". It asks first, then deletes your account, messages and voice notes, and your recipes.
- The privacy policy and terms are linked from "Account & privacy" and the sign-in screen.
- Dishes stay inside the family: this version has no screen for browsing other families' dishes. A cook can choose to share a recipe's text with people nearby (off by default, never her video or voice), and shared text is filtered for objectionable words. Where a family is invited to another family's dinner, the dinner page has "Report or block": a report emails our team within minutes and hides the item for the reporter, and reports from two families hide it for everyone.
- The camera and microphone are used only while someone is filming or recording a voice note.

Contact: team@homecookd.app
```

**Sign-in fields.** 1.0 had "Sign-in required" checked with the family code. 1.1 has no code and no shared account: the
reviewer uses their own Apple ID. Default: **uncheck "Sign-in required"** and give the link in the notes above.
`TODO(caleb)`: or keep it checked and put the join link in the user name field. Apple doesn't say which it prefers for
Sign in with Apple only.

**Not in 1.1's notes any more:** the family code, "Have a family code?", the "Who's in the kitchen?" faces to pick,
"Reviewer" to delete, hands-free cooking ("Tap Cook…", "say next"), and Moss and Gemini.

## 4. App Privacy (App Store Connect → App Privacy)

From #354: add **Diagnostics → Other Diagnostic Data**, collected, **not linked** to the user, **not** used for
tracking, purpose **App Functionality** (Sentry's server error reports). Everything else stays as published: Name,
Email, Phone, Coarse Location, Messages, Photos or Videos, Audio, Other User Content, User ID, Device ID (App
Functionality); Product Interaction (App Functionality, Personalization, Analytics); all linked, none for tracking.
AWS is a service provider, not a data type. Privacy policy URL unchanged.

## 5. App Review guard, per guideline

- **2.1 Completeness / demo access:** the reviewer gets in with the TEST family's link that never expires and their
  own Apple ID, and finds a request waiting, so every screen in the notes and screenshots is reachable on one phone.
  The link opens the app as a universal link (`/i` is in homecookd.app's apple-app-site-association), and a signed-out
  app picks up a copied one. Until CUTOVER step 10 the website's own `/i` page asks the old backend, so the notes ask
  the reviewer to tap the link, not type it into Safari.
- **2.3 Accurate metadata:** the listing, screenshots and notes describe 1.1 only (`LISTING-1.1.md`); no voice cooking.
- **4.8 Login services:** on iOS, Sign in with Apple is the only way in (`ProviderButtons.tsx`: Google shows on
  Android only).
- **5.1.1(i) / (v):** /privacy names every company that stores data (#354); Delete account is two taps from Home and
  deletes for good.
- **5.1.2(i):** the consent sheet, /privacy and the notes name the same AI services for the same jobs (#357, #358); the
  AWS build sends nothing to Moss or Gemini.
- **1.2 User-generated content:** in 1.1 no one can browse other families' dishes (the kid's Community tab is hidden; the
  parent's tabs are Home, Messages, Recipes), so the notes don't send the reviewer to screens they can't reach. A cook
  can still turn on "Share with people nearby" on her own recipe (`components/community/ShareNearbyRow.tsx`), and the
  shared text passes the word filter. Another family's content shows only on a dinner invite, which has Report or
  block, and reports email the team (`docs/build/contracts/COMMUNITY.md`). The fix for 1.2 (a "Dishes near you"
  section behind a switch with a seeded neighbour family, or Report or block on the /d invite screen) is on the
  tracker for Caleb to pick.

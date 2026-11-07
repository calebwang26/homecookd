# Releasing 1.0, then submitting 1.1 (the AWS build) as an update: CUTOVER.md step 9

Written Nov 5, 2026 (App Store, web & builds), after Apple approved 1.0 and it was held as Pending Developer Release.
Rewritten Nov 8 for Caleb's path: release 1.0, then submit 1.1 as an update. Nothing here has been done in App Store
Connect. Caleb or Salik does each step there; App Store, web & builds keeps
this file and the handoff doc ("homecookd App Store submission for Salik") in step. The listing text and screenshot plan
are in `LISTING-1.1.md`.

## Caleb's day: release 1.0, then submit 1.1 as an update (CUTOVER.md step 9)

Caleb's call, Nov 8: release 1.0 (build 6, the old backend) now, and send the AWS build to Apple as **version 1.1**, an
update, rather than cancel 1.0's pending release. Apple reviewed 1.0 as a new app, which took a week; an update is
usually quicker. Section 1 says what this means for the people who join on 1.0. Sections 3 and 4 hold the text to paste.

**A. Release 1.0 (two minutes)**

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** → **homecookd** → in the sidebar under iOS
   App, **1.0 Pending Developer Release**.
2. Click **Release This Version** (top right) and confirm. The status goes to **Processing for App Store**, then **Ready
   for Distribution**. Apple says the app can take up to 24 hours to show in the store.
3. What the public sees for now is 1.0's approved listing (Nov 5): its text and its seven screenshots in
   `docs/app-store/screenshots/` (01 to 07, the pre-egg UI, hands-free cooking on 03 and 04). That's accurate for build 6,
   which has homie's voice. Leave the listing as it is until 1.1 replaces it.

**B. Before 1.1 goes in**

1. The Master Agent builds **1.1.0 (18)** (`production-aws`) from main once the version PR merges, and tells you when
   it's on TestFlight. On your phone: TestFlight → homecookd → install **1.1.0 (18)**. It's build 17 with the new
   version number, so a quick look is enough: Home, a recipe, a heart.
2. On the Mac, copy the reviewer link. In a homecookd Claude chat, type `! pbcopy < docs/build/.test-family-link` (or in
   Terminal: `pbcopy < ~/GitHub/homecookd/homecookd/docs/build/.test-family-link`). Paste it into a note in Notes on your
   phone (Universal Clipboard) and tap it. homecookd opens on **"You're in <your family>. Join Test family instead?"**.
   Close it without joining: joining would move your account into the reviewer's family. Don't use Safari's address
   bar for this: typed there, the link opens the website, whose /i still asks the old backend until CUTOVER step 10.

**C. Submit 1.1 (about ten minutes)**

1. Wait until 1.0 shows **Ready for Distribution**. Then, in the sidebar next to **iOS App**, click **+** (or **+
   Version**) and type **1.1.0**, the same as the build's version, then **Create**.
2. **Build:** click **Add Build** (or **+**), pick **18**, then **Done**. If 18 isn't there yet, it's still processing
   at Apple; wait for the Master Agent's word.
3. **Previews and Screenshots** → the **6.9" Display** tab. A new version starts with 1.0's screenshots: delete those
   seven (hover over each → ×), then drag in the seven from `docs/app-store/screenshots/1.1/` in name order, 01 to 07.
   If another iPhone size tab still has 1.0's, delete those too. Apple scales the 6.9" ones down.
4. Paste from `LISTING-1.1.md`: **Promotional Text**, **Description** and **What's New in This Version**. Keywords stay
   as they are.
5. **App Review Information:** uncheck **Sign-in required**. Replace **Notes** with section 3's text. Copy the link again
   (the same `pbcopy` command) and paste it where it says `<TEST JOIN LINK>`. The contact fields stay.
6. **App Store Version Release:** pick **Manually release this version**. Then **Save** (top right).
7. Sidebar → **App Privacy** → **Edit** under Data Types. Check **Diagnostics → Other Diagnostic Data**, then answer:
   App Functionality, **not** linked to the user, **not** used for tracking. **Save**, then **Publish** (section 4).
8. Back to **1.1.0**. Click **Add for Review**, then **Submit to App Review**. The status should read **Waiting for
   Review**.
9. Tell the Master Agent "submitted". When Apple approves, 1.1 waits for you to press Release.

## 1. What releasing 1.0 first means

- **Anyone who joins on 1.0 starts over on 1.1.** Build 6 runs on the old backend (Convex, the Supabase api), and 1.1
  starts fresh on AWS. When 1.1 lands, a 1.0 family, its recipes and its messages don't come with it. So **no marketing,
  no invites to new families, until 1.1 is live.**
- **1.0's backend stays up until then:** Convex `grand-dragon-649` and its worker, the Supabase `api` edge function,
  Cloud Run's voice service and upload signer, and the GCS buckets. Turning any of it off breaks the public app. When it
  can go after 1.1 is CUTOVER.md's call (and Caleb's).
- **1.0 and 1.1 get separate updates.** `runtimeVersion` follows the app version (`app/app.json`, `appVersion`), so an
  EAS Update made for 1.1.0 never reaches build 6, and the reverse. `scripts/safe-eas-update.sh` still refuses the
  production channel.
- **The path we didn't take** (Nov 5–7): remove 1.0 from review and put the AWS build into version 1.0.0. It would have
  restarted a first-version review, and forum threads report versions stuck after a developer reject. It's no longer
  needed, and nor is the Apple Support message written for it.

## 2. What has to exist before Submit

| Needed | Who | State on Nov 7 |
|---|---|---|
| The step-8 production build, proven on a phone (CUTOVER.md step 8) | App screens & recording | Build 18, version **1.1.0** (`production-aws`), built by the Master Agent once the version PR merges: build 17 (main `f49ef7ba7`, Caleb's re-check) plus the version number. 13, 14 and 16 never made a build |
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

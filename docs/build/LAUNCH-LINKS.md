# TestFlight / App Store: links that open the app

**Goal:** Mom texts an invite, Dad taps it, the homecookd app opens on "Join Mom's family table?". No pasting, no codes.

The code is ready. Three values and one build are missing, and they all come from the Apple developer account.

## Already done in the repo
- `app/app.config.ts` claims `homecookd.app` and `www.homecookd.app` links (`associatedDomains`) and turns on Sign in with Apple.
- The app's invite and recipe screens open from `https://homecookd.app/i?t=…` and `/r?s=…` links.
- `homecookd.app/.well-known/apple-app-site-association` is live with status 200 as `application/json` and no redirect. It only holds the placeholder `TEAMID.BUNDLEID`.
- `app/eas.json` has a production build and submit set up, plus `preview` (internal) for testing pushes (6b).
- The app's API and media defaults are public, so a store build needs no `.env`.

## 1. From the Apple developer account
1. **Team ID:** developer.apple.com → Account → Membership. It's 10 letters and digits, like `ABCDE12345`.
2. **Bundle ID:** the App ID of the iOS app, like `app.homecookd`. If a TestFlight build already exists, reuse its bundle ID.
3. Under **Certificates, Identifiers & Profiles → Identifiers → that App ID**, turn on:
   - **Associated Domains**
   - **Sign in with Apple**
4. **App Store Connect:** create an app record with that bundle ID, if there isn't one yet.

## 2. Put the IDs in the repo (one command)
```bash
node scripts/set-apple-ids.mjs --team ABCDE12345 --bundle app.homecookd
```
This fills `app/app.config.ts`, the website's `apple-app-site-association` and the api's `APP_BUNDLE_ID`. Commit the change on a branch, open a PR and merge it. Vercel redeploys the website, then check:
```bash
node scripts/set-apple-ids.mjs --check --team ABCDE12345 --bundle app.homecookd
```

## 3. Apple sign-in in store builds (no redeploy)
In **Supabase → Edge Functions → Secrets**, set:
```
APPLE_AUDIENCES = app.homecookd,host.exp.Exponent
```
It works right away. The api's built-in default picks up the bundle ID on its next deploy, whoever does that.

## 4. Build from this repo with EAS
The current TestFlight build, if there is one, was made outside this repo, so it has none of this.
```bash
cd app
npx eas-cli login      # the Expo account that should own the app
npx eas-cli init       # adds the EAS project id to the app config: commit it
npx eas-cli build -p ios --profile production   # EAS handles certificates with the Apple account
npx eas-cli submit -p ios --latest              # uploads to App Store Connect / TestFlight
```
- **Google sign-in:** optional. Set `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` as an EAS environment variable before building. Without it the Google button just hides.

## 5. TestFlight
- **Internal testers:** people on the App Store Connect team can install right away, with no review. Add them under TestFlight → Internal Testing.
- **External testers and the public link:** these need Beta App Review once. When the public link exists:
  1. Set `NEXT_PUBLIC_APP_STORE_URL` to it in **Vercel → Project → Settings → Environment Variables** (Production).
  2. Redeploy. The website's "Get the app" button then opens TestFlight instead of saying "early testing".

## 6. Test it on a phone with the new build
1. In the app, "Invite family :)" → Messages → send it to yourself.
2. Tap the link in Messages. **The app should open on "Join …".**

If it opens the website instead:
- **Some places never open the app.** A link typed into Safari's address bar, or tapped from a page on homecookd.app itself, always opens the website. Test from Messages or Notes.
- **Apple caches the association file.** After the first install it can take a while. Delete and reinstall the app to refresh it.
- **Diagnostics:** Settings → Developer → Universal Links → Diagnostics, then enter the link. This needs Developer Mode on.

## 6b. Push notifications (retention, docs/build/RETENTION-HANDOFF.md 2.3)
Pushes ("Mom: Dinner at 6?", "Just in from Dad", "Leo asked about Sunday Chili") need a real build;
Expo Go can't get a push token for this project, and the app never asks for notifications there.
- **Needs:** the EAS project id from `npx eas-cli init` (step 4) and the bundle id (step 2). Push
  credentials (the APNs key) are created by EAS during `eas build -p ios` when it asks, or with
  `npx eas-cli credentials -p ios`. Without the project id the app quietly never asks.
- **No `development` profile and no `expo-dev-client`:** installing expo-dev-client makes
  `npx expo start` open a dev build instead of Expo Go, which would break the Expo Go habit. Test
  pushes on a `preview` build instead (`npx eas-cli build -p ios --profile preview`, internal
  distribution: install it from the link EAS prints; register the phones first with
  `npx eas-cli device:create`) or on TestFlight (step 5).
- **Deploy the server first:** the api (with `x-tz` allowed and the retention migration applied,
  docs/build/API.md "Checks") goes live before any build that has push.
- **Test (two phones in the test family, never the demo family):** sign in on both; on the kid's
  phone tap "I made it" on the cook's dish, then Yes on "Want a note when Dad answers?" and Allow.
  Then text the kid from the cook's phone: the push arrives within seconds and tapping it opens that
  chat. Signing out of the kid's phone removes its token (no more pushes).
- **Cook mode keeps the screen on:** check it on the same build (dev builds always keep it on).

### 6c. The APNs key (found missing Nov 3; closed Nov 6)
**Closed Nov 6:** Salik made APNs key `S3J2G3P3H3` (team `73UV499FKN`; it also serves Sign in with Apple) and it is on
Expo for `com.salik.homecookd`, checked on Expo's credentials the same day. Pushes to every build of this bundle id can be
delivered now; the check below (a test message arriving on a phone) runs on build 12's phone check. The rest of this
section is the Nov 3 write-up, kept for the record.

On the build 11 phone run the token reached the api and the message reached Expo, but Expo answered
"Could not find APNs credentials for com.salik.homecookd". No iOS push can be delivered until the key is added.
- **What's there:** Expo project `@salikm1234/app`, bundle `com.salik.homecookd`, Apple team `73UV499FKN`
  (Salik Mian, Individual): no push key. The Expo account's only APNs key (`YVY2H4MHZU`) is on a different
  Apple team (`SVZ9ABX4SM`) for another app; a key works only for its own team, so it can't be reused.
  Whether Salik's Apple account already has an APNs key needs his login to check. One whose `.p8` nobody kept is
  no use (Apple lets you download it once), so making a new one is simplest.
- **No new build:** builds 6 (1.0, in review) and 11 are both signed with `aps-environment = production` for
  `73UV499FKN.com.salik.homecookd` (read from the downloaded builds' entitlements). The key lives on Expo, not in
  the binary: no rebuild, no OTA update, no App Store Connect change. Tokens phones already sent start working,
  and one key covers every build of this bundle id (production, staging, aws-staging).
- **Cost:** none; APNs keys come with the Apple Developer membership.
- **Who:** Salik's Apple ID. An Individual team has no other members who can make keys.

**A. One command, Salik signs in.** On a Mac logged in to Expo as the project's account:
1. `cd app && npx eas-cli credentials -p ios`, any build profile (all share `com.salik.homecookd`).
2. "Push Notifications: Manage your Apple Push Notifications Key" → "Set up your project to use Push Notifications".
3. Log in to the Apple account: Salik's Apple ID, password and the 2FA code; team `73UV499FKN`.
4. "Generate a new Apple Push Notifications service key?" → Yes. EAS makes the key in his Apple account and stores it on Expo.
5. Done when the summary lists a Push Key with a Key ID.

**B. Salik on the web.**
1. developer.apple.com → Account → Certificates, IDs & Profiles → Keys → "+".
2. Name it "homecookd push", tick "Apple Push Notifications service (APNs)". If it asks, pick "Sandbox & Production"
   and "Team Scoped (All Topics)". Continue → Register.
3. Download the `.p8` (once only) and note the Key ID. The team ID is `73UV499FKN`.
4. expo.dev → salikm1234 → project "app" → Credentials → iOS → `com.salik.homecookd` → Push Key → Add: upload the
   `.p8` and enter the Key ID. Or send the `.p8` to Caleb privately and he adds it with step A's menu ("Use an
   existing key"). Never put it in the repo or a chat.
5. If Apple says the APNs key limit is reached, revoke an unused APNs key on the same Keys page first.

**Check after:** resend a test message to a phone on build 11. Expo accepts it with no "Could not find APNs
credentials" error, and it arrives.

**Note:** this turns push on for 1.0 the moment the key lands. Any pushes the live backend sends start arriving on
reviewers' and testers' phones too.

## 7. After it works
- **Security:** remove `host.exp.Exponent` from `APPLE_AUDIENCES`, and from the api code default (`EXPO_GO_BUNDLE_ID`, marked `TODO(security)`). Any Expo Go project can get Apple tokens for that ID. Expo Go's Apple sign-in stops working after that, which is fine once TestFlight works.

## Not covered here
- **Android:** needs `android.package`, a signing key fingerprint and `/.well-known/assetlinks.json`.

# The 1.1 update card (Caleb, Nov 10, 2026)

**The decision.** Caleb, in the Master Agent's tab: "Also add an update check to 1.1 for next time." He described it as
an "Update homecookd" card with a "Later" option and a button to the App Store. The card is not built for 1.0: the Master
counted 1.0 use first, and it was zero to two phones, so nothing goes to the `production` channel.

**What it is** (`app/src/lib/appUpdate.ts`, `app/src/components/update/AppUpdateCard.tsx`):
- A card on parent Home (under "Record a new recipe", which stays first) and kid Home (under the header). It is never a
  blocking screen.
- It shows only when Apple's public lookup (`https://itunes.apple.com/lookup?id=6825621614`) has a newer version than
  this phone's own build, which is expo-updates' `runtimeVersion` (the native version under the appVersion policy).
  A TestFlight build or one in App Review is newer than the store, so it never sees the card.
- "Later" hides it for 7 days (`SNOOZE_MS`, `TODO(caleb)` on the number) or until a newer store version appears.
- One check per launch, after Home shows. Offline, slow (5 s), bad JSON or an unknown version means no card.

**Why Apple's lookup, not a value we control:** it needs no production change, no one has to remember to flip it at each
release, and it can't ask people to update to a version that isn't out yet.

**How to apply:** change the card's words, place or snooze only with Caleb's word. Caleb sees the screen before it ships,
and it reaches phones only with his own yes for an update. If the policy in app.json's `runtimeVersion` ever changes from
appVersion, revisit `ownVersion()`: a fingerprint reads as unknown, so the card would simply never show.

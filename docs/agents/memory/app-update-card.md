# The 1.1 update popup (Caleb, Nov 10, 2026)

**The decision.** Caleb, in the Master Agent's tab: "Also add an update check to 1.1 for next time." He described it as
an "Update homecookd" card with a "Later" option and a button to the App Store. It is not built for 1.0: the Master
counted 1.0 use first, and it was zero to two phones, so nothing goes to the `production` channel.

**Then a popup, not a card (Nov 10, ~19:55 PT).** He saw kid Home with and without the card, then typed in the Master's tab:
- "I want it to be a popup that grays out the background instead of being like a popup inside the current layout, if that makes sense"
- "Or not grays out, but makes it more, makes the background like, the background of the popup is like blurry glass. And then so that the popup stands out and the popup should be in the middle of the screen"

The second message wins: blurred glass behind it (a light blur, not a grey-out) and the popup in the middle of the
screen, on both Homes. Home's own layout no longer moves: "Record a new recipe" and "Start cooking" stay where they are.

**What it is** (`app/src/lib/appUpdate.ts`, `app/src/components/update/AppUpdatePopup.tsx`):
- A centred popup on parent Home and kid Home: "Update homecookd", one line, Update (opens homecookd in the App Store)
  and Later. It is a `BottomSheet` with `placement="center"`, so its Modal goes through the sheet coordinator
  (`lib/sheets`) like every sheet's.
- It shows only when Apple's public lookup (`https://itunes.apple.com/lookup?id=6825621614`) has a newer version than
  this phone's own build, which is expo-updates' `runtimeVersion` (the native version under the appVersion policy).
  A TestFlight build or one in App Review is newer than the store, so it never sees it.
- It is the lowest sheet on Home (`popupShows`): it comes up only on its Home on screen, after the launch bloom, when no
  other sheet's Modal is up; and it gives way to any sheet that wants to present ("Dad is on a new phone", the push ask),
  coming back once that has gone. No timer. The first-run language choice and sign-in come before any Home, so it never
  covers them.
- Never blocking: "Later" always closes it, for 7 days (`SNOOZE_MS`, `TODO(caleb)` on the number) or until a newer store
  version appears. A tap on the glass is "Later" too, saved the same (`TODO(caleb)`: the other choice is that it does nothing).
- One check per launch, after Home shows. Offline, slow (5 s), bad JSON or an unknown version means no popup.

**Why Apple's lookup, not a value we control:** it needs no production change, no one has to remember to flip it at each
release, and it can't ask people to update to a version that isn't out yet.

**How to apply:** change the popup's words, look, place or snooze only with Caleb's word. Caleb sees the screen before
it ships, and it reaches phones only with his own yes for an update. If the policy in app.json's `runtimeVersion` ever
changes from appVersion, revisit `ownVersion()`: a fingerprint reads as unknown, so the popup would simply never show.

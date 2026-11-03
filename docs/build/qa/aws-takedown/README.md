# The team's takedown and share off on AWS staging (Nov 3, 2026)

How to run these proofs again: [../AWS-PROOFS.md](../AWS-PROOFS.md).

The app's web build (375×812) with `EXPO_PUBLIC_BACKEND=aws` against staging, as one test cook with one shared test
recipe. AWS backend took it down with the same `reviewReport(recipe, id, remove)` the team's `reports.js` runs, as a
one-off with no report filed, so no alert email. Then it ran `keep`.

1. Before: her recipe page, "Share with people nearby · On".
2. Taken down (`hiddenAt` set): "Share with people nearby · Off the map", with "Our team took this recipe off the map
   after a report. It stays with your family." The row can't be tapped.
3. After `keep`: the plain switch again, "Off". The recipe stays off the map until she shares it.
4. Her tap (after the AI notice) shares it again, and the row reads "On" at once. Before this PR it fell back to "Off"
   until the app came to the front again.

`aws-takedown-flows.mjs` checked the same through the app's client:
- **Taken down:** `hiddenAt` set, `sharedAt` cleared, `takenDown: true` in the share chooser's list, and sharing again
  answers 409 `taken_down`, in the app's words.
- **Kept:** all of those cleared, and her tap shares it again.
- **Share off (#330):** `POST /v1/recipes/:id/unshare` takes it off. A second call is fine, and her tap puts it back.

The share chooser itself (Community's "Share your recipe") isn't reachable for a cook in the web build, so its line,
"Our team took it off the map after a report.", is proven by `test-community-ui`. The test cook was deleted afterwards.

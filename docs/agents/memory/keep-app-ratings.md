# Keep the app's ratings on every version (Caleb, Nov 8, 2026)

Every new App Store version keeps homecookd's star rating and count. In App Store Connect, each version's **App Store
Version Release** section has a **Reset summary rating** option; it's off by default, and it stays off.

**Why:** Caleb asked that each release "retain the amount of stars". A reset clears the star average and count in every
country (written reviews stay either way).

**How to apply:** whoever fills a version in App Store Connect leaves the option unticked, and says so in the submission
record. The submit steps say it (`docs/app-store/SUBMIT-1.1.md`, part C step 6). 1.1.0 went out with it unticked.

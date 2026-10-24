---
name: no-testflight-yet
description: "As of Oct 17 2026 there is no TestFlight build, so invite/recipe links can't install or open the app; how to test those flows anyway"
metadata:
  type: project
---

As of 2026-10-17 homecookd has no current TestFlight build (Caleb still has to supply the bundle id, Team ID and a store link). So:
- "Get the app" on homecookd.app/i and /r has no store link: it says homecookd is in early testing (`NEXT_PUBLIC_APP_STORE_URL` unset).
- Tapping a homecookd.app/i or /r link in Messages never opens the app: universal links need AASA `TEAMID.BUNDLEID` and a signed build.
- The app runs only in Expo Go (port 8093 server). Apple sign-in works there (`host.exp.Exponent`); Google sign-in needs a dev build.

**Why:** Caleb flagged this as a limitation for testing (synthetic QA agents, demos): the invite-to-download handoff can't be exercised yet.

**How to apply:** treat dead "Get the app" / store links as a known gap, not a finding. Test invites in two halves: the live web page up to "Get the app", then inside the app via an Expo Go deep link (`exp://<host>/--/i?t=…&c=…`, the simulator's open_url) or the first screen's "Paste invite" / 6-letter code. Report the tap-link → install → open-with-invite step as untested. Revisit once TestFlight exists.

Related: [[dual-icp-playbook]]

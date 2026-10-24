---
name: testflight-live
description: "Since Oct 23 2026 homecookd has a working Apple developer account and TestFlight; dev build while coding, TestFlight for the team and the demo"
metadata:
  type: project
---

As of 2026-10-23 Caleb has an Apple developer account and TestFlight running (before that, from Oct 17, there was no build and the app ran only in Expo Go).
- The hackathon stack needs native modules (live mic streaming, maybe Meta's glasses kit), and Expo Go can't load them.
- Use an EAS dev build while coding, TestFlight for teammates, judges and the demo, and EAS Update to push JS-only fixes to TestFlight phones without a new build.
- Universal links (`/i`, `/r` opening the app) still need the AASA file with the real `TEAMID.BUNDLEID` (`node scripts/set-apple-ids.mjs`). Until that's deployed, test invites in two halves: the web page up to "Get the app", then in the app via the "Paste invite" / 6-letter code.

**Why:** Caleb said so on Oct 23, during the 2-day hackathon, when he asked whether TestFlight could replace Expo Go.

**How to apply:** don't treat "no build" as a known gap any more. Plan features that need native code. Add judges and teammates as internal testers early, because external testers need Apple's beta review first.

Related: [[hackathon-stack-oct23]], [[dual-icp-playbook]]

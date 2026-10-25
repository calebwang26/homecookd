---
name: never-signed-out-by-a-crash
description: "Oct 24: a crash, a relaunch or a passing error never signs anyone out or loses a recording; only Sign out or the server's exact 'This phone was signed out.' may"
metadata:
  type: feedback
---

On 2026-10-24 Caleb, on TestFlight build 5: "right when it finished recording or asking the questions, it said
great, whatever sending to family, and then suddenly the app crashed and logged me out". He asked for the cause
and the fix. The crash was the in-app camera's clip uploading from a file that wasn't there any more
(`File.move()` is async in expo-file-system 57); the relaunch then opened the phone as its owner, not the cook who
had been recording, which looked like being logged out.

**Why:** the people filming are parents in their 50s and 60s. If a crash signs them out or loses grandma's
recording, they won't record again.

**How to apply:**
- Only two things may forget this phone's key: the person's own "Sign out" (`leaveFamily`), and a 401 whose
  error is exactly "This phone was signed out." (`isSignedOutAnswer` in `app/src/lib/api.ts`). Any other 401, a
  500, no network or a keychain that can't be read (a locked phone, a launch in the background) keeps the key and
  the cached family, and tries again later.
- A recording filmed in the app keeps a note on the phone (`app/src/lib/unsentRecordings.ts`) from "I'm done"
  until Convex has its job. After a crash, the next launch opens as that cook and their Home sends it
  (`components/record/useResendUnsent.ts`). The videos stay in `documents/recordings/<id>/`, never in tmp.
- Never start a native upload from a file you haven't checked is there (`fileOnPhone`): iOS throws an exception
  JS can't catch and the app closes. Every expo-file-system `move()`/`copy()` is awaited or the `*Sync` one
  (`scripts/test-recording-ui.mjs` checks the whole `app/src`).

Related: [[in-app-recording]]

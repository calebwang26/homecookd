---
name: never-signed-out-by-a-crash
description: "Oct 24: a crash, a relaunch or a passing error never signs anyone out; only Sign out or the server's exact 'This phone was signed out.' may. An in-app recording the app dies on after 'I'm done' is sent again"
metadata:
  type: feedback
---

On 2026-10-24 Caleb, on TestFlight build 5: "right when it finished recording or asking the questions, it said
great, whatever sending to family, and then suddenly the app crashed and logged me out". He asked for the cause
and the fix. The crash was the in-app camera's clip uploading from a file that wasn't there any more
(`File.move()` is async in expo-file-system 57; hotfix #77). The relaunch then opened the phone as its owner, not
the cook he had picked, which looked like being logged out: the phone stayed signed in.

**Why:** the people filming are parents in their 50s and 60s. If a crash signs them out or loses grandma's
recording, they won't record again.

**How to apply:**
- Only two things may forget this phone's key: the person's own "Sign out" (`leaveFamily`), and a 401 whose
  error is exactly "This phone was signed out." (`isSignedOutAnswer` in `app/src/lib/api.ts`). Any other 401, a
  500 or no network keeps the key and the cached family. A keychain that can't be read while the app isn't in
  front (a locked phone, a launch in the background) is read again when it comes to the front; in front, one that
  keeps failing falls back to the sign-in screen rather than a stuck phone. New keys are saved readable from the
  first unlock (`saveKey`); keys saved before Oct 24 keep "while unlocked" (the keychain can't change that in place).
- A recording filmed in the app keeps a note on the phone (`app/src/lib/unsentRecordings.ts`) from "I'm done"
  until Convex has its job and every file is uploaded. If the app dies before both (a crash, a swipe-away
  mid-upload), the next launch sends it again in the background as that cook, whoever is in
  (`components/record/useResendUnsent.ts`, mounted in `app/_layout.tsx`); the phone opens as usual. Convex's job
  decides (`lib/unsentLogic.ts` `resendStep`): a job is only stopped and sent again when the worker says files are
  missing (`uploading`) an hour after "I'm done"; `queued` and `preparing` wait (the worker sets `preparing` before
  it checks the files). What's covered and what isn't is in `lib/unsentRecordings.ts`'s header: a recording the app
  dies in before "I'm done" isn't resent, and after 3 tries or 7 days a resend gives up quietly (TODO(caleb): a way
  to send one by hand). The videos stay in `documents/recordings/<id>/`, never in tmp.
- Never start a native upload from a file you haven't checked is there (`fileOnPhone`, or `!file.exists` then
  throw): iOS throws an exception JS can't catch and the app closes. Every expo-file-system `move()`/`copy()` is
  awaited or the `*Sync` one. `scripts/test-recording-ui.mjs` checks both across `app/src`.

Related: [[in-app-recording]]

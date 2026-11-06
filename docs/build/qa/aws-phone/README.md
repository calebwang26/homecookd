# Phone check on build 11: results (Nov 3)

Build 11 (`aws-staging`, 1.0.0, from main `612a775`) on Caleb's iPhone against AWS staging, 09:08 to 10:14 UTC Nov 3,
following [CHECKLIST.md](CHECKLIST.md). The staging side ran from `app/scripts/aws-phone-run.mjs` (test cooks "Asha
(test)" and "Nadia (test)", finishing jobs with `POST /v1/test/recipe {newestJob: true}`, a message from Asha, reading
the voice note). AWS backend read staging's logs, database and S3 for each step. Times are UTC.

**Pending Caleb:** the 📸 screenshots (they go in this folder, named by step) and the alerts email's arrival in the
inbox (step 8). Everything else below is proven from staging's side.

| Step | Result | Proof |
|---|---|---|
| 1. Install build 11 | Pass | Installed over the earlier build. |
| 2. Join Asha's family | Pass | Joined by a `homecookd://i?t=…` link pasted into Safari (staging's links use a cloudfront host the app doesn't claim; the checklist now says so). He first signed in with no link, which made his own family; the link then moved him into Asha's (person `f84402bf`, 09:34:54). |
| 3. Short clip, one upload | Pass | Upload `0d5533f6`: two clips, 932,615 and 14,494,207 bytes, each one PUT (under the 20 MiB part threshold). Job finished 09:35:48 as recipe `3da7c0ac`. The recipe plays staging's orange test video, as designed. |
| 4. Long clip, in parts | Pass | Upload `7e41fa90`: a 46,774,205-byte clip in 9 parts (eight of 5 MiB and one of 4,831,165; S3's ETag ends `-9`), links to finish in about 11 s. Recipe `d47908f2`, 09:39:05. |
| 5. Notifications | Fail, then fixed in the app; delivery blocked on the APNs key | See below. |
| 6. Voice note | Pass | Message `f5bb3e38` at 09:52:41: 1.6 s, its audio answers 200, 71,035 bytes, `audio/m4a`. |
| 7. A test report | Pass | `POST /v1/community/reports` at 09:53:11, 200 in 93 ms; report `9901c196` (dinner `fbd5a72f`, reason other). The alert line at 09:53:14; the alarm `homecookd-staging-community-report` went to ALARM and published to `homecookd-staging-alerts` at 09:54:22, about 70 s after. Closed as keep by AWS backend. |
| 8. The alerts email | Pending Caleb | The topic's email subscription is confirmed; whether the email reached the inbox is his to see. |

Errors in the whole run (09:28 to 09:42): 6 of 229 requests, all 401s from the app starting on a stale session and the
one sign-out when he moved families. No 5xx.

## Step 5: notifications

1. **The app never asked** (iOS showed no Notifications row for homecookd, so no token reached the api). Two causes, both
   in shared code, both in build 6 (1.0) too:
   - A phone recording sends itself from the done screen and never opens Send, which was where a cook was asked. Fixed in
     #342: the done screen asks after its send.
   - The cook's ask waited for a later launch; a share-sheet send never asked; an ask made over an open sheet was
     dropped by iOS. Fixed in #341.
2. Both reached build 11 by EAS Update (`01a1a0dc…` for #341, `01a1a0e4…` for #342). At 10:13 the ask showed after a
   recording; he tapped Allow. The token landed on `f84402bf` at 10:13:14.
3. **Delivery fails on Expo's side:** Asha's message `6b475bbc` at 10:13:56 went through the queue to Expo, and push_log
   `9c6590eb` reads failed: "Could not find APNs credentials for com.salik.homecookd (@salikm1234/app)". No iOS push can
   be delivered until an APNs key is on the Expo project (docs/build/LAUNCH-LINKS.md 6c). It's not specific to AWS: 1.0's
   pushes go through the same Expo project.
4. **Still to do:** once the key is in, send one more message from Asha (`aws-phone-run.mjs message`) and read its ticket
   and receipt. The test cooks stay on staging until then; after it, `aws-phone-run.mjs delete`, and Caleb's staging
   account is deleted from the app.

A "recipe ready" push isn't tested here: staging's test route finishes a job without one. Production's check covers it
([PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md)).

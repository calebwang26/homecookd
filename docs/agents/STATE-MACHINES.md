# State machines

Every lifecycle in the codebase, explicit or still implicit, with its owner and its state. Rule and pattern:
`docs/agents/memory/state-machines.md`. Add a row when you make one explicit; keep the file and test columns true.

**The marker (CI-enforced):** a machine file names its test in a header line within its first 40 lines, on a line of its
own: `// state-machine-test: questionMachine.test.ts` (TS/JS) or `# state-machine-test: test_claude.py` (Python). A bare
name is next to the file; a path with a slash is from the repo root. CI's `changes` job runs
`scripts/check-machine-tests.mjs`, which fails a PR that changes a marked file without changing its test, or whose marker
names a test that doesn't exist. Each owner adds the marker to their own machines.

**History:** each machine's last 20 events (type, from, to, when; never what an event carries). The app keeps them in
`app/src/lib/machine.ts` (`machineHistory()`, for a report). The site keeps them in `web/src/lib/machine.ts` in
development builds only (`next dev`, which the QA scripts use): `mom-failures-e2e.mjs` and `dish-e2e.mjs` print them when
a check fails. A production build has none, and the site never sends them anywhere (/privacy: no error reporting).

Status: **implicit** (flags, timers, strings; the survey of Nov 8, 2026 found it), **explicit** (table + transition
test merged), **retired** (code goes with the old stack).

| # | Machine | Owner | Where | Status | Tier |
|---|---|---|---|---|---|
| 1 | Sheet hand-offs (BottomSheet, toasts, root sheets) | App screens | `app/src/lib/sheets/machine.ts` (the table, the root host's), `coordinator.ts` (afterClose, toasts), `components/ui/BottomSheet.tsx`; test `app/scripts/test-sheets.mjs` | explicit (#424); share.tsx's own open/present/crash flow is still implicit (1b) | 1 |
| 2 | Job lifecycle, queue side (SQS receives vs attempts, pauses, sweep) | AWS backend | `pipeline/queue_worker.py` (`_wake_later`, `_try_again`, `_sweep`), `queue_db.py` (`claim`, `wake_later`, `sweep`, `acknowledge_cancel`), `api/migrations/081_job_failures.sql`; tests `test_queue_worker.py` (`the_job_machines_guarded_transitions`, both stores), `api/test/jobsWorker.test.ts` | explicit (#429): the row is the machine, a message only wakes it; budget `jobs.failures` | 1 |
| 3 | Memories opt-in at publish | AWS backend | `pipeline/queue_db.py` `_save_recipe`, `api/src/modules/recipes/writes.ts` `saveMemoriesOptIn`, `api/migrations/082_memories_answered_at.sql`; tests `test_queue_worker.py` (`test_postgres_the_cooks_latest_memories_answer_wins`), `api/test/recipes.test.ts` | explicit (#437): her answer on the recipe (`memories_opt_in_at`) always stands; else the recording's, read at publish | 1 |
| 4 | Recording screen | App screens | `app/src/app/recording.tsx`, `lib/live/quietRecording.ts`, `components/record/filming.ts`, `useInAppCamera.ts` | implicit | 2 |
| 5 | Send → upload → job → resend | App screens | `app/src/components/record/sendMachine.ts` (Send's table, `runSend`), `app/send.tsx` (`useMachineNow`), `components/record/sendKept.ts`, `sendDraft.ts` (`onStarted`); test `app/scripts/test-send.mjs`. After Send: `jobRetry.ts` `jobNext` (the job's retries; test `test-parent-jobs.mjs`) and `lib/unsentLogic.ts` `resendStep` (the next launch's resend; test `test-recording-ui.mjs`) stay pure decisions | explicit (#445; decision 8): one tap, one send, Send can't be tapped from the first tap until "On its way" shows | 2 |
| 6 | Mom's answer page (mic, upload, finish, fill) | App Store, web & builds | `web/src/components/mom/questionMachine.ts` (the answer screen: mic phase, question, what each phase allows), `momMachine.ts` (the page's screens); wired in `QuestionScreen.tsx`, `MomApp.tsx`; tests `questionMachine.test.ts`, `momMachine.test.ts` (`cd web && npm test`), browser runs `web/scripts/qa/mom-failures-e2e.mjs` | explicit (#426), with decision 3's fixes (PR B): Back and Skip whenever nothing is in flight, the mic prompt times out (ARM_MS), Copy link out of in-app browsers, one reload back to her question, a refused answer and a failed Send say so | 1 |
| 7 | Claude batch calls (cancel, spend, fallback) | Pipeline & recipes | `pipeline/claude.py` (`BatchState`, `ALLOWED`, `BatchCall.advance`, `reap`), `process.py` (`reap_batches`), `batch_reap.py`, `queue_worker.py` (`ChildJob.reap`); tests `test_claude.py`, `test_queue_worker.py` | explicit | 1 |
| 8 | Account deletion, outside purge | AWS backend | `api/src/modules/accounts/deletion.ts` (the table; `stageOf`, `retryDeletion`, `stalledDeletions`), `api/src/deletions.ts` (the team's `stalled` and `retry`), `api/migrations/084_deletion_stages.sql`; test `api/test/deletionMachine.test.ts`. `pipeline/account_purge.py` is the old stack's | explicit, with decision 7: purging → outside → done, outside → gave_up after 10 attempts (`external_gave_up_at`) → outside again by the team's `node dist/deletions.js retry <id>`. The CHECK refuses the stages that can't be | 2 |
| 9 | Library loading (`loaded` vs family rows) | App screens | `app/src/lib/libraryLoad.ts` (the table), `lib/recipes.ts` (`familyChecked`), `app/kid/home.tsx`, `kid/recipes`, `parent/recipes.tsx`, `components/recipes/RecipeList.tsx`; test `app/scripts/test-library.mjs` | explicit (#432; decision 4) | 1 |
| 10 | Pushes (`push_log`) | AWS backend | `api/src/modules/messages/pushData.ts` (the table: `claimDelivery`, `finishDelivery`, `retryDelivery`, `sweepDeliveries`), `push.ts` (`deliver`, `sweep`), `expo.ts` (`UNAVAILABLE`), `api/migrations/083_push_retries.sql`; test `api/test/pushMachine.test.ts` | explicit, with decision 6: queued → sending → sent \| failed \| none; a push Expo didn't take goes back to queued and is tried again 1, 5, 15 and 60 min on (5 wake-ups in all); `push.sweep` (every 5 min) wakes one whose push.deliver went to the dead-letter queue or whose holder died. A timeout is never tried again (Expo may have taken it) | 2 |
| 11 | Dinners, join requests, swaps, reports | AWS backend | `api/src/modules/community/` | implicit | 2 |
| 12 | Spend ledger, queue side | Pipeline & recipes | `pipeline/queue_db.py` record_calls, `process.py` usage.json | implicit | 2 |
| 13 | Session gate and held links | App screens | `app/src/lib/session.tsx`, `app/_layout.tsx`, `components/signin/handoff.ts` | implicit | 3 |
| 14 | Kid's card creation and share | App Store, web & builds | `web/src/components/miss/MissApp.tsx`, `AskSheet.tsx`, `CardScreen.tsx` | implicit | 2 |
| 15 | Dish ask (card → asked → answered → merged) | AWS backend | `api/src/modules/dish/` | implicit | 3 |
| 16 | Questions and share asks | AWS backend | `api/src/modules/messages/questions.ts`, `shareAsks.ts` | implicit | 3 |
| 17 | Invites, join links, move requests | AWS backend | `api/src/modules/accounts/invites.ts`, `moves.ts` | move requests explicit; invites implicit | 3 |
| 18 | Sessions and devices | AWS backend | `api/src/auth.ts`, `accounts/data.ts` | implicit | 3 |
| 19 | Outbox and scheduled queue | AWS backend | `api/src/outbox.ts` | implicit | 3 |
| 20 | Pending sends, file ledger, recap schedule | AWS backend | `api/src/modules/messages/activity.ts`, `files`, `retention.ts` | implicit | 3 |
| 21 | Record screen before filming | App screens | `app/src/app/record.tsx`, `components/record/usePickVideos.ts` | implicit | 3 |
| 22 | Chat optimistic sends | App screens | `app/src/lib/messaging.ts` | implicit | 3 |
| 23 | Push asks and registration | Notifications & linking | `app/src/lib/push.ts`, `components/push/PushAskSheet.tsx` | implicit | 3 |
| 24 | Sign-in steps | App screens | `app/src/app/join.tsx` | implicit | 3 |
| 25 | Hold-to-talk, voice request, stopped-early card | App screens | `app/src/components/postcard/HoldToTalk.tsx`, `app/request/voice.tsx` | implicit | 3 |
| 26 | Kid cook mode controller | App screens | `app/src/lib/cookingLogic.ts` | explicit (tested with a fake clock) | — |
| 27 | Shared media player | App screens | `app/src/lib/media.ts` | explicit phase + side flags | 3 |
| 28 | homie live hook | Voice & homie | `app/src/lib/live/homie.ts`, `useWalkie.ts` | implicit, unused while homie is off | — |
| 29 | Queue job attempt (child process, result kinds) | Pipeline & recipes | `pipeline/queue_job.py`, `ChildRunner` | explicit enough (fenced, tested) | — |
| 30 | Disk caches and `recipe.json` as done marker | Pipeline & recipes | `pipeline/process.py`, `shorten.py`, `align.py` | implicit | 2 |
| 31 | Clip-reorder swap | Pipeline & recipes | `pipeline/order.py` | explicit (two-phase, restore) | — |
| 32 | Convex-mode worker and GCS legacy mode | — | `pipeline/worker.py` | retired with the old stack | — |
| 33 | Kid's dish box (voice note, dictation) | App Store, web & builds | `web/src/components/miss/AskScreen.tsx` | implicit | 3 |
| 34 | Card page polling and edits | App Store, web & builds | `web/src/components/miss/CardScreen.tsx` | implicit | 3 |
| 35 | Dinner invite, invite page, shared recipe, clip playback | App Store, web & builds | `web/src/components/dinner-invite/`, `invite/`, `recipe-web/`, `dish/parts.tsx` | implicit | 3 |
| 36 | A sheet torn down with its screen while its Modal is up (iOS: RN Fabric's `prepareForRecycle` never dismisses the presented Modal, so an empty one can stay over the app) | App screens | `react-native` `RCTModalHostViewComponentView.mm`; seen from `components/ui/BottomSheet.tsx` | implicit | 1.1.2 native |
| 37 | Account & privacy: "Email the team a report" with `machineHistory()` and the device and app version (no Sentry in the app) | App screens | `app/src/app/index.tsx` Account sheet, `lib/machine.ts` | to build | 3 |

**The invariant sweep (Nov 9).** Every 5 minutes `platform.invariants` (`api/src/modules/platform/invariants.ts`) counts the states that must never be
true: a queued job with no wake-up owed for 3 h, a running job silent for 15 min, a push queued an hour past its time or sending for an hour, a dish ask merging for 10 min, an
account deletion stalled for an hour or given up outside, an outbox row with 5 failed sends, a recipe shared or hidden while not ready, a full dinner
with seats left. Each count is a CloudWatch metric (`infra/modules/env/invariants.tf`); production alarms on any of them, and on the sweep itself going
quiet for 15 minutes. The violating rows' ids are in the api log as `INVARIANT <name>` lines, so a chat can act on them. A machine made explicit adds its
invariant there (the SQL, a test with a healthy look-alike, and the filter's key).

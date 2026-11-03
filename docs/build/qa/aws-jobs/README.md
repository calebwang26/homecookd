# Jobs on AWS staging: the web build at phone size (Nov 2, 2026)

The app's web build (375×812) with `EXPO_PUBLIC_BACKEND=aws` against staging, for the Jobs screens PR. A test cook from the
staging-only test sign-in, with one real job made by a script: links from `POST /v1/video-uploads`, the job from
`POST /v1/jobs`, 64 KiB PUT to staging's S3, `/complete` → `queued` (staging runs no worker, so it waits there).
The web build can't upload (no CORS on the uploads bucket, by design): uploading itself is proven by `aws-jobs-flows`.

1. Home: "Your Sunday Dal · Waiting its turn", from the `jobs` live topic (`GET /v1/live/jobs`, polled), with the
   family's recipes from `GET /v1/recipes`.
2. After tapping ✕ and the undo seconds: the row is gone. On staging the job then reads `stage: failed`,
   `error: "Cancelled."`, `cancelledAt` set (`POST /v1/jobs/:id/cancel`).

The test cook was deleted afterwards.

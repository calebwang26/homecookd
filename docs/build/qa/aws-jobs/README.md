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

## A finished recipe (Nov 2, with staging's test recipe route)

A second test cook whose real queued job was then finished by `POST /v1/test/recipe` (staging-only; it publishes as the
worker does, with a made-up 3-step recipe).

3. Recipes: "Your recipes" lists **Sunday Dal · ~10 min · 3 steps**, from `GET /v1/recipes`, its `recipe.json` read from
   staging's media CDN. ("Family recipes" below is still the public `library.json` on GCS: JOBS.md open item 15.)
4. Tapping it opens the recipe: the title, her quote, "See all 3 steps", "Watch yourself".

The test cook was deleted afterwards.


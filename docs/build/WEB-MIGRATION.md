# Moving the website off Vercel (phase 7)

Written Oct 31, 2026 (AWS backend chat). The plan is `docs/build/AWS-MIGRATION.md`. **Nothing here is live:** homecookd.app stays
on Vercel with no DNS change, and nothing has been applied or deployed yet. The web section belongs to the App Store, web &
builds chat. `web/` isn't changed, and it still builds and works on Vercel as before.

## What's built

| Piece | File | What it does |
|---|---|---|
| Hosting | `infra/modules/web/main.tf`, used only by `infra/envs/staging` | Private S3 bucket, CloudFront with origin access control, cache and header rules |
| Addresses | `infra/modules/web/rewrite.js` | The CloudFront Function that does what Vercel does for clean URLs |
| Publishing | `.github/workflows/deploy-web.yml`, `infra/scripts/web-sync.sh` | Builds, uploads with exact content types, clears the cache, smoke tests. Staging only, by GitHub's OIDC login |
| What "right" means | `infra/modules/web/paths.mjs` | 86 addresses and their answers, read off homecookd.app |
| Tests | `rewrite.test.mjs`, `infra/scripts/web-smoke.mjs` | The function against the real `web/out`, and any running site over HTTP |

The deploy role gets only: list this bucket, put and delete in it, and create and read invalidations on this distribution.

To start it on staging: `terraform apply`, then set the repo variables `STAGING_WEB_DISTRIBUTION_ID` and `STAGING_WEB_URL` from its
outputs. Until they exist the workflow skips itself.

## How each address behaves

Read from homecookd.app with `curl` on Oct 31, then held to that by the tests.

| Address | Answer | Served from |
|---|---|---|
| `/.well-known/apple-app-site-association` | **200, `application/json`, no redirect**, `max-age=3600` | That exact key. This path runs no function at all, so a function bug can't reach it |
| `/.well-known/assetlinks.json` | 404. There's no Android file, on Vercel or in the repo | |
| `/`, `/r`, `/i`, `/d`, `/miss`, `/a`, `/learn`, `/teach`, `/privacy`, `/terms` | 200 HTML, with or without a query string | `index.html`, `r.html`, and so on (the export writes `miss.html`, never `miss/index.html`) |
| `/index`, `/_not-found` | 200, an oddity of Vercel's that's kept | `index.html`, `_not-found.html` |
| `/r/` and any path ending in a slash | 308 to the same path without it, query kept (`/r/?s=a` to `/r?s=a`) | |
| `//r`, `/r//` | 308 with the doubled slash collapsed. `//example.com/` stays on this site | |
| `/r/abc`, `/i/abc`, `/d/abc`, `/miss/abc`, `/a/abc` | **404**. No page reads a path after its name: they all read the query string | `404.html` |
| `/r.html`, `/index.html`, `/404`, `/404.html` | 404. A page is reachable only by its clean URL | `404.html` |
| `/r.txt`, `/r/__next._full.txt`, `/og.jpg`, `/learn/og.jpg`, icons, `/brand/*` | 200, the file as it is | Same key |
| `/fonts/*`, `/_next/static/*` | 200, `max-age=31536000, immutable` | Same key |
| `/media/*` | 200, `max-age=3600, stale-while-revalidate=604800`, video ranges work | Same key |
| Anything else | 404 with the 404 page | `404.html` |

**Caches:** pages and everything not listed are `max-age=0, must-revalidate` in the browser, as on Vercel, and at most 5 minutes
at CloudFront. A deploy clears CloudFront with `/*`.

**Query strings** never reach S3 and aren't part of the cache key, so `/r?s=<token>` is one cached page and the token stops at
CloudFront. Access logs are off, because they'd record those tokens.

**The function's runtime:** `cloudfront-js-2.0`, which is ES5.1 plus some newer features, with no imports, network, timers or
environment variables, under 10 KB. The function is plain ES5 and calls only methods AWS lists. The test parses it as ES5 and checks
each method name.

## Differences from Vercel

All are small. None changes what a person sees.

| | Vercel | CloudFront |
|---|---|---|
| `http://` to `https://` | 308 | 301 (CloudFront's fixed choice) |
| `Access-Control-Allow-Origin: *` | Always | Only when the request has an `Origin`, which is every request where it matters |
| A redirect's body | "Redirecting..." and a `Refresh` header | Empty. Browsers follow the `Location` either way |
| `/_next/static/nope.js` | Plain-text 404, no long cache | The HTML 404 page, with the one-year cache header |
| `/r%2F` | 200 (reads it as `/r/`) | 404 |
| `/_next/static/` folder | `/_next/static/immutable/chunks/` | `/_next/static/chunks/` (Vercel's build adds the extra folder). Same rule covers both |
| `OPTIONS` requests | Not compared (GETs only) | 403. Static files need no preflight |
| Old hashed files after a deploy | Not compared | Kept in the bucket, so a page already open can still load them |
| `X-Robots-Tag: noindex` | None | **On, for staging only.** `noindex = false` when it becomes homecookd.app |

## Env the build needs

Next writes `NEXT_PUBLIC_*` into the files at build time, so each build points at one backend for good. Vercel's values weren't read for
this work, so production's values have to be listed from Vercel's settings at switch time.

| Variable | If unset | Staging | Production, at the switch |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | **`http://localhost:3000` in canonical links and share images, with no error, off Vercel** | `STAGING_WEB_URL` | `https://homecookd.app`. Must be set: the fallback only knows Vercel's variables |
| `NEXT_PUBLIC_API_URL` | **Live Supabase** | `https://no-backend.invalid` | The backend that's live for `/r`, `/i`, web events |
| `NEXT_PUBLIC_BUCKET_URL` | **Live GCS media** | `https://no-backend.invalid` | Whichever bucket or CDN is live |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | **Live Convex** (`/d`, `/miss`, `/a`) | `https://no-backend.invalid` | The backend that's live for those pages |
| `NEXT_PUBLIC_DISH_URL` | Follows the Convex value | Unset | Unset |
| `NEXT_PUBLIC_APP_STORE_URL` | "Get the app" says it's in early testing | Unset | Copy from Vercel |
| `NEXT_PUBLIC_EARLY_ACCESS_URL` | The form sends nothing | Unset | Copy from Vercel, if set |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `team@homecookd.app` | Unset | Copy from Vercel, if set |

Staging's three backend values default to a name that can't resolve, so a public staging copy can't write to real families or spend
the model budget. Its pages load, and anything that calls a backend shows its error state. The workflow fails if a staging build still
contains a live backend's address. Point them at real backends only with the repo variables `STAGING_WEB_API_URL`,
`STAGING_WEB_BUCKET_URL` and `STAGING_WEB_CONVEX_SITE_URL`, and only on purpose.

Copied links on staging still say `https://homecookd.app` (`WEB_ORIGIN` in `web/src/lib/app-links.ts`). The build also fetches
Fraunces from Google Fonts for the `og.jpg` images, so it needs internet access.

## PR preview links

**Recommendation: keep Vercel's previews for now, and don't rebuild them on S3.** The Vercel project stays up anyway as the way back,
and previews cost nothing extra. When Vercel finally goes, use `next dev` for a PR and staging after a merge. A per-PR copy on S3
would need its own folder, a smarter function and cleanup, for a section with one owning chat and few PRs. The catch: previews are built
by Vercel and don't exercise CloudFront, so staging's smoke test is what proves the hosting.

## Cost

From list prices, not measured. **Staging: about $0.** The export is 97 MB, under a cent a month on S3. CloudFront's always-free tier is
1 TB and 10 million requests a month. Functions are free to 2 million a month, then $0.10 a million. Invalidations are free to 1,000
paths a month, and `/*` counts as one. The free tier is per account and shared with the media CDN. **Production:** a few dollars a month
at today's traffic, as the plan says. Past the free tier, data is about $0.085 a GB in the US and $0.109 in India.

## The switch and the way back

Caleb's OK in chat for each step that touches DNS or live traffic. Do it after Apple approves 1.0, alongside phase 1's `api.` and `media.`
addresses.

1. List Vercel's env values. Add `module "web"` to `infra/envs/production` with `noindex = false`, and a production target to the workflow.
   Give the GitHub `Production` environment required reviewers first (`infra/README.md`).
2. Make an ACM certificate in **us-east-1** covering **`homecookd.app` and `www.homecookd.app`**. The app claims both, and both serve the
   site today with no redirect. Validating it adds a harmless DNS record.
3. Set `domains` and `certificate_arn`, deploy, and test before moving anyone:
   `curl --resolve homecookd.app:443:<CloudFront IP> https://homecookd.app/.well-known/apple-app-site-association`, then the smoke test.
4. Lower the DNS TTL a day ahead. Point both names at CloudFront. An apex name can't be a CNAME, so that needs an ALIAS-style record at
   the DNS host, or Route 53. Check who hosts the DNS first.
5. Run `node infra/scripts/web-smoke.mjs https://homecookd.app`. Tap a real `/i` link on an installed phone. Apple's CDN holds the Apple file
   for a while, and the bytes don't change, so installed phones shouldn't notice.
6. Stop Vercel building production from `main` only after a calm period. Both can build from `main` until then.

**The way back:** point DNS at Vercel again. It takes as long as the TTL. Vercel keeps running and building meanwhile, so keep it for at least
a few weeks.

**Waiting for Apple (in the plan's list):** `/privacy` says "This website runs on Vercel". It changes when the site moves, under the App
Review guard, and isn't touched here. No guard file changes in this work: the Apple file, `/privacy` and `/terms` are as they were.

## Open questions, with recommendations

1. **`/*` on every deploy, or only what changed?** Recommendation: `/*`. CloudFront's wildcard only works at the end of a path, so "everything
   but `_next` and `fonts`" is about 50 paths a deploy and passes the free 1,000 at about 20 deploys a month. The cost of `/*` is that each edge refetches
   hashed files and video once, for the first visitor after a deploy.
2. **Should deep paths like `/i/abc` keep returning 404?** Recommendation: yes for now, since it matches today. But the Apple file claims
   `/i/*`, `/r/*` and `/d/*`, so if such a link ever existed, a phone without the app would land on a 404. Nothing in `app/`, `convex/`, `web/`
   or `voice/` creates one.
3. **Keep `/index` and `/_not-found` at 200?** Recommendation: keep them until the switch is done, then decide. Changing behavior during a
   move makes problems harder to read.
4. **Point staging at a real backend?** Recommendation: not until the new api serves those routes over https. Staging's load balancer is
   plain HTTP, and a browser would block it from an https page.

## Proven on real CloudFront (Oct 31, staging)

The Apple file: 200, exactly `application/json`, no redirect, same bytes as the repo. An unknown page: status 404 with the HTML page. A
308 keeps its query string, regrouped by name. `http` to `https`: 301. HSTS on pages and redirects, video ranges (206), brotli.
Two differences from Vercel found: query parameters are regrouped by name in a redirect, which pages don't mind, and a missing font's
404 isn't cached for a year, which is better.


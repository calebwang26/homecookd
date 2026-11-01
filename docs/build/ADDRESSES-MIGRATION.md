# Phase 1: our own addresses

Phase 1 of `docs/build/AWS-MIGRATION.md`. The code is `infra/modules/front_door/`, with two callers: `infra/addresses/` for the real addresses, and a `front_door`
variable on `infra/envs/staging/` to prove them. **A draft: never applied.** Both are off by default and create nothing. No DNS changes, and nothing calls these addresses.

## What it builds

One CloudFront distribution per address. Later phases change only where one forwards, with no app release.

| | `api` and voice | `media` |
|---|---|---|
| Methods | All, so POST works | GET, HEAD, OPTIONS |
| Cache | None (`Managed-CachingDisabled`) | Follows the file's `Cache-Control`, 1 hour without one, 1 week at most |
| Sent to the origin | Every header, cookie and query string but `Host` (`Managed-AllViewerExceptHostHeader`): `Authorization` and `Sec-WebSocket-*` included | Only `?v=`, as on S3's distribution, and the CORS request headers |
| HTTP | HTTPS only, because a redirect would lose a POST's body | Redirects to HTTPS |
| Logs | None: URLs carry session and family link tokens | None |

**Today's origins** are in `infra/addresses/addresses.tfvars.example`. CloudFront doesn't rewrite a path, so each route keeps the path it came with:

| Address and path | Goes to | Used by |
|---|---|---|
| `api.homecookd.app` `/functions/v1/api/...` | Supabase | `EXPO_PUBLIC_API_URL` |
| `/api/...`, WebSocket included | `grand-dragon-649.convex.cloud` | `EXPO_PUBLIC_CONVEX_URL` |
| `/dish/*`, `/invite/*`, `/link/*` | `grand-dragon-649.convex.site` | The app's `siteUrl()`, the website |
| `/upload` | The signer on Cloud Run, which answers any path | `EXPO_PUBLIC_UPLOAD_URL`, until phase 4 |
| `media.homecookd.app` | `storage.googleapis.com/edible-media-379797517579` | `EXPO_PUBLIC_BUCKET_URL` |
| `voice.homecookd.app` (a default name: `TODO(caleb)`) | `homecookd-voice-...a.run.app` | `EXPO_PUBLIC_VOICE_URL` |

Server-to-server routes (`/worker/*`, `/voice/*`, `/live/*`, `/sync/*`, `/glasses/*`) keep Convex's own address. They aren't compiled into any phone.

## What has to change before app 1.1 relies on `api.`

1. **Per-IP limits would break, the biggest finding here.** Convex and Supabase read the caller's address from `CF-Connecting-IP` (`convex/lib/rateLimit.ts`, `supabase/functions/api/index.ts:363`). Through
   CloudFront, that address is **CloudFront's own**, shared by everyone near that edge. Supabase's sign-up limit is 5 an hour per address (`index.ts:2623`), so a few sign-ups in a city could lock out the rest. `/dish/*` and `/link/open` have
   per-IP limits too (`convex/lib/dishAskRoutes.ts`, `linkRoutes.ts`). CloudFront does send the real one, as `CloudFront-Viewer-Address`, but both origins are still public, so anyone could fake that header on a direct request. The usual proof is a secret header from
   CloudFront, and that would put a secret in Terraform's state, which the rules forbid. **Caleb's call**, and my recommendation is below.
2. **`siteUrl()` returns nothing for our address** (`app/src/components/community/invite.ts:18`). It only recognizes `*.convex.cloud`, so with `EXPO_PUBLIC_CONVEX_URL=https://api.homecookd.app` every invite and dish card opens as "offline". 1.1 needs a separate setting for the HTTP host.
3. **A request that takes over 60 seconds fails with a 504**, CloudFront's limit without a quota increase (up to 180). Not measured for any route today. A GET is retried by CloudFront up to 3 times; a POST isn't.
4. **`/privacy` has to list AWS before family traffic crosses it.** CloudFront caches media at its edges, so it's a store of family data. It's already blocked on Apple (`AWS-MIGRATION.md`).
5. **Convex's WebSocket is unproven** (below). Supabase and Convex also sit behind Cloudflare, which could challenge CloudFront's addresses as it would any bot. Only a real request through a throwaway deployment can answer that.

**Recommendation:** split it. Ship `media.` and `voice.` in 1.1, once proven: GCS has no per-IP limit of ours, and a search of `voice/src/server.ts` finds none there. Keep the app off `api.` until the limits are solved, which means either a Convex and Supabase deploy (the
Supabase one needs his OK), or waiting for the new `api`, where the load balancer and the limits are ours. The cost is that the "no app release" goal isn't met for Supabase and Convex until then.

## What staging can prove without DNS

Staging's addresses use `cloudfront.net` names and its default certificate, and need no DNS or ACM. `infra/envs/staging` refuses the live hosts in `front_door`.

**Can prove:** POST and bodies, `Authorization` on a GET, query strings, no caching, WebSockets and how long an idle one lasts, `?v=` in the cache key, range reads, CORS.

**Can't prove:** our own names and certificate, Supabase, Cloud Run and Convex's real behavior through it unless a throwaway of each is used, Cloudflare's reaction, the per-IP problem, phones on real networks, or timing from India.

```hcl
# staging.tfvars, which git ignores. A plain apply, and the auto-deploy, remove these again.
front_door = {
  echo  = { origin_domain = "httpbin.org" }                                                       # fake token only
  voice = { origin_domain = "<load_balancer_url's host>", origin_http_only = true }               # plain HTTP to the load balancer: staging only
  files = { files = true, origin_domain = "storage.googleapis.com", origin_path = "/gcp-public-data-landsat" } # Google's public data, read only
}
```

```bash
cd infra/envs/staging && AWS_PROFILE=homecookd terraform apply -var-file=staging.tfvars -var voice_count=1   # a few dollars at most, if it's removed the same day
terraform output front_door_domains
node infra/addresses/proof.mjs echo  https://<echo>                 # methods, Authorization, query strings, no cache
node infra/addresses/proof.mjs files https://<files> <a public file's path>   # cached, ?v=, ranges, CORS
node infra/addresses/proof.mjs ws    'wss://<voice>/cook?session=test&recipe=test' 300   # the socket, for 5 minutes (the load balancer's stub takes any token)
cd voice && URL=wss://<voice> FAKE=1 npm run test-client -- test-audio/next-step.wav       # a whole fake cooking turn
```

Then a plain `terraform apply` to remove them, and back to `voice_count = 0`.

Idle sockets matter: CloudFront's 60 seconds applies to gaps in what the origin sends. The voice service pings every 25 seconds (`voice/src/server.ts:156`), so it should hold. Convex's client (1.48) reconnects by itself after 60 seconds of silence from its server (`web_socket_manager.ts`), so its server should speak more often than that. How much more often is what the test below finds out.

## Testing Convex's client WebSocket

**What the client's source says (1.48):** any address but `*.convex.site` is accepted, and the socket is `wss://<address>/api/<version>/sync`, which the `/api/*` route covers. That says it can connect, and only a run can say whether it stays connected.

**Against a throwaway Convex deployment, or not at all. Never `grand-dragon-649`:** staging refuses it, and the live one holds real families. It needs Caleb's Convex login, and costs nothing on a free deployment. **Do it outside this repo,** so nothing can deploy `convex/`, and with no deploy key in the shell, because the root `.env`'s key points at the live one.

```bash
mkdir ~/convex-proof && cd ~/convex-proof && npm init -y && npm i convex
mkdir convex && cat > convex/proof.ts <<'EOF'
import { mutation, query } from "./_generated/server";
export const count = query(async (ctx) => (await ctx.db.query("hits").collect()).length);
export const add = mutation(async (ctx) => { await ctx.db.insert("hits", { at: Date.now() }); });
EOF
unset CONVEX_DEPLOY_KEY && npx convex dev --once --configure new       # a new project; read the name in .env.local, it must not be the live one

cat > client.mjs <<'EOF'
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
const client = new ConvexClient(process.argv[2]);
client.onUpdate(anyApi.proof.count, {}, (n) => console.log(new Date().toISOString(), "pushed", n));
setInterval(() => console.log(JSON.stringify(client.connectionState())), 30_000);
setInterval(() => client.mutation(anyApi.proof.add, {}), Number(process.argv[3] ?? 60) * 1000);
EOF
```

Add `convex = { origin_domain = "<new name>.convex.cloud" }` to `front_door`, apply, and run:

1. `node client.mjs https://<new name>.convex.cloud`, as the control. Then `node client.mjs https://<convex address>`.
2. It works if each `add` is followed by `pushed`, `isWebSocketConnected` stays true, and `connectionRetries` doesn't grow.
3. `node client.mjs https://<convex address> 900` leaves it quiet for 15 minutes. Compare reconnects with the control. CloudFront's 60-second gap is the likely thing to bite.
4. Point a dev build at it (`EXPO_PUBLIC_CONVEX_URL`) on a real iPhone, on Wi-Fi and cell.
5. Delete the project.

**If it fails:** Convex keeps its own URL until phase 6 replaces the client, as `AWS-MIGRATION.md` already says. `api.` then carries the rest.

## Steps for Caleb: DNS and the certificate

Terraform here never touches DNS. `homecookd.app`'s DNS is on Vercel (`ns1.vercel-dns.com`, checked Nov 1). Each step needs his OK.

1. **Allow Amazon to issue certificates.** The domain's CAA records name only `letsencrypt.org`, `pki.goog` and `sectigo.com`, so **ACM will fail until this exists**: add `homecookd.app CAA 0 issue "amazon.com"` in Vercel. Keep the three that are there, because Vercel's own certificates depend on them.
2. **Ask for the certificate:** copy `addresses.tfvars.example` to `addresses.tfvars`, and comment out `addresses` for now. `cd infra/addresses && AWS_PROFILE=homecookd terraform init -backend-config="bucket=homecookd-tfstate-<account id>" && terraform apply -var-file=addresses.tfvars`. It's free, and creates only the request, in `us-east-1`.
3. **Prove the name:** `terraform output certificate_validation_records`. Add each as a CNAME in Vercel, exactly as printed. Wait for ACM to say `ISSUED`, usually minutes. Leave these records in place, because renewal needs them.
4. **Create the addresses:** put `addresses` back, with each `domain` and the `certificate_arn`. Plan, read it, apply. Nothing calls them yet, so this can't affect a phone. Move the values into `main.tf`'s default in a PR now, or a later plain apply removes them.
5. **Test before DNS:** `curl --connect-to api.homecookd.app:443:<its cloudfront domain>:443 https://api.homecookd.app/...`, using the TEST family only.
6. **Point the names:** in Vercel, `CNAME api` (then `media`, `voice`) to `terraform output cloudfront_domains`. A low TTL first, such as 60 seconds. Nothing else on `homecookd.app` moves. **Don't add a record for the apex or `www`:** universal links depend on them.
7. **Ship app 1.1 with the new addresses,** under the App Review guard. Build 6 keeps calling the old ones, and they stay up.

**The way back:** an app version points back only with a release, so what matters is the address itself. Change its origin and apply (minutes), or fix DNS. **Old URLs keep working whatever happens here,** since this adds addresses and removes none.

## Later phases

- **`api`, voice:** change `origin_domain` to the new service. No release.
- **`media` (phase 4, step 8):** S3 needs the signing that `infra/modules/env` already sets up, so this module doesn't repeat it. CloudFront won't let two distributions share a name, so the switch moves `media.homecookd.app` from this distribution to env's (`media_domain`, `media_certificate_arn`): a short gap or `aws cloudfront associate-alias`, and a DNS change. `MEDIA-MIGRATION.md`'s way back still holds, by reversing it. Point it back at GCS by moving the name back.
- **The website (phase 7):** a separate distribution in `infra/modules/web`. Both touch this domain's DNS, so coordinate them.

## Cost: estimates at list prices

From the AWS Price List API, Nov 1, 2026. Nothing has measured real traffic. **Off, it's $0.** On with no traffic, also about $0, since CloudFront has no monthly fee. AWS's free tier (1 TB out and 10 million requests a month, from memory) should cover the first stretch.

| Item | Price |
|---|---|
| Out to viewers, after the free tier | $0.085 per GB in the US, $0.109 in India |
| **Google's egress on every cache miss** | About $0.12 per GB, from `MEDIA-MIGRATION.md`, not paid by AWS credits |

At 1 TB of video watched a month, with half of it from the cache: CloudFront about $0 inside the free tier, and Google about $60, against about $120 today with no CDN. The certificate is free. WebSockets and api requests are a few dollars at most under this traffic.

## Not verified

Nothing has been applied, so all of this is unproven: CloudFront's behavior through the `front_door` policies, `Authorization` on a GET with `AllViewerExceptHostHeader` (AWS's page names `AllViewer`, and `proof.mjs echo` checks it), GCS as an origin, the Cloud Run signer on `/upload` (its code doesn't look at the path), and anything on a real iPhone. `proof.mjs` itself has run only against a local stand-in.

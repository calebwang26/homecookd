# Retention wiring: the next phase, step by step

Written Oct 17, 2026, on branch `retention-plumbing` (worktree `.worktrees/retention`, based on origin/main
a2de7f7). Phase 1 added **new files only** (listed in section 1). This file says exactly how to hook them
into the existing code, which packages to install, and the migration and deploy order. Execute it on
top of main **after the QA branches have merged** (brief D1). The binding plan is still
`docs/build/RETENTION-HANDOFF.md` (its section 5 guardrails are hard rules) plus the per-PR brief.

Every snippet in sections 3 and 4 was applied to a scratch copy of origin/main's `index.ts` and
`app/`, then type-checked, linted and tested: the existing 37 api tests plus the 5 new route tests in
3.9 pass (42/42), `tsc --noEmit` and `eslint` are clean, and `api.ts` still loads under plain Node.
The QA merges move line numbers and change some neighbouring code, so each step names the **anchor
text** to find. The `main Lnnn` numbers are origin/main's, only as a hint.

**Integration (Oct 17, after PRs 2, 4, 5 & 6 were built).** Every retention route and cron job now
comes out of **one** `makeRetention(deps)` call in `retention.ts`, each route tagged with its PR, and a
PR is turned on by adding its number to `prs` (section "Integration" below). The server snippets of
sections 3, PR 2, PR 4, PR 5 and PR 6 were applied together to a scratch copy of this branch's
`index.ts` and `api_test.ts` with `prs: [1, 2, 4, 5, 6]`: `deno check` is clean and the api tests pass
**49/49** (37 existing + 5 PR 1 + 2 PR 2 + 3 PR 4 + 1 PR 5 + 1 PR 6). With PR 1 alone they pass 42/42;
with `prs: [1, 4]` exactly the PR 2, 5 and 6 tests fail (the switch is real). The migrations were
applied, in timestamp order and twice, to an in-memory Postgres on top of main's and qa-cook's
(`supabase/tests/retention_migrations_sql_test.ts`).

---------------------------------------------------------------------------------------------------
## Integration: one factory, one switch per PR

### Server modules (no import cycles; `supabase/tests/retention_wiring_test.ts` checks the graph)
```
time.ts                       imports nothing
table.ts, recap.ts            import time.ts                       (pure rules: Sunday table, recap slides)
plumbing.ts                   imports time.ts (+ types)            PR 1: caps, notify(), push copy, x-tz,
                                                                   library, push-token & cron routes,
                                                                   RECIPE_EVENT_KINDS / STAT_EVENT_KINDS /
                                                                   HEARD_MIN_S / PUSH_KINDS / CAP_REASONS
cooking.ts                    imports plumbing.ts, time.ts         PR 2 routes; dishName, reactionPush,
                                                                   isReaction/REACTIONS, postcardPush (PR 3)
hearts.ts                     imports plumbing.ts                  PR 4 routes
tablePr.ts                    imports plumbing, table, time, recap PR 5 route + `table_nudge` job
recapPr.ts                    imports recap, plumbing, time        PR 6 route + `recap` job
retention.ts                  imports all of the above             re-exports everything; makeRetention()
index.ts                      imports retention.ts ONLY
```
No module but index.ts imports `retention.ts`, and none imports `index.ts`. PR 3 (Send it home) has no
module here: its one route, `POST /messages/:id/postcard`, lives in index.ts on qa-cook's photo helpers,
its column is in PR 1's migration (and, idempotently, its own `20261018100400_retention_postcard.sql`)
and its push copy is `postcardPush()` / `postcardKey()` (see "PR 3 as wired"). PR 7 is app-only.

### `makeRetention(deps)` (retention.ts)
- `prs`: which PRs are on. PR 1 is always on (every later PR pushes or runs on the cron through it);
  default `[1]`. A number with nothing here (3, 7) throws at module init.
- deps: PR 1's (`db, HttpError, requireMe, rateLimit, dbFail, clientIp, expoAccessToken`) plus
  `library` (PRs 2, 4, 5, 6), `assertRecipe` (PR 2, optional), `answersFor` (PR 6) and `signPhotos`
  (PR 6, optional, after qa-cook). A PR that is on without what it needs throws
  `makeRetention: PR <n> needs <dep>` at module init, so a bad deploy fails loudly, not half-way.
- returns `routes` / `publicRoutes` (only the PRs that are on, each `{pr, method, path, handler, auth}`),
  `cronJobs` (already registered: `table_nudge` for PR 5, `recap` for PR 6, each with its `pr`),
  `notify`, `notifyLater`, the PR modules (`cooking`, `hearts`, `table`, `recap`, null when off) and the
  PR 1 handlers by name (tests). index.ts never pushes into `cronJobs` and never calls `makeCooking`,
  `makeHearts`, `makeTable`, `makeRecap` or `makePlumbing` itself.

The index.ts registration (section 3.4) stays two lines for the life of the feature:
```ts
for (const r of retention.routes) on(r.method, r.path, r.handler, r.auth);
for (const r of retention.publicRoutes) onPublic(r.method, r.path, r.handler);
```

Routes by PR (`retention_wiring_test.ts` pins this list, and that none overlaps an index.ts route):

| PR | Routes | Cron job | Migration (apply BEFORE the deploy that turns the PR on) |
|---|---|---|---|
| 1 | `POST /push-tokens`, `POST /push-tokens/remove` (lenientMe), public `POST /cron/hourly` | (runner) | `20261018100000_retention_plumbing.sql`; then, AFTER the deploy, `20261018100100_retention_cron.sql` |
| 2 | `POST /cooking`, `POST /cooking/end`, `GET /cooking`, `GET` + `POST /profile/share-cooking` | | none (PR 1's file has `cooking_now`, `share_cooking`, `reaction`) |
| 3 | (in index.ts, not `makeRetention`) `POST /messages/:id/postcard`; `GET /threads` gains `postcards` | | `20261018100400_retention_postcard.sql` (a no-op after PR 1's, which already adds `messages.rating`) |
| 4 | `GET /dish-stats`, `GET /hearts/recent` | | none |
| 5 | `GET /table` (lenientMe) | `table_nudge` | `20261018100300_retention_table.sql` |
| 6 | `GET /recap` | `recap` | none |

The old `20261018100200_retention_cooking.sql` (PR 2's idempotent repeat of PR 1's parts) was dropped
in integration: PR 1's file ships first and holds all of it, so one copy is kept. 100200 stays unused.

### Per-PR wiring at a glance (details and snippets in each PR's section below)

Every PR: rebase on main (after PR 1 is merged), apply its index.ts lines, its api_test block and its
app steps; run section 7; open the PR; after merge: migration (if any) -> api deploy (every file under
`supabase/functions/api/`, `verify_jwt: false`) -> live checks -> app build. Server always before app.

**PR 2, Leo is cooking (handoff 3.1).**
- index.ts: add `2` to `prs` and `assertRecipe` to the deps (S2); the reaction push rule in
  `pushMessage` + pass `replyTo` from POST /threads/:id/messages (S3). api_test: S4, including the
  one PR 1 assertion it changes ("Just like mine" now names the dish).
- Schema: none. Deploy: function, then app.
- App mounts: `cook/[id].tsx` (`useCookingSession` under `const step…`, `await live.finish()` first in
  `finish()`, `<ConsentSheet>` + `<HeartBurst>` after `<StepsSheet>`); `components/parent/UpdatesCard.tsx`
  (`useLiveCooking`, `CookingUpdate`, `<LiveCookingRow>` first in `row()`); `app/index.tsx` `/?pick=1`
  foot (`<ShareCookingRow>`); delete `app/dev/cooking.tsx`.
- Kind filters: PR 2 writes `started` events, so PR 1's 3.7 filters (`.in("kind", STAT_EVENT_KINDS)` on
  `/me/recipe-stats` and `/recipes/:id/activity`) must already be in.
- Reaction exclusions (PR 2 writes the first real reaction rows): server, from PR 1's 3.8: `answersFor`
  replies `.neq("kind", "reaction")`, the legacy step loop `.neq("kind", "reaction")`, `summaries` drops
  reactions (so `last`, `unread`, `GET /unread` and reaction-only threads are clean). App (A5):
  `ChatLog.tsx` (`groupMessages` stamp group, `<ReactionStamp>`, `lastGroup`, `dishCards`, `nextOf`),
  `messages/helpers.ts` `waitingQuestion`, `ThreadRows.tsx` `previewText`, `lib/messaging.ts`
  `remember()`, `profiles/status.ts` `lastSender`.
- Acceptance: handoff 3.1 (one push within ~5 s; "Step N of M" within 15 s; heart burst within ~10 s;
  no second push the same day; "Not now" shares nothing) + "PR 2 checks".

**PR 3, Send it home (handoff 3.4).** Wired last; see "PR 3 as wired" at the end.
- index.ts: `POST /messages/:id/postcard` (no `prs` number), `rating` in `MESSAGE_COLS`, `postcards`
  on `GET /threads`. api_test: 3 tests.
- Schema: `20261018100400_retention_postcard.sql` (idempotent; a no-op after PR 1's) BEFORE the deploy.
- App mounts: `MadeIt.tsx` (`PostcardStep` replaces "Want to share the love?" and B30's photo step for
  another family member's dish), `UpdatesCard.tsx` (`PostcardRow` for a "made" row with a photo),
  `Bubbles.tsx` (`CookedBubble` as a postcard), `kitchen.ts` (`kitchenStamp`, `liked`).
- Acceptance: handoff 3.4 (the postcard on Dad's Home within one poll; "Just like mine" reaches the kid
  as a push and a stamp; hold-to-talk without leaving Home; no photo = the plain row).

**PR 4, Hearts & kitchen (handoff 3.5, 3.6).**
- index.ts: add `4` to `prs` (P2). api_test: P4.
- Schema: none. Deploy: function, then app. A8 (the hearts note) ships in the same release as A2-A5.
- App mounts: `parent/recipes.tsx` (`<CookMirrorLine>` under "Your recipes", `stat` on each card);
  `components/parent/RecipeRow.tsx` (`<DishStatsLine>`); `my-recipe/[id].tsx` (`<DishStatsLine variant="page">`
  above `<WhoCooked>`); `UpdatesCard.tsx` (heart rows, merged by time with "made"); `kid/recipes/index.tsx` +
  `components/recipes/RecipeList.tsx` (`<KitchenHeader>`, learners only); `RecipeListRow.tsx` (`<CookStamp>`);
  `components/recipes/HeartButton.tsx` (`takeHeartsNote` toast); `cook/[id].tsx` `finish()` (`madeItMilestone`).
  Delete `app/dev/hearts.tsx`.
- Kind filters: PR 1's 3.7 (P3 here repeats it; skip if in). hearts.ts names `cooked` itself.
- Reaction exclusions: none new.
- Acceptance: handoff 3.5/3.6 (♥ 1 & the face after a refresh; un-heart removes it; Mom never sees
  Dad's counts; counts match `/me/recipe-stats`; samples never count toward "4 of 7") + "PR 4 checks".

**PR 5, Sunday table & I miss home (handoff 3.2, 3.3).**
- index.ts: add `5` to `prs` (S2; this also registers the `table_nudge` job). api_test: S3.
- Schema: `20261018100300_retention_table.sql` BEFORE the deploy (else `GET /table` is 500 and the nudge
  skips every family); then C1. Deploy: function, then app.
- App mounts: `kid/home.tsx` and `parent/home.tsx` right after `<LargeHeader>` (`<TableRow>`, `large` on the
  cook's, + `<MembersSheet>`); `kid/home.tsx` `<MissHomePill>` in the row's `right` + `<MissHomeSheet>` +
  `useClipAudio(missHomeAudioClip(…))` (needs PR 1's 4.3) and stop on blur; `chat/[id].tsx` header
  (`<WeeksBadge>`, `<MilestoneBurst>`); `app/index.tsx` + `profiles/ProfileTile.tsx` (`<FlameBadge>`);
  `invalidateTable()` in `lib/messaging.ts` `deliver()` / `cooked()` / `sendRecipe()` and `lib/listening.ts`.
  Delete `app/dev/table.tsx`. TODO(caleb) before A3 ships: scope the clip pool to this family's recordings.
- Kind filters: `table_activity` names its own (cooked, heard >= `HEARD_MIN_S`, non-system messages,
  delivered `pending_sends`). Reactions DO count there as messages (a cook's heart is "any message",
  handoff 3.2); that's intended.
- Acceptance: handoff 3.2/3.3 + C1 (grants & shape), C2 (live flow & cron with a `now`), C3 (screens).

**PR 6, Month in the kitchen (handoff 3.7).**
- index.ts: `familyCtx` + `answersFor` in the deps and `6` in `prs` (P2; this also registers the `recap`
  job); after qa-cook, `signPhotos` in the same deps (P4). api_test: P3.
- Schema: none. Deploy: function; then the app (`npx expo install react-native-view-shot` needs an EAS
  rebuild). Live by Nov 30 (first edition Dec 1).
- App mounts: new `app/recap.tsx`; `_layout.tsx` `<Stack.Screen name="recap" …fullScreenModal>`;
  `<RecapCard>` on both Homes under PR 5's `<TableRow>`; `shareSlide` (view-shot + expo-sharing) in
  `recap.tsx`; `heard` tag in `RecapScreen.tsx` (after PR 1's 4.3); `x-tz` in `lib/recapApi.ts`. Delete
  `app/dev/recap.tsx`.
- Kind filters: recapPr.ts names its own (`cooked` & `heard` events; replies `.neq("kind", "reaction")`).
- Reaction exclusions: "Questions you answered" goes through index.ts's `answersFor` (PR 1's 3.8
  exclusions) and recapPr's own reply query skips reactions.
- Acceptance: handoff 3.7 (an empty month: no card, no push; every number matches the database; share
  makes an image) + "PR 6 checks".

---------------------------------------------------------------------------------------------------
## 0. Order of work

1. QA branches land on main in the brief's order: qa-deadends, qa-recipes, qa-people, qa-cook, qa-chat.
   Apply qa-cook's `20261018000000_cooked_photos.sql` (MCP `apply_migration`) before any api deploy
   that contains qa-cook.
2. Rebase `retention-plumbing` onto that main. It holds only new files, so it rebases cleanly.
3. **PR 1 server:** section 3. **PR 1 app:** section 4. Run the checks in section 7. Open PR 1.
4. After merge: migration, then deploy, then the cron migration, then the live checks (section 6).
5. Wave 2 (PRs 2-6) builds on the contracts in section 5.

---------------------------------------------------------------------------------------------------
## 1. What phase 1 added (all untracked, new)

| File | What it is |
|---|---|
| `supabase/functions/api/time.ts` | Each person's local clock: `DEFAULT_TZ`, `validTz`, `zoneOf`, `localParts`, `localDateKey`, `localMonthKey`, `zonedMidnight`, `weekStartUtc`, `monthStartUtc`, `monthBounds`, `inQuietHours`, `NUDGE_AT`, `RECAP_AT`. Imports nothing. |
| `supabase/functions/api/table.ts` | The Sunday table, pure: `computeTable`, `familyPairs`, `pairStreak`, `nudgeCandidates`, `pickNudgeQuote`, `nudgePush`, `weekStart`; types `Activity`, `TableProfile`, `Table`, `TablePair`, `PairStreak`, `NudgeRecipe`. Imports `time.ts` only. |
| `supabase/functions/api/recap.ts` | Month in the kitchen, pure: `computeRecap`, `recapPush`, `isMonth`, `monthName`; types `RecapInput`, `RecapEvent`, `RecapMessage`, `RecapFavorite`, `RecipeInfo`, `RecipeLookup`, `RecapAnswers`, `Slide`, `Recap`. Imports `time.ts` only. |
| `supabase/functions/api/plumbing.ts` | PR 1's core (it was `retention.ts` until integration): caps (`capCheck`, `CAP_REASONS`), the Expo sender (`sendExpoPush`), push copy (`messagePush` & co., `PUSH_KINDS`), `notify()`, `runInBackground` / `backgroundIdle`, `syncTz`, push-token parsing, `dueProfiles`, `makePlumbing()` (routes `/push-tokens`, `/push-tokens/remove`, `/cron/hourly`, and the `cronJobs` registry), the recipe-event kinds (`RECIPE_EVENT_KINDS`, `STAT_EVENT_KINDS`, `HEARD_MIN_S`), and what later routes read: `FamilyProfile` + `familyProfiles()`, `makeLibrary()` (`libraryIndex()`, `recipeInfo()`), `dishesOf()`, the exact `/dish-stats` contract (`DishStat`, `DishStats`, `HeartRecent`, `buildDishStats()`), the shared `RetentionCtx` / `RouteArgs`. Imports time.ts (+ types). |
| `supabase/functions/api/retention.ts` | **The one import for index.ts.** Re-exports every retention module and composes them in `makeRetention(deps)`: PR-tagged `routes` / `publicRoutes` for the PRs in `prs`, their cron jobs registered (section "Integration"). Imported by index.ts only. |
| `supabase/migrations/20261018100000_retention_plumbing.sql` | All schema for PRs 1-4 & 6: `push_tokens`, `notification_log`, `cooking_now`; `profiles.tz / share_cooking / memorial`; `recipe_events` kinds `started`/`heard` + `cook_id / duration_s / clip_start_s` + index; `messages` kind `reaction` + `photo_path` (if not exists) + `rating` + reaction body check. No `photos` bucket (qa-cook owns it), no `reply_to` (exists). |
| `supabase/migrations/20261018100100_retention_cron.sql` | pg_cron + pg_net, a Vault-generated secret, `cron_secret_ok()` & `run_cron_hourly()` (revoked from client keys), the hourly job and a weekly log sweep. Apply after the deploy. |
| `supabase/tests/retention_test.ts`, `table_test.ts`, `recap_test.ts` | Offline unit tests (111 at phase 1; 111 now: 45 + 41 + 25). |
| `supabase/tests/retention_wiring_test.ts` (integration) | 9 tests: `makeRetention`'s PR-tagged route list & jobs, the `prs` switch and its init errors, the cron runner over the registered jobs, no route overlapping an index.ts route, no import cycle (only index.ts imports retention.ts), the code's kind lists vs the migration's checks, the postcard copy. |
| `supabase/tests/retention_migrations_sql_test.ts` (integration) | 5 tests in PGlite: main's migrations, qa-cook's `cooked_photos` and retention's, in timestamp order and then again (idempotent), in both orders of cooked_photos vs plumbing; the photos bucket stays qa-cook's; widened checks; one cron secret & one of each job; function grants; `table_activity` on the real tables. Needs `--allow-read`. |
| `app/src/lib/push.ts` | Push on the phone (lazy expo-notifications, no-op on web/Expo Go/no projectId): `initPush`, `addTapListener`, `pushUrl`, `shouldAskPush`, `requestAndRegister`, `snoozePushAsk`, `syncRegistration`, `unregister`, `pushSupported`. API calls are injected. |
| `app/src/components/push/PushAskSheet.tsx` | The explainer before the OS prompt: `PushAskSheet`, `PushAskHost`, `askForPush({kind, profileId, name, profile?})`. |
| `app/src/lib/tz.ts` | `deviceTimeZone()` for the `x-tz` header. |
| `app/src/lib/kitchenCounts.ts` | "4 of 7" (3.6): `kitchenCounts`, `kitchenFor`, `earnsStamp`, `cookMirror`, `mirrorLine`, `madeItMilestone`; the app copy of `DishStat`/`DishStats`. |
| `app/src/lib/missHome.ts` | "I miss home" (3.3) clip pool: `missHomeEntries`, `clipPool`, `pickClip`, play log helpers. |
| `app/src/components/ui/FlameIcon.tsx` | The drawn sun-yellow flame. |
| `app/scripts/test-retention.mjs` | App logic tests under Node (26). |

---------------------------------------------------------------------------------------------------
## 2. Packages (PR 1)

```bash
cd app
npx expo install expo-notifications expo-keep-awake   # NOT npm i: npm latest is SDK 58
```
- Do **not** install `expo-dev-client` (it makes `npx expo start` skip Expo Go). Test push on a `preview`
  (internal) or TestFlight build.
- `react-native-view-shot` waits for PR 6 (`npx expo install react-native-view-shot`).
- Optional once installed: in `lib/push.ts` replace the local `NotificationsModule` type with
  `typeof import('expo-notifications')` (the TODO there). The lazy `require` stays.
- Caleb only (blocks real push, not the build): `npx eas-cli init` (writes the projectId),
  `node scripts/set-apple-ids.mjs`, Apple push credentials. Until then `pushSupported()` is false and
  nothing shows.

---------------------------------------------------------------------------------------------------
## 3. Server wiring: `supabase/functions/api/index.ts` (PR 1)

### 3.1 Import (after the `npm:jose` import, main L28)
```ts
import {
  HEARD_MIN_S,
  isReaction,
  makeLibrary,
  makeRetention,
  messagePush,
  RECIPE_EVENT_KINDS,
  type RecipeEventKind,
  runInBackground,
  STAT_EVENT_KINDS,
  syncTz,
} from "./retention.ts";
```
This is the only retention import index.ts ever has. Later PRs add names to it: PR 2 `dishName,
reactionPush`; PR 3 `postcardKey, postcardPush`; PR 6 `type RecapFamily`. PRs 4 and 5 add none.

### 3.2 CORS: allow `x-tz` (anchor `"access-control-allow-headers":`, main L46-47)
```ts
"content-type, x-device-key, x-family-code, x-profile-id, x-tz, authorization, apikey, x-client-info",
```
`x-cron-secret` does NOT go here (server-to-server).

### 3.3 Store `x-tz` on every signed-in call
In `Deno.serve`, anchor `const ctx = await authenticate(req, r.auth);` (main L2873). Add the line under it:
```ts
      const ctx = await authenticate(req, r.auth);
      runInBackground(syncTz(db, ctx.me?.id, req.headers.get("x-tz")));
```
Replace the `onPublic("POST", "/events", ...)` ternary (main L2694-2697) so the app's events store it too:
```ts
onPublic("POST", "/events", async (a) => {
  if (!(a.req.headers.get("x-device-key")?.trim() || a.req.headers.get("x-family-code")?.trim())) return landerEvent(a);
  const ctx = await authenticate(a.req);
  runInBackground(syncTz(db, ctx.me?.id, a.req.headers.get("x-tz")));
  return recipeEvent(ctx, a.body);
});
```
Do not touch `authenticate()`'s select (qa-chat and qa-people edit that line). `syncTz` writes at most
once per isolate per change and never throws.

### 3.4 New section `// --- push & cron`, just above `// Server` (main L2843)
```ts
// ---------------------------------------------------------------------------------------------
// --- push & cron (retention PR 1: docs/build/RETENTION-HANDOFF.md 2.4-2.5, RETENTION-WIRING.md)

/** library.json & recipe.json from the public bucket, 10-min cache (dish titles for push copy). */
const library = makeLibrary({ bucketUrl: BUCKET_URL });

/**
 * Every retention route & cron job (retention.ts). Each later PR turns itself on by adding its number
 * to `prs` (and its deps, if any): RETENTION-WIRING.md, "Integration" and the PR sections.
 */
const retention = makeRetention<Ctx>({
  prs: [1],
  db,
  HttpError,
  requireMe,
  rateLimit,
  dbFail,
  clientIp,
  library,
  expoAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null,
});
for (const r of retention.routes) on(r.method, r.path, r.handler, r.auth);
for (const r of retention.publicRoutes) onPublic(r.method, r.path, r.handler);

const dishTitle = async (rid: string | null) => (rid ? (await library.recipeInfo(rid))?.title || null : null);

/**
 * The push for a message someone just sent (handoff 2.5 rows 1-3 & "Just like mine"), to everyone
 * else in the thread who is still in the family. A question goes only to whoever can answer it (the
 * person asked; in the circle, every cook but the asker). Run in the background: never awaited.
 */
async function pushMessage(ctx: Ctx, me: ProfileRow, t: ThreadRow, row: MessageRow): Promise<void> {
  const copy = messagePush(row, me.name, await dishTitle(row.recipe_id));
  if (!copy) return; // a dish someone made, a system note, a heart
  let to = membersOf(ctx, t).filter((p) => p.id !== me.id && !p.removed_at);
  if (copy.kind === "question") {
    const target = questionTargets(ctx, [row], new Map([[t.id, t]])).get(row.id);
    if (target?.answerer) to = to.filter((p) => p.id === target.answerer);
    else if (t.kind === "circle") to = to.filter((p) => p.role === "cook");
  }
  const dedupeKey = copy.kind === "reaction" ? `reaction:${row.reply_to}:${row.body}` : `message:${row.id}`;
  for (const p of to) await retention.notify(p.id, { ...copy, appInitiated: false, dedupeKey });
}

/** "Just in from Dad" for each recipe message just sent (POST /send-recipe, deliverPending). */
async function pushRecipes(senderName: string, rid: string, sent: { profile_id: string; thread_id: string; message_id: string }[]) {
  const dish = await dishTitle(rid);
  for (const x of sent) {
    const copy = messagePush({ kind: "recipe", thread_id: x.thread_id, recipe_id: rid }, senderName, dish);
    if (copy) await retention.notify(x.profile_id, { ...copy, appInitiated: false, dedupeKey: `message:${x.message_id}` });
  }
}
```
- qa-chat adds `recipeCook(id)` (a second recipe.json fetcher). Make it a wrapper so there is one
  cache: `const recipeCook = async (id: string) => (await library.recipeInfo(id))?.cook_name ?? null;`.
  Move the `library` const above it if `recipeCook` is defined earlier in the file. A `const` is only
  readable after its line runs, and route handlers run after module init, so this is safe.
- qa-people renames the route auth type to `AuthOpts`. The retention routes pass `{}` and
  `{ lenientMe: true }`, so they still fit.

### 3.5 Push hooks (never inside `insertMessage`: system notes and deliverPending use it)
**POST /threads/:id/messages** (anchor `await saveNote(ctx, row, replyTo);`, main L1980). Add the push
just before the final `return`:
```ts
    await saveNote(ctx, row, replyTo);
  }
  runInBackground(pushMessage(ctx, me, t, row));
  return (await toMessages(ctx, [row]))[0];
```
**POST /send-recipe** (anchor `sent.push({ profile_id: p.id, thread_id: t.id, message_id: m.id });`, main L2120):
```ts
  }
  runInBackground(pushRecipes(me.name, rid, sent));
  return { sent };
```
**deliverPending** (main L1089). In the `try`, collect what was sent, then push just before
`return { delivered: recipients.length };`. `runInBackground` never throws, so it can't release the claim:
```ts
    const recipients = (members ?? []).map((p) => p.id).filter((id) => id !== row.sender_id);
    const sent: { profile_id: string; thread_id: string; message_id: string }[] = [];
    for (const to of recipients) {
      const thread = await getOrCreateThread(familyId, row.sender_id, to);
      const at = new Date();
      const m = await insertMessage(thread, row.sender_id, { kind: "recipe", recipe_id: rid, created_at: at.toISOString() });
      sent.push({ profile_id: to, thread_id: thread.id, message_id: m.id });
      // (hello voice note insert unchanged)
    }
    // runInBackground never throws, so a push can never release the claim below.
    runInBackground((async () => {
      const { data: who } = await db.from("profiles").select("name").eq("id", row.sender_id).maybeSingle();
      await pushRecipes(who?.name ?? "your family", rid, sent);
    })());
    return { delivered: recipients.length };
```

### 3.6 POST /events: new kinds (replace `recipeEvent`, anchor `/** \`{ recipe_id, kind: "viewed" | "cooked" }\``, main L2630-2648)
The kinds and the 3 s floor are plumbing.ts's (`RECIPE_EVENT_KINDS`, `HEARD_MIN_S`), the same lists the
migration's check and `table_activity` use (`retention_wiring_test.ts` compares them).
```ts
/**
 * `{ recipe_id, kind, cook_id?, duration_s?, start_s? }` from a person in the family. `cook_id` is
 * whose dish it is (the app resolves it by name); `heard` is a clip of a cook's voice that played
 * for `duration_s` >= 3 s from `start_s` (handoff 2.3).
 */
async function recipeEvent(ctx: Ctx, body: () => Promise<Record<string, unknown>>) {
  const me = requireMe(ctx);
  const b = await body();
  const rid = recipeId(b.recipe_id)!;
  const kind = str(b.kind, "kind", { max: 10, required: true }) as RecipeEventKind;
  if (!RECIPE_EVENT_KINDS.includes(kind)) throw new HttpError(400, "kind must be viewed, cooked, started or heard");
  let cookId: string | null = null;
  if (b.cook_id !== undefined && b.cook_id !== null) {
    const id = typeof b.cook_id === "string" ? b.cook_id.toLowerCase() : "";
    if (!ctx.everyone.some((p) => p.id === id)) throw new HttpError(400, "cook_id must be someone in your family");
    cookId = id;
  }
  const duration = num(b.duration_s, "duration_s", { min: 0, max: 3600 });
  if (kind === "heard" && (duration === null || duration < HEARD_MIN_S)) {
    throw new HttpError(400, `duration_s must be at least ${HEARD_MIN_S} for heard`);
  }
  const start = num(b.start_s, "start_s", { min: 0, max: 86400 });
  await assertRecipe(rid);
  // Re-opening within 30 min, a double-tapped "I made it" or a second cook-mode open within a minute
  // counts once; a clip counts again unless it's the same clip within 5 s (a double flush).
  const windowMs = kind === "viewed" ? 30 * 60_000 : kind === "heard" ? 5_000 : 60_000;
  let q = db.from("recipe_events").select("id")
    .eq("profile_id", me.id).eq("recipe_id", rid).eq("kind", kind)
    .gt("created_at", new Date(Date.now() - windowMs).toISOString());
  if (kind === "heard") q = start === null ? q.is("clip_start_s", null) : q.eq("clip_start_s", start);
  const { data: recent, error } = await q.limit(1);
  if (error) dbFail("events find", error);
  if (recent?.length) return { ok: true, counted: false };
  const ins = await db.from("recipe_events").insert({
    family_id: ctx.family.id,
    profile_id: me.id,
    recipe_id: rid,
    kind,
    cook_id: cookId,
    duration_s: duration,
    clip_start_s: kind === "heard" ? start : null,
  });
  if (ins.error) dbFail("event insert", ins.error);
  return { ok: true, counted: true };
}
```

### 3.7 Stats count only views & cooks (or heard/started rows push cooked rows past the row cap)
- `/me/recipe-stats` (main L2754): `.eq("profile_id", me.id).in("kind", STAT_EVENT_KINDS).order(...)`
- `/recipes/:id/activity` (main L2810): `.eq("recipe_id", rid).in("kind", STAT_EVENT_KINDS)`, before `.order(...)`
- Every later query on `recipe_events` names its kinds too (hearts.ts `cooked`; recapPr.ts `cooked` /
  `heard`; `table_activity` `cooked` / `heard`). index.ts reads `recipe_events` in four places on main
  and on every QA branch as of Oct 17: these two, plus `recipeEvent`'s own dedupe select and insert,
  which already name their kind. Re-check with `grep -n 'from("recipe_events")'` after the QA merges.

### 3.8 Reactions (brief D9: ships in PR 1 because PR 2's heart needs it)
1. `const KINDS` (main L848): append `, reaction`.
2. `parseMessage` switch, just before `case "system":`. If qa-cook's `cooked` case sits next to it, keep both:
```ts
    case "reaction":
      // A cook's heart mid-cook, or "Just like mine" on a postcard (handoff 3.1, 3.4).
      if (!isReaction(text)) throw new HttpError(400, "body must be heart or just_like_mine");
      break;
```
3. `parseMessage`, after the `reply_to` block and before `if (rid) await assertRecipe(rid);`:
```ts
  if (kind === "reaction") {
    const madeByOther = replyTo && replyTo.kind === "cooked" && replyTo.sender_id !== ctx.me?.id;
    if ((replyTo && !madeByOther) || (text === "just_like_mine" && !replyTo)) {
      throw new HttpError(400, "A reaction answers a dish someone made");
    }
  }
```
4. POST /threads/:id/messages, between `parseMessage` and `insertMessage` (idempotent "Just like mine"):
```ts
  if (m.kind === "reaction" && m.reply_to) {
    // Tapping "Just like mine" twice sends one.
    const { data: same, error } = await db.from("messages").select(MESSAGE_COLS)
      .eq("thread_id", t.id).eq("sender_id", me.id).eq("kind", "reaction").eq("reply_to", m.reply_to).eq("body", m.body!)
      .limit(1);
    if (error) dbFail("reaction find", error);
    if (same?.length) return (await toMessages(ctx, same as MessageRow[]))[0];
  }
```
5. A reaction must never answer a question. In `answersFor`'s replies query (main L433), add
   `.neq("kind", "reaction")` after `.in("reply_to", chunk)`. In the legacy step loop (main L452), use
   `.neq("kind", "system").neq("kind", "reaction")`.
6. Keep reactions out of the inbox. In `summaries` (main L1047), replace `const rows = byThread.get(t.id) ?? [];` with:
```ts
    // Reactions are stamps under a message: never the headline, never unread, never a thread alone.
    const rows = (byThread.get(t.id) ?? []).filter((m) => m.kind !== "reaction");
```
(A pair thread that has only system notes keeps today's behaviour.)

### 3.9 `supabase/tests/api_test.ts`
- `reset()` tables: add `recipe_events: [], push_tokens: [], notification_log: [],` and after the
  object `pushed = [];`. Declare `let pushed: Row[] = [];` next to `let tables`.
- `fakeFetch`, before the `if (url.origin !== STUB) throw ...` line:
```ts
  if (url.href === "https://exp.host/--/api/v2/push/send") {
    const batch = JSON.parse(await req.text()) as Row[];
    pushed.push(...batch);
    return new Response(JSON.stringify({ data: batch.map(() => ({ status: "ok", id: crypto.randomUUID() })) }), {
      headers: { "content-type": "application/json" },
    });
  }
```
- Right after `await import("../functions/api/index.ts");`:
  `const { backgroundIdle } = await import("../functions/api/retention.ts");`
- The one existing assertion that changes (the `/events` test, main L1171):
  `[400, "kind must be viewed, cooked, started or heard"]`.
- Append this block (verified, 5 tests):
```ts
// === retention (PR 1 wiring) ===================================================================

const LEO = "55555555-5555-4555-8555-555555555555";
const leoByCode = { "x-family-code": CODE, "x-profile-id": LEO };
const tokenFor = (id: string, n: number) => ({
  token: `ExponentPushToken[t${n}]`, family_id: FAM, profile_id: id, device_id: null, platform: "ios",
});
function addLeo() {
  tables.profiles.push({ id: LEO, family_id: FAM, name: "Leo", role: "learner", relation: null, avatar_key: null, sort: 4, removed_at: null, email: null });
}

t("retention: CORS allows x-tz, and a signed-in call stores it on the acting profile", async () => {
  const pre = await handler!(new Request("http://edge.local/functions/v1/api/family", { method: "OPTIONS" }));
  assertMatch(pre.headers.get("access-control-allow-headers") ?? "", /x-tz/);
  assertEquals((await call("GET", "/family", { headers: { ...asMom, "x-tz": "America/New_York" } })).status, 200);
  await backgroundIdle();
  assertEquals(tables.profiles.find((x) => x.id === MOM)!.tz, "America/New_York");
  await call("GET", "/family", { headers: { ...asMom, "x-tz": "+05:30" } }); // refused, kept
  await backgroundIdle();
  assertEquals(tables.profiles.find((x) => x.id === MOM)!.tz, "America/New_York");
});

t("retention: a text pushes the other person once, with the sender's name; never the sender", async () => {
  tables.push_tokens.push(tokenFor(DAD, 1), tokenFor(MOM, 2));
  const th = await call("POST", "/threads", { headers: asMom, body: { other_id: DAD } });
  const sent = await call("POST", `/threads/${th.data.id}/messages`, { headers: asMom, body: { kind: "text", body: "Dinner at 6?" } });
  assertEquals(sent.status, 200);
  await backgroundIdle();
  assertEquals(pushed.map((m) => [m.to, m.title, m.body, m.data.url]), [["ExponentPushToken[t1]", "Mom", "Dinner at 6?", `/chat/${th.data.id}`]]);
  assertEquals(tables.notification_log.map((r) => [r.profile_id, r.kind, r.app_initiated, r.dedupe_key]), [[DAD, "message", false, `message:${sent.data.id}`]]);
});

t("retention: reactions: a heart (no push), 'Just like mine' only on a dish someone else made, once", async () => {
  addLeo();
  tables.push_tokens.push(tokenFor(LEO, 3));
  const th = await call("POST", "/threads", { headers: leoByCode, body: { other_id: MOM } });
  const cid = th.data.id;
  const made = await call("POST", `/threads/${cid}/messages`, { headers: leoByCode, body: { kind: "cooked", recipe_id: "mom-dal" } });
  assertEquals(made.status, 200);
  const text = await call("POST", `/threads/${cid}/messages`, { headers: leoByCode, body: { kind: "text", body: "So good" } });

  const heart = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "reaction", body: "heart" } });
  assertEquals([heart.status, heart.data.kind, heart.data.body], [200, "reaction", "heart"]);
  const bad = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: { kind: "reaction", body: "wow" } });
  assertEquals([bad.status, bad.data.error], [400, "body must be heart or just_like_mine"]);
  for (const body of [
    { kind: "reaction", body: "just_like_mine" }, // needs the dish
    { kind: "reaction", body: "just_like_mine", reply_to: text.data.id }, // not a dish
  ]) {
    const r = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body });
    assertEquals([r.status, r.data.error], [400, "A reaction answers a dish someone made"], JSON.stringify(body));
  }
  const own = await call("POST", `/threads/${cid}/messages`, { headers: leoByCode, body: { kind: "reaction", body: "heart", reply_to: made.data.id } });
  assertEquals(own.status, 400, "not on my own dish");

  const jlm = { kind: "reaction", body: "just_like_mine", reply_to: made.data.id, recipe_id: "mom-dal" };
  const first = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: jlm });
  const again = await call("POST", `/threads/${cid}/messages`, { headers: asMom, body: jlm });
  assertEquals([first.status, again.data.id], [200, first.data.id]);
  await backgroundIdle();
  // Leo's phone: one push for "Just like mine", none for the heart.
  assertEquals(pushed.filter((m) => m.to === "ExponentPushToken[t3]").map((m) => [m.title, m.body]), [["Mom", "“Just like mine.”"]]);

  // Reactions never become the inbox headline or unread.
  const inbox = await call("GET", "/threads", { headers: leoByCode });
  const pair = inbox.data.find((x: Row) => x.id === cid);
  assertEquals([pair.last.id, pair.unread], [text.data.id, 0]);
});

t("retention: POST /events takes started & heard with cook_id; recipe stats still count views & cooks only", async () => {
  addLeo();
  const ev = (body: Row) => call("POST", "/events", { headers: leoByCode, body });
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 2 })).data.error, "duration_s must be at least 3 for heard");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: "nobody", duration_s: 5 })).data.error, "cook_id must be someone in your family");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 5, start_s: 12 })).data, { ok: true, counted: true });
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 5, start_s: 12 })).data.counted, false, "same clip within 5 s");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "heard", cook_id: MOM, duration_s: 7, start_s: 40 })).data.counted, true, "another clip");
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "started", cook_id: MOM })).data.counted, true);
  assertEquals((await ev({ recipe_id: "mom-dal", kind: "cooked", cook_id: MOM })).data.counted, true);
  assertEquals(tables.recipe_events.find((e) => e.kind === "heard")!.clip_start_s, 12);
  const stats = await call("GET", "/me/recipe-stats", { headers: leoByCode });
  assertEquals(stats.data.map((x: Row) => [x.recipe_id, x.views, x.cooked]), [["mom-dal", 0, 1]]);
});

t("retention: push tokens & the cron route are registered", async () => {
  const reg = await call("POST", "/push-tokens", { headers: asMom, body: { token: "ExponentPushToken[abc]", platform: "ios" } });
  assertEquals([reg.status, tables.push_tokens.map((x) => x.profile_id)], [200, [MOM]]);
  const off = await call("POST", "/push-tokens/remove", { headers: { "x-device-key": KEY }, body: { token: "ExponentPushToken[abc]" } });
  assertEquals([off.status, tables.push_tokens.length], [200, 0]);
  const cron = await call("POST", "/cron/hourly", { body: {} });
  assertEquals([cron.status, cron.data.error], [401, "Not allowed"]);
});
```
If a QA branch already adds a learner named Leo or uses `5555…` ids, rename these. qa-cook's
storage stub may require `cooked` messages to carry no photo, which these tests already do.

### 3.10 `docs/build/API.md`
Add a `## Retention` section: `POST /push-tokens`, `POST /push-tokens/remove`, the extended
`POST /events` (kinds, `cook_id`, `duration_s`, `start_s`, the new 400s), `kind: 'reaction'` on
`POST /threads/:id/messages` (400s: "body must be heart or just_like_mine", "A reaction answers a dish
someone made"; idempotent), `POST /cron/hourly`, the `x-tz` header, and pushes per 2.5. Add the deploy
order from section 6 to "Checks". Add `push-tokens` and `badcron` to the 429 list.

---------------------------------------------------------------------------------------------------
## 4. App wiring (PR 1)

### 4.1 `app/src/lib/api.ts` (stays import-free: `scripts/api-smoke.mjs` runs it under Node)
1. `MessageKind` (main L75): add `| 'reaction'`.
2. `NewMessage` union (main L231-262), as the last member before `) & {`:
```ts
  /** A cook's heart mid-cook, or "Just like mine" on a dish someone made (needs reply_to: that cooked message). */
  | { kind: 'reaction'; body: 'heart' | 'just_like_mine'; recipe_id?: string | null }
```
3. After `setApiAuth` (main L340-342):
```ts
let timeZone: string | null = null;

/** The phone's IANA zone, sent as x-tz on signed-in calls (lib/tz.ts deviceTimeZone; set by session.tsx). */
export function setApiTimeZone(tz: string | null) {
  timeZone = tz;
}
```
4. In `once()`, under `if (pid && o.authed !== false) headers['x-profile-id'] = pid;` (main L426):
```ts
  if (timeZone && o.authed !== false) headers['x-tz'] = timeZone;
```
5. Above `export type VoiceUpload` (main L264):
```ts
export type RecipeEventKind = 'viewed' | 'cooked' | 'started' | 'heard';
export type RecipeEventExtra = { cook_id?: string | null; duration_s?: number; start_s?: number };
```
6. Replace `event:` (main L635-637) and add the two token calls:
```ts
  /**
   * POST /events (me): 'viewed' (deduped for 30 min), 'cooked', 'started' (cook mode opened) or
   * 'heard' (a cook's voice played >= 3 s: `duration_s`, `start_s`). `cook_id`: whose dish it is.
   */
  event: (recipeId: string, kind: RecipeEventKind, extra: RecipeEventExtra = {}, o: AuthOverride = {}) =>
    call<{ ok: true; counted: boolean }>('/events', { method: 'POST', body: { recipe_id: recipeId, kind, ...extra }, me: true, retry: 'safe', ...o }),

  /** POST /push-tokens (me): this phone's Expo push token, for the phone's own person (the server decides). */
  pushToken: (input: { token: string; platform: 'ios' | 'android' }, o: AuthOverride = {}) =>
    call<{ ok: true }>('/push-tokens', { method: 'POST', body: input, me: true, retry: 'safe', ...o }),

  /** POST /push-tokens/remove (signed in, no profile): sign-out. Send it before the key is dropped. */
  removePushToken: (input: { token: string }, o: AuthOverride = {}) =>
    call<{ ok: true }>('/push-tokens/remove', { method: 'POST', body: input, retry: 'none', timeoutMs: 3000, ...o }),
```
The existing callers (`messaging.ts` `cooked()` and `logViewed`) pass two arguments and need no change.
If one adds `cook_id` to `cooked()`, use `cookProfile(source, session.profiles)?.id`.

### 4.2 `app/src/lib/session.tsx`
1. Add `setApiTimeZone,` to the `from './api'` import list (main L49-64).
2. Next to `import { kvGet, … } from './storage';` (main L69):
```ts
import { unregister as unregisterPush } from './push';
import { kvGet, kvGetJson, kvSet, kvSetJson, secretGet, secretSet } from './storage';
import { deviceTimeZone } from './tz';

// Every signed-in call carries the phone's zone (x-tz): quiet hours, Sunday weeks, the 1st's recap.
setApiTimeZone(deviceTimeZone());
```
3. `leaveFamily` (main L777). This covers qa-people's "Sign out of this phone" and the MembersSheet leave:
```ts
  const leaveFamily = useCallback(async () => {
    const key = credRef.current.deviceKey;
    // Never waits on the network: the token is forgotten here, the server is told in the background
    // with the key captured now (as wired: see "PR 1 as wired").
    await unregisterPush({ remove: (token) => api.removePushToken({ token }, key ? { deviceKey: key } : {}) });
    if (key) void api.revokeDevice({ deviceKey: key }).catch(() => {});
    ...
```
4. `adopt` (main L579) doesn't unregister, despite the brief. The old key is revoked there, and
   `notify()` skips and deletes tokens of revoked phones. Registering the same token again with the
   new key moves the row (the token is the primary key). An unregister racing the new family's
   `syncRegistration` could also wipe the new token from storage. That second register must really
   happen, even for the same person on the same phone: `setCredential` bumps the session's
   `credentialVersion` whenever the key changes, and PushBridge syncs with
   `` key: `${credentialVersion}|${person}` `` (deps include it), so `syncRegistration`'s in-memory
   dedupe never skips it (as wired).
5. Optional touch (handoff 4): in `UnreadProvider` (main L903-936), when `total` rises while the app is
   open, `haptic('light')` twice, 120 ms apart.

### 4.3 `app/src/lib/media.ts`: an opt-in "heard" measure per play
1. `AudioClip` (main L24-30): add the field, and below the type the listener plumbing:
```ts
  /** A cook's recipe voice: log 'heard' once a play of it reaches 3 s (lib/listening.ts). Voice notes leave it out. */
  heard?: { recipe_id: string; cook_id: string | null };
};

/** One play of a `heard` clip that lasted >= 3 s, from its start. */
export type HeardPlay = { recipe_id: string; cook_id: string | null; duration_s: number; start_s: number };
const HEARD_MIN_S = 3;
let heardListener: ((p: HeardPlay) => void) | null = null;
let heardNow: { meta: NonNullable<AudioClip['heard']>; start: number; max: number } | null = null;

/** lib/listening.ts registers the sender once, so this file needs no api or session import. */
export function setHeardListener(fn: ((p: HeardPlay) => void) | null) {
  heardListener = fn;
}

/** Ends the current play's measure; reports it when it reached 3 s. */
function flushHeard() {
  const p = heardNow;
  heardNow = null;
  if (!p || !heardListener) return;
  const duration = Math.floor(p.max - p.start);
  if (duration < HEARD_MIN_S) return;
  try {
    heardListener({ ...p.meta, duration_s: duration, start_s: p.start });
  } catch {
    // logging never breaks playback
  }
}
```
2. `onStatus` (main L107-114), inside `if (state.phase === 'playing' && now >= ignoreUntil) {`. Track first, then flush on both "ended" paths:
```ts
    if (heardNow) heardNow.max = Math.max(heardNow.max, Math.min(s.currentTime, state.end ?? Infinity));
    if (state.end != null && s.currentTime >= state.end) {
      player?.pause();
      set({ phase: 'ended', position: state.end });
      flushHeard();
      return;
    }
    if (s.didJustFinish) {
      set({ phase: 'ended', position: s.duration || s.currentTime });
      flushHeard();
      return;
    }
```
3. `playClip`, under `// A new clip (or a replay): stop whatever is playing, then load / seek.` and `player?.pause();`:
```ts
  flushHeard();
  heardNow = clip.heard ? { meta: clip.heard, start, max: start } : null;
```
4. `stopAudio`: `flushHeard();` right after `if (onlyKey && state.key !== onlyKey) return;`. This also covers unmount stops.
5. `useClipAudio`'s `current()` (main L245-248) must carry `heard` (it is dropped silently today):
```ts
  const customKey = clip?.key;
  const heardRecipe = clip?.heard?.recipe_id ?? null;
  const heardCook = clip?.heard?.cook_id ?? null;
  const current = useCallback(
    (): AudioClip | null =>
      url
        ? { url, start_s: start, end_s: rawEnd, key: customKey, heard: heardRecipe ? { recipe_id: heardRecipe, cook_id: heardCook } : undefined }
        : null,
    [url, start, rawEnd, customKey, heardRecipe, heardCook],
  );
```

### 4.4 New `app/src/lib/listening.ts`
```ts
// "Heard" events (RETENTION-HANDOFF 2.3): every play of a cook's recipe voice that runs 3 s or more
// posts api.event(recipe, 'heard', {cook_id, duration_s, start_s}). It lights the Sunday table and
// adds up the recap's "minutes of family voices". lib/media.ts measures each play of a clip that
// carries `heard`; this file sends it, so media.ts needs no api or session import. Voice notes and
// the hello card never carry `heard`, so they never log.
//
//   registerHeardLogging()                          // once, from the root layout
//   const heard = useHeard(recipe)                  // then useClipAudio({ ...clip, heard })
import { api } from './api';
import { setHeardListener, type AudioClip } from './media';
import { cookProfile } from './recipes';
import { useSession } from './session';
import type { Recipe } from './types';

let registered = false;

export function registerHeardLogging(): void {
  if (registered) return;
  registered = true;
  setHeardListener((p) => {
    void api.event(p.recipe_id, 'heard', { cook_id: p.cook_id, duration_s: p.duration_s, start_s: p.start_s }).catch(() => {});
  });
}

/**
 * The `heard` tag for a recipe's voice, or undefined when it is my own voice (nothing to log). A cook
 * outside the family (a YouTube dish) logs with cook_id null; the server counts only family cooks.
 */
export function useHeard(recipe: Pick<Recipe, 'id' | 'cook'> | null | undefined): AudioClip['heard'] {
  const { profiles, me } = useSession();
  if (!recipe?.id) return undefined;
  const cook = cookProfile(recipe, profiles);
  if (cook && cook.id === me?.id) return undefined;
  return { recipe_id: recipe.id, cook_id: cook?.id ?? null };
}
```

### 4.5 The two players of a cook's voice (not HearCard: qa-cook changed its props)
- `components/media/MediaSheet.tsx`: `import { useHeard } from '@/lib/listening';`. In `SheetBody`, after
  `const aspect = …`: `const heard = useHeard(r);`. Then on the HearCard (main L145):
  `clip={{ url: r.media.audio_url, start_s: start, end_s: end, heard }}`. (If qa-cook moved this line,
  find the `<HearCard` in `SheetBody`.)
- `components/kid-home/HomeHero.tsx`: `import { useHeard } from '@/lib/listening';`, then replace
  `const clip = heroClip(hero);` (main L42) with:
```ts
  const heard = useHeard(recipe);
  const base = heroClip(hero);
  const clip = base ? { ...base, heard } : null;
```
- Later: the "I miss home" sheet (PR 5) passes `heard` the same way (`missHome.ts` clips carry `recipeId`/`cookId`).

### 4.6 `app/src/app/_layout.tsx`
1. Imports: `useRef` from react; `import { PushAskHost } from '@/components/push/PushAskSheet';`,
   `import { api } from '@/lib/api';`, `import { registerHeardLogging } from '@/lib/listening';`,
   `import { addTapListener, initPush, pushUrl, syncRegistration, type PushPlatform } from '@/lib/push';`.
2. In `RootLayout`, under `<SessionGate />`:
```tsx
                <SessionGate />
                <PushBridge />
                <PushAskHost register={registerPush} />
```
3. Above `const styles` (bottom of the file):
```tsx
const registerPush = (token: string, platform: PushPlatform) => api.pushToken({ token, platform });

/**
 * Push on this phone (RETENTION-HANDOFF 2.3): no banner for the screen already showing, a tapped push
 * opens its screen (a push for someone else on a shared phone opens "Who's in the kitchen?"), and the
 * token follows whoever this phone belongs to. Also starts "heard" logging. No-ops on web & Expo Go.
 */
function PushBridge() {
  const { me, owner } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const navReady = !!useRootNavigationState()?.key;
  const here = useRef(pathname);
  const meId = useRef<string | null>(null);
  useEffect(() => {
    here.current = pathname;
    meId.current = me?.id ?? null;
  }, [pathname, me?.id]);
  useEffect(() => {
    registerHeardLogging();
    void initPush((url) => url === here.current);
  }, []);
  const person = owner?.id ?? me?.id ?? null;
  useEffect(() => {
    if (person) void syncRegistration({ register: registerPush, key: person });
  }, [person]);
  useEffect(() => {
    if (!navReady) return;
    return addTapListener(router, (data) => {
      const url = pushUrl(data);
      const forOther = typeof data.profile_id === 'string' && !!meId.current && data.profile_id !== meId.current;
      return url && forOther ? '/' : url;
    });
  }, [navReady, router]);
  return null;
}
```
A cold-start tap arrives before anyone is picked (`me` is null), so it goes through `router.push(url)`.
After qa-deadends, `SessionGate` holds that link and opens it after "Who's in the kitchen?"
(`holdAfterPick` / `openHeld`); don't duplicate that.

### 4.7 `app.config.ts`, cook mode, haptics
- `app.config.ts` plugins, after `'expo-apple-authentication',` (app.json is qa-cook's):
  `['expo-notifications', { color: '#C8643B', defaultChannel: 'default', enableBackgroundRemoteNotifications: false }],`
- `app/src/app/cook/[id].tsx` (after qa-cook's rewrite): `import { useKeepAwake } from 'expo-keep-awake';`,
  and as the first line of `CookScreen()`, before any early return:
  `useKeepAwake('cook-mode', { suppressDeactivateWarnings: true });`. Add a one-time toast
  "Screen stays on" (kv `cook.awakeToast.<me.id>`, `useToast().show`). Checklist toggle `haptic('selection')`;
  send success `haptic('medium')`. If qa-cook is late, move keep-awake to PR 7 (brief).

### 4.8 When to ask for push (lib level, not screens)
`askForPush` checks everything itself (build supports push, not the first launch, OS never asked, no
"Not now" in 30 days), so calling it at each moment is safe:
- kid, after "I made it" (`cook/[id].tsx` `MadeItOverlay` `onFinished`; PR 3 moves it to after the postcard):
  `void askForPush({ kind: 'kid-first-made', profileId: me.id, name: cook.name, profile: cook })`
- kid, after a question or step send resolves (`lib/messaging.ts` thread send path):
  `kind: 'kid-first-question'`, name = the person asked (or the first cook for a circle question).
- cook, after a Send resolves (`lib/uploads.ts` after `api.pendingSend`, and `messaging.sendRecipe`):
  `kind: 'cook-first-send'`, name = the first recipient's name.
`cook` there is qa-cook's `useOtherCook(recipe)`. Skip it when null.

---------------------------------------------------------------------------------------------------
## 5. Contracts ready for PRs 2-6 (use these, don't rebuild them)

**Shared inputs.** `familyProfiles(db, ctx.family.id)` gives every member with `tz`/`memorial`
(`ctx.profiles` lacks them). Pass it straight to `computeTable` / `computeRecap` / `dueProfiles`.
`library.libraryIndex()` gives `Map<id, {title, cook_name, sample}>`; an empty Map means the bucket
is unreachable. `library.recipeInfo(id)` gives `{id, title, cook_name, sample, steps:[{order, quote}]}`,
which is table.ts's `NudgeRecipe`. `dishesOf(index, me.name)` lists my dishes (the cookProfile name rule).

Everything below comes from `./retention.ts`; add names to the 3.1 import as each PR needs them
(`familyProfiles`, `dishesOf`, `buildDishStats`, `computeTable`, `familyPairs`, `nudgeCandidates`,
`pickNudgeQuote`, `nudgePush`, `weekStart`, `computeRecap`, `recapPush`, `isMonth`, `monthBounds`,
`localDateKey`, `zoneOf`, types `Activity`, `DishStats`, …).

**PR 2, Leo is cooking.** Built; see "PR 2 wiring" below, which replaces the sketch that was here.
Schema is in the migration (`cooking_now`; `profiles.share_cooking` is nullable, and null means not
asked; brief D10). The routes, the started push (title through `dishName()`, dedupe day from the kid's
stored zone and the request's clock, sent with `retention.notify` after the response) and the reaction
push rule (`reactionPush`) all live in `cooking.ts`: turn them on with `prs` (PR 2 S2; makeRetention
builds `makeCooking()`) and don't rebuild the push in index.ts. The consent routes ship as `GET` / `POST /profile/share-cooking
{share}`, not the brief's `/me/settings {share_cooking}`.

**PR 3, Send it home.** Built: see **PR 3 as wired** at the end of this file (the sketch below is
what it was built from). Its route extends qa-cook's `/photo-upload` and `cooked` message in index.ts,
so there is no `prs` number for it. `messages.rating`,
the reaction kind and `photo_path` (if not exists; qa-cook owns the bucket) are in PR 1's migration.
The postcard push copy is `cooking.ts`'s `postcardPush()` (the started push's dish rule, never "He sent
you…"; `retention_wiring_test.ts` pins it). In `POST /messages/:id/postcard`, after the update:
```ts
const info = row.recipe_id ? await library.recipeInfo(row.recipe_id) : null;
retention.notifyLater(cookId, { ...postcardPush(me.name, info), appInitiated: false, dedupeKey: postcardKey(row.id) });
```
(`cookId`: the dish's cook, checked to be someone else in the family, as `POST /cooking` checks it.)

**PR 4, Hearts & kitchen.** `GET /dish-stats?ids=` (≤ 50): ids are `ids ∩ dishesOf(await library.libraryIndex(), me.name)`;
favorites `.in('recipe_id', ids).in('profile_id', familyIdsExceptMe)`; cooked
`recipe_events.eq('family_id').eq('kind','cooked').in('recipe_id', ids).neq('profile_id', me.id)`;
return `buildDishStats(ids, favorites, cooked)`. The shape is the handoff's table exactly, with every
id present (zeros included); `retention_test.ts` and `test-retention.mjs` pin it. App: add
`api.dishStats(ids)` returning `DishStats`, and move `DishStat`/`DishStats` from `lib/kitchenCounts.ts`
into `lib/api.ts` (import them back as types; see the TODO there). `GET /hearts/recent` returns `HeartRecent[]`.

**PR 5, Sunday table.** Built: follow **PR 5 wiring** further down this file. `tablePr.ts` ships
`GET /table` (`makeTable`) and the `table_nudge` cron job, both turned on by `prs`;
`20261018100300_retention_table.sql` is the real `table_activity` function. The draft SQL and cron
snippet that used to sit here are **withdrawn**: the draft had no heard >= 3 s filter, no delivered
recordings (`pending_sends`, kind `published`), no 15-minute collapse, and was named `20261018100200`
(a version now left unused: PR 2's repeat migration of that name was dropped in integration). Never apply
SQL from an older copy of this file; apply the migration file itself. The rules haven't moved:
`activity` is raw instants (table.ts puts each pair's weeks in the kid's zone), a null cook on an
older event is filled from `library.libraryIndex()` by name, and the nudge opens the quoted dish
(TODO(caleb): "that cook's newest recipe" needs dates library.json doesn't have).

**PR 6, Month in the kitchen.** Built: follow **PR 6 wiring** at the end of this file. `recapPr.ts`
ships `GET /recap` (`makeRecap`) and its own `recap` cron job (both turned on by `prs`), which runs every hour of the local 1st
from 10:00 until quiet hours (21:00) with its own due list and pages past the 1000-row cap. Don't
build the route inline in index.ts, and don't add a second job over `due.recap`: `dueProfiles` still
fills it with 10:xx people, and nothing should act on it.

---------------------------------------------------------------------------------------------------
## 6. Migration & deploy order (only from merged main; one deploy owner)

1. qa-cook's `20261018000000_cooked_photos.sql` is applied (MCP `apply_migration`).
2. Read-only pre-check (MCP `execute_sql`): `select conname from pg_constraint where conname in ('recipe_events_kind_check','messages_kind_check');`
   should return both. `select 1 from information_schema.columns where table_name='messages' and column_name='reply_to';` should return one row.
3. Apply `20261018100000_retention_plumbing.sql` with MCP `apply_migration` (name `retention_plumbing`).
   **Never** `supabase db push`: the live versions are MCP timestamps, so the CLI would re-run all 8.
4. Deploy the api function with MCP `deploy_edge_function`:
   - First run `get_edge_function` and mirror the live layout. The entrypoint is `source/index.ts`, so
     the files go as `source/<name>` for **every** file under `supabase/functions/api/`: today
     `index.ts`, `retention.ts`, `plumbing.ts`, `time.ts`, `table.ts`, `recap.ts`, `cooking.ts`,
     `hearts.ts`, `tablePr.ts`, `recapPr.ts`. retention.ts imports all of them from PR 1 on, whatever
     `prs` says, so a deploy missing one fails the import and takes the whole api down.
   - A wave-2 migration goes in **before** the deploy that turns its PR on, in timestamp order. Only
     PR 5 has one: `20261018100300_retention_table.sql` (name `retention_table`) before the deploy with
     `5` in `prs`; without it `GET /table` answers 500 and the nudge job skips every family. PRs 2, 4
     and 6 need no migration (PR 1's file holds their schema).
   - Per PR after PR 1, the order is: merge -> (PR 5: apply its migration, then C1) -> deploy -> live
     checks -> app build. Turning a PR on is a deploy with its number in `prs`; turning it off again is
     a deploy without it (the tables stay; nothing reads them).
   - Set `verify_jwt: false`. The default (true) 401s every app and cron call.
   - From now on the function is multi-file. Tell the QA session that a deploy from any branch
     without these files wipes the retention routes.
5. Apply `20261018100100_retention_cron.sql` (MCP `apply_migration`, name `retention_cron`). Applied
   earlier, the hourly call would only 404.
6. Live checks against the test family. The code is in the main checkout's
   `docs/build/.test-family-code`; never print it. Work through brief PR 1 (f):
   1. Register a bogus `ExponentPushToken[retention-test-0001]` as profile B.
   2. A texts B. `notification_log` shows a `message` row and the bogus token is pruned (Expo's DeviceNotRegistered).
   3. `POST /events` heard with `{cook_id, duration_s: 5}` returns counted.
   4. After any call with `x-tz`, `profiles.tz` is set.
   5. `select public.run_cron_hourly('2026-10-25 17:10:00-07');` then read `net._http_response`: 200 `{"ok":true,…}`.
   6. A wrong secret gets a 401.
   7. `select jobname, active from cron.job;`.
   - `node supabase/tests/retention_live.mjs` covers the HTTP side (push tokens, x-tz, heard events,
     the cron's 401s, /table, /dish-stats, /hearts/recent, /recap, cook mode, the postcard's refusals,
     the reaction staying out of the inbox). PASS/FAIL/SKIP only; `CODE_FILE` env (default: this
     checkout's gitignored file); refuses the family "Our family"; revokes the key it mints. Its header
     lists what a run leaves behind in the test family. Items 2, 4, 5 and 7 above stay SQL checks.
7. App last: an EAS `preview` build once the server (with `x-tz` in CORS) is live. Otherwise web
   preflight fails.
`EXPO_ACCESS_TOKEN` isn't needed unless Enhanced Push Security is turned on.

---------------------------------------------------------------------------------------------------
## 7. Checks (every retention PR)

```bash
npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/*.ts supabase/tests/*_test.ts
# every offline suite: api, retention (unit + wiring + migrations in PGlite), PR 2/4/5/6 route tests, table, recap
npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/
cd app && npx tsc --noEmit && npx expo lint
node scripts/test-retention.mjs && node scripts/test-recommend.mjs && node scripts/test-cooking.mjs \
  && node scripts/test-hearts.mjs && node scripts/test-table.mjs && node scripts/test-recap.mjs
node scripts/api-smoke.mjs        # live, test family
cd ../web && npm run build
```
At integration (Oct 17, before any wiring): 248 Deno tests pass (api 37, retention 45, wiring 9,
migrations 5, table 41, recap 25, cooking 24, hearts 13, tablePr 23, table_activity 3, recap_route 23);
app `tsc` and `eslint` (every new file) are clean; Node: retention 26, recommend 20, cooking 21,
hearts 11, table 19, recap 17.

---------------------------------------------------------------------------------------------------
## 8. Where this departs from the handoff / brief (say so in the PR description)

- **Module layout:** `time.ts` + `plumbing.ts` (caps, sender, copy, notify, PR 1 routes, library) +
  `table.ts` + `recap.ts` + one module per later PR (`cooking.ts`, `hearts.ts`, `tablePr.ts`,
  `recapPr.ts`) + `retention.ts`, which composes them in one `makeRetention()` with a `prs` switch,
  instead of `time.ts` / `push.ts` / `streak.ts` / `recap.ts` and per-PR route sections in index.ts.
  index.ts imports `retention.ts` only and registers its routes in one place.
- **Migration names:** `20261018100000_retention_plumbing.sql` and `20261018100100_retention_cron.sql`
  (both sort after qa-cook's `20261018000000`), and `20261018100300_retention_table.sql` (PR 5's
  `table_activity`), not the brief's `20261018010000` / `20261018020000` / `20261018030000`. PR 2's
  `20261018100200_retention_cooking.sql` was dropped at integration (an idempotent repeat of PR 1's file).
- **`notification_log.skipped_reason`** is `quiet | daily | weekly | monthly` (which cap), not `cap | quiet`.
- **`share_cooking` is nullable** (null = not asked): brief D10, guardrail 6.
- **`adopt()` doesn't unregister** (4.2 explains why); `leaveFamily()` does.
- **`x-tz` comes from a setter** (`setApiTimeZone(deviceTimeZone())` in session.tsx), so `api.ts` stays import-free.
- **`recipeInfo()` returns `cook_name`** (snake case, like library.json and recap.ts), not `cookName`.
- **Reactions** are filtered out of `summaries` entirely, and `insertMessage` neither touches
  `threads.last_message_at` nor marks the thread read for them (a heart from Home must not hide the
  kid's unread question or move the chat up the inbox). Pair threads with only system notes are unchanged.
- **Samples:** table.ts and recap.ts count a family cook's sample dishes toward flames, "family dishes",
  hearts and pair weeks, but never as her voice or quotes. kitchenCounts.ts (3.6) never counts samples.
  Every family dish in the live and test libraries is a sample today. TODO(caleb) in each file.
- **`/dish-stats`** returns an entry for every requested id (zeros included). The app hides zero parts.
- **The PR 5 RPC** returns raw rows with instants, not the brief's distinct week keys (5, PR 5).
- **The recap push (PR 6)** may go any hour of the local 1st from 10:00 until quiet hours (21:00),
  not only at 10:00: a later hour still sends when the library was unreachable at 10. Share is an
  injected capture function and hidden on web. Details in **PR 6 departures**.

Open decisions stay as `TODO(caleb)` in code: quiet hours, nudge hour, memorial UI, heart-count
visibility, pots vs dumplings, cookbook offer, leftovers-week rule across a month boundary (table.ts).

### PR 1 as wired (Oct 17, branch `retention-1-plumbing`, on top of qa-fixes)
Sections 3 and 4 were applied to the post-QA code, with these differences (say so in the PR):
- **Push asks.** `kid-first-made` is asked when cook mode's "I made it" flow ends (`onLeave`, back on
  the dish), not in `onFinished`, which would put the sheet on top of qa-cook's "Show Dad yours"
  photo step; only when the cook was told. `cook-first-send` is asked after Send's burst in
  `send.tsx` (not in `lib/uploads.ts`, which runs before the burst and on background retries) and
  after `messaging.sendRecipe`. `kid-first-question` is asked in `messaging.deliver()` once a
  learner's question (or step question) is stored. Never on a lent phone (its token is the owner's).
  `askForPushSoon` (PushAskSheet) waits 450 ms so a screen change settles first; after
  `messaging.sendRecipe` (WhoCooked's inline Send) it waits 600 ms so the button's "Sent" is seen
  first. TODO(caleb) at all three ask sites: skip the ask when the person named is memorial, once
  `Profile` carries `memorial` (add it to GET /family's `PROFILE_COLS` and guard with `!to.memorial`).
- **Cook's ask copy.** "Want a note when Leo writes back?", not the handoff's "…cooks it?": PR 1 never
  pushes the cook when a kid cooks (`messagePush` sends nothing for a `cooked` message; the `started`
  push is PR 2, the postcard PR 3), and the honesty rule says never promise a note that doesn't come.
  The kid's messages and questions do push the cook, so "writes back" is true. `COOK_ASK_COOKS_IT` in
  `PushAskSheet.tsx` switches to "cooks it" (PR 2 step A0). TODO(caleb) there: a kid who says "Not now"
  to sharing their cooking and sends no photo still sends the cook nothing.
- **Token.** Registered (`syncRegistration`) once someone is in, keyed to
  `${credentialVersion}|${owner ?? me}` (a new key for the same person registers again: 4.2 step 4).
  `leaveFamily` never waits on the network (unlike 4.2 step 3): `unregister` forgets the token here at
  once and sends `POST /push-tokens/remove` in the background with the key captured before
  `forget()`, then the key is revoked and dropped right away. Order doesn't matter (the server skips
  a revoked phone's tokens). A `leaving` ref keeps a refused key on the way out (leaving the family
  from your own phone) from flashing "You were signed out".
- **Live suite.** `supabase/tests/two_sided_live.mjs` now matches the `/events` kind error by its stem
  (`/^kind must be /`): the text changed to "kind must be viewed, cooked, started or heard", and the
  check passes against the server before and after this deploy.
- **Taps.** A `/recipe/<id>` push opens through `openRecipe` (a kid's dishes live in the Recipes tab);
  a push for someone else on a shared phone opens `/?pick=1`, not `/`. A tap while nobody is in (one
  that launched the app, before the session loads) is held with `holdPushAfterPick(url, profile_id)`
  (`signin/handoff.ts`): SessionGate opens it once a home shows only if that person is the one in,
  else `/?pick=1`, so a shared phone never lands on someone else's chat.
- **x-tz** is not sent while the web `?as=` dev aid borrows the build's code. `tz.ts` reads the zone
  fresh each call and `session.tsx` sends it again whenever the app comes back to the front (a flight
  home with the app still running).
- **Server.** qa-chat's `recipeCook()` now wraps `library.recipeInfo()` (one recipe.json cache).
  `pushMessage` also returns early on a `system` row, and sends `just_like_mine` only to the
  `reply_to` message's sender (the dish's maker), even in the circle. The api tests stub `cron_secret_ok` and Expo's
  push API (a token containing "dead" answers DeviceNotRegistered): 10 new tests (x-tz, text push,
  dead token, question routing, reactions, a heart that leaves unread and inbox order alone, recipe
  pushes incl. the pipeline delivery, event kinds and the stats filter, push tokens, the cron runner).
  `insertMessage` returns before the thread touch and `markRead` for a `reaction`.
- **Config.** The expo-notifications plugin is added only when the package resolves (a checkout that
  hasn't run `npm install` still starts); its Android colour is the Hearth green `#5B6F00`. No eas.json
  `development` profile (it needs expo-dev-client): LAUNCH-LINKS.md 6b says to test on `preview` or
  TestFlight.
- **Touches.** Cook mode keeps the screen on with `activateKeepAwakeAsync('cook-mode')` (released on
  leave) and shows the one-time "Screen stays on" toast only after activation resolves (a browser can
  refuse the wake lock even when `navigator.wakeLock` exists).
- **Reactions in the chat.** `ChatLog` leaves `reaction` messages out (no raw "heart" bubble, never an
  answer) until A5 draws them as `ReactionStamp`s. `messaging.cooked()` sends `cook_id` with its
  `cooked` event. Haptics: the shared Send pill is `medium`; ingredient checks already
  tick (`selection`). `lib/media.ts`'s heard measure has a Node test in `scripts/test-retention.mjs`.

---------------------------------------------------------------------------------------------------
## PR 2 wiring: Leo is cooking (handoff 3.1)

Built as new files only. Nothing here is wired yet; this section says exactly where each piece goes.
Server steps are numbered S1-S6, app steps A1-A8. S1-S4 (as rewritten at integration) were applied
with PR 1 and PRs 4-6 to a scratch copy of this branch's `index.ts` and `api_test.ts`: `deno check` is
clean and the api tests pass 49/49 (see the top of this file). The app steps were **not** compiled: they target qa-cook's `cook/[id].tsx`,
qa-chat's `UpdatesCard.tsx` / `ChatLog.tsx` / `ThreadRows.tsx` / `helpers.ts` and qa-people's
`index.tsx` / `status.ts`, which are still moving, so each step names its anchor (line hints are
those branches' as of Oct 17). Every new component renders on `/dev/cooking` (web).

| File | What it is |
|---|---|
| `supabase/functions/api/cooking.ts` | `makeCooking(deps)`: `POST /cooking`, `POST /cooking/end`, `GET /cooking`, `GET` + `POST /profile/share-cooking`. Pure: `dishName` (the app's kitchen.ts rule), `startedPush`, `startedKey`, `reactionPush`, `isReaction`, `REACTIONS`, `consentOf`, `COOKING_FRESH_MS`, and PR 3's `postcardPush` / `postcardKey`; types `CookingStart`, `LiveCooking`. Imports `plumbing.ts` & `time.ts`; built by `makeRetention` when `prs` has 2. |
| (no migration) | PR 2's schema (`profiles.share_cooking` nullable, `messages_kind_check` + `reaction`, `messages_reaction_body_check`, `cooking_now`) is all in PR 1's `20261018100000_retention_plumbing.sql`. The lane's idempotent repeat, `20261018100200_retention_cooking.sql`, was dropped at integration (its TODO(integrator)). |
| `supabase/tests/cooking_test.ts` | 24 offline tests (fake db, fake Expo, a library map), including the primary-key race, memorial cooks and someone else's dish. |
| `app/src/lib/cookingLogic.ts` | No React, no network (Node-tested): the copy, `createCookingSession` (start at once, 2 s step debounce, one call in flight, the consent gate, a 45 min idle end and a new session on the next step change), `createHeartWatch` + `heartFeedFor` (one heart feed per session), `freshLive`, `liveKey`, `isReactionMessage`, `reactionStampText`, the timings. |
| `app/src/lib/cookingApi.ts` | `cookingApi.start / end / live / share / setShare / sendHeart`, `heartFetcher(cookId)`, `CookingError`. Its own fetch with `getApiAuth()` + `x-tz`, like `lib/moveRequests.ts`. |
| `app/src/lib/useCookingSession.ts` | Cook mode: `{consent, askConsent, answerConsent, shared, finish}`. |
| `app/src/lib/useLiveCooking.ts` | Cook Home: `{rows, ready, refresh}` (`GET /cooking` now and every 15 s while focused and in the foreground). |
| `app/src/components/cooking/` | `ConsentSheet`, `HeartBurst` (+ `HeartPop`), `LiveCookingRow`, `ShareCookingRow` (the "changeable later" toggle), `ReactionStamp` (a heart in the chat). |
| `app/scripts/test-cooking.mjs` | 18 Node tests for `cookingLogic.ts`. |
| `app/src/app/dev/cooking.tsx` | Dev page (`/dev/cooking`, `?fail=1` makes hearts fail, `?sheet=1` opens the consent sheet). Delete it once the pieces are on their screens. |

### Server (`supabase/functions/api/index.ts`)

**S1. Import**: add `dishName, reactionPush` to PR 1's one retention import (3.1). Never import
`cooking.ts` directly: index.ts imports `retention.ts` only.

**S2. Turn PR 2 on** (verified). In PR 1's `makeRetention<Ctx>({ … })` call (3.4), add `2` to `prs` and
`assertRecipe` to the deps; PR 1's two `for` lines register the five routes:
```ts
const retention = makeRetention<Ctx>({
  prs: [1, 2],
  db, HttpError, requireMe, rateLimit, dbFail, clientIp, library,
  assertRecipe, // PR 2: checks a dish once per cook-mode session
  expoAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null,
});
```
makeRetention builds `makeCooking()` with `retention.notify` and `library` itself; no new section, no
second `for` loop. `assertRecipe` runs once per session (not per step). The started push goes through `retention.notify`
with the copy, kind, url and dedupe key built in cooking.ts (`startedPush`, `startedKey`), after the
response. Use these and don't rebuild them: the section 5 sketch (`notifyLater`, the raw title,
`new Date()` with a separately loaded zone) is superseded.

**S3. The reaction push rule** (do it in whichever of PR 2 / PR 3 lands first; type-checked). PR 1's
`pushMessage` (3.4) already sends nothing for a heart (`messagePush` returns null). What it gets wrong is
"Just like mine": in the circle it would push every member, and the dish reads "your Mom's Sunday
Chili". Pass the answered message in from POST /threads/:id/messages (3.5):
```ts
  runInBackground(pushMessage(ctx, me, t, row, replyTo));
```
and start `pushMessage` with:
```ts
async function pushMessage(ctx: Ctx, me: ProfileRow, t: ThreadRow, row: MessageRow, replyTo: MessageRow | null = null): Promise<void> {
  if (row.kind === "reaction") {
    // Hearts never push; "Just like mine" pushes only whoever made the dish it answers, once.
    const info = row.recipe_id ? await library.recipeInfo(row.recipe_id) : null;
    const p = reactionPush(row, me, replyTo, info ? dishName(info.title, info.cook_name) : null);
    if (p) await retention.notify(p.to, { ...p.copy, appInitiated: false, dedupeKey: p.dedupeKey });
    return;
  }
  // … PR 1's body as it is
```
The dedupe key (`reaction:<reply_to>:just_like_mine`) is the one PR 1's 3.4 uses, so nothing changes in
`notification_log`.

**S4. `supabase/tests/api_test.ts`** (verified, on top of PR 1's 3.9 plumbing):
- `reset()` tables: add `cooking_now: [],` (PR 1 adds `recipe_events`, `push_tokens`, `notification_log`).
- PR 1's reaction test (3.9) changes one assertion: with this `mom-dal` recipe.json stub the "Just like
  mine" push names the dish, so expect `[["Mom", "“Just like mine.” on your Dal"]]` instead of
  `[["Mom", "“Just like mine.”"]]`.
- `fakeFetch`, next to PR 1's exp.host stub (and PR 4's library stub, if it is in):
```ts
  // PR 2: one dish's recipe.json in the public bucket (whose dish it is, its title for the push).
  if (url.href === "https://storage.googleapis.com/edible-media-379797517579/mom-dal/recipe.json") {
    return new Response(req.method === "HEAD" ? null : JSON.stringify({ title: "Mom's Dal", cook: { name: "Mom" }, steps: [] }), {
      headers: { "content-type": "application/json" },
    });
  }
```
- Append:
```ts
// === retention PR 2: Leo is cooking ===============================================================

const COOKING_KID = "77777777-7777-4777-8777-777777777777";
const asCookingKid = { "x-family-code": CODE, "x-profile-id": COOKING_KID };
function addCookingKid() {
  tables.profiles.push({ id: COOKING_KID, family_id: FAM, name: "Leo", role: "learner", relation: null, avatar_key: null, sort: 6, removed_at: null, email: null });
}

t("PR 2: asked once; then one push to Mom, her live row, the step, the end, and no second push that day", async () => {
  addCookingKid();
  tables.push_tokens.push({ token: "ExponentPushToken[pr2-mom]", family_id: FAM, profile_id: MOM, device_id: null, platform: "ios" });
  const dal = (step: number) => ({ recipe_id: "mom-dal", cook_id: MOM, step, total: 6 });
  const asked = await call("POST", "/cooking", { headers: asCookingKid, body: dal(1) });
  assertEquals([asked.status, asked.data.consent, asked.data.shared], [200, "unasked", false]);
  assertEquals((await call("GET", "/profile/share-cooking", { headers: asCookingKid })).data, { share_cooking: null });
  assertEquals((await call("POST", "/profile/share-cooking", { headers: asCookingKid, body: { share: true } })).data, { ok: true, share_cooking: true });

  const go = await call("POST", "/cooking", { headers: asCookingKid, body: dal(1) });
  assertEquals([go.status, go.data.shared, go.data.new_session], [200, true, true]);
  await backgroundIdle();
  assertEquals(pushed.map((m) => [m.to, m.title, m.body, m.data.url]),
    [["ExponentPushToken[pr2-mom]", "Leo is making your Dal", "Right now, step 1 of 6.", "/parent/home"]]);
  assertEquals(tables.recipe_events.map((e) => [e.profile_id, e.kind, e.cook_id]), [[COOKING_KID, "started", MOM]]);

  assertEquals((await call("POST", "/cooking", { headers: asCookingKid, body: dal(3) })).data.new_session, false);
  const live = await call("GET", "/cooking", { headers: asMom });
  assertEquals(live.data.map((r: Row) => [r.profile.name, r.recipe_id, r.step, r.total]), [["Leo", "mom-dal", 3, 6]]);
  assertEquals((await call("GET", "/cooking", { headers: { "x-family-code": CODE, "x-profile-id": DAD } })).data, []);

  assertEquals((await call("POST", "/cooking/end", { headers: asCookingKid, body: { recipe_id: "mom-dal" } })).data, { ok: true });
  assertEquals((await call("GET", "/cooking", { headers: asMom })).data, []);
  assert((await call("POST", "/cooking", { headers: asCookingKid, body: dal(1) })).data.new_session);
  await backgroundIdle();
  assertEquals([pushed.length, tables.notification_log.length, tables.recipe_events.length], [1, 1, 2]);
});

t("PR 2: 400s, someone else's dish, and Not now (nothing written)", async () => {
  addCookingKid();
  const r = (body: Row) => call("POST", "/cooking", { headers: asCookingKid, body });
  assertEquals((await r({ recipe_id: "mom-dal", cook_id: COOKING_KID, step: 1, total: 6 })).data.error, "cook_id must be someone else in your family");
  assertEquals((await r({ recipe_id: "mom-dal", cook_id: MOM, step: 7, total: 6 })).data.error, "step must be at most total");
  await call("POST", "/profile/share-cooking", { headers: asCookingKid, body: { share: true } });
  const theirs = await r({ recipe_id: "mom-dal", cook_id: DAD, step: 1, total: 6 });
  assertEquals([theirs.status, theirs.data.error], [400, "cook_id must be the dish's cook"]);
  await call("POST", "/profile/share-cooking", { headers: asCookingKid, body: { share: false } });
  assertEquals((await r({ recipe_id: "mom-dal", cook_id: MOM, step: 1, total: 6 })).data.consent, "no");
  assertEquals([tables.cooking_now.length, tables.recipe_events.length], [0, 0]);
  assertEquals((await call("GET", "/cooking", { headers: { "x-family-code": CODE } })).data.error, "x-profile-id header is required for this request");
});
```
If another PR's block already uses the id `7777…` or a learner named Leo, rename these. The api caches
recipe.json for 10 minutes per isolate, so keep `mom-dal`'s stub the same for the whole file.

**S5. `docs/build/API.md`, under "## Retention":**
- `POST /cooking` (me) `{recipe_id, cook_id, step, total}` → `{ok, shared, consent: 'yes'|'no'|'unasked',
  started_at, new_session}`. Cook mode on someone else's dish, sent at once and then 2 s after each step
  change. `cook_id` must be another cook in my family and the dish's cook (recipe.json `cook.name`,
  case-insensitively; not checked when the bucket is unreachable). Until my `share_cooking` is true,
  nothing is stored, logged or pushed and `consent` says why (`unasked` = show the question). For a
  memorial cook nothing is stored either (`shared: false`). The first call of a session (no row, a row
  older than 45 min, or another dish) logs a `started` event with `cook_id` and pushes the cook ("Leo is
  making your Sunday Chili" / "Right now, step 1 of 8.", opens `/parent/home`; at most once per kid,
  dish and kid-local day). Later calls only move the step (a call naming another cook than the
  session's is checked like a new session). `started_at` is the session's start (server clock, always
  `toISOString()` form, the same string on every call of a session): hearts newer than it count. 400s: "recipe_id is required", "recipe_id is not a valid recipe
  id", "cook_id must be someone else in your family", "cook_id must be a cook in your family", "cook_id
  must be the dish's cook", "step/total must be a whole number", "… must be between 1 and 200", "step
  must be at most total". 429 kind `cooking` (240 an hour).
- `POST /cooking/end` (me) `{recipe_id?}` → `{ok}`. "I made it", leaving cook mode, 45 min idle. With a
  `recipe_id` it ends only that dish's session.
- `GET /cooking` (me) → `[{profile: {id, name, role, relation, avatar_key}, recipe_id, cook_id, step,
  total, started_at, updated_at}]`: people in my family cooking **my** dishes right now (step changed
  in the last 45 min, and they said yes), newest first. Poll every 15 s while Home is focused.
- `GET /profile/share-cooking` (me) → `{share_cooking: true | false | null}` (null = never asked).
- `POST /profile/share-cooking` (me) `{share: boolean}` → `{ok, share_cooking}`. The consent answer, or a
  later change. `false` also ends my live session at once. 400 "share must be true or false". 429 kind
  `share-cooking` (30 an hour).
- Hearts mid-cook are `kind: 'reaction', body: 'heart'` messages in the 1:1 thread (PR 1's 3.8), with
  `recipe_id`, never a push. Add `cooking` and `share-cooking` to the 429 list.

**S6. Deploy.** No migration: PR 1's `20261018100000_retention_plumbing.sql` already holds everything
PR 2 reads (and PR 2 can't ship before PR 1). The deploy carries every file under
`supabase/functions/api/` (section 6.4; `cooking.ts` has been in it since PR 1, because retention.ts
imports it). Order: deploy with `2` in `prs`, the live checks below, then the app.

### App

**A0. The cook's push ask.** Set `COOK_ASK_COOKS_IT = true` in `components/push/PushAskSheet.tsx`
once the `started` push ships here, so the explainer after Send says "Want a note when Leo cooks it?"
(PR 1 says "…writes back?"). Check its TODO(caleb) first: a kid who declines sharing and sends no photo
still sends no note.

**A1. Client modules.** Keep `lib/cookingApi.ts`, `lib/cookingLogic.ts`, `lib/useCookingSession.ts` and
`lib/useLiveCooking.ts` as they are: they need nothing from `lib/api.ts` beyond `API_URL` / `getApiAuth`.
Optional later: move the calls into `lib/api.ts` (the TODO in cookingApi.ts). `HeartLike` is a subset of
`Message`, so once PR 1's 4.1 adds `'reaction'` to `MessageKind`, `api.messages` can feed the heart watch.

**A2. Cook mode (`app/src/app/cook/[id].tsx`, after qa-cook).**
- Imports:
```tsx
import { ConsentSheet } from '@/components/cooking/ConsentSheet';
import { HeartBurst } from '@/components/cooking/HeartBurst';
import { useCookingSession } from '@/lib/useCookingSession';
```
- Right under `const step: Step | null = recipe?.steps[n - 1] ?? null;` (qa-cook L96; it needs `n`,
  `total` and `otherCook`, and must stay above every early return):
```tsx
  // Leo is cooking (PR 2): only another family cook's dish (cookProfile matches any name, so check
  // the role). A family cook's sample dishes count (every family dish is a sample today; see PR 2
  // departures). On a lent phone it follows `me`, like every call.
  const liveCook = otherCook?.role === 'cook' ? otherCook : null;
  const [heartKey, setHeartKey] = useState(0);
  const live = useCookingSession({ recipeId: recipe?.id, cook: liveCook, step: n, total, onHeart: () => setHeartKey((k) => k + 1) });
```
  Once `Profile` carries `memorial`, `liveCook` passes it through and the hook turns itself off.
- `finish()` (qa-cook L125). End the live session **first**, so the cook's live row is gone before the
  made-it message lands. `live.finish()` never rejects and waits at most 2 s:
```tsx
  const finish = async () => {
    if (!recipe) return;
    await live.finish();
    const name = recipe.cook.name;
    // … as it is: cooked(recipe.id), refreshRecipeStats, setDone
```
- JSX, after `<StepsSheet … />` and before `{done ? (<MadeItOverlay …` (the overlay covers the burst):
```tsx
      <ConsentSheet
        visible={live.askConsent}
        cookName={liveCook?.name}
        profile={liveCook}
        onYes={() => live.answerConsent(true)}
        onNotNow={() => void live.answerConsent(false)}
      />
      <HeartBurst trigger={heartKey} fromName={liveCook?.name} />
```
  The sheet has no close button and ignores the backdrop, so a stray tap never answers for the kid. A
  swipe down on the grabber and the Android back button both count as "Not now" (BottomSheet calls
  `onClose` for both). Optional in this PR: add `dismissOnDrag?: boolean` (default true) to
  `components/ui/BottomSheet.tsx` (skip the `GestureDetector`'s `onClose` when false) and pass
  `dismissOnDrag={false}` from ConsentSheet, so only the two buttons answer (TODO in ConsentSheet.tsx).
  (Done in the PR 2 wiring, see "PR 2 as wired": no drag, and Android back closes it for the visit only.)
  Yes shows loading until the answer is saved, else "Try again".
  Leaving cook mode unmounts the hook, which ends the session.
- Web dev aid: `/cook/<dish>?as=<kid>` shows the sheet the first time. Use the worktree's `app/.env.local`
  with the **test** family code (brief, PR 1 risks), or this writes to the demo family.

**A3. Updates card (`components/parent/UpdatesCard.tsx`, after qa-chat).** The live rows go first: they
only exist while someone is cooking.
- Imports:
```tsx
import { LiveCookingRow } from '@/components/cooking/LiveCookingRow';
import { cookingApi } from '@/lib/cookingApi';
import { liveKey, type LiveCooking } from '@/lib/cookingLogic';
import { useLiveCooking } from '@/lib/useLiveCooking';
```
- Types (qa-chat L54-57):
```tsx
type CookingUpdate = { kind: 'cooking'; key: string; at: string; live: LiveCooking; entry: LibraryEntry | undefined };
type Update = CookingUpdate | AskUpdate | MadeUpdate | MoveUpdate;
```
- In `useUpdates()`, after `const { me, profiles, profileById } = useSession();`:
```tsx
  const { rows: liveRows } = useLiveCooking({ forId: me?.role === 'cook' ? me.id : null });
```
  and where `items` is built (qa-chat L108-112):
```tsx
  const cooking: CookingUpdate[] = liveRows.map((r) => ({ kind: 'cooking', key: `cooking:${liveKey(r)}`, at: r.updated_at, live: r, entry: getCachedEntry(r.recipe_id) }));
  const items = [...cooking, ...moves, ...mine, ...family];
```
  `liveKey` is kid + dish + session start, so a new session is a new row and its heart starts empty. The
  dismissed filter only touches `made`, so live rows can't be cleared; they go when the session ends
  (the next poll).
- In `row(u, onGo)`, first:
```tsx
    u.kind === 'cooking' ? (
      <LiveCookingRow
        kid={u.live.profile}
        dish={u.entry ? dishName(u.entry.title, u.entry.cook_name) : 'recipe'}
        step={u.live.step}
        total={u.live.total}
        onHeart={() => cookingApi.sendHeart(u.live.profile.id, u.live.recipe_id)}
      />
    ) : u.kind === 'move' ? (
```
  The heart is the row's one action (48 pt; haptic, a small burst and "Sent" beside it, all inside the
  row, so nothing overlaps the card's header or edge). Check it once in the real card at 375 and 390 pt.
  The step line follows within 15 s of each step change.

**A4. "Changeable later"** (handoff: "from the kid's own profile sheet"; there is none, so qa-people's
`/?pick=1` foot, as the brief says). In `app/src/app/index.tsx`, inside the foot (`{choosing && !loading
&& !covered ? (<Animated.View … style={styles.foot}>`, qa-people L277), first:
```tsx
              <ShareCookingRow profileId={me?.id} />
```
(`import { ShareCookingRow } from '@/components/cooking/ShareCookingRow';`, `me` from `useSession()`.) It
reads `GET /profile/share-cooking` for whoever is acting and stays hidden until they have answered once,
so nobody meets a setting for something they never saw. Tapping flips it and saves at once ("Show cooks
when I cook · On/Off").

**A5. Reactions in the chat UI.** PR 2 writes the first real reaction rows: the cook's heart, a
`reaction` with body `heart`, no `reply_to`, in the 1:1 thread. The server side is PR 1's 3.8 (`summaries`
drops reactions, so `last`, `unread`, `GET /unread`, a reaction-only pair thread and everything built on
them are already clean; `answersFor` skips them). `GET /threads/:id/messages` **does** return them, and
without these client changes the kid's chat would show "heart" as a text bubble:
- `components/messages/ChatLog.tsx` (qa-chat): PR 1 filters reactions out at the top
  (`const messages = all.filter((m) => m.kind !== 'reaction')`, with a TODO pointing here). Drop that
  filter when the stamp below lands, or the stamps never show.
  - `groupMessages` (L48): a reaction gets its own centred group, like a system note. Add `stamp: boolean`
    to `Group`, set `const stamp = m.kind === 'reaction';`, treat it like `system` in the split condition
    (`if (!g || system || g.system || stamp || g.stamp || …)`), and never count it as `mine` for alignment.
  - Render (L183, next to `if (g.system)`):
```tsx
        if (g.stamp) {
          const m = g.messages[0];
          const mine = m.sender_id === meId;
          const name = mine ? null : (ctx.profile?.(m.sender_id)?.name ?? ctx.other?.name ?? null);
          return <ReactionStamp key={g.key} body={m.body} name={name} mine={mine} />;
        }
```
    (`import { ReactionStamp } from '@/components/cooking/ReactionStamp';`). It reads "♥ Mom" ("♥ You" on
    the cook's side), small and centred, never the raw body.
  - `lastGroup` (L150): `.find((g) => !g.system && !g.stamp)`, so "· Sent" stays on the last real bubble.
  - `dishCards` (L77): `if (m.kind === 'system' || m.kind === 'reaction') continue;` and add
    `'reaction'` to `OWN_CARD`. A heart carries `recipe_id`; it must never draw a dish card or count as
    "the message above".
  - `nextOf` (L160): `if (m.kind !== 'system' && m.kind !== 'reaction') after = m;`.
  - PR 3 then groups a `just_like_mine` with a `reply_to` under its cooked message instead of a group of
    its own (`ReactionStamp` already words it "“Just like mine.” · Mom").
- `components/messages/helpers.ts` `waitingQuestion` (L65): skip reactions
  (`if (m.kind === 'reaction') continue;` as the loop's first line). Otherwise the cook's own heart,
  being the newest message, makes the kid's open question look answered and its ring goes away.
- `components/messages/ThreadRows.tsx` `previewText` (L26): `case 'reaction': return '';` (never a
  preview; `summaries` never makes one `last`, this is the guard).
- `lib/messaging.ts` `remember()` (L272): if a reaction is ever sent through `useThread().send` (PR 3's
  "Just like mine" pill), skip the inbox `last` update for it: `if (m.kind !== 'reaction')` around the
  `inbox.set(…)`. `cookingApi.sendHeart` doesn't go through it.
- `components/profiles/status.ts` (qa-people) reads `t.unread` and `t.last` from `summaries`, so it is
  clean once 3.8 is in. Belt and braces in `lastSender` (L62): `t.last?.kind === 'system' || t.last?.kind === 'reaction'`.
- The unread badge (`session.tsx` `UnreadProvider` → `GET /unread`) needs nothing: the server counts
  through `summaries`.
- `isReactionMessage(m)` in `lib/cookingLogic.ts` is the one test to use in all of these if you prefer a name.

**A6. When the kid's heart watch looks.** `useCookingSession` asks `GET /threads/:id/messages?after=<the
newest message seen>` in the 1:1 with the cook every 10 s while cook mode is focused and the app is in
the foreground, and right away on each resume. It keeps one feed per session (cook + session start)
across focus and app-state changes, so a heart shows once however often the screen loses focus, and a
heart that lands mid-pause shows on return. `POST /threads` creates that thread on the first look; a
thread with no messages never shows in the inbox.

**A7. Push asks.** None new. PR 1's 4.8 kid moments stay as they are; the started push is the cook's, and
its ask is PR 1's `cook-first-send`.

**A8. Dev page.** `/dev/cooking` is a stand-in for the updates card (qa-chat's padding and header), the
burst and the sheet. Delete `app/src/app/dev/cooking.tsx` once A2-A3 are in. Until then it opens only in
development builds (`__DEV__`); a release build sends the deep link to Home.

### PR 2 departures (say so in the PR description)
- **Routes:** `GET` / `POST /profile/share-cooking {share}` instead of the brief's `/me/settings
  {share_cooking}`. The name says what it holds; there is no other setting yet.
- **Live rows only for the dish's cook** (tighter than the handoff's "my family"): the consent question
  names that cook. Brief D10's nullable `share_cooking` (null = not asked) is kept.
- **Consent covers every cook (flag for Caleb):** `share_cooking` is one answer for all of a kid's
  cooks, but the handoff's question names one ("Let Mom see when you cook their dishes?"). So the line
  under it says the real scope: "Each cook in the family gets a note when you start one of their
  dishes." (guardrail 6). The `/?pick=1` toggle says it the same way ("Show cooks when I cook"). A
  per-cook answer would need a table, not a column.
- **Whose dish:** a new session checks recipe.json's `cook.name` against `cook_id` (400 "cook_id must be
  the dish's cook"). The brief only asked for "a cook in my family". A step that names another cook than
  the session's is checked the same way, and a step never rewrites the row's `cook_id`.
- **Samples count:** a family cook's sample dishes start sessions and push that cook like any other
  dish (the app passes the cook, the server doesn't skip `dish.sample`). Every family dish is a sample
  today, so skipping them would turn the feature off in the demo and test families. The catch (brief:
  ownership by name match): a family profile named like a sample's cook gets "Leo is making your
  <sample dish>". TODO(caleb): skip samples in both places once real recordings exist.
- **One spelling for `started_at`:** every `POST /cooking` answer and every `GET /cooking` row says it
  as `toISOString()` (PostgREST answers `+00:00`), and the app keeps a session's start once set and keys
  its heart feed on the instant, so a heart never bursts twice when the answers' spelling changes.
- **Memorial cooks:** `POST /cooking` stores, logs and pushes nothing for them (`shared: false`). Guardrail
  2: no pair data. As wired, the server checks memorial before consent and answers `consent: 'no'` +
  `memorial: true` (never `unasked`), because the app's Profile has no memorial flag yet and would
  otherwise ask "Let Grandma see…" on the first visit to a late grandparent's dish.
- **Idle:** after the 45 min idle end, the kid's next step change starts a new session (back after a long
  simmer). The server logs another `started` event; the one-push-a-day dedupe sends no second push.
- **"I made it"** waits at most 2 s for the end call before `cooked()`.
- **Race:** two first calls at once (open + a quick step) hit `cooking_now`'s primary key; the loser only
  moves the step and keeps the first call's `started_at` (no second event or push).
- **No migration of its own:** the lane wrote `20261018100200_retention_cooking.sql` as an idempotent
  repeat of PR 1's parts; integration dropped it, since PR 1's file ships first and holds all of it.
- **Consent copy:** "Let Mom see when you cook their dishes?" / "Each cook in the family gets a note when
  you start one of their dishes." (no pronoun data, so "their"; the handoff's "her dishes" assumes one).

### PR 2 as wired (Oct 17, branch `retention-2-cooking`, on top of `retention-1-plumbing`)
S1-S5 and A1-A3, A5, A8 were applied to the post-QA code, with these differences (say so in the PR):
- **Server.** `prs: [1, 2]` + `assertRecipe`. `pushMessage` starts with the reaction branch (S3); the
  "Just like mine" push also checks that the dish's maker is still in the thread (not removed), as
  PR 1's member filter did. A third api test covers the heart from Home (no push, not unread, not
  the headline, a heart-only thread never in the inbox), and a fourth "Just like mine" for a maker
  who has left the family (no push; `notify()`'s own `removed_at` check holds it too).
- **A0 not flipped.** `COOK_ASK_COOKS_IT` stays false ("Want a note when Leo writes back?"): its
  TODO(caleb) says keep "cooks it" only if a kid who says "Not now" (and sends no photo) still gives
  the cook a note, and nothing does yet. Caleb's call.
- **A4 not mounted.** The handoff hosts "changeable later" in the kid's own profile sheet; there is
  none, and no new settings surface was added. `ShareCookingRow` carries a TODO(caleb) with the
  one line to mount it (e.g. the `/?pick=1` foot). Until then a consent answer can't be changed in
  the app.
- **Dev aid.** Cook mode never starts a session while the web `?as=` dev aid borrows the build's
  code (`session.usingDevAid()`, a module flag beside the `devAid` ref), and `cookingApi` sends
  `x-tz` the way `api.ts` does (`getApiTimeZone()`: none under the dev aid). A screenshot writes
  nothing, to any family.
- **One thing at a time.** Cook mode's one-time "Screen stays on" toast waits until the consent
  question is settled (asked, or the server has said whether to ask), and, once asked, until the
  sheet has closed (a toast raised while a sheet closes renders in its viewport and goes with it).
  A failed `POST /cooking` counts as settled (`useCookingSession().startFailed`: offline, a refused
  dish, or an app that reaches a server without PR 2 yet and gets a 404), so the toast still shows
  that visit; if a later step change then gets 'unasked', the sheet comes up on its own.
- **Live rows** sort newest first among themselves and sit above "is on a new phone" (they only
  exist while someone cooks); the dish falls back to "recipe" before the library is cached. They
  sit on top of the card's 3 other rows rather than taking their places, so with kids cooking, "is
  on a new phone" and new questions never drop behind "See all" (live rows still count in "N
  updates"). The row's words open nothing: the heart is its one action (handoff 3.1), and
  `LiveCookingRow` keeps its optional `onPress` in case Caleb wants the words to open the 1:1.
- **Reactions in the chat (A5, extended).** ChatLog splits reactions out of the conversation: one
  answering a message in the log is a `ReactionStamp` under that message on its bubble's side (one
  per person and reaction), so PR 3's "Just like mine" already lands under its cooked message; one
  answering nothing (the heart mid-cook) is a quiet centred line in its place, and repeated taps from
  the same person in a row show once. Every reader of the conversation (answers, dish cards, the
  ring, "Sent", `nextOf`) sees it without reactions. Also kept out: `helpers.waitingQuestion`,
  `ThreadRows.previewText`, `messaging.remember()` (no inbox `last`), `profiles/status.ts`
  `lastSender`, `parent/kitchen.ts` (a cook's heart never closes the kid's question or counts as
  "made"), and `chat/[id].tsx`'s circle "thanks" lookup. The grouping lives in
  `components/messages/chatGroups.ts` (tested in `scripts/test-cooking.mjs`): a quiet line (a heart,
  a system note) that opens a day hands the day to the next group's time line (`showsDay`), so the
  cook's chat, which has no day lines, says "Today, 6:40 pm" under a heart instead of "6:40 pm".
- **Consent sheet answers only by its buttons (review fix).** `BottomSheet` got `dismissOnDrag`
  (default true; false = no drag, no grabber) and ConsentSheet passes false. The Android back button
  (Escape on web) is `onDismiss` -> `useCookingSession().dismissConsent()`: nothing shared that visit,
  nothing saved, asked again next visit. Only a tap on "Not now" saves `share_cooking = false`, which
  matters while ShareCookingRow has no home (nothing in the app can undo it yet).
- **Memorial before consent (review fix).** `POST /cooking` answers a memorial cook's dish
  `consent: 'no', memorial: true` (cooking_test + api_test), and the session treats `memorial` as
  'no' for the visit (one call, no end). The cook-mode TODO(caleb) to pass `memorial` stays (it only
  saves that first call).
- **Screenshots** came from this worktree's Expo web against a local stand-in for the api (a
  made-up family; the real api and families were never called).
- **Open for Caleb before PR 2 reaches real kids (privacy).** With A4 unmounted, a kid who taps Yes
  can't stop sharing, and a tapped "Not now" can't be undone (Android back saves nothing, which
  softens it). A4 names an existing host: the `/?pick=1` foot in `app/src/app/index.tsx`, which
  already holds the phone's own settings. If Caleb agrees, one line mounts it, first in the
  `choosing` foot: `<ShareCookingRow profileId={me?.id} />` (hidden until the kid has answered once).
- **Follow-ups seen, not in this PR (pre-existing).** The made-it overlay title
  `${name} will love this` (cook/[id].tsx, MadeIt.tsx, SPEC) speaks for the cook (guardrail 1): a
  factual title such as "We told Dad." would fit. The inbox preview on web reads
  "Go slow on the beans.· 6:48 pm": ThreadRows puts " · time" in its own Text and web drops the
  leading space at the start of that block, so the gap belongs on the row (a margin), not in the
  string.

### PR 2 checks
```bash
npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/index.ts
npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/api_test.ts supabase/tests/cooking_test.ts \
  supabase/tests/retention_wiring_test.ts
cd app && npx tsc --noEmit && npx expo lint && node scripts/test-cooking.mjs && node scripts/test-retention.mjs
```
Live (test family; register the bogus `ExponentPushToken[...]` for the cook first): as the kid,
`POST /cooking` → `consent: 'unasked'` → `POST /profile/share-cooking {share: true}` → `POST /cooking` →
a `recipe_events` `started` row and a `notification_log` `started` row for the cook. `POST /cooking/end`,
then `POST /cooking` again the same day → a new session, no second log row. `GET /cooking` as the cook →
the row; as another cook → `[]`. `{share: false}` → nothing written. Screens: `/cook/<dish>?as=<kid>`
(the sheet), `/parent/home?as=<cook>` (the live row, the heart), then the kid's cook mode shows the burst
within ~10 s.

---------------------------------------------------------------------------------------------------
## PR 4 wiring: Hearts & kitchen (handoff 3.5 + 3.6)

Built as new files only. Nothing here is wired yet; this section says exactly where each piece goes.
Server steps are numbered P1-P6, app steps A1-A9. P1-P4 (as rewritten at integration) were applied
with PRs 1, 2, 5 and 6 to a scratch copy of this branch's `index.ts` and `api_test.ts`: `deno check` is
clean and the api tests pass 49/49 (see the top of this file); the lane's own run was 40/40, and its
P3 test fails when the P3 filter is taken out. A2-A4 and A6-A8
were applied to a scratch copy of this branch's screens (origin/main's), and `tsc` and `eslint` are
clean. The QA branches move those files, so re-apply against the anchors. A5 (UpdatesCard, which
qa-chat restructures) and A9 (cook mode, which qa-cook rewrites) were not compiled.

| File | What it is |
|---|---|
| `supabase/functions/api/hearts.ts` | `makeHearts(deps)`: `GET /dish-stats`, `GET /hearts/recent`. Pure helpers `parseDishIds`, `parseSince`, `newestHearts`. Imports `plumbing.ts` only (`buildDishStats`, `dishesOf`, types); built by `makeRetention` when `prs` has 4. |
| `supabase/tests/hearts_test.ts` | 13 offline tests (fake db + the real `makeLibrary` over a fake bucket). |
| `app/src/lib/dishStatsApi.ts` | `fetchDishStats(ids)` (batches of 50), `fetchHeartsRecent(since?)`, type `HeartRecent`. Own fetch with `getApiAuth()`, like `lib/moveRequests.ts`. A 404 (routes not deployed yet) reads as "nothing to show". |
| `app/src/lib/heartsCopy.ts` | Pure copy: `dishStatsParts`/`dishStatsText` ("♥ 4 · cooked 3 times"), `statFaces`, `heartNames` ("♥ 4 · Leo, Maya, Dad"), `kitchenLine`, `heartUpdates`, `heartUpdateTitle`. |
| `app/src/lib/heartsNote.ts` | "Mom sees your hearts", once per profile: `takeHeartsNote({meId, cook, wasOn, ok})`. kv `hearts.toastSeen.<profileId>`. |
| `app/src/components/hearts/` | `useDishStats(ids)`, `useHeartsRecent({enabled})`, `DishStatsLine` (card / page), `FacesRow`, `KitchenHeader`, `CookStamp`, `CookMirrorLine`, `HeartUpdateRow`; barrel `index.ts`. |
| `app/scripts/test-hearts.mjs` | 11 Node tests for the three lib files. |
| `app/src/app/dev/hearts.tsx` | Dev page: every piece on made-up data (`/dev/hearts`). Delete it once the pieces are on their screens. |

### Server (`supabase/functions/api/index.ts`)

**P1. Import**: nothing new (PR 4 needs no name in index.ts; never import `hearts.ts` directly).

**P2. Turn PR 4 on.** In PR 1's `makeRetention<Ctx>({ … })` call (3.4), add `4` to `prs`
(e.g. `prs: [1, 2, 4]`). It needs `library`, which PR 1's call already passes. makeRetention builds
`makeHearts()` and PR 1's `for` lines register `GET /dish-stats` and `GET /hearts/recent`. PR 4 can't
land without PR 1 (`makeRetention` is PR 1's).

**P3. The stats count views & cooks only.** This is the risk-list fix. PR 1's 3.7 has the same two lines;
skip this step if they are already in. Since PR 1, `recipe_events` also holds `started` and `heard`, and
these two queries count every kind. That lets heard/started rows push cooked rows out of the 1000/5000-row
cap, and `/me/recipe-stats` makes a zero row for a dish that was only heard. Change exactly these two lines:
- `GET /me/recipe-stats` (anchor: the `recipe_events` select in its `Promise.all`):
  ```ts
  // before
        .eq("profile_id", me.id).order("created_at", { ascending: false }).limit(1000),
  // after
        .eq("profile_id", me.id).in("kind", ["viewed", "cooked"]).order("created_at", { ascending: false }).limit(1000),
  ```
- `GET /recipes/:id/activity` (anchor: the `recipe_events` select in its `Promise.all`):
  ```ts
  // before
        .eq("family_id", ctx.family.id).eq("recipe_id", rid).order("created_at", { ascending: false }).limit(5000),
  // after
        .eq("family_id", ctx.family.id).eq("recipe_id", rid).in("kind", ["viewed", "cooked"]).order("created_at", { ascending: false }).limit(5000),
  ```
`hearts.ts` names its kind itself (`.eq("kind", "cooked")`). Any later query on `recipe_events` must name
its kinds too.

**P4. `supabase/tests/api_test.ts`** (verified). The api caches `library.json` for 10 minutes per isolate,
so the whole file shares one library. If another PR's block also needs one, merge the entries into this
const.
- `reset()` tables: add `recipe_events: [],` (PR 1's 3.9 adds it too; keep one).
- Above `// --- load the function with the stand-ins in place`:
```ts
/** library.json in the public bucket (PR 4: whose dish is whose). One for the whole file: the api caches it 10 min. */
const BUCKET_LIBRARY = [
  { id: "dad-sunday-chili", title: "Sunday Chili", cook_name: "Dad", relation: "Dad", sample: true, recipe_url: "x" },
  { id: "dad-fried-rice", title: "Fried Rice", cook_name: "Dad", relation: "Dad", sample: false, recipe_url: "x" },
  { id: "mom-dal", title: "Mom's Dal", cook_name: "Mom", relation: "Mom", sample: false, recipe_url: "x" },
];
```
- `fakeFetch`, before `if (url.origin !== STUB) throw ...` (next to PR 1's exp.host stub):
```ts
  if (url.href === "https://storage.googleapis.com/edible-media-379797517579/library.json") {
    return new Response(JSON.stringify(BUCKET_LIBRARY), { headers: { "content-type": "application/json" } });
  }
```
- Append:
```ts
// === retention PR 4: hearts & kitchen ============================================================

const MAYA = "66666666-6666-4666-8666-666666666666";
const asMaya = { "x-family-code": CODE, "x-profile-id": MAYA };
const asDadByCode = { "x-family-code": CODE, "x-profile-id": DAD };
function addMaya() {
  tables.profiles.push({ id: MAYA, family_id: FAM, name: "Maya", role: "learner", relation: null, avatar_key: null, sort: 5, removed_at: null, email: null });
}

t("PR 4: Maya hearts & cooks Dad's chili -> Dad's /dish-stats & /hearts/recent show her; Mom sees nothing of Dad's", async () => {
  addMaya();
  assertEquals((await call("POST", "/favorites", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", on: true } })).status, 200);
  assertEquals((await call("POST", "/events", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", kind: "cooked" } })).data.counted, true);
  // Kinds PR 1 adds, written straight into the table: none of them is a cook.
  for (const kind of ["viewed", "started", "heard"]) {
    tables.recipe_events.push({ id: crypto.randomUUID(), family_id: FAM, profile_id: MAYA, recipe_id: "dad-sunday-chili", kind, created_at: new Date().toISOString() });
  }
  // Dad's own heart never counts.
  await call("POST", "/favorites", { headers: asDadByCode, body: { recipe_id: "dad-sunday-chili", on: true } });

  const stats = await call("GET", "/dish-stats?ids=dad-sunday-chili,dad-fried-rice,mom-dal", { headers: asDadByCode });
  assertEquals(stats.status, 200);
  assertEquals(Object.keys(stats.data).sort(), ["dad-fried-rice", "dad-sunday-chili"]);
  const chili = stats.data["dad-sunday-chili"];
  assertEquals([chili.hearts.count, chili.hearts.by.map((h: Row) => h.profile_id), chili.cooked.count, chili.cooked.by.map((c: Row) => [c.profile_id, c.count])],
    [1, [MAYA], 1, [[MAYA, 1]]]);
  assertEquals(stats.data["dad-fried-rice"], { hearts: { count: 0, by: [] }, cooked: { count: 0, by: [] } });

  const recent = await call("GET", "/hearts/recent", { headers: asDadByCode });
  assertEquals(recent.data.map((h: Row) => [h.profile_id, h.recipe_id]), [[MAYA, "dad-sunday-chili"]]);

  assertEquals((await call("GET", "/dish-stats?ids=dad-sunday-chili", { headers: asMom })).data, {});
  assertEquals((await call("GET", "/hearts/recent", { headers: asMom })).data, []);

  // Un-heart: gone from both.
  await call("POST", "/favorites", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", on: false } });
  assertEquals((await call("GET", "/dish-stats?ids=dad-sunday-chili", { headers: asDadByCode })).data["dad-sunday-chili"].hearts.count, 0);
  assertEquals((await call("GET", "/hearts/recent", { headers: asDadByCode })).data, []);
});

t("PR 4: /dish-stats & /hearts/recent 400s", async () => {
  const many = Array.from({ length: 51 }, (_, i) => `dad-${i}`).join(",");
  const r = (path: string, headers: Record<string, string> = asDadByCode) => call("GET", path, { headers });
  assertEquals([(await r(`/dish-stats?ids=${many}`)).status, (await r(`/dish-stats?ids=${many}`)).data.error], [400, "ids: at most 50"]);
  assertEquals((await r("/dish-stats")).data.error, "ids is required");
  assertEquals((await r("/dish-stats?ids=Bad%20Id")).data.error, "ids must be recipe ids separated by commas");
  assertEquals((await r("/hearts/recent?since=soon")).data.error, "since must be an ISO time");
  assertEquals((await r("/dish-stats?ids=dad-sunday-chili", { "x-family-code": CODE })).data.error, "x-profile-id header is required for this request");
});

t("PR 4 wiring: /me/recipe-stats and /recipes/:id/activity count views & cooks only", async () => {
  addMaya();
  const now = new Date().toISOString();
  for (const kind of ["heard", "started"]) {
    tables.recipe_events.push({ id: crypto.randomUUID(), family_id: FAM, profile_id: MAYA, recipe_id: "mom-dal", kind, created_at: now });
  }
  await call("POST", "/events", { headers: asMaya, body: { recipe_id: "dad-sunday-chili", kind: "cooked" } });
  const stats = await call("GET", "/me/recipe-stats", { headers: asMaya });
  assertEquals(stats.data.map((x: Row) => [x.recipe_id, x.views, x.cooked]), [["dad-sunday-chili", 0, 1]], "no zero row for a dish only heard");
  const act = await call("GET", "/recipes/mom-dal/activity", { headers: asMom });
  assertEquals([act.data.cooked, act.data.viewed], [[], []]);
});
```
If PR 1's block already adds a learner with id `6666…` or named Maya, rename these.

**P5. `docs/build/API.md`, under "## Retention":**
- `GET /dish-stats?ids=a,b` (me). Up to 50 distinct recipe ids, comma-separated. Returns
  `{[id]: {hearts: {count, by: [{profile_id, at}]}, cooked: {count, by: [{profile_id, count, last_at}]}}}`,
  newest first. It covers only the asked-for ids **whose cook is me** (library `cook_name` = my name,
  case-insensitively); others are left out. Every one of mine is present, zeros included. Hearts come
  from `favorites` and cooks from `recipe_events` kind `cooked`. Both count only people in my family
  now, never me. 400s: "ids is required", "ids must be recipe ids separated by commas", "ids: at most 50".
  `{}` when the bucket can't be reached.
- `GET /hearts/recent?since=<iso>` (me). Returns `[{profile_id, recipe_id, at}]`: hearts on my dishes
  from my family since `since` (default 14 days ago, at most 30 days back, at most now), newest first,
  at most 20. 400: "since must be an ISO time". There is no push for hearts.

**P6. Deploy.** No migration: `favorites` and `recipe_events` already have every column PR 4 reads.
Add `source/hearts.ts` to the `deploy_edge_function` file list (every file under
`supabase/functions/api/`, section 6.4).

### App

**A1. Data hooks.** Keep `lib/dishStatsApi.ts` as it is. It needs nothing from `lib/api.ts` beyond
`API_URL`/`getApiAuth`. Optional later: move `DishStat`/`DishStats`/`HeartRecent` into `lib/api.ts`
with `api.dishStats` / `api.heartsRecent` (kitchenCounts.ts has the same TODO) and re-export them here.
Screens use the hooks in `components/hearts/useDishStats.ts`. Each refetches on focus, at most every
10 s. If a call fails, the hook keeps its last answer.

**A2. Cook's Recipes (`app/src/app/parent/recipes.tsx`, after qa-recipes/qa-people).** `mine` and `ids`
already exist:
```tsx
import { CookMirrorLine, useDishStats } from '@/components/hearts';
const { me, profiles } = useSession();
const { stats } = useDishStats(ids);
// directly under the "Your recipes" heading, before the search field:
<CookMirrorLine entries={mine} stats={stats} profiles={profiles} meId={me?.id} style={{ paddingHorizontal: space.gutter, marginBottom: space.lg }} />
// each card:
<RecipeRow entry={e} recipe={recipes[e.id]} lastSent={...} stat={stats?.[e.id] ?? null} onPress={...} />
```
The mirror line hides itself until someone has cooked one of her real (non-sample) dishes. Today every
family dish is a sample, so it stays hidden in the demo and test families.

**A3. `components/parent/RecipeRow.tsx`.** Add the optional prop `stat?: DishStat | null`. Under the
activity line, inside `rowStyles.text`:
```tsx
<DishStatsLine stat={stat} profiles={profiles} verb={madeVerb(entry.tags, entry.title)} />
```
`profiles` comes from `useSession()`, `madeVerb` from `./kitchen`, and `DishStatsLine` from
`@/components/hearts`. The line hides each zero part and hides completely at zero. As wired after
review: the line never wraps (words whole, at most 3 faces of 20 pt in the room left, fewer with "+N"
or none on a narrow card; the label names who), and when the stat says it was cooked and the faces
drawn (`onFacesShown`) include everyone who cooked it, the activity line drops its cooked case
(`cardActivityLine` in `lib/heartsCopy.ts`); with no room for those faces it keeps "✓ Leo cooked it",
and "opened it" never names someone who cooked it. TODO(caleb): the alternative always keeps "✓ Leo
cooked it" above the line.

**A4. Her recipe page (`app/src/app/my-recipe/[id].tsx`).** Put this inside the `onLayout` wrapper,
above `<WhoCooked`, so `whoBottom` still measures:
```tsx
const statIds = useMemo(() => [id], [id]);
const { stats } = useDishStats(statIds);
<DishStatsLine variant="page" stat={stats?.[id]} profiles={profiles} style={{ marginBottom: 12 }} />
```
It shows "♥ 4 · Maya, Leo, Mom +1" and hides when nobody has hearted the dish.

**A5. Updates card (`components/parent/UpdatesCard.tsx`, after qa-chat, PR 2 and PR 3).**
- Type: `type HeartUpdate = { kind: 'heart'; key: string; at: string; who: Profile; entry: LibraryEntry };`
- In `useUpdates()`:
```tsx
const { hearts } = useHeartsRecent({ enabled: isCook });
const heartRows: HeartUpdate[] = heartUpdates(hearts, profiles, mineIds, { meId: me?.id, dismissed: dismissedIds, max: 3 })
  .flatMap((h) => { const entry = getCachedEntry(h.recipeId); return entry ? [{ kind: 'heart' as const, key: h.key, at: h.at, who: h.who, entry }] : []; });
```
  Merge `heartRows` by time into the "mine" group, next to `made`. They never go above move requests.
  `dismissedIds` is the card's existing `useDismissed` list (`updates.dismissed.<id>`). Heart keys look
  like `heart:<who>:<dish>:<at>`, so they never collide with message ids. A re-heart after an un-heart
  has a new time, so it shows again.
- In `row(u, onGo)`:
```tsx
case 'heart':
  return <HeartUpdateRow who={u.who} dish={dishName(u.entry.title, u.entry.cook_name)} posterUrl={u.entry.poster_url}
    onPress={() => { onGo?.(); router.push({ pathname: '/my-recipe/[id]', params: { id: u.entry.id } }); }}
    onClear={() => dismiss(u.key)} />;
```
There is no push for hearts (handoff 2.5): this row is the only place they arrive.

**A6. Kid Recipes header (`app/src/app/kid/recipes/index.tsx` + `components/recipes/RecipeList.tsx`).**
Learners only, so the cook's "Family recipes" section (qa-recipes reuses `RecipeList`) stays calm.
- `kid/recipes/index.tsx`:
```tsx
const { me, cooks, profiles, isLearner } = useSession();
const counts = useMemo(() => kitchenCounts(entries, profiles, stats.byId, me?.id), [entries, profiles, stats.byId, me?.id]);
<RecipeList ... kitchens={isLearner ? counts : undefined} profiles={profiles} meId={me?.id} />
```
- `RecipeList.tsx`: add the optional props `kitchens?: KitchenCount[]`, `profiles?: Profile[]`,
  `meId?: string | null`. Inside the keyed `<Animated.View key={active} …>`, above the cards:
```tsx
{kitchens && active !== EVERYONE && active !== FAVORITES ? (
  <KitchenHeader count={kitchenFor(kitchens, active)} cook={cookProfile({ cook_name: active }, profiles ?? [])} style={{ marginBottom: space.lg }} />
) : null}
```
  The header hides itself for a cook with no counted dishes (samples, YouTube).

**A7. Stamps (`components/recipes/RecipeListRow.tsx`).** Add the optional prop `stamp?: boolean`. In
`RecipeCards`, pass `stamp={!!kitchens && earnsStamp(e, profiles ?? [], stats, meId)}`. Then wrap the
meta `Txt` in a row and put the stamp after it:
```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
  <Txt variant="body" size={15} color={colors.muted} numberOfLines={1} style={{ flexShrink: 1 }}>…as today…</Txt>
  {stamp ? <CookStamp /> : null}
</View>
```

**A8. "Mom sees your hearts" (`components/recipes/HeartButton.tsx`).** Ship it in the same release as
A2-A5. Before then, nobody can see the hearts and the note would be untrue.
```tsx
const { me, profiles } = useSession();
const onPress = () => {
  const wasOn = on;
  void fav.toggle(recipeId).then(async (ok) => {
    if (!ok) { /* existing error toast */ return; }
    const entry = getCachedEntry(recipeId);
    const note = await takeHeartsNote({ meId: me?.id, cook: cookProfile(entry ?? null, profiles), wasOn, ok });
    if (note) toast.show(note, { icon: <HeartIcon size={14} filled color={colors.card} /> });
  });
};
```
It fires only on off → on, once it is saved, and only when the dish's cook is someone else in the
family. Each profile sees it once on this phone. Memorial cooks are skipped once `Profile` carries
`memorial`. The particles (section 4) go in an overlay sibling; never put a transform on the glyph.

**A9. "I made it" milestones (`cook/[id].tsx` `finish()`, after qa-cook).** Use phase A's
`madeItMilestone` and read the stats **before** the refresh:
```tsx
const milestone = madeItMilestone({ entries, profiles, meId: me.id, before: stats.byId, recipeId: recipe.id });
// … after cooked() …
setDone({ title: milestone?.title ?? existingTitle, subtitle: existingSubtitle });
```

### PR 4 departures (say so in the PR description)
- `/dish-stats` leaves out ids that aren't mine, and lists every one of mine with zeros (as in section 8).
- Cooks are counted with `.in("profile_id", familyOthers)` rather than the `.neq("profile_id", me.id)`
  in section 5. That excludes removed people the same way the hearts query does.
- Hearts from other cooks count too: everyone in the family except me (handoff: "profiles in my
  family, me excluded"). qa-recipes lets cooks heart. TODO(caleb) if only kids should count.
- Hearts on sample dishes count (they are real hearts from real people, and every family dish is a
  sample today). The "4 of 7" counts and the mirror line never count samples (kitchenCounts.ts).
- `/hearts/recent`: the server maps my dishes (the app passes no ids). Default 14 days, at most 30, at most 20 rows.
- The kid header shows "Grandma's 7 dishes" with empty dots before the first cook. It has no count
  and no nudge in it. A 13th dish and beyond: no dots, just the words.

### PR 4 as wired (Oct 17, branch `retention-4-hearts`, on top of `retention-2-cooking`)
P2, P4, P5 and A2-A9 were applied to the post-QA code, with these differences (say so in the PR):
- **Server.** `prs: [1, 2, 4]`; no new dep (PR 4 needs only `library`). P3 was already in (PR 1's
  `STAT_EVENT_KINDS`). The P4 test block also checks that a heart sends no push; `BUCKET_LIBRARY`
  is stubbed at `${BUCKET}/library.json` (no other route reads the index while PR 5/6 are off).
- **A1 not moved.** `dishStatsApi.ts` stays as it is (the optional fold into `lib/api.ts` is still
  the TODO(wiring) there and in `kitchenCounts.ts`).
- **Cook's Recipes (A2, A3).** The mirror line sits between "Your recipes" and the search field
  (`marginTop: space.md`); pull to refresh also refetches `/dish-stats`. Each card's screen-reader
  label adds the stat with who ("4 hearts, cooked 3 times. Leo, Maya, Dad"). Review fix: the card
  never grows past title + 2 lines. The stat line is one line (`facesThatFit` measures the room
  beside the words: at most 3 faces, 20 pt, "+N"; none when even one won't fit, e.g. a 3-person
  "♥ 2 · cooked 3 times" on a 390-pt phone). The activity line drops "✓ Leo cooked it" only when
  the stat says cooked and the faces actually drawn (DishStatsLine `onFacesShown`) include everyone
  who cooked it; otherwise it keeps naming them (second review fix: on a phone the busy cards had no
  faces, so nothing said who). Its "opened it" fallback leaves out anyone who cooked it, so Dad's
  chili never reads "Maya opened it twice" after Maya cooked it. TODO(caleb) in `RecipeRow.tsx`: or
  always keep "✓ Leo cooked it" above the line.
- **Updates card (A5).** `useUpdates(dismissed)` takes the card's cleared ids, so the 3 heart rows
  are the newest 3 *not cleared* (clearing one brings the 4th up); heart rows clear like "made"
  rows (`clearable`). They are only fetched for a cook (`useHeartsRecent({ enabled: me.role ===
  'cook' })`) and never hold the card's skeleton.
- **Kid header & stamps (A6, A7).** Learners only, and only once `/me/recipe-stats` has answered
  (`useRecipeStats().loaded`, new: `ready` is also true after a failed first load with no rows, which
  would read as "nothing cooked"). The header shows only when the chip has rows. Stamps come from a
  `stampFor` callback on `RecipeCards`, so search results (which reuse it) never stamp.
- **Hearts note (A8).** Review fix (guardrail 2): `GET /family` now returns `memorial` per profile
  (its own select in plumbing.ts `memorialIds()`, so authenticate()'s line and `PROFILE_COLS` stay
  as QA left them; unreadable = the flag left out, never false). `Profile.memorial` carries it,
  HeartButton calls `takeHeartsNoteFor({ entry, profiles })`, and the note needs `memorial ===
  false`, so a memorial cook, or a family loaded without the flag, never gets "Grandma sees your
  hearts". With the flag on Profile, the three push-ask sites (kid-first-question, cook-first-send,
  kid-first-made) skip a memorial person and cook mode's `liveCook` passes it to the cooking hook.
- **Milestones (A9).** Learners only (a cook never sees the "4 of 7" counts, so "Keeper of…" would
  come from nowhere), computed first in `finish()` from the stats before the refresh, and only when
  `useRecipeStats().loaded`; the milestone replaces the burst's title and keeps "We told Dad.".
- **Dev aid.** `app/dev/hearts.tsx` deleted (screenshot kept as a reference).
- **Screenshots** came from this worktree's Expo web against a local stand-in for the api and the
  bucket's JSON (a made-up family whose family dishes are real recordings, re-titled from the bundled
  recipes, so the "4 of 7" counts show); the real api and families were never called.
- **Seen, not in this PR.** The made-it title `${name} will love this` still speaks for the cook
  (guardrail 1; PR 2's follow-up); a milestone replaces it, the usual case still shows it.

### PR 4 checks
```bash
npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/index.ts
npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/api_test.ts supabase/tests/hearts_test.ts
cd app && npx tsc --noEmit && npx expo lint && node scripts/test-hearts.mjs && node scripts/test-retention.mjs
```
Live (test family; every family dish there is a sample, so hearts show and the "4 of 7" stays hidden):
a kid with no phone hearts a cook's dish (`POST /favorites`). The cook's `GET /dish-stats?ids=<it>` and
`GET /hearts/recent` list the kid. Another cook's `GET /dish-stats?ids=<it>` returns `{}`. Un-hearting
removes the kid from both. Screens: `/parent/recipes?as=<cook>`, `/my-recipe/<id>?as=<cook>`,
`/parent/home?as=<cook>`, and `/kid/recipes?as=<kid>` with a cook chip.

---------------------------------------------------------------------------------------------------
## PR 5 wiring: Sunday table & I miss home (handoff 3.2 + 3.3)

Built as new files only. Nothing here is wired yet; this section says exactly where each piece goes.
Server steps are S1-S6, app steps A1-A8, checks C1-C3. S1-S3 (as rewritten at integration) were
applied with PRs 1, 2, 4 and 6 to a scratch copy of this branch's `index.ts` and `api_test.ts`:
`deno check` is clean and the api tests pass 49/49 (see the top of this file). The app steps were not compiled against the screens (qa-people, qa-chat and qa-cook move them);
every piece they use is on `/dev/table`, and `tsc` and `eslint` are clean on the new files.

| File | What it is |
|---|---|
| `supabase/functions/api/tablePr.ts` | `makeTable(deps)`: `GET /table` (auth `{ lenientMe: true }`), the `table_nudge` `cronJob`, `loadActivity`. Pure helpers `parseActivity`, `toActivity`, `needsMoreHistory`, `viewerTz`. Per-isolate cache: rows older than ~8 days are reused for 60 s per family, the last 8 days are read on every call (so a flame shows the moment it's earned), and a family whose streak needed more than 53 weeks starts at that window. The nudge quotes and opens only recordings this family published (`pending_sends` delivered with a `recipe_id`); a delivered recording lights the dish's cook, not whoever registered the send. Imports `plumbing.ts`, `table.ts`, `time.ts` (and a type from `recap.ts`); built by `makeRetention` when `prs` has 5. |
| `supabase/migrations/20261018100300_retention_table.sql` | `public.table_activity(p_family uuid, p_since timestamptz) returns jsonb`: one array (no 1000-row cap) of `cooked` / `heard` (>= 3 s) events, non-system `message`s with `thread_with` (the other person of a 1:1 thread, absent in the circle), and `published` rows per recipient of a delivered recording with the dish's `recipe_id` (one row without a target when it went to nobody). Repeats within a 15-minute slot collapse. Security definer, `search_path = ''`, service role only. |
| `supabase/tests/tablePr_test.ts` | 23 offline tests: the route with a stand-in for the RPC, the cache (a cron `now` ahead of real time included), how far back history loads, the library fallback (current cooks only; a delivered recording credited to its cook), the nudge alone (never a same-named cook from another family) and through retention's `/cron/hourly` with `notify()` and a fake Expo. |
| `supabase/tests/table_activity_sql_test.ts` | 3 tests that run the migration's SQL in an in-memory Postgres (PGlite, `npm:@electric-sql/pglite@0.2.17`, fetched by Deno like `jsr:@std/assert`; nothing is installed in the repo): row kinds and shape, heard >= 3 s, system notes left out, `thread_with` pair vs circle, `pending_sends` unnesting with the dish's `recipe_id` (empty list included), the 15-minute collapse, `p_since`, other families, and `permission denied` for `anon` / `authenticated`. Needs `--allow-read`. |
| `app/src/lib/sundayTable.ts` | The `GET /table` types (`Table`, `TablePair`, `TablePerson`) and pure rules: `asTable`, `litIds`, `tableFaces` (cooks first, at most 8, me never cut), `fitFaces`, `pairWith`, `weeksOf`, `weeksLabel`, `milestoneOf`, `milestoneTitle`, `claimMilestone` / `milestoneSeen` / `releaseMilestone` (kv `table.milestone.<me>.<kid>.<cook>.<n>`, written only once the burst has played to the end). |
| `app/src/lib/tableApi.ts` | `useTable({ enabled? })`, `refreshTable(personId, { force? })`, `invalidateTable()`, `tableApi.get(personId?)`. Own fetch with `getApiAuth()` + `x-tz`, like `lib/moveRequests.ts`; `x-profile-id` is the person asked for. One shared store; asks on mount, focus, foreground and person change (at most every 10 s unless stale or forced); a late answer for the person before a switch is dropped. A 404 (route not deployed), offline or junk keeps the last table (null at first), so nothing shows rather than made-up flames. |
| `app/src/lib/missHome.ts` (phase A, extended) | Adds `nextClip(pool, me, { current })` (pick + remember, never the clip on screen) and `missHomeAudioClip(clip)` (the `useClipAudio` input, tagged `heard`). |
| `app/src/components/table/` | `TableRow` (one row; cells share the width, 48-64 pt, or 68-88 pt with 56-pt faces and 16-pt names when `large`; "+N" when the faces don't fit; header with the `right` slot even before faces load), `FlameBadge` (the flame disc on a lit face), `WeeksBadge` ("6 weeks"; nothing for 0 or an ember), `MilestoneBurst` (one-time "12 weeks at the table with Mom"; remembered once it has played, so a quick back tap leaves it for next time). |
| `app/src/components/missHome/` | `MissHomePill`, `MissHomeSheet` (player injected as a prop), `useMissHome(pool, me)`. |
| `app/scripts/test-table.mjs` | 19 Node tests: sundayTable, the sheet's moves in missHome, and tableApi's store when a shared phone switches people mid-request. |
| `app/src/app/dev/table.tsx` | Dev page: every piece on made-up data (`/dev/table`, `?sheet=1`, `?burst=1`). Delete it in A8. |

### Server (`supabase/functions/api/index.ts`)

**S1. Import**: nothing new (never import `tablePr.ts` directly).

**S2. Turn PR 5 on.** In PR 1's `makeRetention<Ctx>({ … })` call (3.4), add `5` to `prs`. It needs
`library`, which PR 1's call already passes. makeRetention builds `makeTable()` (sharing `library`'s
10-minute cache), PR 1's `for` lines register `GET /table` (auth `{ lenientMe: true }`), and the
`table_nudge` job is registered on the hourly cron for you: **don't** push it into `retention.cronJobs`
(that would run the nudge twice; the dedupe key would stop the second push, but not its work).
`GET /table` reads `x-tz` itself (the caller's zone frames their own week before `syncTz` stores it),
so PR 1's CORS line (3.2) must already allow `x-tz`.

**S3. `supabase/tests/api_test.ts`** (verified with S1-S2; 49/49 with every PR):
- Next to `let tables`:
```ts
/** What public.table_activity answers (PR 5), per test: the rows since p_since, as one jsonb array. */
let tableActivity: Row[] = [];
```
- In `reset()`, next to `rateHits = [];`: `tableActivity = [];`
- `fakeFetch`, just above `if (url.pathname === "/rest/v1/rpc/hit_rate") {`:
```ts
  if (url.pathname === "/rest/v1/rpc/table_activity") {
    const since = Date.parse(body.p_since);
    const rows = body.p_family === FAM ? tableActivity.filter((r) => Date.parse(r.at) >= since) : [];
    return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
  }
```
- Append:
```ts
// === retention PR 5: the Sunday table ============================================================

const NIA = "77777777-7777-4777-8777-777777777777";
const asNia = { "x-family-code": CODE, "x-profile-id": NIA };

t("PR 5: GET /table: Nia cooks Mom's dish & Mom answers -> 1 week, both lit; only Nia's own pairs", async () => {
  tables.profiles.push({ id: NIA, family_id: FAM, name: "Nia", role: "learner", relation: null, avatar_key: null, sort: 4, removed_at: null, email: null });
  // A minute ago: this week, unless the test runs in the first minute of a Monday in Los Angeles.
  const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
  tableActivity = [
    { at: ago(60), actor_id: NIA, kind: "cooked", target_cook_id: MOM },
    { at: ago(30), actor_id: MOM, kind: "message", thread_with: NIA },
  ];
  const r = await call("GET", "/table", { headers: asNia });
  assertEquals(r.status, 200);
  assertEquals(r.data.people.filter((p: Row) => p.lit).map((p: Row) => p.profile_id).sort(), [MOM, NIA].sort());
  assertEquals(r.data.pairs.map((p: Row) => [p.kid_id, p.cook_id, p.weeks, p.lit_this_week]), [[NIA, MOM, 1, true], [NIA, DAD, 0, false]]);
  // A cook sees only the pairs they're in; no one picked (lenient): faces only.
  assertEquals((await call("GET", "/table", { headers: asMom })).data.pairs.map((p: Row) => p.kid_id), [NIA]);
  const none = await call("GET", "/table", { headers: { "x-family-code": CODE } });
  assertEquals([none.status, none.data.pairs], [200, []]);
  assertEquals(none.data.people.some((p: Row) => p.profile_id === SAM), false, "removed people aren't at the table");
});
```
If PR 1's or PR 4's block already uses `7777…` or a learner named Nia, rename these. The api keeps a
family's rows older than 8 days for 60 s per isolate, and the whole test file is one isolate: a later
test that stages rows older than 8 days for `FAM` must use another family or rows within the last 8 days.

**S4. `docs/build/API.md`, under "## Retention":**
- `GET /table` (signed in; `x-profile-id` optional: a removed or locked one is ignored, like
  `/family`). Returns `{week_start, people: [{profile_id, lit}], pairs: [{kid_id, cook_id, weeks,
  ember_until, lit_this_week, milestone?}]}`. `people`: every current member, cooks and kids, with
  this week's flame (a memorial cook's face stays, never lit). `pairs`: only the kid-cook pairs that
  include the caller (none with no one picked); `weeks` is null while an ember shows, `milestone` is
  4, 12, 26 or 52 in the week it's reached. The week is Monday-start in the caller's zone (`x-tz`,
  else their stored zone; a cook with exactly one kid uses that kid's zone). No 4xx of its own; a
  database failure is 500. Computed on read; rows older than ~8 days are cached 60 s per family.
- The Sunday nudge (cron job `table_nudge`, push kind `table_nudge`, app-initiated): to a kid at
  local Sunday 17:xx whose longest unlit streak this week is with a cook, never to cooks, never about
  a memorial cook. Body: “<quote>” · Your week at the table is still open. (no quote left: "Your week
  at the table with {cook} is still open."). Quotes are the cook's own step words (≤ 90 chars) from
  real recordings this family published (a delivered send), not reused for that kid within 15 days;
  never another family's recording, whatever its cook is called. Opens the quoted dish, else the
  cook's first recording this family published, else a sample dish under the cook's name, else
  `/kid/home`. Dedupe `table_nudge:<kid>:<week_start>`.

**S5. Migration, before the deploy.** Apply `supabase/migrations/20261018100300_retention_table.sql`
with MCP `apply_migration` (name `retention_table`), after `20261018100000_retention_plumbing.sql`
(it reads `recipe_events.cook_id` / `duration_s`) and after the cron file `20261018100100` (timestamp
order; PR 1 applied both), and **before** the api deploy with `5` in `prs` (S2). Deployed first,
`GET /table` answers 500 ("function does not exist") and the nudge job logs "family skipped" for
every family. Never `supabase db push` (section 6.3). Then run C1.

**S6. Deploy.** Every file under `supabase/functions/api/` goes (section 6.4; `tablePr.ts` has been in
the deploy since PR 1, because retention.ts imports it). Order: S5's migration, C1, the deploy with `5`
in `prs`, C2-C3, then the app. A deploy with `5` in `prs` before S5 answers 500 on `GET /table`.

### Checks against the live database (read-only; MCP `execute_sql`, after S5)

**C1.** `<FAM>` is the test family's id (look it up without printing the family code; the code file
is the main checkout's `docs/build/.test-family-code`).
1. Grants: `select has_function_privilege('anon', 'public.table_activity(uuid, timestamptz)', 'execute') as anon, has_function_privilege('authenticated', 'public.table_activity(uuid, timestamptz)', 'execute') as authed, has_function_privilege('service_role', 'public.table_activity(uuid, timestamptz)', 'execute') as service;`
   must be `false, false, true`. (A client key calling `rpc('table_activity')` gets "permission denied".)
2. Shape: `select r->>'kind' as kind, count(*) from jsonb_array_elements(public.table_activity('<FAM>', now() - interval '400 days')) r group by 1;`
   only `cooked`, `heard`, `message`, `published` appear.
3. Heard filter: `select count(*) from jsonb_array_elements(public.table_activity('<FAM>', now() - interval '400 days')) r where r->>'kind' = 'heard' and (r->>'duration_s')::numeric < 3;`
   must be 0. (`POST /events` refuses heard under 3 s, so live rows rarely test this; the PGlite test does.)
4. System notes: `select count(*) from public.messages where family_id = '<FAM>' and kind = 'system';` vs
   `select count(*) from jsonb_array_elements(public.table_activity('<FAM>', now() - interval '400 days')) r where r->>'kind' = 'message';`:
   the second is at most the non-system message count (fewer when repeats collapse), never more.

**C2. Live flow (brief PR 5 (f)).** A kid cooks Dad's dish (`POST /events` `{recipe_id, kind: "cooked",
cook_id: <Dad>}`) and Dad replies in their pair: `GET /table` as the kid shows the pair at `weeks: 1`,
`lit_this_week: true`, both faces lit; as Dad, the same pair; with no `x-profile-id`, `pairs: []`.
Cron: `select public.run_cron_hourly('<a Sunday 17:10 in the kid''s zone>');` with a bogus token for
the kid and the pair unlit that week: one `table_nudge` row in `notification_log` (with `quote_key`
when Dad has a real recording this family published, i.e. a delivered `pending_sends` row with its
`recipe_id`, else null); a re-run adds nothing (dedupe); a cap or quiet-hours skip
carries `skipped_reason`.

**C3. Screens** (web, `?as=`): `/kid/home?as=<kid>`, `/parent/home?as=<cook>`, `/chat/<pair>?as=<kid>`,
`/?pick=1`. The test family has no family audio, so the "I miss home" pill stays hidden there until
a real recording exists.

### App

**A1. Data.** Keep `lib/tableApi.ts` as it is: it needs nothing from `lib/api.ts` beyond
`API_URL`/`getApiAuth`. Screens call `useTable()`; it shares one store, so the Homes, the chat header
and the Profiles tiles ask once between them.

**A2. Both Homes: "This week at the table".** `app/src/app/kid/home.tsx` and `app/src/app/parent/home.tsx`.
Anchor: right after `<LargeHeader … />` inside the `Animated.ScrollView` (qa-people's `ActingAsBar`
lives in the tab layouts, not here; if a QA branch moves it into the Home, go right after it).
```tsx
import { MembersSheet } from '@/components/messages';
import { TableRow } from '@/components/table/TableRow';
import { useToast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { openChatWith } from '@/lib/messaging';
import { tableFaces } from '@/lib/sundayTable';
import { useTable } from '@/lib/tableApi';

const { me, profiles } = useSession();      // kid Home: me is home.me; add profiles from useSession()
const toast = useToast();
const { table } = useTable();
const faces = useMemo(() => tableFaces(profiles, table, me?.id), [profiles, table, me?.id]);
const [membersOpen, setMembersOpen] = useState(false);
const openFace = useCallback(async (p: { id: string }) => {
  try {
    const id = await openChatWith(p.id);
    router.push({ pathname: '/chat/[id]', params: { id } });
  } catch (e) {
    toast.show(errorMessage(e, 'That didn’t open. Try again.'), { tone: 'error' });
  }
}, [router, toast]);

<TableRow faces={faces} onPressFace={openFace} onPressMore={() => setMembersOpen(true)}
  style={{ paddingHorizontal: space.gutter, marginTop: space.lg }} />   // parent/home.tsx: add `large`
// … at the end of the screen's root View, next to <MoveRequestPrompt />:
<MembersSheet visible={membersOpen} onClose={() => setMembersOpen(false)} />
```
- The cook Home passes `large` (big type for cooks in their 50s-70s: 56-pt faces, 16-pt names, 5
  cells on a phone, the rest in "+N"); the kid Home leaves it off.
- The row hides itself until `/table` answers and when nobody but me is in the family; it keeps the
  header when the kid Home passes `right` (A3). It measures its own width, so pass the gutter as
  padding (the faces fit inside it).
- A tap opens the chat with that person, like MembersSheet's "Message". The brief's "PersonSheet for
  someone without a phone" is left to the screen: TODO(caleb) if a phoneless kid's face should open
  PersonSheet on the cook Home instead.
- Kid Home fold: the row adds about 135 pt under the greeting (16 margin, 32 header, 10 gap, 76
  faces), so "Explore more dishes" (and on a 375x812 phone the Invite button) goes below the fold
  (TODO(caleb) #2 in the risk list). Options: accept the scroll, or drop `HERO_HEIGHT` by the row's
  height. The cook Home has room.

**A3. Kid Home: "I miss home" pill + sheet + player** (`kid/home.tsx`). Needs PR 1's 4.3 so
`useClipAudio` carries `heard` (otherwise it plays but never logs a listen, and the listen never
lights the table).
```tsx
import { MissHomePill } from '@/components/missHome/MissHomePill';
import { MissHomeSheet } from '@/components/missHome/MissHomeSheet';
import { useMissHome } from '@/components/missHome/useMissHome';
import { useClipAudio } from '@/lib/media';
import { clipPool, missHomeAudioClip, missHomeEntries } from '@/lib/missHome';
import { useLibrary, useRecipes } from '@/lib/recipes';

const { entries } = useLibrary();
const missIds = useMemo(() => missHomeEntries(entries, profiles, me?.id).map((e) => e.id), [entries, profiles, me?.id]);
const missRecipes = useRecipes(missIds);
const pool = useMemo(() => clipPool(Object.values(missRecipes), profiles, me?.id), [missRecipes, profiles, me?.id]);
const miss = useMissHome(pool, me?.id);
const hear = useClipAudio(missHomeAudioClip(miss.clip));

<TableRow … right={<MissHomePill available={miss.available} onPress={miss.show} />} />
// next to the MembersSheet:
<MissHomeSheet visible={miss.open} clip={miss.clip} player={hear} canAnother={miss.canAnother}
  cook={profiles.find((p) => p.id === miss.clip?.cookId) ?? null}
  onAnother={miss.another} onClose={miss.close}
  onOpenRecipe={(id) => { miss.close(); openRecipe(router, id); }} />
```
- Stop it on blur like the hero clip. Next to `heroKey`, keep
  `missKey.current = miss.clip ? clipKey(missHomeAudioClip(miss.clip)!) : null` in an effect on
  `[miss.clip]`, and in the existing `useFocusEffect` cleanup add
  `if (missKey.current) stopAudio(missKey.current);` (the sheet stops on close and on "Open the
  recipe" itself; this covers a push tap that navigates away under it).
- The pill shows as soon as the pool has a clip, whatever `/table` says (TableRow keeps its header
  for `right`), so it never waits on the network or a deploy.
- **TODO(caleb), before this ships: scope the pool to this family's own recordings.** `clipPool`
  (phase A `missHome.ts`) picks dishes by the global library's cook name, like `cookProfile()`, so
  another family's real recording whose cook is also called "Mom" can play here labelled as this
  family's Mom (guardrail 1). The nudge already filters to recipe ids from this family's delivered
  `pending_sends`; the pool needs the same list (for example a small `GET` that returns them, or a
  field on `/table`) and should drop any real dish not on it. Samples can stay, as the app shows them.

**A4. 1:1 chat header: "6 weeks" + the milestone** (`app/src/app/chat/[id].tsx`). Call the hook with
the others, before any early return:
```tsx
import { MilestoneBurst } from '@/components/table/MilestoneBurst';
import { WeeksBadge } from '@/components/table/WeeksBadge';
import { pairWith, weeksOf } from '@/lib/sundayTable';
import { useTable } from '@/lib/tableApi';

const { table } = useTable({ enabled: !circle });
const pair = circle ? null : pairWith(table, me?.id, other?.id);
```
In both header branches, put the name and the badge in one column inside `who(…)`:
- kid (anchor `<Txt variant="chatName" numberOfLines={1} style={styles.shrink} accessibilityRole="header">`):
```tsx
<View style={styles.shrink}>
  <Txt variant="chatName" numberOfLines={1} accessibilityRole="header">{name}</Txt>
  <WeeksBadge weeks={weeksOf(pair)} />
</View>
```
- parent (anchor `style={styles.parentName}`): the same, with `styles.parentName` on the column.
- Last inside the `KeyboardAvoidingView`, after `<ToastViewport position="top" />`:
  `{pair ? <MilestoneBurst meId={me?.id} pair={pair} otherName={other?.name ?? ''} /> : null}`
The badge shows only to the pair's two people (the server sends only my pairs), only with a count
of 1 or more; an ember or 0 shows nothing. The burst fires once per person, pair and milestone on
this phone and never takes a touch.

**A5. Flames on "Who's in the kitchen?"** (`app/src/app/index.tsx` + `components/profiles/ProfileTile.tsx`).
`/table` works with no one picked (faces only), so the Profiles screen can show who's lit.
- `ProfileTile.tsx`: add the optional prop `lit?: boolean`, and inside `<View style={styles.face}>`
  (already the avatar's size), right after the `<Avatar … />`:
  `{lit ? <FlameBadge avatarSize={AVATAR} /> : null}` (`import { FlameBadge } from '@/components/table/FlameBadge';`).
  It sits bottom-right, clear of the "New" badge and the dot (both top-right).
- `index.tsx`: `const { table } = useTable(); const lit = useMemo(() => litIds(table), [table]);`, pass
  `lit` to both `<Group … statuses={statuses} />` uses, and in `Group`
  `<ProfileTile … lit={lit.has(p.id)} />`.
- Optional (brief): the `?profiles=` fixture may fake a lit flag for screenshots, `__DEV__` web only.
- The brief's `Avatar.tsx` `flame` prop isn't added: `FlameBadge` overlays the avatar, so the shared
  Avatar stays as it is. Fold it into Avatar later if more screens need it.

**A6. Light a face right after the user's own action: `invalidateTable()`** (`import { invalidateTable } from './tableApi';`).
It marks the shared table stale; any mounted, focused `useTable()` asks again at once (the 10 s
throttle doesn't apply), and the server reads the last 8 days fresh. Call it:
- `lib/messaging.ts` `deliver()`, right after `const saved = await api.sendMessage(threadId, body);`
  (texts, voice notes, questions, steps, requests, reactions, the "I made it" note).
- `lib/messaging.ts` `cooked()`, after `await api.event(recipeId, 'cooked')…` (a cook lights the kid
  even before the note sends).
- `lib/messaging.ts` `sendRecipe()`, after `api.sendRecipe(…)` resolves.
- `lib/listening.ts` (PR 1 4.4), in `registerHeardLogging`: `void api.event(…).then(() => invalidateTable()).catch(() => {});`
- A published recording lights the cook only when the pipeline delivers it (`pending_sends.delivered_at`),
  minutes after `ensurePendingSend`; there is no app moment for that, so the next Home focus picks it up.
`tableApi.ts` imports `session.tsx`, which doesn't import `messaging.ts`, so these imports add no cycle.

**A7. Push tap.** The nudge's `url` is `/recipe/<id>` or `/kid/home`, both routes PR 1's `PushBridge`
already opens. Nothing to add.

**A8. Clean up.** Delete `app/src/app/dev/table.tsx` once A2-A5 are on their screens.

### PR 5 departures (say so in the PR description)
- Files: `tablePr.ts` (route + job) over phase A's pure `table.ts`, not the brief's `streak.ts`;
  `MissHomePill` / `MissHomeSheet` live in `components/missHome/`, not `components/table/`.
- Migration `20261018100300_retention_table.sql`, not `20261018030000_table_activity.sql`. The function
  returns raw instants (not week keys), adds `published` rows per recipient (one untargeted row when a
  recording went to nobody) and collapses repeats into 15-minute slots.
- The server section sits below PR 1's (S2), not before `// --- favorites`.
- Cache: rows older than ~8 days per family for 60 s, the last 8 days always fresh, and the window a
  long streak needed is remembered. The brief's "per family+me for 60 s" would hold a just-earned
  flame back for up to a minute.
- A cook with exactly one kid sees their week framed in that kid's zone (`viewerTz`; TODO(caleb)).
- Whose dish is whose: library.json ties a dish to a cook by name alone, one library for every family.
  The nudge quotes and opens only recordings this family published (`pending_sends` delivered with
  a `recipe_id`), so a same-named cook in another family is never quoted. The name rule stays only
  where the row is already this family's (an older event without `cook_id`, a delivered recording's
  dish) and matches current cooks only (never a removed same-named profile or a kid).
- A delivered recording lights the dish's cook (its `recipe_id` through the library), not
  `pending_sends.sender_id`, which is often the kid who filmed it. No library match: the sender.
- TODO(caleb): the "I miss home" pool (`clipPool` in `missHome.ts`) still has the cross-family name
  match; it needs the same family scoping when it's wired (A3).
- The nudge opens the quoted dish, else the cook's first recording this family published, else a
  sample under the cook's name (library.json has no dates; TODO(caleb)).
- Memorial cooks: the face stays, never lit; no pair, never nudged (TODO(caleb) for the memorial UI).
- `TableRow` fits one row: up to 7 cells on a 390-pt phone (6 on 375), so with 8 faces the last cell
  is "+2" (or "+3") and opens MembersSheet. No horizontal scroll. On the cook Home (`large`), 5
  cells, so 8 faces show as 4 and "+4".
- The milestone burst is remembered once it has played to the end, not when it's claimed: a chat
  closed during the 2 s hold shows it again next time (within the server's milestone window).
- No `flame` prop on `Avatar` (A5).

### PR 5 as wired (Oct 17, branch `retention-5-table`, on top of `retention-4-hearts`)
S2-S4 and A1-A8 were applied to the post-QA code, with these differences (say so in the PR):
- **Server.** `prs: [1, 2, 4, 5]`; no new dep. PR 1's cron test now expects `jobs: { table_nudge: 0 }`
  (the job runs for Leo, who has no streak yet). The S3 kid is `8888…` (Nia), since PR 2's block
  already uses `7777…`; two more api tests: a memorial cook keeps a face, never lit, with no pair;
  and `recordings` (below).
- **A3's TODO(caleb) is done: the clip pool is this family's own recordings.** `GET /table` also
  returns `recordings`: the dishes this family's delivered `pending_sends` became (tablePr.ts
  `familyRecordings`, the nudge's scope; read in parallel with the activity, sorted; one more small
  query per call). The app's `missHomeEntries(entries, profiles, me, recordings)` now requires the
  list and keeps only those dishes before the name match, and `clipPool(…, recordings)` filters again;
  no list (an older server, offline before the first answer) means no clips, so the pill waits for
  `/table` instead of showing before it (A3's "never waits on the network" traded for guardrail 1).
  `asTable` keeps `recordings` only when the server sent it. tablePr_test, api_test, test-table and
  test-retention cover it (another family's same-named "Mom"/"Grandma" recording never plays).
- **Mounts.** Both Homes use `components/table/HomeTableRow.tsx` (TableRow + useTable + the family +
  MembersSheet + PersonSheet), right after `<ActingAsBar />`. The kid Home's pill and sheet come from
  `components/missHome/KidMissHome.tsx` (`useKidMissHome()`: pool, `useMissHome`, `useClipAudio` with
  the `heard` tag, stop on blur); `right` is the pill only when there are clips, so the row adds no
  empty header. "Open the recipe" waits for the sheet to close (`motion.sheetCloseMs + 40`), like
  PersonSheet, so the screen never changes under a closing Modal.
- **Taps (the brief's "PersonSheet for people without a phone").** A face opens the 1:1 chat (like
  MembersSheet's Message), including people on a lent phone, who read it when picked there. Someone
  invited who hasn't joined yet (`invited && !locked`) opens PersonSheet ("Maya hasn't joined yet."
  with Send again) instead: a chat would wait for someone who isn't here. PersonSheet has no copy for
  a phoneless person who has joined (TODO(caleb) if they should get a sheet instead of the chat).
  A memorial person's face (`memorial: true` from GET /family) is not a button, like my own
  (`canTapFace`, test-table): their 1:1 composer says "Ask Grandma anything.", which treats them as
  present (guardrail 2). TODO(caleb) #5 may give them a quiet state (their recipes, a memorial chat).
- **"+N" counts the whole family.** `tableFaces` returns everyone (its `max` is now optional) and
  `fitFaces` caps the row at 8 cells, so "+N" is everyone the row couldn't show, matching the
  MembersSheet it opens (it had counted only within the first 8). test-table has a family of 12.
- **Kid Home fold (TODO(caleb) #2 kept as the default).** The row is `dense` on the kid Home (a
  16-pt title that fits beside a 36-pt pill on a 375-pt phone, 40-pt faces, 13-pt names, cells 56-64
  pt so "Grandma" isn't cut; about 100 pt in all). While the row shows, hero -> Invite tightens 32 ->
  20 and Invite -> Explore 24 -> 4, and the hero card takes the height left above the tab bar
  (`HomeHero`'s new `height`, `HERO_MIN_HEIGHT` 264 .. `HERO_HEIGHT` 344, from the scroll view's
  height and the content measured without the card; taller phones keep 344). Under 330 the title
  gets 2 lines and the line 2; under 290 the title drops to 28 pt (still 2 lines) and the line keeps
  2 lines, since it's often the cook's words and the live subtitle while Hear plays; the gap above
  the Hear pill goes 16 -> 12 so the chip stays clear. The card is sized for what isn't there yet
  (the link while the skeleton shows), and while `/table` is on its way (whenever someone else is in
  the family) an empty View of the row's height (6 + 107 pt) holds the row's own slot, so the hero,
  Invite and Explore don't move when it lands. `useTable()` now also says `failed` (no table and the
  last ask ended without one: offline, a 404, junk); then the space goes, the gaps relax and the
  hero gets its full 344. Measurements: see the screenshots' notes in the PR.
  The alternative (a "+" at the end of the row instead of "Invite family") is noted at the top of
  `kid/home.tsx`.
- **Pull to refresh** on the kid Home also forces `/table`. The cook Home's row is `large` and sits
  above "Record a new recipe" (the handoff's "under the greeting"); with three updates, "Invite
  family" is now below the fold there (it scrolls; the cook Home had no fold rule).
- **Profiles.** `useTable({ enabled: !autoEnter && status === 'ready' })`: not asked for on the way
  straight to a home. The `?profiles=` fixture has no credential, so it never calls and shows no
  flames (no fake `lit` flag was added). ProfileTile's label adds "at the table this week".
- **x-tz.** `tableApi.ts` now sends `getApiTimeZone()` (none under the `?as=` dev aid), like
  `cookingApi.ts`, instead of `deviceTimeZone()` (GET /table stores the zone through `syncTz` like
  every signed-in route, so a screenshot must not send one). test-table checks it.
- **A6.** `invalidateTable()` after `deliver()`'s send, `cooked()`'s saved event, `sendRecipe()`,
  `request()` and a logged listen (`listening.ts`). Not after `cookedPhoto()` (the "I made it" event
  already lit the kid).
- **Dev aid.** `app/dev/table.tsx` deleted (A8; `pr5shots/table.png` kept as the reference).
- **Screenshots** came from this worktree's Expo web against a local stand-in for the api and the
  bucket's JSON (a made-up family, plus another family's same-named "Grandma" recording that must
  never play); the real api and families were never called.
- **Open for Caleb.** MembersSheet (the "+N" sheet) still offers a memorial person a Message pill, as
  before this PR (TODO(caleb) #5, with the memorial chat state).

### PR 5 checks
```bash
npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/index.ts
npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/api_test.ts \
  supabase/tests/tablePr_test.ts supabase/tests/table_test.ts supabase/tests/retention_test.ts
npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/table_activity_sql_test.ts
cd app && npx tsc --noEmit && npx expo lint && node scripts/test-table.mjs && node scripts/test-retention.mjs
```
Then C1 after S5, C2-C3 after the deploy.

---------------------------------------------------------------------------------------------------
## PR 6 wiring: Month in the kitchen (handoff 3.7)

Built as new files only. Nothing here is wired yet; this section says exactly where each piece goes,
and it replaces the old section 5 sketch (no inline route, no job over `due.recap`). Server steps are
P1-P6, app steps A1-A7. P1-P3 (as rewritten at integration) were applied with PRs 1, 2, 4 and 5 to a
scratch copy of this branch's `index.ts` and `api_test.ts`: `deno check` is clean and `api_test.ts`
passes 49/49 (see the top of this file). The A2 route and the A4 card were compiled against
this branch's app (`tsc` clean; the card needed an `as Href` cast only because `/recap` isn't in
`.expo/types` yet). A3 (qa-deadends edits that list), A5 (view-shot isn't installed) and A7 (needs
PR 1's media.ts change) were not compiled.

| File | What it is |
|---|---|
| `supabase/functions/api/recap.ts` (phase A) | Pure: `computeRecap` (the slides, in order) and `recapPush` (the push copy). |
| `supabase/functions/api/recapPr.ts` | `makeRecap(deps)`: `GET /recap` and the `recap` cron job. Pure helpers `previousMonth`, `monthParam`, `resolveMonth`, `maybeLocalFirst`, `recapDue`, `signSlides`, `photoPaths`, `recapPushFor`. Imports `recap.ts`, `plumbing.ts`, `time.ts`, never retention.ts or index.ts; built by `makeRetention` when `prs` has 6. Pages every list 1000 rows at a time, so no RPC and no migration. |
| `supabase/tests/recap_route_test.ts` | 23 offline tests: an in-memory PostgREST with the 1000-row cap, a fake Expo, and the real `/cron/hourly` route. |
| `app/src/lib/recapApi.ts` | `recapApi.get(month)` (own fetch with `getApiAuth()`, like `lib/moveRequests.ts`), `readRecap`, `recapTeaser`, `cardMonth`, `monthOrPrevious`, the opened flag per person per month (kv `recap.opened.<profileId>.<month>`), `onRecapOpened`. React-free. |
| `app/src/components/recap/story.ts` | React-free story logic: next/back/done, the tap side, Hearth tones per slide, accented numbers, the hearts picture, which clip the voices slide plays. |
| `app/src/components/recap/RecapStory.tsx` | The full-screen story, presentational: progress bars, one component per slide type, round Back + big Next (Done on the last), left-third tap goes back, Share through an injected `shareSlide`. |
| `app/src/components/recap/RecapScreen.tsx` | The body of `recap.tsx`: loads `GET /recap` for `me`, marks the month opened, wires the voices clip; loading, no-person, empty and error states, each with a way out. |
| `app/src/components/recap/RecapCard.tsx` | The Home card: `RecapCard` (checks the day, the opened flag and `GET /recap` itself) and `RecapCardView` (the card alone). |
| `app/scripts/test-recap.mjs` | 17 Node tests for `recapApi.ts` and `story.ts`. |
| `app/src/app/dev/recap.tsx` | Dev page `/dev/recap` (`?as=cook`, `?slide=N`, `?card=1`), made-up data. A release build (`__DEV__` false) redirects it Home. Deleted in A6. |

### Server (`supabase/functions/api/index.ts`)

**P1. Import**: add `type RecapFamily` to PR 1's one retention import (3.1). Never import
`recapPr.ts` directly.

**P2. Turn PR 6 on** (verified). Put `familyCtx` directly above PR 1's `makeRetention<Ctx>({ … })` call
(3.4), then add `6` to `prs` and `answersFor` to its deps. This is the call with every PR on:
```ts
/** answersFor() for a whole family with no caller behind it (PR 6; it reads only family.id & everyone's roles). */
const familyCtx = (fam: RecapFamily) =>
  ({ family: { id: fam.id, name: "" }, profiles: fam.profiles, everyone: fam.profiles, me: null, device: null, phones: new Set() }) as unknown as Ctx;

/** Every retention route & cron job (retention.ts). One number per PR in `prs` turns that PR on. */
const retention = makeRetention<Ctx>({
  prs: [1, 2, 4, 5, 6],
  db,
  HttpError,
  requireMe,
  rateLimit,
  dbFail,
  clientIp,
  library,
  assertRecipe, // PR 2
  answersFor: (fam, rows) => answersFor(familyCtx(fam), rows as unknown as MessageRow[]), // PR 6
  // signPhotos: (paths) => signVoice(paths, PHOTO_BUCKET), // PR 6, after qa-cook (P4)
  expoAccessToken: Deno.env.get("EXPO_ACCESS_TOKEN") ?? null,
});
```
`answersFor` is a function declaration in index.ts (hoisted), so the call can sit anywhere after
`library`. makeRetention builds `makeRecap()`, PR 1's `for` lines register `GET /recap`, and the
`recap` job is registered on the hourly cron for you: **don't** push it into `retention.cronJobs`.
With `6` in `prs` and no `answersFor`, the module throws "makeRetention: PR 6 needs answersFor" at init.
- **Don't** also add a job over `due.recap`. This job finds its own people (push on, the local 1st,
  10:00 until 21:00, never memorial or removed), builds each family's month once, and stays one push
  a month through the `recap:YYYY-MM` dedupe key. `/cron/hourly` still reports `due.recap` (10:xx
  people only); nothing acts on it.
- `familyCtx` relies on `answersFor()` reading only `ctx.family.id` and `ctx.everyone` (roles). If a
  QA branch changes that, revisit it: "Questions you answered" must keep matching the app's "answered".
- PR 6 can't land without PR 1: it needs `library` and PR 1's `makeRetention` call.

**P3. `supabase/tests/api_test.ts`** (verified). Append:
```ts
// === retention PR 6: month in the kitchen ========================================================

t("PR 6: GET /recap is registered: a person, a well-formed month; a month that can't hold anything is empty", async () => {
  const bad = await call("GET", "/recap?month=2026-13", { headers: asMom });
  assertEquals([bad.status, bad.data.error], [400, "month must be YYYY-MM"]);
  const future = await call("GET", "/recap?month=2099-01", { headers: asMom });
  assertEquals([future.status, future.data], [200, { empty: true }]);
  const nobody = await call("GET", "/recap?month=2026-10", { headers: { "x-family-code": CODE } });
  assertEquals([nobody.status, nobody.data.error], [400, "x-profile-id header is required for this request"]);
});
```
This only proves index.ts registers the route; `recap_route_test.ts` covers the slides and the job.
A live month needs a library in the test (PR 4's `BUCKET_LIBRARY` stub): with none, `GET /recap`
answers 503 on purpose.

**P4. Postcard photos (after qa-cook lands).** qa-cook adds the private `photos` bucket, `PHOTO_BUCKET`
and `signVoice(paths, bucket = VOICE_BUCKET)`. Then, in PR 1's `makeRetention` deps (P2), replace the
`// signPhotos: …` comment with:
```ts
  signPhotos: (paths) => signVoice(paths, PHOTO_BUCKET),
```
Don't redeclare `PHOTO_BUCKET` or the signer. Until this step, postcards come back without photos and
the Then & now slide is dropped; the numbers still show. The push follows the same rule
(`recapPushFor`): a month whose only slide is Then & now gets no push until the signer is passed.

**P5. `docs/build/API.md`, under "## Retention"** (PR 1 adds the heading):
- `GET /recap?month=YYYY-MM` (me). `month` missing = last month on my clock (`profiles.tz`); not
  `YYYY-MM` = 400 "month must be YYYY-MM". Returns `{empty: true}` or `{month, role, slides}`, `role`
  `"cook" | "learner"`. Each slide has `type` and `title` and shows only when it has data, cover first
  and close last. Learner: `cooked {value, photos}`, `most_made {value, recipe_id, cook_id}`,
  `voices {value, seconds, clip: {recipe_id, cook_id, start_s, plays}}`, `hearts_left {value}`,
  `then_now {photos: [first, latest]}`. Cook: `dishes_cooked {value, faces: [{profile_id}]}` (each kid once, in the order they first
  cooked one of her dishes that month; no count per kid, so nothing ranks siblings),
  `most_loved {value, recipe_id}`, `postcards {value, photos}`, `answered {value}`. A photo is
  `{message_id, photo_url, recipe_id, at}` with a 1-hour signed URL, never the storage path. Every
  number counts that month's rows in my time zone. A month before the first edition (November 2026,
  `FIRST_MONTH`) or after this one is empty, and so is a memorial or removed person's. 503 "Can’t reach the family recipes right now. Try
  again." while library.json can't be read (the numbers would come out too small).
- The push: kind `recap`, title "Your November in the kitchen", body a real line from the slides,
  `data.url` `/recap?month=YYYY-MM`. Once a month per person (`recap:YYYY-MM`), app-initiated (the
  caps apply), only for a non-empty month, on the local 1st from 10:00 until quiet hours.

**P6. Deploy.** No migration: the columns it reads come from `20261018100000_retention_plumbing.sql`
and qa-cook's `cooked_photos`, and the push rides the existing hourly cron
(`20261018100100_retention_cron.sql`). Add `source/recapPr.ts` to the `deploy_edge_function` file list
(section 6.4). First edition is Dec 1 for November, so PR 6 must be live by Nov 30.

### App

**A1. `lib/recapApi.ts`** stays as it is: it needs only `API_URL` and `getApiAuth` from lib/api.ts.
Once PR 1's `x-tz` is live (3.2's CORS allows it), add the header in its `call()`:
```ts
import { deviceTimeZone } from './tz';
// in call(), after the auth headers (replacing the TODO there):
headers['x-tz'] = deviceTimeZone();
```
and add `'x-tz': T.deviceTimeZone()` (import `../src/lib/tz.ts` as `T`) to the expected headers in
`scripts/test-recap.mjs` ("recapApi.get: the phone's headers…"). The month is always in the query, so
this only keeps `profiles.tz` fresh.

**A2. New route `app/src/app/recap.tsx`** (verified):
```tsx
import { useLocalSearchParams, useRouter } from 'expo-router';

import { RecapScreen } from '@/components/recap/RecapScreen';

/** Month in the kitchen (RETENTION-HANDOFF 3.7): the Home card and the 1st-of-month push open /recap?month=YYYY-MM. */
export default function RecapRoute() {
  const { month } = useLocalSearchParams<{ month?: string }>();
  const router = useRouter();
  return <RecapScreen month={month} onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
```
A5 adds `shareSlide` to it.

**A3. `app/src/app/_layout.tsx`.** In `AppStack`, after `<Stack.Screen name="record" … />` (qa-deadends
edits this list; keep their lines):
```tsx
<Stack.Screen name="recap" options={{ title: 'Your month in the kitchen', presentation: 'fullScreenModal', animation: 'fade' }} />
```
`fullScreenModal`, not `modal`: the story fills the screen, the Home doesn't peek behind it, and its
top padding (safe-area inset) is right. Close is always on screen, so no swipe is needed. Keep
`/recap` out of `SIGNED_OUT_ROUTES` and the no-profile set: a cold-start tap is held until "Who's in
the kitchen?" (4.6). If it's ever reached with no person, RecapScreen says "Pick who you are first".
With typedRoutes on, run the dev server once (`npx expo start`) so `.expo/types/router.d.ts` lists
`/recap` before `tsc`.

**A4. Home cards** (the plan as first written; the review moved both cards and changed the API, see
"PR 6 as wired", Home card), directly under PR 5's `TableRow` on both Homes (PR 5 wiring A2 puts it right
after `<LargeHeader … />`; without PR 5, go right after `<LargeHeader … />`). `me` is already in scope
on each (`home.me` on the kid Home, `useSession()` on the cook's).
```tsx
import { RecapCard } from '@/components/recap/RecapCard';
```
- `kid/home.tsx`, before the hero's `<View style={{ marginTop: HERO_GAP }}>`:
```tsx
<RecapCard profileId={me?.id} enterIndex={0} style={[styles.gutter, { marginTop: space.lg }]}
  onOpen={(month) => router.push({ pathname: '/recap', params: { month } })} />
```
- `parent/home.tsx`, the first child of `<View style={styles.col}>`, above "Record a new recipe" (the
  column already has the gutter and the gap):
```tsx
<RecapCard profileId={me?.id} enterIndex={0} onOpen={(month) => router.push({ pathname: '/recap', params: { month } })} />
```
It renders nothing outside the 1st-7th, once opened on this phone, for an empty month, or when the call
fails (offline, route not deployed yet), so it is safe to ship before the server. It hides the moment
RecapScreen marks the month opened. To see it on another day: `/dev/recap?card=1`, or pass
`now={new Date(2026, 10, 1)}` in a `__DEV__`-only branch.

**A5. Share.** `npx expo install react-native-view-shot` (expo-sharing is already installed). It is a
native module, so the EAS preview build needs a rebuild. Then in A2:
```tsx
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';

<RecapScreen
  month={month}
  onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))}
  shareSlide={async (view) => {
    const uri = await captureRef(view, { format: 'png', quality: 1, result: 'tmpfile' });
    await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share' });
  }}
/>
```
The Share button shows only when `shareSlide` is passed, and never on web (RecapStory). It waits for
the slide's photos, captures the slide on its colour with the homecookd mark, and a failure shows
"Couldn’t share that one. Try again."

**A6. Delete `app/src/app/dev/recap.tsx`** once A2-A4 are in. It ships in the bundle at `/dev/recap`
until then, but only renders under `__DEV__`; a release build redirects it Home.

**A7. Count listening as `heard` (after PR 1's 4.3 media.ts change).** In `RecapScreen.tsx`, tag the
clip like 4.5 does for the two players, so a play here adds to next month's "minutes of family voices":
```tsx
import { useHeard } from '@/lib/listening';
const heard = useHeard(clip ? clipRecipes[clip.recipe_id] : null);
const hear = useClipAudio(moment ? { url: moment.url, start_s: moment.start_s, end_s: moment.end_s, key: `recap:${moment.key}`, heard } : null);
```
Remove the TODO(wiring) about it in that file's header.

### PR 6 departures (say so in the PR description)
- **The push window:** the handoff says the 1st at 10:00 local. The job runs every hour of the local
  1st from 10:00 until quiet hours (21:00), so a later hour still sends when the library was
  unreachable at 10 (with no library it sends nothing and logs nothing). The `recap:YYYY-MM` dedupe
  key keeps it to one push; a person capped that day (another app-initiated push already went) is
  logged as skipped and not tried again.
- **Its own job, not `due.recap`:** `recapPr.ts` picks its own people; `dueProfiles`' 10:xx
  `due.recap` is unused.
- **Share is injected:** `react-native-view-shot` isn't installed in this PR's files; RecapScreen
  takes `shareSlide`, and Share is hidden on web (html2canvas can't read the signed photo URLs, and
  expo-sharing can't share files there).
- **503 while the library is down:** `GET /recap` refuses rather than answer a smaller month, so the
  Home card stays and nothing is marked opened (acceptance: every number matches the database).
- **No timer on slides:** each slide stays until the person taps Next or the right side (older cooks
  read at their own pace). The left third goes back.
- **No cookbook offer** on the last slide: TODO(caleb) #4, until printing exists.
- **The hearts picture:** up to 12 little hearts, one per heart; past 12, one big heart, so the
  picture never shows a different number from the title.

### PR 6 as wired (Oct 17, branch `retention-6-recap`, on top of `retention-5-table`)
P1-P5 and A1-A7 were applied to the post-QA code, with these differences (say so in the PR):
- **Server.** `prs: [1, 2, 4, 5, 6]`, `familyCtx` above the call, `answersFor` and P4's `signPhotos`
  (`signVoice(paths, PHOTO_BUCKET)`, qa-cook's signer, already in) in the deps. PR 1's cron test now
  expects `jobs: { table_nudge: 0, recap: 0 }` and also runs a local Dec 1, 10:10 (an empty November:
  no push). Besides P3, one more api test runs the first edition through index.ts: on Nov 20 (the test
  moves `Date` forward, `atClock`) Leo cooks Dad's fried rice with a photo postcard and asks a question
  Dad answers; on Dec 1 Dad's `GET /recap` (no month = November) names Leo once, signs the postcard (a
  `photos` bucket URL, no `photo_path`) and counts the answer (`answersFor` over `familyCtx`). The
  api_test PostgREST stand-in learned `gte`.
- **First edition: Dec 1, for November** (handoff 3.7). `FIRST_MONTH = '2026-11'` in both recapPr.ts
  and lib/recapApi.ts: `GET /recap` answers `{empty: true}` for October without a query, the cron job
  reads nothing until it's Dec 1 somewhere (UTC+14) and skips anyone whose last month is earlier, and
  the Home card's `cardMonth` is null on Nov 1-7. October's numbers would be thin (its `heard` minutes
  & postcards only count once PRs 1 & 3 deploy), and its push would add notification volume (handoff
  5.3) and use each cook's one app-initiated push for November. TODO(caleb): an October edition means
  setting both to `'2026-10'`. recap_route_test's made-up family cooked in October, so its harness
  passes makeRecap's test-only `firstMonth: '2026-10'`; two tests leave it out (October empty without
  a query; nothing on Nov 1, nothing for an empty November on Dec 1, then "Your November in the
  kitchen").
- **Share (A5).** `npx expo install react-native-view-shot` (5.1.0; the SDK 57 docs list it as in
  Expo Go, so Expo Go needs nothing; an EAS build needs a rebuild). The route passes `shareSlide`
  (captureRef PNG -> `Sharing.shareAsync`, after `isAvailableAsync`), never on web; RecapStory still
  hides Share on web and toasts "Couldn’t share that one. Try again." on any failure.
- **x-tz (A1)** uses `getApiTimeZone()` (like `tableApi.ts` / `cookingApi.ts`), not `deviceTimeZone()`:
  none under the `?as=` dev aid. test-recap checks both.
- **The voices clip is family-scoped.** RecapScreen passes GET /table's `recordings` to `clipPool`
  (`useTable({ enabled: !!clip })`), PR 5's rule for "I miss home": the server names the clip by
  recipe & cook id, but library.json ties a dish to a cook by name, so another family's same-named
  cook's recording would otherwise play as ours. No list yet = no play button; the number stays.
  A7's `heard` tag is in (a listen of 3 s or more logs when the clip stops: another slide pauses, Close
  or Done stops and flushes it).
- **Home card (A4), after review.** Both Homes. `useRecapCard(me?.id)` runs in each Home and
  `<RecapCard card={…} />` draws it, so nothing that arrives late moves what's on screen:
  - **Kid Home:** the card takes the big "Invite family" button's place under the hero as a 64 pt
    olive pill (`slot`: the title and a 48 pt arrow; the month's line goes to VoiceOver through the
    label), and Invite moves a short scroll down under "Explore more dishes". The hero, the fold and
    the slot's height are the same as on any other day (375x812: the hero stays 264, Explore ends at
    682; 390x844: 294 / 712). The hero is now fitted to the measured block down to "Explore more
    dishes" (a wrapper View's onLayout) instead of the whole scroll content, so the Invite under the
    fold never shrinks it. TODO(caleb): where the month's card goes. The first wiring put a compact
    card (~100 pt) under the table row: the hero dropped to its 264 minimum at 390x844 and Invite /
    Explore went under the tab bar at 375x812 (shot `11-option-card-under-table-row-…-before`). Other
    options: a pill beside "I miss home" (no room at 375 pt) or #2's "+" in the row.
  - **Cook Home:** the full card (bars, title, the month's line with two lines of room whatever its
    length, arrow) is the last thing on the page, after "Record a new recipe", the updates card and
    "Invite family" (`useRecapCard(me?.id, { last: true })`). Nothing is held and nothing is drawn
    until its answer is known; a card fades in under Invite whenever it's found (even with Home on
    screen, since nothing is under it), and focus asks again after a failed call too. At 375x812 and
    390x844 with a full updates card it's a short scroll down (shots `pr6-review2/05-…-scrolled`).
    The review's second round had put it between the big button and the updates card with a held
    space: an empty month, a failed call or the 10 s timeout then let ~210 pt go and moved the
    questions waiting to be answered up, on every cook's first Home of the month with an empty
    month, on a new phone, and on every offline cold launch. TODO(caleb): where the month's card goes
    on the cook Home.
  - **Held slot (kid Home only):** while the first answer for this person and month is on its way,
    the card's space is kept (the same card at opacity 0, no taps, hidden from VoiceOver) and the card
    fades into it; an empty month, an opened one or a failed call lets the space go and Invite fades
    into the slot at the same height.
  - **Remembered:** `recapApi.rememberRecapCard` keeps the answer per person per month (memory for
    the run + kv `recap.card.<profile>.<month>`: `'empty'` or `{teaser}`; never a failure), and
    `recapCardNow` / `recapCardStored` give it back, so a Home drawn again that week renders the card,
    or no card, with its first layout and without calling GET /recap. Tested in test-recap.
  - **Asking again:** the first focus asks; after a failed call (offline, route not deployed) no
    space is held and Home asks again on blur (so the card is there when Home comes back) and on
    foreground; a card found while the kid Home is on screen waits (`later`) and shows once Home is
    off screen (blur or background), so it never swaps in under a thumb (the cook Home's `last` card
    shows at once). The day is read again on focus
    and foreground (state, not a render-time `new Date()`). The opened listener stays outside the
    focus effect (the recap opens on top of Home).
- **Close** with nothing under it (a cold link) goes to the person's Home (`homeFor(me)`), else `/`.
- **Dev aid.** `app/dev/recap.tsx` deleted (A6). Screenshots came from this worktree's Expo web against
  a local stand-in api & bucket with a shifted page clock (Dec 1 for the card; Nov 1 shows none),
  never a real family.

### PR 6 checks
```bash
npx --yes deno@2 check --node-modules-dir=none supabase/functions/api/index.ts
npx --yes deno@2 test --node-modules-dir=none --allow-env supabase/tests/api_test.ts \
  supabase/tests/recap_test.ts supabase/tests/recap_route_test.ts supabase/tests/retention_test.ts
cd app && npx tsc --noEmit && npx expo lint && node scripts/test-recap.mjs && node scripts/test-retention.mjs
```
Live (test family): `GET /recap?month=<this month>` as a kid who cooked something returns slides whose
numbers match a `select count(*)` on `recipe_events` / `favorites` for that month; `?month=2026-13`
is a 400. `select public.run_cron_hourly('<a local 1st, 10:10>')` sends one `recap` push per
non-empty month and a second run sends nothing (read `notification_log`). Screens: `/recap?month=<it>`
for a kid and a cook, and a Home on a 1st (A4's `now` aid).

---------------------------------------------------------------------------------------------------
## PR 3 as wired: Send it home, get one back (handoff 3.4; Oct 18, branch `retention-3-postcard`, on top of `retention-6-recap`)

Built last of the five, straight onto the wired code (no lane, no dev page). The cooked message
"I made it" sends is still sent the moment it is tapped; the postcard goes **on that same message**,
replacing QA B30's second `cooked` message with a photo (two cards per dish in the chat, and a cleared
"made" row coming back with a new key).

**Server (`supabase/functions/api/index.ts`).**
- `20261018100400_retention_postcard.sql`: `messages.rating smallint check (rating between 1 and 5)`,
  `add column if not exists`, so it is a no-op after PR 1's plumbing file (which already adds the
  column with the same check). `photo_path` and the `photos` bucket stay qa-cook's (not re-added;
  `retention_migrations_sql_test.ts` pins the file list, the rating check, and that the file stands on
  its own and never touches storage or `photo_path`).
- `MessageRow.rating`, `rating` in `MESSAGE_COLS`, and `toMessages` returns `rating` (null when none).
- `POST /messages/:id/postcard {photo_path, rating?}` (after `/photo-upload`): signed in; only the
  sender of their own `cooked` message (403 / 400 otherwise, 404 for unknown, malformed or another
  family's ids); `photoPathFor` + `voiceExists(path, PHOTO_BUCKET)` (qa-cook's, reused); a 1:1 with
  someone removed is read-only (403, as for messages); 429 kind `postcard` (60 an hour). Posting again
  replaces the photo and the rating (no rating = null). Returns the updated `Message` with a fresh
  signed `photo_url`.
- The push (`pushPostcard`, after the response): `postcardPush()` / `postcardKey()` from cooking.ts
  ("Leo made your Sunday Chili" / "Sent you a postcard.", `/parent/home`, not app-initiated, one per
  message). Whose dish: the family member named on it (`library.recipeInfo`, the cookProfile rule),
  never me, and in a 1:1 only when that is the other person (a card sent to someone else tells nobody
  "your"); bucket unreachable: a 1:1's other person if they are a cook ("Leo made your recipe").
- `GET /threads` rows gain `postcards` (cooked cards in the thread with a photo), computed from the
  messages `summaries` already loads: a postcard never changes `last`, so the cook's Home keys its
  refetch on it too.
- QA's send-time `photo_path` on a `cooked` message still works (builds already out there).
- api_test (+3): the whole flow (early 400, photo + rating, one push, log row, "Take another" replaces
  with no second push or card, Dad's read and inbox `postcards`, then Dad's "Just like mine" and a held
  voice reply both pushing Leo), every refusal (nothing written), and the push target (a circle card by
  the dish's name, even when Dad wrote after it; a card in Leo's 1:1 with Mom pushes nobody).

**App, kid side.**
- `lib/messaging.ts`: `cookedPhoto()` (QA's second card) is replaced by `sendPostcard({recipeId,
  cooked, photo, rating})`: upload (`lib/photos.ts uploadPhoto`, reused) -> `api.postcard` on the card
  "I made it" sent -> the chat cache swaps the card in place (`replaceCached`). When "I made it" couldn't
  send the card (offline then), the postcard sends it first; a retry reuses the uploaded photo and that
  card (never a second upload or card). `api.postcard()` in `lib/api.ts`; `Message.rating`.
- `components/postcard/PostcardStep.tsx` (in `MadeIt.tsx`, replacing both "Want to share the love?" and
  B30's "Show Dad yours"): "Show Dad how it came out" + one big shutter (the "Take a photo" button,
  under a flat peach tile with a camera that is only a picture; "Choose a photo" for the library),
  then the photo in a cream frame,
  "How close to Dad’s?" with five 48 pt pots (optional; tap again to take it back; TODO(caleb): pots vs
  dumplings), "Send to Dad" -> the postcard flies up and away with a little turn (650 ms; a 250 ms fade
  under Reduce Motion) + toast "Sent to Dad" -> back to the recipe. Quiet: "Take another" / "Choose a
  photo", "Not now", "Share with someone else" (the existing share sheet; stays on the step).
- Shown only when `canPostcard(cook, me)`: the dish's cook is someone else in the family and not
  memorial. My own dish, a cook outside the family (or memorial): the old share prompt, unchanged.
- **The note is dropped**: QA's optional one-line note didn't fit beside the pots without clutter, and
  the handoff's postcard has none (a kid can still write in the chat).
- **Burst copy** (guardrail 1): "You made it" + "We told Dad." (was "Dad will love this"); "You made it"
  alone when the card couldn't send. PR 4's milestone titles still win (`madeItTitle`).
- PR 1's `kid-first-made` push ask still comes after the whole flow (`onLeave`), so after the postcard.

**App, cook side.**
- `components/postcard/PostcardRow.tsx` in `UpdatesCard.tsx`: a "made" row whose message has a photo
  is a postcard: the header row as before (words -> my recipe, x clears), Leo's photo (3:2, cream frame,
  a steady 1-1.5° tilt per card, none under Reduce Motion), "How close to yours" + the pots when rated,
  then two equal 52 pt pills: **"Just like mine"** (sun; medium haptic, then a "Just like mine" stamp
  lands on the photo's corner with a success haptic; the pill reads "Sent", disabled, on later visits
  too: `kitchen.liked` from the thread's reactions, and `keepSent` puts the new one in the cache) and
  **"Hold to talk"** (`HoldToTalk.tsx`, `lib/voice.ts useVoiceRecorder`: red "Let go to send" with a
  soft ring while held and the time so far (`mmss(rec.elapsed)`) on a small tab on the pill's top
  edge, clear of the thumb; release -> "Sending… Undo" (below) -> `messaging.sendVoiceReply` = upload
  + a `voice` message in our 1:1 with `reply_to` the card -> "Sending" -> "Sent"; a hold under 0.8 s
  reads "Hold longer" (VoiceOver hears the whole hint); a release while the mic is still starting
  counts as too short; no mic: the chat composer's toasts). No new screen.
- **Undo before it goes** (review fix): a sent voice message can't be taken back (`onDiscard` only
  drops unsent local ones), so letting go no longer sends at once. The note waits on the phone for
  3 s (6 s with VoiceOver / TalkBack on; `postcardLogic.undoWindowMs`) as "Sending… **Undo**" (butter
  pill, a thin sun bar running down; no bar under Reduce Motion; VoiceOver hears "Sending to Leo. Tap
  to undo." and its double-tap is Undo). A touch on the pill in that time takes it back on touch-down
  (so a tap just in time always beats the timer): "Not sent", nothing uploads (`holdPress` /
  `holdWait`). Untouched, it uploads and sends. If the row goes away while it waits (the sheet
  closed, the row cleared), it still goes: the cook let go to send and only Undo un-sends. This keeps
  the drift fix below (a drift still never ends a hold); an Undo tap is an ordinary touch a scroll may
  take after it has undone. The 5-minute limit waits the same way.
- **The hold is the raw touch responder, not a Pressable** (review fix): the pill lives in Parent
  Home's scroll and the "All updates" sheet's, and a Pressable lets a parent scroll take the touch
  (and lets go when the finger drifts past its press rect), which looked like a release and sent a
  cut-off note. Now only lifting the finger sends (anywhere, even off the pill); the pill never gives
  the touch up (`onResponderTerminationRequest` false; on Android the grant blocks the scroll's
  intercept); the scroll holds still while a finger is down (`ui/ScrollHold`: Home and the sheet pass
  `scrollEnabled={!hold.held}`); a touch the phone takes away (a call, the notification shade) throws
  the note away and the pill says "Not sent" (`postcardLogic.holdEnd`). Reaching the recorder's
  5-minute limit with the finger still down keeps what was recorded and waits to send it, as a lift
  does (it was dropped silently).
- The row key is `<id>:postcard` (`madeKey`), so a plain row cleared before the photo came never hides
  the postcard. A plain card without a photo keeps the plain "Leo made your Sunday Chili" row.
- `kitchen.ts` keys each thread's refetch on `kitchenStamp(t)`: `last`'s time, whether it has a
  photo/rating, and `postcards`. Never the photo URL (its signature changes on every poll; swapping it
  in would reload the photo every 8 s). An expired photo (1 h) refetches that thread once per URL.
- In the chat, `CookedBubble` draws a card with a photo as the postcard (`PostcardPhoto`, on QA's
  photo rendering) with "How close to Dad’s" / "How close to yours" + the pots; "Just like mine" is
  PR 2's `ReactionStamp` under it (already grouped under its card by `chatGroups.splitReactions`).
- `components/ui/icons.tsx` gains `PotIcon` (drawn to match PotMark; not in the bible).

### PR 3 departures (say so in the PR description)
- **Circle cards answer by voice in the 1:1.** The handoff's voice reply goes "in their 1:1 thread
  with reply_to". A cooked card in the family circle (older builds) keeps "Just like mine" in the
  circle, but its voice reply goes to the 1:1 without `reply_to` (a reply can't point into another
  thread).
- **Hold here, tap in the chat.** The postcard's mic is press-and-hold ("Hold to talk" / "Let go to
  send"), as the handoff names it (3.4: a "hold-to-talk mic"), while the chat's AnswerPanel, one
  screen away, is tap-to-start / tap-again-to-send ("Tap to talk" / "Tap again to send"). So the same
  cook learns two gestures, and a first tap on the postcard only gets "Hold longer". Kept because the
  pill sits in Parent Home's scroll and the "All updates" sheet: a tap-to-start recorder there keeps
  the microphone open while the cook scrolls away or the sheet closes, and the hold ends exactly when
  the finger lifts. TODO(caleb): one gesture everywhere (hold in the chat too, or tap-tap on the card
  with the recording pinned on screen) is a product call.
- **Undo window**: the handoff says release sends. Release now waits 3 s ("Sending… Undo", 6 s with a
  screen reader) before sending, the only way to take back a false start (the chat cancels a recording
  through "Type instead"; a sent voice note can't be unsent anywhere).
- **The note is dropped** from the kid's postcard (above): the handoff has none.

**Checks.** api 75 tests (+3), migrations 6 (+1); `test-cooking.mjs` +6 (`lib/postcardLogic.ts`: who
gets a postcard, the burst's words and a no-feelings/no-pronoun/no-guilt check, the pots, the tilt,
"Just like mine" once, the refetch stamp and row key; review fix +1: only a lifted finger ends a
hold, a touch taken away never sends; review fix +1: the Undo path, a touch while a note waits takes
it back, time running out or the row going away sends it, nothing while it uploads, 3 s / 6 s).

**Screenshots** (`scratchpad/shots/pr3/`) came from this worktree's Expo web against a local stand-in
api + bucket (`mock-api-pr3`, a made-up family; uploads PUT to the stand-in; the kid's photo is a stock
image from `web/public/media/stock`); the real api and families were never written to (the only
outside requests were read-only GETs of public recipe JSON the app already makes from its bundled
library). The voice reply ran with Chrome's fake microphone. The hold review fix was checked with
real touch events (`mock-api-pr3-hold/drift.mjs`, shots 26-29): a thumb drifting 90 pt mid-hold on
Home and in the sheet keeps recording, the page doesn't move, nothing is sent until the finger lifts,
then exactly one voice reply goes; a touchcancel says "Not sent" and sends nothing. The same script on
the old Pressable (`-before` shots) scrolled the page and ended the hold mid-drift, and a touchcancel
sent a 1.5 s cut-off note. The Undo fix (shots 18, 19, 30, 31, re-run 26-29): the time ticks on the
pill's tab while held; after the lift nothing is written for the whole wait, then exactly one voice
reply; a real-touch tap on "Sending… Undo" says "Not sent" and nothing is written 6.5 s later (Reduce
Motion too: no bar); closing the sheet mid-wait sends the one note. Still to check on a phone: hold
and drift a little inside the Home scroll, and Undo with VoiceOver's double-tap.

**Deploy order.** Apply `20261018100400_retention_postcard.sql` (name `retention_postcard`) -> deploy
every function file (no `prs` change) -> the app build. An older server answers the postcard 404 and
the step says "Try again" (the card itself was already sent).

**LOW review fixes (Oct 18).**
- *Send can't race the quiet links* (`PostcardStep`): a `sending` flag from the Send tap until it
  answers turns off "Take another" / "Choose a photo", "Not now", "Share with someone else" (dimmed)
  and the pots, so the photo and rating shown are the ones that go and "Not now" can't leave
  mid-upload. A late answer after the step is gone (an `alive` ref) only shows the "Sent" toast: no
  second `onDone`, so no second `dismissTo` / `askForPushSoon`.
- *One shutter*: the peach camera tile is a picture of the postcard to be (flat, not pressable, hidden
  from screen readers); "Take a photo" is the one shutter, "Choose a photo" the quiet link.
- *A failed send* (`PostcardStep`): its toast shows at the top of this screen (`ToastViewport
  position="top"` until it flies), clear of the button's "Try again"; a network, timeout or 5xx
  error says "Couldn’t send it to Dad. Try again." (a refusal keeps the server's words: too big,
  can't be sent, 403). `ui/Toast`: an error toast without its own icon now shows an x on the red
  disc (it showed the success check on every screen).
- *Pots read as buttons* (`ui/icons PotIcon`): the unchosen outline is `colors.muted` (5.8:1 on the
  page, 6.1:1 on cards; it was ink at 32%, about 2:1).
- *An open chat sees a postcard land* (`messaging.useThread`): the cursor poll only brings newer
  messages, so while the chat holds a `cooked` card from someone else from the last 30 minutes
  (`postcardLogic.watchForPostcard`, `POSTCARD_WATCH_MS`), it also reads `GET /threads` at most every
  `INBOX_POLL_MS` and fetches the whole thread when that thread's `postcards` count moves (baseline:
  the count in the last full fetch). Older cards cost nothing extra. Checked: Dad's chat open on the
  plain card, the postcard showed in 7.9 s with one inbox read and one full fetch; a chat with only a
  2-day-old card made no inbox reads in 12 s.
- *Circle cards* (`UpdatesCard` -> `PostcardRow circle`): "Just like mine" stays in the card's own
  thread (its stamp shows under it there); the hold-to-talk reply goes to our 1:1
  (`openChatWith(sender)`) as a plain voice note, `reply_to` null (`sendVoiceReply` takes null), since
  a reply can only point at a message in its own thread. New builds always send cooked cards to the 1:1.
- *A waiting postcard stays in the first 3* (`postcardLogic.rankMine`, `UpdatesCard`): until I answer
  it "Just like mine", a postcard ranks at least as high as the newest "made" row (first on a tie),
  and hearts never go above it (`mixInHearts`'s needs-an-answer test counts it). Newer questions stay
  above it.
- *VoiceOver / TalkBack double-tap* (`HoldToTalk`): `activate` is always declared. While a note waits
  it is Undo, as before; otherwise it announces `HOLD_TAP_SPOKEN` ("To record, double-tap and hold
  while you talk, then let go.") with a light haptic and never starts the microphone. Their
  double-tap-and-hold still arrives as real touches (a hold).
- test-cooking +2 (`watchForPostcard`, `rankMine`; `HOLD_TAP_SPOKEN` joins the copy check).
  Screenshots: `scratchpad/shots/pr3-low/` (stand-in api `mock-api-pr3-low`: a slow postcard, a
  failing one, a "rank" Home with two questions and two newer hearts, Leo's postcard in the circle).
  Still to check on a phone: the double-tap announcement with VoiceOver (web has no accessibility
  actions).

**Open for Caleb.** Pots vs dumplings (TODO(caleb) in `icons.tsx` / `RatingPots.tsx`). Old photos a
re-post replaces stay in the private bucket (no sweep yet). A rating changed on a re-post with the
same photo doesn't move the `postcards` count, so an open chat shows it only when reopened (the app
re-posts only after a lost answer, with the same photo and rating).


---------------------------------------------------------------------------------------------------
## PR 7 as wired: the remaining touches (handoff section 4; Oct 18, branch `retention-7-touches`, on top of `retention-3-postcard`)

App only: no route, no migration, no deploy step, nothing in `makeRetention` (`prs` stays as it is).
Every touch is polish on a screen the seven already use: no new action, no new words beyond the
handoff's own, Reduce Motion gets a fade or nothing. The pure parts are in `app/src/lib/touches.ts`
(tested in `scripts/test-retention.mjs`, +8).

**Already done before this PR (checked in the code, not redone):** keep-awake + "Screen stays on"
(PR 1, `cook/[id].tsx useCookAwake`), the soft tick on checks and the firmer Send haptic (PR 1), hold
to record on the cook's update card (PR 3, `HoldToTalk`).

**Built.**
- *Cook mode's step pots* (`components/recipe/PotDots.tsx`, in `cook/[id].tsx`'s header under the
  tappable "Step 3 of 8", which still opens "All steps"): one pot silhouette per step, track colour
  until reached, then green (the bars' 240 ms fade); a jump from the sheet fills the new pots 45 ms
  apart. Sized by `potDotLayout` (10-16 pt, gap 6 then 4); more steps than fit at 10 pt keep the old
  bars. The row is always 13 pt tall, so nothing moves when it's measured. 13 steps (the longest
  bundled recipe) fit a 375 pt phone at 14 pt.
- *Ingredients* (`recipe/[id]/ingredients.tsx`): the "2 of 6" pill holds `CountPot`, a tiny pot whose
  body fills green from the bottom (done / total, 260 ms glide, a jump under Reduce Motion) and whose
  lid fills too when everything is out. A ticked row's big words get `StruckText`
  (`components/recipe/Strike.tsx`): one wobbly pen stroke per line (`strikeStrokes`), light green,
  drawn on in 260 ms; already-ticked rows show it drawn; unticking fades it; Reduce Motion fades it
  in. Lines come from `onTextLayout` on iOS/Android and from the browser's line boxes on web
  (`mergeLineRects`); failing both, one full-width stroke per line height. The estimate is never struck.
- *"I made it" steam* (`SuccessBurst steam`, from `MadeIt.tsx`): three curls draw on above the badge
  at 300 ms, then rise 10 pt and fade. Reduce Motion: they fade in with the badge and stay.
- *Send* (`send.tsx`): the button reads "Wrapping…" beside its spinner while it works (`ActionButton
  loadingLabel`; also the button's label while loading, and VoiceOver is told once, since the live
  region only speaks on Android and the web); the burst holds a folded paper plane (`SuccessBurst glyph="plane"`) that lifts off
  3 pt up and right with a small turn, and its subtitle is "You can close the app" after `LidPot`, a
  small pot whose lid drops 5 pt onto it as the words show (`SuccessBurst subtitleIcon`). Reduce
  Motion: fades only. Dev aid `?preview=wrapping` (the button mid-send, with stills and a dish name),
  beside the existing `?preview=done`.
- *Pot moods* (`ui/PotMood.tsx`, `PotMark mood`, `Brand mood`): sleepy 22:00-06:00 (closed eyes,
  softer smile, two small z's over the lid), waving all Sunday (the right handle raised as an arm; the
  pot rocks twice from its base when it first shows, about 1 s; no rock under Reduce Motion); sleepy
  wins on a Sunday night. Phone's clock (`getNow()`, so the web's dev `?now=` works), re-read every
  minute. Only on the brand row: "Who's in the kitchen?" and the sign-in screens. Brand without
  `mood` (share card, recap slides) stays the plain pot.
- *Hear on the kid hero* (`kid-home/HomeHero.tsx`): while the clip plays (or loads), the pill shows
  pause, a 14-bar `Waveform` that fills with progress and the time left, instead of "Hear Grandma ·
  0:23" (paused: the words and the progress fill come back; VoiceOver labels unchanged). When the
  chip's face is the voice speaking (`chipName` = `cookName`; a sender's face never pulses for someone
  else's voice), a 2 pt sun ring pulses out from the avatar every 1.2 s (`TalkRing`); Reduce Motion: a
  still ring. The kid Home still fits 375x812: "Explore more dishes" ends at 682 pt, the tab bar
  starts near 714.
- *Heart particles* (`recipes/HeartButton.tsx`): a heart that goes on plays PR 2's `HeartPop` (now
  with a `size` option; 0.7 here, reach 14) in the button, behind the glyph, so it stays crisp (no
  transform touches it, as its comment requires). Nothing under Reduce Motion. The pop mounts on the
  first tap only (a long Recipes list carries no idle animated nodes). It plays on the tap, like the
  fill: both are optimistic (`lib/favorites`), and a failed save rolls the fill back with its toast.
- *New family message, app open* (`lib/session.tsx UnreadProvider`, `buzzForUnread`): two light taps
  120 ms apart when the unread count read from the server goes up for the same person while the app
  is in front; never on the first read for someone (what was waiting when the app opened), never when
  it drops. Reading a thread re-polls (`refreshUnread`), so the lower count becomes the baseline and
  the next message still taps (`setTotal` keeps the baseline in step if it is ever used). The baseline is kept only while the app is in front (`unreadSeenAfter`): leaving the
  foreground forgets it and drops a read still on its way, and a read that lands while away is never
  kept, so coming back (say, by tapping the push for that message) is a silent baseline, like a cold
  start; the push was the note. One message, one signal: a rise waits `TAP_WAIT_MS` (3 s, for a push
  still on its way) and then plays only if `tapStillDue`: no message push (message, question, recipe,
  postcard) arrived with the app open in the last 20 s (`lib/push.ts lastMessagePushAt`, noted by the
  foreground handler whether it showed the banner or kept it quiet because that chat was on screen),
  no chat is open (`/chat/…`: its messages land on screen; with pushes on, another chat's message
  still has its banner), the count hasn't dropped back (the open chat marked it read), and the app is
  still in front for the same person. One wait at a time, so a burst of messages gets one double tap.
  No-op on web.

**Skipped, and why (say so in the PR).**
- *"Mom would be proud" in Caveat* (handoff 4, last step): it invents the cook's feeling (guardrail 1).
  The fallback (her verbatim last-step quote) is skipped too: the burst already has "You made it" +
  "We told Dad." and the postcard follows in about 2 s; a last-step quote is nearly always an
  instruction ("serve it hot"), and shown as a send-off it puts her words in a context she didn't say
  them in. So the Caveat font stays unloaded (`theme/fonts.ts` unchanged).
- *"next pick in 2:14" on the kid Home heading*: it competes. The heading line is the hero's one
  plain label and already shares the screen's right edge with "I miss home" and the profile pill; a
  ticking number is the only moving text on the calmest screen (throwaway look:
  `scratchpad/shots/pr7/30-SKIPPED-countdown-mock-*.png`, not committed). It also fails guardrail 5
  as specified: most families have 1-3 family dishes, and "family first, strictly" means the next
  window often picks the same dish (nothing changes at zero), while a weeknight dinner re-plans in
  half-hour steps after 17:00 (the change can come before zero). An honest version would need
  `recommend()` simulated forward to the first real change, and it would still be clutter.
- *Moods on the launch bloom*: its steam curls and sparkle sit exactly where the z's and the arm go
  (tried: crowded at night). The brand rows carry the moods.

**Departures.** The waveform is a fixed shape per dish that fills with progress, not live loudness:
expo-audio's sampling needs the record permission on Android and taps the audio through Web Audio on
web (a cross-origin clip without CORS would go silent). The pots use the app's green for "reached"
(as the bars did), not the mascot's peach.

**Checks.** Deno 291 passed, `deno check` clean, `tsc` and `expo lint` clean, Node: retention 39
(+8: potMoodAt, potDotLayout, strikeStrokes, blockLines, buzzForUnread, unreadSeenAfter's resume
sequence, tapStillDue, the foreground handler noting a message push), recommend 20, cooking 35,
hearts 15, table 25, recap 18. Screenshots in `scratchpad/shots/pr7/` from this worktree's Expo web
against a local copy of the PR 3 LOW stand-in api + bucket (`scratchpad/mock-api-pr7`, a made-up
family; `?now=` for the clock); the real api and families were never written to (the only outside
requests were read-only GETs of public recipe JSON and the voice clip the app already makes).

**Still to check on a phone:** the strike's line boxes from `onTextLayout` (web used the browser's),
the double tap's feel (it can come up to 15 s + 3 s after the message: if that feels late, tie it to
the open thread's own live update), the ring's pulse rate against a real voice, and a force-quit
mid-upload after Send: "You can close the app" holds for a locked phone or a backgrounded app (iOS
background URLSession), but iOS cancels those uploads when the app is swiped away and
`lib/uploads.ts` has no resume on launch; either add one for a job whose files didn't finish, or
Caleb softens the line (TODO(caleb) in `send.tsx`).

**Open for Caleb.** The kid hero's idle pill already truncates to "Hear Grandma · 0:…" on a 375 pt
phone with a long name (unchanged here; a name that gives way before the time needs a native check:
web's line clamp leaves a gap). Pots vs dumplings for the step pots and the count pot follows the
postcard's TODO(caleb) if that changes.

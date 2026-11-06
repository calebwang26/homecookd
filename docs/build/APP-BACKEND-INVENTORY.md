# What the app calls today (inventory for the AWS api)

Nov 2, 2026 · App screens & recording. This lists every backend call `app/` makes on `main` (at `a44fdee17`), grouped
by area, so AWS backend can write each area's contract (routes, auth, errors) against it. Docs only: nothing in `app/`
changes until the contract for an area is agreed. Caleb's plan (Nov 1): 1.1 talks only to AWS for every area, proven on
TestFlight against staging and then production. There are no area-by-area switches and no adapter for old builds.

## How the app talks to the backend today

| Backend | Base URL in the app | Auth the app sends | Where |
|---|---|---|---|
| Supabase `api` edge function | `EXPO_PUBLIC_API_URL` | `x-device-key` (or the retired `x-family-code`), `x-profile-id` when acting as one person, `x-tz` | `lib/api.ts` (`api.*`), plus own clients in `cookingApi.ts`, `tableApi.ts`, `recapApi.ts`, `dishStatsApi.ts`, `moveRequests.ts` |
| Convex functions | `EXPO_PUBLIC_CONVEX_URL` | `sessionToken` argument from `sessions:start` (device key + profile id) | `lib/live/convex.ts` (`call`, `useLive`), `lib/live/community.ts`, `lib/live/answers.ts`, `lib/live/pushTokens.ts`, `lib/cravings.ts`, `lib/dishCards.ts`, `lib/homie/news.ts`, `lib/live/links.ts` |
| Convex HTTP routes (`.convex.site`) | from `EXPO_PUBLIC_CONVEX_URL` | capability token in the body | `lib/live/links.ts` (`/link/open`), `lib/live/invite.ts` (`/invite/open`) |
| Upload signer (Cloud Run) | `EXPO_PUBLIC_UPLOAD_URL` | `Authorization: Bearer <Convex session>` (and the retired `X-Edible-Family`) | `lib/uploads.ts` (create a job: title, files, then PUT to signed GCS URLs), `lib/deletes.ts` (`action: 'delete'` a recipe, `action: 'cancel'` a job) |
| Signed upload URLs (GCS) | returned by `/voice-upload`, `/photo-upload`, `files:uploadUrl` and the signer | in the signed URL | `lib/voice.ts`, `lib/photos.ts`, `lib/live/convex.ts` (`uploadFile`) |
| Public media bucket (GCS) | `EXPO_PUBLIC_BUCKET_URL` | none | `lib/recipes.ts`: `library.json`, `<id>/recipe.json`, covers and clips by URL |
| Voice service (Cloud Run) | `EXPO_PUBLIC_VOICE_URL` | `session=<Convex session>` on the socket URL / in the body | `lib/live/voice.ts` (`/cook`), `lib/live/homie.ts` (`/record`), `lib/live/speak.ts` (`/speak`), `lib/homie/news.ts` (`/homie/line`) |

Counts: 48 Supabase routes, 59 Convex functions (24 queries, 30 mutations, 5 actions), 2 Convex HTTP routes, the signer
(3 actions), the public bucket, and 4 voice-service endpoints.

**Live updates.** 20 of the 24 Convex queries are subscriptions through `useLive`, so screens re-render when the data
changes: `jobs:mine`, `live:recording`, `liveEvents:forRecording`, `liveEvents:frame`, `glasses:videos`, `people:me`,
`recipes:list`, `questions:openForCook`, `questions:forRecipe`, `messages:madeMyDish`, `cravings:forCook`, `dishAsks:get`,
`homie:news`, `shareRequests:familyDishes`, and `community:` and `dinners:` (blocked, feed, mySwaps, recipe, get, mine).
The AWS replacement for subscriptions has to exist before these areas move (build order step 7).

**Two ids for one person.** Supabase knows a person by `profile_id`, Convex by its own person id. The app maps them with
`people:family` and, where that's missing, `convexPersonIdByName` (a name match across `questions:openForCook`,
`cooking:current` and `messages:list`). One AWS id should replace both, and these lookups go away.

**Stub fallbacks.** Most Convex calls take a stub fallback for Expo Go and a missing function (`useLive`'s `soft`). The
AWS client needs a clear rule for what a phone shows when a route is missing or the api is down.

**Not called anywhere:** `api.createInvite` (`POST /invites`), `api.unread` (`GET /unread`) and `api.jobPublished` are
defined in `lib/api.ts` but no screen calls them, so they don't need AWS routes.

## Reading the tables

- **App wrapper** is the function the screens call (`file:function`). One function can make several calls.
- **Screens** are the `app/src/app` routes that import the wrapper, directly or through components. "app-wide" means
  the root layout or the session provider, so every screen depends on it. "N screens" usually means a shared sheet
  (share, members, the inbox).
- The list was built by a script that reads string literals and imports (`'jobs:mine'`, `api.family(`,
  `fetch(\`${API_URL}/table\``). Three calls with computed paths were added by hand: `/table`, `/hearts/recent` and the
  bucket reads. A call made some other way would be missed, so check this list against each area's code when its contract is written.

## Sign-in, people and family

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Convex action | `apple:revoke` | `convex.ts:revokeAppleSignIn` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Convex action | `sessions:start` | `convex.ts:convexSession`, `convex.ts:deleteMyAccount` | 20 screens (shared sheet or provider) |
| Convex mutation | `account:deleteMe` | `convex.ts:deleteMyAccount` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Convex mutation | `links:claim` | `links.ts:claimLink` | `/a`, `/dinner/new`, `/i`, `/join`, `/miss`, `/parent/_layout`, `/r` |
| Convex mutation | `links:moved` | `links.ts:linksMoved` | `/_layout` |
| Convex mutation | `people:setLanguage` | `convex.ts:setLanguage` | 28 screens (shared sheet or provider) |
| Convex mutation | `push:register` | `pushTokens.ts:convexPush` | `/_layout` |
| Convex mutation | `push:unregister` | `pushTokens.ts:convexPush` | `/_layout` |
| Convex query | `apple:revokeReady` | `convex.ts:appleRevokeReady` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Convex query | `cooking:current` | `convex.ts:convexPersonIdByName`; convexPersonIdByName matches a name across these three reads (fallback when people:family is missing) | app-wide |
| Convex query | `people:family` | `convex.ts:convexKidIds` | `/_layout`, `/parent/home`, `/parent/recipes`, `/record`, `/recording`, `/send` |
| Convex query | `people:me` | `convex.ts:useMe` | 28 screens (shared sheet or provider) |
| Convex HTTP | `/link/open` | `links.ts:openLink` | `/a`, `/dinner/new`, `/i`, `/join`, `/miss`, `/parent/_layout`, `/r` |
| Supabase api | `POST /move-requests (ask), GET /move-requests (to approve)` | `moveRequests.ts:moveApi.ask`, `moveRequests.ts:load` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Supabase api | `POST /move-requests/:id/approve` | `moveRequests.ts:moveApi.approve` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Supabase api | `POST /move-requests/:id/decline` | `moveRequests.ts:moveApi.decline` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Supabase api | `GET /move-requests/mine` | `moveRequests.ts:moveApi.mine` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Supabase api | `GET /family` | `session.tsx:SessionProvider` | app-wide |
| Supabase api | `GET /shares/:id` | `handoff.ts:peekShare` | `/_layout`, `/a`, `/dinner/new`, `/i`, `/join`, `/miss`, `/parent/_layout`, `/r` |
| Supabase api | `POST /auth/apple` | `session.tsx:providerAuth` | app-wide |
| Supabase api | `POST /auth/google` | `session.tsx:providerAuth` | app-wide |
| Supabase api | `POST /devices` | `session.tsx:SessionProvider` | app-wide |
| Supabase api | `POST /devices/revoke` | `session.tsx:SessionProvider` | app-wide |
| Supabase api | `POST /invites/peek` | `useClaimPeek.ts:useClaimPeek` | `/a`, `/dinner/new`, `/i`, `/join`, `/miss`, `/parent/_layout`, `/r` |
| Supabase api | `POST /join-links` | `invites.ts:familyJoinLink` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Supabase api | `POST /profiles` | `AddPhonelessSheet.tsx:AddPhoneless` | `/`, `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/home`, `/parent/messages` |
| Supabase api | `POST /profiles/:id/remove` | `MembersSheet.tsx:Members`, `session.tsx:SessionProvider` | app-wide |
| Supabase api | `POST /profiles/self` | `session.tsx:SessionProvider` | app-wide |
| Supabase api | `POST /push-tokens` | `_layout.tsx:registerPush` | `/_layout` |
| Supabase api | `POST /push-tokens/remove` | `session.tsx:SessionProvider` | app-wide |

## Recording, upload and jobs

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Convex mutation | `files:uploadUrl` | `convex.ts:uploadFile` | app-wide |
| Convex mutation | `jobs:cancel` | `convex.ts:cancelLiveJob` | `/_layout`, `/parent/home`, `/parent/recipes` |
| Convex mutation | `jobs:cancelUpload` | `convex.ts:cancelLiveUpload` | `/parent/home`, `/parent/recipes` |
| Convex mutation | `jobs:create` | `convex.ts:createJob` | `/_layout`, `/parent/home`, `/parent/recipes`, `/recording`, `/send` |
| Convex mutation | `live:endRecording` | `convex.ts:endRecording` | `/parent/home`, `/recording` |
| Convex mutation | `live:setCover` | `convex.ts:setCover` | `/recording` |
| Convex mutation | `live:startFilming` | `convex.ts:startFilming` | `/recording` |
| Convex mutation | `live:startRecording` | `convex.ts:startRecording` | `/record` |
| Convex query | `glasses:videos` | `convex.ts:useGlassesVideos` | `/parent/home`, `/record` |
| Convex query | `homie:news` | `news.ts:useHomieNews` | `/_layout`, `/answer/[id]`, `/recording` |
| Convex query | `jobs:mine` | `useDoorsGate.ts:useDoorsGate`, `convex.ts:useLiveJobs`, `convex.ts:recordingJob`, `convex.ts:uploadJob` | `/_layout`, `/parent/_layout`, `/parent/home`, `/parent/recipes` |
| Convex query | `live:recording` | `convex.ts:recordingJob`, `convex.ts:useRecording` | `/_layout`, `/parent/home`, `/recording` |
| Convex query | `liveEvents:forRecording` | `convex.ts:useLiveLog` | `/recording` |
| Convex query | `liveEvents:frame` | `convex.ts:useLiveFrame` | `/recording` |
| Voice service HTTP | `/homie/line` | `news.ts:askLine` | `/_layout`, `/answer/[id]`, `/recording` |
| Voice service HTTP | `/speak` | `speak.ts:fetchSpeech` | `/_layout`, `/answer/[id]`, `/cook/[id]`, `/recording` |
| Upload signer | `POST /` | `deletes.ts:requestDelete`, `deletes.ts:requestCancel`, `uploads.ts:startUpload` | 19 screens (shared sheet or provider) |
| Supabase api | `POST /pending-sends` | `uploads.ts:ensurePendingSend` | `/_layout`, `/parent/home`, `/parent/recipes`, `/recording`, `/send` |
| Voice service socket | `/record` | `homie.ts:useHomieRecording` | `/recording` |

## Recipes and library

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Convex query | `recipes:list` | `data.ts:useFamilyRecipes`, `useDoorsGate.ts:useDoorsGate`, `convex.ts:recipeMap`, `recipes.ts:useFamilyLibrary` | app-wide |
| Supabase api | `GET /dish-stats?ids=` | `dishStatsApi.ts:fetchDishStats` | `/kid/home`, `/kid/recipes`, `/my-recipe/[id]`, `/parent/home`, `/parent/recipes` |
| Supabase api | `GET /favorites` | `favorites.ts:load` | `/kid/home`, `/kid/recipes`, `/kid/recipes/[id]`, `/parent/recipes`, `/recipe/[id]` |
| Supabase api | `GET /me/recipe-stats` | `stats.ts:load` | `/cook/[id]`, `/kid/recipes`, `/kid/recipes/[id]`, `/parent/recipes`, `/recipe/[id]` |
| Supabase api | `GET /recipes/:id/activity` | `ShareSheet.tsx:ShareBody` | 11 screens (shared sheet or provider) |
| Supabase api | `POST /events` | `messaging.ts:cooked`, `messaging.ts:logViewed` | 13 screens (shared sheet or provider) |
| Supabase api | `POST /favorites` | `favorites.ts:send` | `/kid/home`, `/kid/recipes`, `/kid/recipes/[id]`, `/parent/recipes`, `/recipe/[id]` |
| Supabase api | `POST /send-recipe` | `sendRecipe.ts:sendRecipes`, `messaging.ts:sendRecipe` | 11 screens (shared sheet or provider) |
| Supabase api | `POST /shares` | `shareLink.ts:getShareLink` | 11 screens (shared sheet or provider) |
| Supabase api | `GET /hearts/recent` | `dishStatsApi.ts:fetchHeartsRecent`; components/parent/UpdatesCard, components/hearts/HeartUpdateRow | `/parent/home` |
| GCS (public) | `GET <bucket>/library.json, <bucket>/<id>/recipe.json` | `recipes.ts`; public library + recipe files, EXPO_PUBLIC_BUCKET_URL | app-wide |

## Messages, questions and media

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Convex action | `messages:sharePhoto` | `convex.ts:sharePhoto` | `/chat/[id]`, `/cook/[id]`, `/kid/ask`, `/kid/home`, `/parent/messages` |
| Convex mutation | `messages:send` | `convex.ts:sendPhoto` | `/chat/[id]`, `/cook/[id]`, `/kid/ask`, `/kid/home`, `/parent/messages` |
| Convex mutation | `questions:answer` | `convex.ts:answerQuestion` | `/answer/[id]`, `/parent/home` |
| Convex query | `messages:list` | `convex.ts:convexPersonIdByName`; convexPersonIdByName matches a name across these three reads (fallback when people:family is missing) | app-wide |
| Convex query | `messages:madeMyDish` | `convex.ts:useMadeMyDish` | `/parent/home` |
| Convex query | `questions:openForCook` | `convex.ts:useCookQuestions`, `convex.ts:convexPersonIdByName`; convexPersonIdByName matches a name across these three reads (fallback when people:family is missing) | app-wide |
| Supabase api | `POST /threads` | `cookingApi.ts:threadWith` | `/cook/[id]` |
| Supabase api | `POST + GET /threads/:id/messages (hearts)` | `cookingApi.ts:cookingApi.sendHeart`, `cookingApi.ts:heartFetcher` | `/cook/[id]` |
| Supabase api | `GET /circle` | `messaging.ts:openCircle` | `/chat/[id]`, `/cook/[id]`, `/kid/ask`, `/kid/home`, `/kid/recipes/[id]`, `/parent/messages`, `/recipe/[id]` |
| Supabase api | `GET /questions/open` | `messaging.ts:loadOpen` | 15 screens (shared sheet or provider) |
| Supabase api | `GET /recipes/:id/notes` | `messaging.ts:loadNotes` | 15 screens (shared sheet or provider) |
| Supabase api | `GET /recipes/:id/questions` | `messaging.ts:useRecipeQuestions` | `/cook/[id]` |
| Supabase api | `GET /threads` | `messaging.ts:loadThreads` | 15 screens (shared sheet or provider) |
| Supabase api | `GET /threads/:id/messages ` | `messaging.ts:fetchNew`, `messaging.ts:fetchAll` | 15 screens (shared sheet or provider) |
| Supabase api | `POST /messages/:id/postcard` | `messaging.ts:sendPostcard` | `/chat/[id]`, `/cook/[id]`, `/kid/ask`, `/kid/home`, `/parent/messages` |
| Supabase api | `POST /photo-upload` | `photos.ts:uploadPhoto` | 15 screens (shared sheet or provider) |
| Supabase api | `POST /recipe-notes` | `messaging.ts:saveToRecipe` | `/chat/[id]`, `/kid/ask`, `/kid/home`, `/parent/messages` |
| Supabase api | `POST /recipe-notes/:id/remove` | `messaging.ts:removeNote` | `/chat/[id]` |
| Supabase api | `POST /threads` | `messaging.ts:openChatWith` | `/`, `/chat/[id]`, `/cook/[id]`, `/kid/ask`, `/kid/home`, `/kid/recipes/[id]`, `/parent/home`, `/parent/messages`, `/recipe/[id]` |
| Supabase api | `POST /threads/:id/messages` | `messaging.ts:deliver`, `messaging.ts:cooked`, `messaging.ts:sendPostcard`, `messaging.ts:sendJustLikeMine`, `messaging.ts:sendVoiceReply`, `messaging.ts:sendVoiceQuestion`, `messaging.ts:request` | 15 screens (shared sheet or provider) |
| Supabase api | `POST /threads/:id/read` | `messaging.ts:markRead` | 15 screens (shared sheet or provider) |
| Supabase api | `POST /voice-upload` | `voice.ts:uploadVoice` | 16 screens (shared sheet or provider) |

## Kid cooking

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Convex query | `questions:forRecipe` | `answers.ts:useRecipeAnswers` | `/cook/[id]` |
| Supabase api | `POST /cooking (start), GET /cooking (who is cooking)` | `cookingApi.ts:cookingApi.start`, `cookingApi.ts:cookingApi.live` | `/cook/[id]` |
| Supabase api | `POST /cooking/end` | `cookingApi.ts:cookingApi.end` | `/cook/[id]` |
| Supabase api | `GET + POST /profile/share-cooking` | `cookingApi.ts:cookingApi.share`, `cookingApi.ts:cookingApi.setShare`; components/cooking/ShareCookingRow (in ConsentSheet) | (none found) |
| Voice service socket | `/cook` | `voice.ts:useVoiceCooking` | `/cook/[id]` |

## Cravings and kid asks (v2)

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Convex action | `cravings:sendVoiceRecipe` | `convex.ts:sendCravingVoice` | `/parent/_layout`, `/parent/home`, `/record`, `/recording`, `/request/[id]`, `/request/sent`, `/request/voice`, `/send` |
| Convex mutation | `cravings:createLink` | `convex.ts:cravingLink` | `/parent/_layout`, `/parent/home`, `/record`, `/recording`, `/request/[id]`, `/request/sent`, `/request/voice`, `/send` |
| Convex mutation | `cravings:setFilmingDay` | `convex.ts:setCravingDay` | `/parent/_layout`, `/parent/home`, `/record`, `/recording`, `/request/[id]`, `/request/sent`, `/request/voice`, `/send` |
| Convex query | `cravings:forCook` | `cravings.ts:useCravingAsks` | `/parent/home` |
| Convex query | `dishAsks:get` | `dishCards.ts:useMyCard` | `/dish/[id]` |

## Community and dinners

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Convex action | `dinners:inviteLink` | `community.ts:inviteLink` | 11 screens (shared sheet or provider) |
| Convex mutation | `community:block` | `community.ts:block` | `/community/[id]`, `/dinner/[id]`, `/kid/community` |
| Convex mutation | `community:cookTogether` | `community.ts:cookTogether` | `/kid/community` |
| Convex mutation | `community:report` | `community.ts:report` | `/community/[id]`, `/dinner/[id]` |
| Convex mutation | `community:requestSwap` | `community.ts:requestSwap` | `/kid/community` |
| Convex mutation | `community:respondSwap` | `community.ts:respondSwap` | `/kid/community` |
| Convex mutation | `community:setLocation` | `community.ts:setLocation` | 21 screens (shared sheet or provider) |
| Convex mutation | `community:setShare` | `community.ts:setShare` | `/my-recipe/[id]` |
| Convex mutation | `community:unblock` | `community.ts:unblock` | `/kid/community` |
| Convex mutation | `dinners:create` | `community.ts:createDinner` | `/dinner/new` |
| Convex mutation | `dinners:requestJoin` | `community.ts:requestJoin` | `/dinner/[id]` |
| Convex mutation | `dinners:respond` | `community.ts:respond` | `/d`, `/dinner/[id]` |
| Convex mutation | `shareRequests:ask` | `community.ts:askToShare` | `/kid/community` |
| Convex query | `community:blocked` | `community.ts:useBlocked` | `/kid/community` |
| Convex query | `community:feed` | `community.ts:useCommunityFeed` | `/kid/community` |
| Convex query | `community:mySwaps` | `community.ts:useMySwaps` | `/dinner/new`, `/kid/community` |
| Convex query | `community:recipe` | `community.ts:useCommunityRecipe` | `/community/[id]` |
| Convex query | `dinners:get` | `community.ts:useDinner` | `/dinner/[id]`, `/kid/community` |
| Convex query | `dinners:mine` | `community.ts:useMyDinners` | `/kid/community` |
| Convex query | `shareRequests:familyDishes` | `community.ts:useFamilyDishes` | `/kid/community` |
| Convex HTTP | `/invite/open` | `invite.ts:openInvite` | `/d` |

## Table and recap

| Backend | Call | App wrapper | Screens |
|---|---|---|---|
| Supabase api | `GET /recap?month=` | `recapApi.ts:recapApi.get` | `/recap` |
| Supabase api | `GET /table` | `tableApi.ts:refreshTable`; Sunday table (useTable: components/table/HomeTableRow, lib/sundayTable, lib/listening) | `/`, `/chat/[id]` |


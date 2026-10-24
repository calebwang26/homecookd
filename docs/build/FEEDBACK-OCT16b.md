# Founder feedback, Oct 16 (round 2): binding plan

Brand **homecookd**. Design bible `docs/design/hearth-bible/`, motion `docs/design/ANIMATIONS.md`,
previous rounds `docs/build/FEEDBACK-OCT16.md`, API `docs/build/API.md`. Caleb: "DO NOT MAKE
MISTAKES. Prioritize quality." Keep words few. Never invent facts; bind real data.

## 1. Kid app
### 1.1 Heart bug
Hearting a dish makes that grey heart's outline go very fuzzy; it only turns crisp again after the
next heart toggle elsewhere. Root-cause it (e.g. a press/scale animation or rasterization left on
the icon, a transform that never settles to exactly 1, an SVG scaled from a small viewBox) and fix
it so the heart is always crisp in both states, on iOS (Expo Go) and web.

### 1.2 Tabs: Home | Recipes | Ask (Recipes comes back as its own tab)
- **Recipes tab** = the parent's "Your recipes" UI (bible Parent-Home-Scrolled: big rounded card list,
  thumbnail, title, one activity line, chevron), plus a heart on each row (kids can heart), and filter
  chips on top: **Favorites**, Everyone, then each cook (Dad, Miles, Grandma, Auntie Lin...).
  Favorites chip = the dishes this kid hearted. Search lives on Home (see 1.3), not here (a small
  search in Recipes is optional if it doesn't clutter).
- **Every tap on a dish anywhere in the kid app opens it inside the Recipes tab** (the recipe screen
  is part of the Recipes tab's stack): Back returns to the Recipes list, and the Recipes tab is the
  active tab. Recipe detail screens keep the bible layout (no tab bar on the detail, sticky Start
  cooking), ingredients and cook mode as today.
  Route plan (expo-router): `app/src/app/kid/recipes/_layout.tsx` (Stack), `kid/recipes/index.tsx`
  (list), and the detail routes reachable as `/kid/recipes/<id>` (wrapping the existing
  `recipe/[id]` screen component, not duplicating it); `router.push('/kid/recipes/<id>')` from Home,
  Ask (recipe cards), chats. Keep `/recipe/<id>` working (parents + deep links).
- **Favorites are stored on the server per profile** (valuable data for recommendations): see 4.

### 1.3 Kid Home: decluttered, smart sections
Keep: greeting + avatar, the search bar ("A dish, a cook, a craving..."; typing shows matching
dishes inline), the recommendation hero on top (time of day / holiday, from `lib/recommend.ts`).
Replace the whole "Our family table" kitchens list with three short smart sections (each a
horizontal row or 2-3 cards, hidden when empty, honest reasons from real data only):
1. **Your favorites** ("You keep coming back to these"): hearted dishes first, then most-viewed.
2. **Explore** ("Just in. You haven't made it yet."): newest recipes sent to me / newest family
   recipes that I have not cooked.
3. **Come back to it** ("You made this a while ago"): dishes I cooked more than ~3 weeks ago (from
   cooked events), oldest first.
"Hear their voices" stays only if it fits without clutter (compact). Every dish tap -> Recipes tab
(1.2). Data comes from `GET /me/recipe-stats` + favorites (section 4).

### 1.4 Messaging: the whole system
- "+ Ask about a dish" -> pick a dish (or "Something else") -> **pick who**: "The family" or a
  specific person (avatars of everyone else in the family). "Something else" must also let them pick
  who, not force the family chat.
- In the family (circle) chat, tapping the header ("Family" + faces) opens **members**: everyone in
  the circle with a "Message" button each -> opens/creates the 1:1 chat (POST /threads {other_id}).
- Ask inbox: family circle first, then every 1:1 chat; a "New message" action to start a chat with
  anyone in the family. Both kids and cooks get the same messaging (parents' Messages tab too).
- A question sent to one person in a 1:1 chat counts as a question for them: it shows in their
  "Waiting for your answer" (if they're a cook), and their answer (reply) is saved into the recipe for
  the whole family exactly like circle answers (backend 4).
- Keep the bible chat look (lavender me / peach them bubbles, voice notes, step chips, recipe cards).

## 2. Parent app
- **Parent Home gets a "Send a recipe" section** (it looks empty): one clear card/row "Send a recipe
  to your family" -> pick one of my recipes (or any family recipe if I have none, say so honestly) ->
  opens the existing Spotify-style share sheet (send inside homecookd to a person, or Copy link /
  Messages / WhatsApp / More so anyone can open the limited web version). Keep Home's three-button
  calm: this is one compact row/card, not clutter.
- **Crash: tapping the share (arrow-up) icon kills the app in Expo Go** ("logs me out of Expo Go").
  Root-cause and fix (native crash: check every native API the share sheet path touches on iOS:
  BottomSheet inside a native Modal + BlurView + GestureHandlerRootView, Reanimated
  interpolateColor/animated props, react-native-svg animated components, expo-image, expo-clipboard,
  Share/Linking, a Modal opened while another Modal or a native-stack transition is active, version
  mismatches vs Expo Go's native modules (`npx expo install --check`), anything only on iOS). The
  Metro log of the running server is in the user's terminal tab "c15" (read it with the terminal
  read tool; iOS errors appear there if the JS side logged anything). Make the share sheet open
  reliably on iOS in Expo Go; add defensive fallbacks.

## 3. Lander (/teach)
- Order: hero -> **Record yourself cooking...** (how-it-works) -> **Here's the real app** (the demo,
  SeeItWork) -> **Your kids miss your cooking. Let's fix that.** (the family table) -> rest as now.
- Too much space above and below the "Record yourself cooking" section: tighten both.
- "Your kids miss your cooking" must NOT look like a second copy of "Record yourself cooking" (same
  layout twice in a row is the complaint). Redesign it so it's creatively different: e.g. a full-bleed
  colour block (forest green #34430C with cream/chartreuse type, or sun yellow), a different
  arrangement of the family table (big centred folder, or photo-led cards in a row, headline centred
  above), different rhythm. Still simple motion (fade-ins), still parent-only changes, /learn
  unchanged. Keep the perf guardrails (FEEDBACK-OCT16.md section E) and `npm run perf` passing.

## 4. Backend additions (Supabase `homecookd`, function `api`)
- `favorites(profile_id, recipe_id, created_at, primary key(profile_id, recipe_id))`, RLS on, no
  policies (same model). `GET /favorites` -> `{recipe_ids: string[]}`; `POST /favorites`
  `{recipe_id, on: boolean}` (idempotent).
- `GET /me/recipe-stats` -> `[{recipe_id, views, last_viewed_at, cooked, last_cooked_at,
  favorited, sent_to_me_at}]` for the acting profile (views/cooked from recipe_events, sent from
  recipe messages to me).
- 1:1 questions: a learner's `question` (or step question) in a pair thread is a question for the
  other person; `GET /questions/open` returns, for a cook, open circle questions plus open 1:1
  questions addressed to them; a reply (reply_to) by the addressee answers it and creates the recipe
  note exactly like the circle.
- `GET /circle` already returns members; make sure every family member is a member.
- Keep all existing endpoints working; update API.md and app/src/lib/api.ts types/functions.

## 5. Ship
Typecheck + lint (app, web), web build + `npm run perf`, screenshots vs bible, live API tests on the
TEST family only (code in docs/build/.test-family-code; never print it; never write to "Our family"
except read-only). Then commit (branch lander).

## 6. Lander guardrails (also enforced this round)
See FEEDBACK-OCT16.md section E, incl. rule 5: never pass 'scale' to gsap.quickSetter/quickTo (Safari crash).

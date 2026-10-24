# Founder feedback, Oct 16, and how we build it (binding for every agent)

Brand: **homecookd** (all lowercase). Design bible: `docs/design/hearth-bible/`. Motion:
`docs/design/ANIMATIONS.md`. App contract: `docs/build/SPEC.md`; backend: `docs/build/API.md`.
Overall note from Caleb: "Looks great, especially the theme & colors. **Keep cutting words; the less
wordy, the better.**" Every screen and every lander section you touch gets shorter, never longer.

---------------------------------------------------------------------------------------------------
## A. App

### A1. Sign-in & the family circle
- **Every open of the app lands on the Profiles screen** ("Who's in the kitchen?": cooks / kids).
  The app never skips straight into the last profile. (A warm launch splash first is fine.)
- **One email = your family circle.** A person signs up once with their email and is connected to
  their family's circle. No family codes in the normal path.
  - First run: a single screen: wordmark, "What's your email?", one field, Continue. If the email is
    new: name + "I'm the cook" / "I'm learning" choice -> creates the circle (or joins the circle of
    a share link they came from). If the email is known: straight to Profiles.
  - Adding family on the Profiles screen ("+ Add family") asks name, cook or learner, and optional
    email. When that person later signs in with that email (app or web), they land in the same circle.
  - "Have a family code?" stays as a small secondary link (backwards compatible).
  - The web share page (`/r`) sign-up uses the same email flow and **joins the sender's family
    circle** (not a new family). Success copy: "You're in <Family name>." + "Open homecookd on your
    phone and sign in with <email>."
  - Honest gap (document as a TODO in code + API.md): emails are not verified yet (no email provider
    is configured). Production needs a one-time code by email before connecting a device. When a new
    device connects to a circle by email, post a short system note into the family circle thread
    ("Sam signed in on a new phone") so the family can see it.

### A2. Kid view: Home + Recipes become one Home
- Kid tabs become **Home | Ask** (two tabs). The merged Home = the recommendation on top, then the
  family's recipes sorted by whose kitchen (the current Recipes screen content: search, cook chips,
  kitchen sections with hearts). Keep the bible's look (Kid-Home hero card + Kid-Browse lists).
- **Recommendations are based on time of day and season/holidays**:
  - meal of the moment from the device clock: breakfast (5-10:30), lunch (10:30-15), dinner
    (15-21), late night (21-5). Pick family recipes that fit (tags/title keywords: breakfast, eggs,
    pancakes, noodle, soup, rice, chili, fish, dessert...). Copy like "Dinner tonight" / "For lunch".
  - season + holidays from a small built-in calendar (2026-2027, e.g. Mid-Autumn Festival 2026-09-25
    -> mooncakes, Halloween 10-31, Diwali 2026-11-08, Thanksgiving 2026-11-26, Christmas 12-25, Lunar
    New Year 2027-02-06... verify dates) shown in the ~3 weeks before the day. If a family recipe
    matches (keywords), recommend it ("Mooncakes for Mid-Autumn"). If none matches, show one small
    honest card that asks the family ("Mid-Autumn is in 9 days. Ask Grandma for mooncakes?") which
    posts a request into the family circle.
  - never invent facts; recommendations only use real recipes.
- Fewer words everywhere (cards: title + one short line max).

### A3. Questions go to the family circle; answers are saved into the recipe for good
- Every family has one **family circle thread** (all members). Kids' questions go there by default
  (the step "Ask about this step", "+ Ask about a dish", and the Ask composer), so **Mom or Dad (any
  cook) can answer**. 1:1 chats still exist (e.g. a recipe someone sent), but asking = the circle.
- Kid Ask inbox: the circle is the top row ("Family", stacked faces of the cooks, last message),
  then any 1:1 threads. The circle chat shows each message with the sender's face + name.
- Parent: open questions (unanswered kid questions in the circle) show as "Waiting for your answer"
  on Parent Home and Messages for every cook. Whoever answers first, it's marked answered by them.
- **Answers update the shared family recipe**: when a cook answers a question about a recipe (reply to
  that question, by voice or text), the answer is saved as a **recipe note** on that recipe (and
  step, if the question was about a step). Everyone in the family sees it (Leo & Maya, not only the
  asker): on the step screen inside the "More from <cook>" dropdown as "From the family" Q&A (question
  in their words, the answer with a Hear button for voice), and on the recipe screen as a small
  "<N> family answers" row that opens them. A cook's chat message can also be saved into the recipe
  with one tap ("Save to recipe") when it's about a recipe. Saved notes show "Saved to the recipe".

### A4. Parent view
- Home: keep exactly as is (kid's question first, "Leo made yours", three buttons, nothing else).
- Your recipes: keep the page; easy to follow as is (fewer words OK).
- Record: keep as its own tab, one tap away; keep Leo's request, the 3-step prompt, camera-roll upload.
- Messages: keep; now includes circle questions as above.

### A5. Backend data model for A1 + A3 (Supabase `homecookd`, function `api`)
- `profiles.email text` (nullable), unique on lower(email) across all families.
- `POST /auth/email` (public) `{email, name?, role?, share_token?}` ->
  known email: `{family_code, family_name, profile_id, existing:true}`;
  new email + share_token: join the share's family as a new profile (role learner unless given);
  new email, no token: create a family circle "<name>'s family" with this profile;
  name required for new emails. Returns the family code for the device to store (the app keeps it
  in SecureStore; users never need to see it). Rate-limited. Posts the "signed in on a new phone"
  system note for known emails.
- `POST /profiles` accepts optional `email`.
- `threads.kind text default 'pair' check in ('pair','circle')`; one circle per family (unique
  partial index). `GET /circle` -> `{id}` (create if missing). `GET /threads` includes the circle
  (with `kind`, member avatars) first. Unread works per profile via thread_reads.
- `messages.reply_to uuid null` (references messages.id), new kind `'question'` (a learner's
  text/voice question, may carry recipe_id/step_order) and `'system'` (system note, no sender
  pressure). A cook's message with `reply_to` = a question => that question is answered
  (`answered_by`, `answered_at` derivable) and a `recipe_notes` row is created when the question has
  a recipe_id.
- `recipe_notes(id, family_id, recipe_id, step_order null, question_message_id null, question text,
  answer_message_id, answer_text, answer_audio_path, answer_duration_s, answered_by, created_at)`.
  `POST /recipe-notes` `{message_id}` = "Save to recipe" for any cook message about a recipe.
  `GET /recipes/:id/notes` -> notes with fresh signed audio URLs + author profile.
- `GET /questions/open` -> unanswered circle questions (for cooks' cards).
- Keep every existing endpoint working (the app and web page use them). Update API.md.

## B. Backend pipeline
- Camera-roll videos can arrive out of order (creation dates missing, identical or wrong). The
  pipeline must order the files so setup & prep (preheating, chopping, measuring) come before
  cooking, mixing and assembling, then plating. Implementation lives in `pipeline/` (prep.py /
  process.py): after per-file extraction, decide the order from the extracted events (cheap text-only
  model call that returns an order + confidence, plus a deterministic keyword fallback), and if it
  differs from the recording-time order (and the timestamps are unreliable or the content order is
  clearly different), rebuild play.mp4 / voice.m4a in the new order, shift all event times by the
  new offsets, update the manifest, then merge. Unit tests with a fake model; no paid calls in tests.

## C. Lander (web/)
### C1. Chooser (/) : way less text, especially on phones
- Keep the UI, but it's literally just the two options: the cook, or the one being cooked for.
  Remove the lead paragraph, the who-lists, the "Not sure?" line, the hand note and the brand line.
  Mostly parents see this: the fewest words for the most meaning. Mobile even shorter.
### C2. Parent version (/teach)
1. No fancy card animations in the parent version: no cards shifting/fanning/stacking as you scroll.
   Normal food-site feel: text and images fade/slide in, buttons and hovers stay. The kid version
   (/learn) keeps its card animations.
2. Cut the "The call" section (clock "Sun, 7:30 pm", card stack, "Grandpa Rey / Grandma Rosa"
   chips, "Your kids miss your cooking, 900 miles away. You hit record. They learn it your way...")
   from the parent version.
3. By the second slide the parent knows exactly what the product does, in a **bold section header**
   (not a subhead): e.g. "Record yourself cooking. We turn it into a recipe your kids can follow,
   900 miles away." Do it in the How-it-works section ("From your kitchen to their phone to their
   stove" header gets replaced by this functional header; the 3 steps stay on the side, short),
   and move it to be the second screen.
4. Cut subheading text; the important stuff goes in the headings. Fewer animations.
5. Replace one existing header around the 3rd/4th section with "Your kids miss your cooking. Let's fix
   that." (no new section).
6. Remove the footer tagline "Culture we want to preserve, and pass down." (parent).
### C3. Kid version (/learn)
- Remove the footer tagline "Culture we want to preserve, and pass down." Nothing else changes.

## D. Ship
- Everything verified (screenshots, typecheck, lint, `npm run build && npm run perf` for web, API
  tests). Then commit on branch `lander` and push to GitHub. The lander + /r are deployed to
  homecookd.app after QA; the edge function is redeployed by the backend agent.

## E. Lander performance guardrails (from the speed-work session; reviewers enforce)
1. First-screen files (DeckFilm/*, HeroOverlay, Chip, Highlighter, LetterArc) must not import from
   'motion' directly. Use '@/lib/motion/lazy' (motionNow / loadMotion / inView), or Motion's ~44 KB
   goes back into the first-load JS.
2. Phones avoid live blur: no animated `filter: blur()`, and no `backdrop-filter` over the playing
   hero video (see the `max-width: 1023px` blocks).
3. Any new demo video goes through AppClip, so it is attached only near the viewport.
4. `cd web && npm run perf` must pass (budgets in scripts/perf-check.mjs).
5. Never pass the 'scale' shorthand to gsap.quickSetter or gsap.quickTo (use scaleX/scaleY). It becomes
   setAttribute('scaleX,scaleY'), which Safari rejects, and it took the whole page down on every iPhone.
   The WebKit step of `npm run perf` catches it.

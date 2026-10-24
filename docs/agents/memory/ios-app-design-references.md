---
name: ios-app-design-references
description: "Caleb's 8 iOS app references (Oct 15) and what he likes in each; priorities for the next Edible app UI: emotional intelligence, big clear structure, profiles first, kid vs parent sub-versions"
metadata:
  type: feedback
---

On 2026-10-15 Caleb asked for five iOS app concepts in Claude Design (mockups only, no build). Each concept has a parent sub-version and a kid sub-version. Copy each reference's STRUCTURE, never its colors; keep Edible's palette and fonts (Fraunces SOFT, DM Sans, Caveat; olive/chartreuse/sun/peach on cream).

**Priorities:**
1. Emotional intelligence: the app knows the user. For the kid, that's missing family connection ("Just in from Mom, hear her voice"). For the parent, that's missing the kid.
2. Intuition and clear structure over clutter: big fonts, big photos, headers that stand out.
3. Customers: older parents (50s–60s, not techy), so make it obvious; homesick college kids. Warm, home-based, a little nostalgic. The point is connecting families.

**The references:**
1. Subway store page: a clear bottom bar (Home / Pickup / Browse / Me), a hero photo filling half the screen, round buttons.
2. Cold-brew detail: the image fills most of the screen; a big segmented white box; the selected option gets a green outline and a check ("click → it lights up").
3. HelloFresh orders: a bottom bar in its own color with words under the icons; two big photos plus two big buttons, little text.
4. Luma events: a dish catalog on Home, and an emotionally smart "Picked for you" section.
5. Netflix profiles: the first screen picks the profile (one family account). The parent home says "what will you cook next / your past work"; the kid home says "recipes your parent cooked for you".
6. Google TV: the first recommendation takes about a third of the page, then rows below it.
7. DICE catalog: photo on the left, heart on the right, title, and an info line.
8. DICE home: rounded bubble panels per section ("Popular", "Just for Jane"), each with hearts.

**Why:** these come from his own notes on the screenshots; the five concepts are graded against them.

**How to apply:** use this list for any Edible app UI work. The five concepts (1 Hearth, 2 Sunday Supper, 3 Lamplight, 4 Recipe Box, 5 Big Table; 9 screens each) are on the Claude Design canvas "Edible iOS App Concepts" (https://claude.ai/artifact/8KhgmxrmfxShWb1WkikynN). Their kit is in `docs/app-concepts/`: DIRECTION.md (audience truths, copy bank, rubric), C{n}-SPEC.md (tokens and snippets), boards/ and sheets/. Build from the concept he picks.

**Oct 16: built.** The Expo app now follows Caleb's own "Edible · Hearth, Redesigned" canvas. It is copied into `docs/design/hearth-bible/`, and he calls it "the bible": match it almost 1 to 1. Motion follows `docs/design/ANIMATIONS.md`. The build contract is `docs/build/SPEC.md` and the backend contract is `docs/build/API.md`.
- **Backend:** the Supabase project `edible` (ref qeiednrjkiyzbolkepbk) runs one `api` edge function, with family-code auth, messages, voice notes, share links and sign-up.
- **Web:** the locked share page is `web/src/app/r` (homecookd.app/r?s=token).

**Oct 16 feedback, built and shipped:** the plan is in `docs/build/FEEDBACK-OCT16.md`.
- **Profiles on every open:** the app always opens on the profile picker.
- **Email circle:** one email connects you to your family circle. Email is not verified yet; there's a TODO for an email provider.
- **Kid tabs:** just Home and Ask. The pick on top follows the time of day and nearby holidays.
- **Questions:** they go to the family circle, and cooks' answers are saved into the recipe for everyone.
- **Pipeline:** reorders camera-roll clips into cooking order.
- **Lander:** the chooser is just the two options. The parent page has a clear "what it does" header and no card animations.
- **GitHub:** `main` and `lander` are pushed. GitHub says the repo moved to calebwang26/EDIBLE-venturehacks; pushes still redirect.

**Decisions (Oct 15):** Caleb likes concept 1 **Hearth** most. Design new features only for Hearth from now on and leave concepts 2–5 alone. He wants the app as simple as possible and asked to cut anything redundant. The Family tab was removed: it only re-opened the profile picker. Tab bars are now Leo: Home, Recipes, Ask; Mom: Home, My recipes, Record. Leo's Ask tab now has its own page (C1-Kid-Ask).

Related: [[lander-icp-problems]], [[lander-copy-feedback]], [[lander-design-references]]

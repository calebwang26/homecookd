# homecookd lander: copy for two audiences

## Oct 17, 2026: simpler heroes, clearer features (Caleb)

- **Heroes:** no sub and no beats on either version; the kid hero also drops "See it work" (headline, CTA, switch only).
- **Kid second section:** the brand line "Culture we want to preserve, and pass down." is cut. Its place goes to what the app does: "Too far to cook together? {R} films {herself} cooking, and you get {her} homemade recipe." ({R} = the picked relation, Mom by default).
- **The call is cut (kid):** the "You miss Mom's cooking, 900 miles away. She hits record. You learn it her way, every pinch, in ~~weeks~~ minutes." scene is gone, along with its call card and chips, and so is the `theCall` copy key. The pass-down fan closes back into its stack and drops straight into How it works.
- **Every family:** the italic word keeps cycling on both versions, alone on line 2. Kid: "A few minutes a day with *Mom*." (Mom, Dad, Grandma, Grandpa, Auntie, Uncle), body "They tell the story. You catch it after class." Parent: "Back in the kitchen with your *mom*." (mom, dad, son, daughter, grandma, grandpa).
- **Parent How it works:** the cook's name sits alone on line 1 and cross-fades Mom → Dad → Grandma → Grandpa: "Mom / films themselves cooking. We turn it into a recipe the whole family can follow, *900 miles away.*"
- **In their words** says the feature plainly: "Their words. *Translated.*" / "Your words. *Translated.*"
- **Measures** says the feature plainly: "homecookd turns their (your) "a handful" into a real measurement like ~½ cup, right beside their (your) own words." The scrolling phrases are lighter and smaller than the H2. The bouncing food drop plays on both versions.

## Oct 16, 2026: the 50/50 rule (supersedes the chooser and the per-version app rows below)

The "Which one are you?" chooser is gone. `/` opens the parent version, and a hero button switches to the kid version (`/learn`). Caleb's rule for the copy on both versions:

- **The emotional parts speak to one side**: the hero, the `recipeBox` H2 ("Your kids miss your cooking. Let's fix that."), `everyFamily`, `farApart`, `finalCta`, plus the kid's `passDown` and `theCall`.
- **Everything that explains the product is written for both sides.** A kid on the parent page, or a parent on the kid page, should still follow the whole journey from the cook's kitchen to the kid's stove.
- **"Here's the real app" (`seeItWork.rows`) is identical on both versions**: same titles, bodies, chips and tabs. It walks the whole pipeline in Caleb's order, one real recording per row:

| # | Step | Title | Body | Clip | Chip | Tab |
|---|---|---|---|---|---|---|
| 01 | The cook records, or picks a video from the camera roll | Film it. Pick the videos. | The cook films like always, then picks the videos from their phone. | app-add | Sunday dumplings · Grandma | Film it |
| 02 | We turn it into a recipe, with all the original words kept | Their recipe, their words. | We write it up. "Two heaping rice bowls" stays theirs, ~3 cups beside it. | app-recipe | warm like a baby's bath · ~1 cup | Recipe |
| 03 | It's sent to the people they love | Send it to your loved ones. | It lands at the family table. Tap Share to send it on. | app-keep (the Share tap and its payload bubble) | Our family table | Send it |
| 04 | It's passed down: anyone can cook it, hear it, and ask about it | Passed down. Cooked again. | Anyone in the family can cook it, hear their voice, and ask them about it. | app-watch (▶ on its chip) | Watch · Mix the dough | Cook it |

Notes: the rows are gender-neutral ("the cook", "their"; Caleb, Oct 17), because the cook may be a dad or a grandpa. The H2s stay per version ("Here's the real thing." under the kid's "The app" eyebrow; "Here's the real app." on the parent page, which has no eyebrow). Tabs stay short enough for one line in the 2×2 grid at 360 px. How it works is not shared word for word (Caleb, Oct 17): the kid version stays written for the kid ("From their kitchen / to your phone / to your stove."), and the parent version, as the home page's explainer, reads right for a cook and a kid alike: "{R} films {herself} cooking. We turn it into a recipe the whole family can follow, *900 miles away.*" ({R} follows the "Cooking as" role, Mom by default), with steps "Prop up a phone." / "Cook and talk, like always." / "We write the recipe. Everyone cooks it." It says "films", not "records", so it doesn't repeat the hero's "Record it once."

---

Oct 13, 2026. One codebase, two versions with the same sections, components and images. Only the words change.

**Status: applied** in `web/src/content/copy.ts` (kid), `copy.parent.ts` (parent) and `chooser.ts` (the `/` page), with these changes from the draft below:
- Chooser H1 stays "Are you the *cook,* or the one who *misses it?*" (the client's own framing: the cook vs. the one who gets the food). The kid card says "I miss the cooking." / "I want to learn to cook the food I grew up on." The cook card, chips, note ("every family needs both"), reassurance line, title and description follow section A.
- `PARENT_INVITE` / `parentInvite` are gone. Both versions end the final CTA with one quiet cross-link in their own reader's voice (`finalCta.otherSide`): "Curious what Mom will see? *Take a look.*" → `/teach?for=mom`, and "Curious what your kids will see? *Take a look.*" → `/learn?for=mom`. The footer also links across (`footer.switchLink`: "I'm the cook" / "I'm here to learn"). No nav link.
- Parent `farApart` pills: "Learning your way" / "So proud of them" (instead of naming audience segments).
- The `{kids}` rows (`seeItWork.rows[0|3].body`, `inTheirWords.body`) are filled where they render.

| Route | Who it is for | Copy |
|---|---|---|
| `/` | everyone: a chooser that asks which one you are | section A below |
| `/learn` | the kid: college students and young adults who miss home | `copy.ts`, with the changes in section B |
| `/teach` | the cook: parents and grandparents, about 50 to 70+ | `copy.parent.ts`, the full object in section C |

The brand line stays on both: **Culture we want to preserve, and pass down.**

**The one idea under both versions:** the cook already knows the dish by heart, and the kid wants to learn it. homecookd is how one teaches the other from two kitchens, so the family stays close. Kid site: "Cook it like Mom does." Parent site: "Show your kids how." Each is the other's mirror, told from its own side of the stove.

**Tokens**

| Token | `/learn` (kid) | `/teach` (parent) |
|---|---|---|
| `{R}` | who the kid cooks with, from "Cooking with: Mom" | the visitor's own role, from "Cooking as: Grandma" |
| `{R's}`, `{She}`, `{she}`, `{her}`, `{herself}` | follow `{R}` | not used |
| `{kids}` | not used | "kids", or "grandkids" for Grandma and Grandpa. Always one plural word |
| `{R}` inside `hero.sub` and `hero.beats` | the H1's word on screen (Mom, Dad, Grandma, Grandpa) | the H1's word on screen (kids, daughter, son, grandkids), never the role |

Notation: `*word*` is the heading's display italic (the `accent`), `==word==` sits on the yellow highlighter, `~~word~~` is struck through.

---

## A. Chooser page (`/`)

The whole page is one question and two big cards. A 70-year-old should know which card is theirs before reading the second line.

**H1:** Here to *teach*, or here to *learn?*

- Accent words: `teach,` and `learn?` (exact tokens, punctuation attached). Two accents is a deliberate exception to the one-accent rule: each accent takes the color of its card below (`teach,` in the cook card's forest, `learn?` in the kid card's sun), so the eye maps the question onto the answers. `splitText()` already falls back to marking each word when the accent words are not contiguous. If the one-accent rule must hold, accent `learn?` only.
- The two verbs are the two routes, `/teach` and `/learn`, which keeps every later link honest.
- Runner-up H1 (plainer, longer): "Are you the cook, or the one learning?"

**Sub:** homecookd passes family recipes from the one who cooks to the ones who want to learn. Pick the one that sounds like you.

**Cards** (cook first, then the kid; side by side on desktop, stacked on phones with the cook card on top)

| | Cook card → `/teach` | Kid card → `/learn` |
|---|---|---|
| Label (H2, what the visitor says) | I'm the cook. | I'm the one learning. |
| Sentence | I know our family's dishes by heart, and I'd love to pass them on. | I miss the food from home, and I want to make it the way they do. |
| Role chips | Mom · Dad · Grandma · Grandpa · Auntie · Uncle | Son · Daughter · Grandkid · Niece · Nephew |
| Button | That's me | That's me |
| Button `aria-label` | That's me, I'm the cook | That's me, I'm the one learning |
| Photo | `photo-abuela-tortillas.jpg` | `photo-young-adult-cooking-night.jpg` |
| Photo alt | A grandmother in a green dress pressing tortillas by hand. | A young man cooking alone at night in a small apartment kitchen. |

Why these choices:
- The same button text on both cards is on purpose. The card's big first-person label does the choosing ("I'm the cook."), and the button only confirms it, so there is nothing to decode and no wrong reading of either button. The aria-labels start with the visible text, so voice control still works.
- The kid card's chips are the kid's roles, never Mom or Grandma, so a grandmother can't see "Grandma" on the wrong card and tap it.
- Optional mechanic: each cook chip can be a link that lands with the role already picked (`/teach?for=grandma` opens on "Cooking as: Grandma" and "Show your grandkids how."). The kid chips stay plain text.
- Photos: the tortilla-pressing grandmother is the plainest picture of "the cook" in the library (hands in the dough, a lifetime of doing it), and the young man alone in a small kitchen at night is the plainest picture of "the one far from home". One woman, one man, two generations. Alternate for the cook card if she reads too old for a 50-year-old dad: `photo-grandpa-chopping.jpg` (then both cards show men, so check the balance). Avoid `photo-cook-recording-phone.jpg` here: she reads as a young food blogger, not a family cook.

**Reassurance line** (small, under the cards): Not sure? Either one is fine. You can switch anytime.

**Hand-written note** (Caveat, pointing between the two cards): every family needs both.

**Brand line** (optional sign-off at the bottom, same style as the footer): Culture we want to preserve, and *pass down.*

**Page title:** homecookd: family recipes, passed down

**Meta description:** homecookd turns a family cook's everyday videos into recipes the whole family can follow, in the cook's own words and voice. For the one who cooks, and the ones who want to learn.

**OG image alt:** Here to teach, or here to learn? homecookd.

**Cross-links between the versions** (new keys; suggested name `audienceSwitch` in each copy file, kept out of the shared `Copy` shape so neither version's tuples change)

| Where | On `/learn` (points to `/teach`) | On `/teach` (points to `/learn`) |
|---|---|---|
| Nav link (desktop link row) | I'm the cook | I'm here to learn |
| Footer line, lead + link | Are you the one who cooks? · Here's your page. | Here to learn a family recipe? · Here's your page. |

Only the link part ("Here's your page.") is the anchor. No arrows or dashes typed into the labels; the Button's own arrow prop can add one.

---

## B. Kid version (`/learn`): changes to make it 100% kid-facing

The kid site is strong, and the client liked it. Only the lines that talk to the cook, tell the cook what to do, or point the page at parents change. The hero sub stays exactly "Too far to cook together? {R} films themselves cooking, and you get their homemade recipe."

Kid problems, as numbered in the client notes: 1 missing the taste of home · 2 cooking alone for the first time, without spending on takeout · 3 a keepsake of their parents (voice, culture, stories) · 4 language and distance · 5 busy, and long phone lessons lose to a quick recipe online.

| Key path | Current | New | Why · problem |
|---|---|---|---|
| `howItWorks.steps[0].pill` | Lean it on the rice jar. | Propped on the rice jar. | The current line is an instruction to the cook. Now the kid is looking at their parent's setup. · 5 |
| `howItWorks.steps[1].moonChip` | Overnight rise? Film it in pieces. | Overnight rise? Two videos, one recipe. | Same: it told the cook what to do. Now it promises the kid one recipe however long the dish takes. Still splits after "?". · 5 |
| `everyFamily.cycle` | them · Mom · Grandpa · the kids · Nana · them | them · Mom · Grandpa · Nana · Dad · them | "A few minutes a day with the kids." is the parent's sentence. Dad keeps two women and two men. · 1 |
| `farApart.body` | One tap sends the recipe to whoever misses it most. Then a first-try photo comes back the other way. | Their recipe finds you, however far away. Send home your first try, and they'll tell you what to tweak. | The current body is told from the cook's side (the cook taps send). Now the kid gets the recipe, sends the photo, and gets coached back, which also explains the H2 "Send it home. Get one back." · 1, 2 |
| `farApart.left.pill` | For the one who's learning | You, learning their way | Speaks to the kid instead of naming an audience segment. · 1 |
| `farApart.right.pill` | For the one who cooks | Missing you, too | Same, and it says the quiet part: the kitchen back home misses them. · 1, 3 |
| `measures.body` | We never replace their words. We just add the ~. | We never replace their words. We just add a ~ for “about.” | The COPY-REQUEST already in `Measures.tsx`: nothing on the page says what ~ means. · 2 |
| `questions.faq[1].q` | Do we need any special gear? | Is there any special gear? | "we" read as the household. |
| `questions.faq[1].a` | Just a phone with a camera. Lean it anywhere it can see the stove and their hands. | Just {R's} phone, leaned anywhere it can see the stove and {her} hands. | No instruction to the cook; the person tokens already work in the FAQ (`fill()` applies them). · 5 |
| `questions.faq[3].a` | Record in pieces. Stop for the overnight soak, record again in the morning, and add every video to the same recipe. | {She} can film it in pieces, stop for the overnight soak and pick up again in the morning. Every video goes into the same recipe. | Same fix: describes what the cook can do. · 5 |
| `questions.faq[4].a` | It uses AI to watch and listen to the videos, then writes the steps. Amounts stay in the cook's own words with a ~ estimate beside them, and their stories come along too. | It uses AI to watch and listen to the videos, then writes the steps. Amounts stay in the cook's own words, with an estimate like ~1 cup beside them, and their stories come along too. | The second half of the same COPY-REQUEST. · 2, 3 |
| `questions.faq[5]` (q and a) | Can we send recipes to the rest of the family? / Yes. Send any recipe to a brother, a cousin or the family group chat, right from the recipe. | I've never really cooked. Can I do this? / Yes. Every step comes with a clip of {R} doing it and amounts you can measure, so your first try can be tonight. Cheaper than takeout, too. | Problem 2 had no home on the page. The sharing answer moves into faq[6], so the FAQ keeps 8 items (the `Copy` type fixes the length). · 2 |
| `questions.faq[6].a` | Your family. You choose who you send each recipe to. | Your family. Send any recipe to a brother, a cousin or the family group chat, and you choose who gets each one. | Absorbs the sharing answer. |
| `PARENT_INVITE` (`FinalCta/parentCopy.ts`) and `<ParentInvite />` | The one who cooks? Send this to your kids. They'll set up the phone. (share text: "...You prop up the phone, and homecookd keeps the recipe in my own words.") | **Remove it from `/learn`.** | It speaks to parents, and it breaks the path rule: the kid never sets up the phone or films the cook. A cook who lands on `/learn` has the "I'm the cook" cross-link in the nav and footer. On `/teach`, the same slot shows `parentInvite` from section C. |
| `finalCta` share link (`lib/share.ts` `inviteUrl`, not copy) | `/?for={r}` | `/teach?for={r}` | "Send this to {R}" should land Mom on her own page, already set to "Cooking as: Mom". The share text itself stays: the parent films their own cooking. |

If the design needs a line in the ParentInvite slot on `/learn` (for balance under the pills), use this kid-facing version with the same keys and the same `/teach?for={r}` link:

| Key | Text |
|---|---|
| `lead` | Not sure how to ask? |
| `button` | Send {R} the page for cooks |
| `after` | It explains everything. |
| `shareText` | {R}, I found this and thought of your cooking. It shows how you could teach me from your kitchen. Take a look? |
| `emailSubject` | I thought of your cooking |
| `copied` | Copied. Paste it to {R}. |

Kept on purpose (they read as parent-facing at a glance but serve the kid):
- `finalCta.pills[1]` "No measuring for the cook": tells the kid the ask is easy to say yes to.
- `theCall.chips.grandpa.words` "Is it recording?": a fond joke on the kid's side. The parent site swaps it.
- `howItWorks.steps[*].title` ("They prop up a phone." and the rest): third person, narrated to the kid.
- `seeItWork.rows[0].body` "...then pick their videos from the camera roll...": whoever adds the videos, the kid is the reader.

Where each kid problem lands after these changes: 1 the call ("You miss Mom's cooking, 900 miles away."), the far-apart pills, the footer "Hungry for home?" · 2 the new FAQ, the far-apart coaching line, "you've got this!", the "~ for about" line · 3 "Keep it, with them in it.", "The way they make it, forever.", her words lighting up in row 03 · 4 the Languages block, Grandma Rosa's chip, "900 miles away" · 5 "every pinch, ~~in weeks~~ minutes", "ready whenever you are", "Stuck on a step? Tap play".

---

## C. Parent version (`/teach`)

Written for a 62-year-old mom and a 74-year-old grandpa: the expert in the room. Short sentences, no tech words, and no jokes about phones. The emotional spine, top to bottom:

1. **Hero:** you miss cooking for them; you can still show them how ("Show your kids how.").
2. **The call:** they miss *your* cooking; the "I'll teach them someday" that never comes becomes "by Sunday".
3. **How it works and the app:** cook like always; your words stay yours; it is like you're right there.
4. **Recipe box and every family:** your way, kept forever, for your kids and theirs; back in the kitchen with them.
5. **Far apart:** you send it off, photos come back, and you still get the last word.
6. **Final CTA:** cooking has always been how you say I love you; now they get to keep it.

Where each parent problem lands: 1 tradition fading: pass-down sub, "forever.", "for your kids and theirs", "~~someday~~ by Sunday" · 2 culture and stories: the recipe-box noodle story, "In your words. In theirs.", "your stories come along too" · 3 missing the kids, no time to line up a call: hero sub, the call, "Back in the kitchen with them.", "They hear it whenever they can.", "A quieter kitchen." · 4 love that's hard to say: the final CTA body, "they'll be so glad you did." · mentorship: "Their turn to cook", "Like you're right there.", "you get the last word", "Teach them your way."

**Hero H1 pick:** "Show your *==kids==* how." with rotation kids → daughter → son → grandkids. Line 1 is "Show your", line 2 is at most "grandkids how." (14 characters; the kid site's "Grandma does." is 13). It puts the cook in charge, "show" is exactly what the video does, and the rotating word needs no verb, so nothing breaks between singular and plural. Once a role is picked, the word settles on `{kids}` ("Show your grandkids how.").

**Runner-up:** "Cook for your *==kids==* again." It hits harder on missing them, but line 2 "grandkids again." is 16 characters (over the cap), and it's a little untrue, since the kids do the cooking.

The object below matches `copy.ts` key for key, with the same tuple lengths, including the two keys the refactor added (`hero.explicitWord`, `theCall.callCard.nameExplicit`). Every fixed value (`id`, `clip`, `recipeId`, `arcRecipeId`, `relation`, `lang`, `href`) is unchanged. It type-checks against the refactor's `Copy` type. Validated: every accent word appears in its string, the struck word ends l3, `cycle[0]` is the H2's last word, and the call lines keep the same word count for "kids" and "grandkids".

```ts
// homecookd lander copy, parent version (/teach): the same keys as copy.ts, every word for the cook.
// Tokens: {R} = the visitor's own role from the "Cooking as" picker (Mom, Dad, Grandma, Grandpa,
// Auntie, Uncle). {kids} = "kids", or "grandkids" for Grandma and Grandpa (one plural word).
// hero.sub's {R} is the H1's rotating word (kids, daughter, son, grandkids), never the role.
// Rules: universal English, no "AI" outside questions.faq, no invented stats or reviews, no tech
// words the cook would not use ("upload", "sync", "AI-powered").
import type { Copy } from './copy';

export const copyParent: Copy = {
  nav: {
    logo: "homecookd",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "The app", href: "#see-it-work" },
      { label: "Languages", href: "#in-their-words" },
      { label: "Questions", href: "#questions" },
    ],
    pickerLabel: "Cooking as:",
    pickerLabelMobile: "as {R}",
    pickerA11yLabel: "Cooking as",
    relations: {
      mom: "Mom",
      dad: "Dad",
      grandma: "Grandma",
      grandpa: "Grandpa",
      auntie: "Auntie",
      uncle: "Uncle",
    },
    cta: "Get early access",
    ctaMobile: "Early access",
    skipLink: "Skip to how it works",
  },

  hero: {
    // "Show your / kids how." Line 2 is at most "grandkids how." (14 characters).
    h1Before: "Show your",
    h1After: "how.",
    relationDefault: "kids",
    rotation: ["kids", "daughter", "son", "grandkids"],
    // once a role is picked the H1 settles on who they cook for: "Show your grandkids how."
    explicitWord: "{kids}",
    // {R} here = the H1's word on screen; "your ___ can" reads right for kids, daughter, son, grandkids.
    sub: "Miss cooking for them? Prop up a phone, cook like always, and your {R} can make it just like you do.",
    // no {R} in the beats: "They" covers one child or many
    beats: ["You hit record", "They get the recipe", "Their turn to cook"],
    cta: "Get early access",
    link: "See it work",
    pauseVideo: "Pause video",
    playVideo: "Play video",
    videoAlt: "A mother laughing with her adult son and daughter as they make a salad together in the kitchen.",
    frontCard: {
      recipeId: "mom-salad",
      recPill: "● Recording · 0:42",
      watchPill: "▶ Watch",
    },
  },

  passDown: {
    h2: "Culture we want to preserve, and pass down.",
    accent: ["pass", "down."],
    sub: "Every family has a dish only one person knows by heart. Pass it on, with you in it.",
    chips: ["Grandma", "Dad"],
    cta: "Get early access",
    link: "How it works",
    deckListLabel: "A few family recipes, shown as examples:",
  },

  theCall: {
    // the weekly call home (the kid site's is a late-night call from a dorm)
    clock: "Sun, 7:30 pm",
    // {kids} is one word, so the word fill keeps its spans for every role. The struck "someday."
    // (the "I'll teach them someday" that never comes) is answered by the hand note "by Sunday."
    l1: "Your {kids} miss your cooking, 900 miles away.",
    l1Accent: ["900", "miles", "away."],
    l2: "You hit record.",
    l2Highlight: "hit record.",
    l3: "They learn it your way, every pinch, someday.",
    l3Strike: "someday.",
    note: "by Sunday.",
    ariaLabel: "Your {kids} miss your cooking, 900 miles away. You hit record. They learn it your way, every pinch, by Sunday.",
    callCard: {
      // the kid on the other end of the call; the parent's own role would be wrong here, so the
      // picked role never replaces it
      nameDefault: "Sam",
      nameExplicit: "Sam",
      time: "0:42",
      status: "Connected",
    },
    chips: {
      // Grandpa Rey teaching to the camera (the kid site's "Is it recording?" is a joke at the
      // cook's expense, which this audience reads as being about them)
      grandpa: { who: "Grandpa Rey", words: "Watch my hands." },
      grandma: { who: "Grandma Rosa", original: "a fuego lento", lang: "es", english: "on a low flame" },
    },
  },

  howItWorks: {
    eyebrow: "How it works",
    clock: "Tue, 9:30 am",
    h2Lines: ["From your kitchen", "to their phone", "to their stove."],
    body: "Cook on your own time and talk them through it, like always. homecookd writes the recipe from your videos, and it's ready whenever they are.",
    pill: "See the real app",
    steps: [
      {
        numeral: "1",
        title: "Prop up your phone.",
        pill: "Lean it on the rice jar.",
        imageAlt: "A phone on a small tripod on a kitchen counter, ready to record.",
      },
      {
        numeral: "2",
        title: "Cook and talk, like always.",
        recPill: "● REC 0:42",
        moonChip: "Overnight rise? Film it in pieces.",
        imageAlt: "Hands kneading golden dough on a floured counter.",
      },
      {
        numeral: "3",
        title: "Add your videos. Sent.",
        sticker: ["Love,", "Grandma"],
        imageAlt: "The Add a recipe screen in homecookd, with Sunday dumplings typed in and Grandma picked as the cook.",
      },
    ],
  },

  recipeBox: {
    eyebrow: "Your family table",
    clock: "Sun, 6:30 pm · everyone's home",
    h2: "The way you make it, forever.",
    accent: ["forever."],
    body: "Grandma won't cut a noodle, because a long noodle means a long life. Your recipes keep stories like that, too.",
    note: "three cooks so far. yours next?",
    folderTitle: "Our family table",
    folderAccent: "family",
    tablistLabel: "Show recipes from",
    tabs: ["Everyone", "Auntie Lin", "Dad", "Grandma"],
    addTab: "+ Add a recipe",
  },

  seeItWork: {
    eyebrow: "The app",
    h2: "Here's the real thing.",
    accent: ["real"],
    note: "screen recordings, straight from the app",
    rows: [
      {
        number: "01",
        clip: "app-add",
        title: "Name it. Pick the videos.",
        // {kids} needs fill() here (RowText renders row.body as is today)
        body: "Name the dish, then pick your videos from your photos. Or let your {kids} do this part.",
        chip: "Sunday dumplings · Grandma",
        tab: "Add videos",
      },
      {
        number: "02",
        clip: "app-recipe",
        title: "Your words, kept.",
        body: "“Two heaping rice bowls, maybe a little more” stays in your words. ~3 cups sits beside it.",
        chip: "warm like a baby's bath · ~1 cup",
        tab: "Your words",
      },
      {
        number: "03",
        clip: "app-watch",
        title: "Like you're right there.",
        body: "When they're stuck on a step, they tap play and see just that moment, with your words lighting up as you say them.",
        chip: "Watch · Mix the dough",
        tab: "Watch a step",
      },
      {
        number: "04",
        clip: "app-keep",
        title: "Keep it. Pass it down.",
        // {kids} needs fill() here too: "for your grandkids and theirs"
        body: "Every recipe lives at one family table, for your {kids} and theirs. Sending one takes a single tap.",
        chip: "Our family table",
        tab: "Pass it on",
      },
    ],
    sharePayload: "Grandma's Red-Braised Pork Belly by Grandma — from our family table",
    shareLabel: "What Share sends",
    shareSr: "Tapping Share sends this text: “{payload}”",
    tablistLabel: "What the app does",
    pauseTabs: "Pause the app tour",
    playTabs: "Play the app tour",
    playClip: "Play recording",
  },

  everyFamily: {
    // cooking side by side again, from two kitchens
    h2: "Back in the kitchen with them.",
    accent: ["them."],
    cycle: ["them", "the kids", "your son", "the grandkids", "your daughter", "them"],
    ariaLabel: "Back in the kitchen with them.",
    body: "You tell the story at the stove. They hear it whenever they can. That's how a family's cooking gets passed down.",
    listLabel: "Family recipes in this section, shown as examples:",
    pause: "Pause moving recipes",
    play: "Play moving recipes",
  },

  inTheirWords: {
    eyebrow: "Languages",
    h2: "In your words. In theirs.",
    accent: ["In", "theirs."],
    // {kids} needs fill() here (InTheirWords renders T.body as is today)
    body: "Explain it in the language you cook in. Soon your {kids} can follow in English, with your words right above.",
    starAlt: "A grandmother and her granddaughter smile as they fold dumplings together over a steamer basket.",
    sticker: ["Coming to", "the app"],
    radioLabel: "Pick a language",
    saidLabel: "{cook} said",
    youRead: "They read",
    rule: "Your words always stay on top.",
    note: "Today the app works in English. Other languages are coming during early access.",
    pause: "Pause languages",
    play: "Play languages",
    // structural: the same six lines as the kid site (TODO(native-check) still applies)
    lines: [
      {
        id: "zh",
        chip: "中文 Chinese",
        lang: "zh-Hans",
        cook: "Grandma",
        relation: "grandma",
        recipeId: "grandma-pork-belly",
        dish: "Red-Braised Pork Belly",
        original: "糖炒到像茶或蜂蜜的颜色，不要太深。",
        english: "Cook the sugar to the color of tea or honey, never dark.",
      },
      {
        id: "es",
        chip: "Español Spanish",
        lang: "es",
        cook: "Grandpa Luis",
        relation: "grandpa",
        recipeId: "abuelo-empanadas",
        dish: "Empanadas",
        original: "Doce pellizquitos alrededor del borde.",
        english: "Twelve little pinches around the edge.",
      },
      {
        id: "tl",
        chip: "Tagalog",
        lang: "tl",
        cook: "Grandpa Rey",
        relation: "grandpa",
        recipeId: "grandpa-rey-adobo",
        dish: "Pork Adobo",
        original: "Hanggang lumambot, mga isang oras.",
        english: "Until it's tender, about an hour.",
      },
      {
        id: "hi",
        chip: "हिन्दी Hindi",
        lang: "hi",
        cook: "Grandma Asha",
        relation: "grandma",
        recipeId: "nani-biryani",
        dish: "Chicken Biryani",
        original: "इतना भूनो कि घी अलग हो जाए।",
        english: "Fry it until the ghee separates.",
      },
      {
        id: "ko",
        chip: "한국어 Korean",
        lang: "ko",
        cook: "Dad",
        relation: "dad",
        recipeId: "appa-kimchi-jjigae",
        dish: "Kimchi Jjigae",
        original: "손맛이야.",
        english: "It's all in the hands.",
      },
      {
        id: "it",
        chip: "Italiano Italian",
        lang: "it",
        cook: "Grandma Lucia",
        relation: "grandma",
        recipeId: "nonna-lasagna",
        dish: "Lasagna",
        original: "Il ragù non ha fretta.",
        english: "Ragù is never in a hurry.",
      },
    ],
  },

  farApart: {
    h2: "Send it off. Get photos back.",
    accent: ["Get", "photos", "back."],
    // the cook's answer on the card ("Next time, ten more minutes ♥") is the last word
    body: "One tap sends your recipe to whoever misses it most. Then a first-try photo comes back, and you get the last word.",
    left: {
      title: "Far from home.",
      clock: "Tue, 11:04 pm",
      pill: "For the one who's learning",
      imageAlt: "A young man cooking alone at night in a small apartment kitchen.",
    },
    right: {
      title: "A quieter kitchen.",
      pill: "For the one who teaches",
      imageAlt: "A woman in her sixties covers her mouth in delight as she looks at her phone in the kitchen.",
    },
    arcRecipeId: "grandma-pork-belly",
    arcCaption: "from {cook}",
    delivered: "Delivered ✓",
    reply: { text: "First try!! The whole hallway came by.", time: "11:52 pm" },
    answer: {
      "grandma-pork-belly": "Next time, ten more minutes ♥",
      "dad-chili": "Next time, one more shake ♥",
      "grandma-noodle-soup": "Next time, pull them thinner ♥",
    },
    deliveredTo: "Delivered · {R} ♥",
    srStory: "In the illustration, {title} travels from {cook}'s kitchen to the one far from home. A first-try photo comes back: “{reply}” {cook} answers: “{answer}.”",
  },

  measures: {
    marqueeLabel: "Things families say instead of measurements",
    marquee: [
      { text: "a handful, only the green part", caption: "~3 scallions" },
      { text: "warm like a baby's bath", caption: "~1 cup water" },
      { text: "three coins, this thick", caption: "~3 thin slices ginger" },
      { text: "un puñito", lang: "es", caption: "a little handful" },
      { text: "the color of tea or honey", caption: "the sugar's ready" },
      { text: "you'll know", caption: "we'll ask for you" },
      { text: "适量", lang: "zh-Hans", caption: "as much as feels right" },
      { text: "quanto basta", lang: "it", caption: "as much as it needs" },
    ],
    h2: "Your handful. Their ~½ cup.",
    accent: ["~½", "cup."],
    body: "Never measure a thing. We keep your words and add a ~ for “about.”",
    mascotChip: "you know this one!",
    pause: "Pause moving words",
    play: "Play moving words",
  },

  questions: {
    h2: "Good questions.",
    accent: ["questions."],
    note: "clearer than “a pinch,” promise",
    phoneCaption: "homecookd asks you a few, too.",
    faq: [
      {
        q: "Do I need to download anything?",
        a: "Only if you want to add the videos yourself. Otherwise, just prop up your phone, cook and talk like always, and send the videos to your {kids} to add.",
      },
      {
        q: "I never measure. Is that okay?",
        a: "That's the whole idea. Say “a handful” like you always do. homecookd keeps your words and puts a ~ estimate beside them.",
      },
      {
        q: "Do I need anything special?",
        a: "Just your phone. Lean it anywhere it can see the stove and your hands.",
      },
      {
        q: "Do I have to speak English?",
        a: "For now, homecookd works in English. Other languages are coming during early access, and your own words will always stay on top.",
      },
      {
        q: "What if the dish takes all day?",
        a: "Record in pieces. Stop for the overnight soak, record again in the morning, and every video goes into the same recipe.",
      },
      {
        q: "How does homecookd write the recipe?",
        a: "It uses AI to watch and listen to your videos, then writes out the steps. Amounts stay in your own words, with an estimate like ~1 cup beside them, and your stories come along too.",
      },
      {
        q: "Who can see my recipes?",
        a: "Only your family. Send each one to your {kids}, a cousin or the family group chat. You choose.",
      },
      {
        q: "How much does it cost?",
        a: "It's free during early access.",
      },
    ],
  },

  finalCta: {
    clock: "This Sunday, 10:00 am?",
    // CtaHeading breaks before the accent phrase: "Teach them / your way."
    h2Default: "Teach them your way.",
    h2Explicit: "Teach the {kids} your way.",
    accent: ["your", "way."],
    body: "Cooking is how you've always said I love you. Now they get to keep it.",
    emailLabel: "Your email",
    emailPlaceholder: "you@example.com",
    submit: "Get early access",
    submitting: "Saving your spot…",
    error: "That email looks a little off. Mind checking it?",
    networkError: "That didn't go through. Mind trying again?",
    success: "You're on the list. Now pick your first dish.",
    shareButton: "Send this to your {kids}",
    shareTitle: "homecookd",
    // sent from the cook to the kids, with a link to /learn?for={r} ("Cook it like Grandma does.")
    shareText: "I'd love to teach you my cooking. I'll film myself making your favorite this Sunday, and homecookd turns it into a recipe you can follow, in my own words.",
    copied: "Copied. Paste it to your {kids}.",
    smsLabel: "Text it",
    emailLinkLabel: "Email it",
    emailSubject: "I'd love to teach you my recipes",
    pills: ["Any phone", "No measuring needed", "Free in early access"],
    sticker: ["Free", "Early access"],
    note: "they'll be so glad you did.",
    // the abuela star answering the H2: she already knows which dish comes first
    reply: "I know just where to start.",
    starLeftAlt: "A grandpa and his teenage grandson talking over a pancake breakfast.",
    starRightAlt: "A grandmother in a green dress pressing tortillas by hand.",
  },

  footer: {
    prompt: "Know a dish by heart? Get early access and start with that one.", // keeps "Get early access" on one line
    button: { before: "Get", after: "early access" },
    buttonA11yLabel: "Get early access",
    linksPrimary: [
      { label: "How it works", href: "#how-it-works" },
      { label: "The app", href: "#see-it-work" },
      { label: "Languages", href: "#in-their-words" },
      { label: "Questions", href: "#questions" },
    ],
    linksSecondary: [
      { label: "Back to top", href: "#top" },
      { label: "Contact", href: "mailto:" },
    ],
    wordmark: "homecookd",
    credits: "Photo credits",
    creditsIntro: "Photos and video from Pexels.",
    creditsThanks: "Thank you to:",
    disclaimer: "App clips are real screen recordings of homecookd, shown with demo recipes and stock cooking video. Other families on this page are illustrations.",
    copyright: "© 2026 homecookd",
  },

  meta: {
    siteName: "homecookd",
    title: "homecookd: show your kids how",
    description: "Prop up a phone and cook like always. homecookd turns your videos into a recipe your kids can follow, in your own words and voice. Free in early access.",
    ogAlt: "Show your kids how. homecookd.",
  },

  // structural: the same aria-labels as the kid site (they describe the real recordings)
  appClips: {
    "app-record": "Screen recording of homecookd: five prompts to read before cooking, then a new recipe called Sunday dumplings with Grandma as the cook.",
    "app-recipe": "Screen recording of homecookd: Grandma's Hand-Pulled Noodle Soup, with ingredients in her words and estimates beside them. Flour and salt get checked off.",
    "app-cook": "Screen recording of homecookd: cook mode for Dad's Sunday Chili, with a highlighted cue, his story and the Hear Dad button.",
    "app-share": "Screen recording of homecookd: Grandma's Red-Braised Pork Belly, then a tap on Share.",
    "app-library": "Screen recording of homecookd: the family table, filtered to Dad, then Grandma, then everyone.",
    "app-questions": "Screen recording of homecookd: three follow-up questions to ask Dad about his chili.",
    "app-add": "Screen recording of homecookd: adding a recipe called Sunday dumplings, picking Grandma as the cook, then choosing two videos from the phone.",
    "app-watch": "Screen recording of homecookd: step 1 of Grandma's noodle soup in cook mode. Tapping the photo plays that step's video, with her words below as a transcript. The video is a stock clip standing in for a family recording.",
    "app-keep": "Screen recording of homecookd: the family table filtered to Grandma, then her Red-Braised Pork Belly, then a tap on Share.",
  },
};

// The parent site's counterpart of PARENT_INVITE (the line under the reassurance pills). The kids
// already have their button above it, so this one lets the cook pass homecookd to another cook: a
// sister, a friend, their own mother. Same mechanics: navigator.share, else copy + Text it / Email it.
// The link is the plain /teach page (no ?for=, the other cook's role is unknown).
export const parentInvite = {
  lead: "Know another cook like you?",
  button: "Send this to them",
  after: "Every family has one.",
  shareText:
    "This made me think of you and your cooking. You prop up your phone, cook like always, and homecookd turns it into a recipe your family can follow, in your own words.",
  emailSubject: "This made me think of your cooking",
  copied: "Copied. Paste it to them.",
} as const;
```

**Wiring notes for the parent object** (copy that only reads right if the component does one small thing):

- `{kids}` sits in three strings that render without `fill()` today: `seeItWork.rows[0].body`, `seeItWork.rows[3].body` and `inTheirWords.body`. Run them through `useFill()` on `/teach`. Token-free fallbacks if that's not possible: "...Or let the family do this part.", "...for your family and theirs.", "...Soon they can follow in English...".
- `theCall.callCard`: the card is the kid on the other end of the call, so it says "Sam" both before and after a role is picked. Showing the parent's own role ("Grandma") there would put the reader on both ends of the call.
- `hero`: the sub's pill is sized by the widest word the H1 can show ("grandkids"), which the refactor already does from `rotation` plus `explicitWord`.
- Share links: on `/teach`, "Send this to your {kids}" should link to `/learn?for={r}`, so Grandma's message opens on "Cook it like Grandma does." `parentInvite` links to plain `/teach` (we don't know the other cook's role).
- `finalCta`: the accent is the two words that end the H2 ("your way."), so the refactored `CtaHeading` breaks it as "Teach them / your way." and "Teach the grandkids / your way."

---

## D. Open questions and risks

1. **Auntie and Uncle get "kids".** "Show your kids how" and "Your kids miss your cooking" read as their own children, not nieces and nephews ("nieces and nephews" is three words and would break the word fill). Most aunties say "the kids" for all of them, so I kept it; the alternative is mapping Auntie and Uncle to "family", which breaks "miss" vs "misses".
2. **"~~someday.~~ by Sunday."** The hand note is two words where the kid site's "minutes." is one. It answers the most honest parent line on the page ("I'll teach them someday"), but check that the note fits above the struck word on a phone. If it doesn't, the note can be "Sunday." on its own; the aria-label keeps "by Sunday."
3. **"Get early access" for 70+ readers.** It's understood, but slightly techy. "Save my spot" is warmer. I kept "Get early access" on both sites because the form, the seal, the pills and the FAQ all name the program "early access", and changing one means changing all of them. Worth a quick read with a real 70-year-old.
4. **Step 3 "Add your videos. Sent."** assumes the cook adds the videos in the app. Row 01 ("Or let your kids do this part.") and FAQ 1 cover the cook who would rather text the videos to the kids. If the client wants that path first, use "Send your videos. Done." (the image still shows the app's Add screen).
5. **"Cheaper than takeout, too."** (new kid FAQ) is a general truth, not a number, but it is a claim. Cut it if the client wants zero claims; the answer still works.
6. **The chooser has two accents** where the site uses one per heading. That's deliberate (each matches its card), but it is a new pattern.
7. **Call card name "Sam"** is an invented first name for the kid on the call. It's neutral on gender and culture. If the client would rather not name anyone, "My kids" works, but its avatar initial becomes "M", which reads as Mom.
8. **`sharePayload` keeps its em dash** on both sites. It's the real text the app hands to the share sheet (captured from the recordings), so it can't be reworded on the lander; change it in the app if the no-dash rule should apply there too.
9. **Native-speaker checks** still apply to the shared language lines (`inTheirWords.lines`, the marquee, Grandma Rosa's chip). The parent site makes no new non-English claims.
10. **Shared links skip the chooser.** A kid's "Send this to Mom" lands on `/teach?for=mom`, and a cook's "Send this to your kids" lands on `/learn?for=mom`. The same slug works in both directions (who the kid cooks with = the cook's own role), so no new values are needed.

// homecookd lander copy, kid version (/learn): every word for the one who misses the cooking.
// The parent version (/teach) is copy.parent.ts, with the same keys (type Copy below); components
// read the page's version through useCopy() (components/providers/CopyProvider). Started from the
// ★ picks in docs/lander-copy-v2.md; the two-audience pass is docs/lander-copy-audiences.md.
// Keys follow the section ids in docs/lander-build-brief.md (camelCase).
// Tokens: {R} = relation label ("Grandma"), {r} = relation slug ("grandma"), the person tokens
// ({R's}, {She}, {her}, … and {kids} for the parent version), {cook} = a recipe's cook name. Run
// tokenized strings through fill() in src/lib/relation.ts.
// `accent` arrays list the exact words that render in <em> (one accent phrase per heading).
// Rules: universal English, no "AI" outside questions.faq, no invented stats or reviews.

export const copy = {
  nav: {
    logo: "homecookd",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "The app", href: "#see-it-work" },
      { label: "Languages", href: "#in-their-words" },
      { label: "Questions", href: "#questions" },
    ],
    pickerLabel: "Cooking with:",
    pickerLabelMobile: "with {R}",
    pickerA11yLabel: "Cooking with",
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
    h1Before: "Cook it like",
    h1After: "does.",
    relationDefault: "Mom",
    rotation: ["Mom", "Dad", "Grandma", "Grandpa"],
    // the word once a relation is picked ("Cooking with", ?for=, storage)
    explicitWord: "{R}",
    // The sub and beat 1 follow the H1's relation word as it rotates (Mom → Dad → Grandma → Grandpa)
    // and then the picked relation ("Cooking with", ?for=, storage). Only the name ({R}) changes; it
    // sits in a fixed-width slot so the paragraph keeps one shape (HeroOverlay SubText).
    // not shown: the hero has no sub (Caleb, Oct 17); "what it does" is the pass-down heading now
    sub: "",
    beats: ["{R} hits record", "You get the recipe", "Your turn to cook"],
    // a fixed headline instead of the rotating one (parent only; "" = rotate). Lines split on \n,
    // h1Accent (one whole line) sits on the highlighter.
    h1Fixed: "",
    h1Accent: "",
    cta: "Get early access",
    // the hero's second button: the other version of the page (switchHref)
    switchLabel: "Are you the cook?",
    // read after the label by screen readers, so the question says where it goes
    switchSr: "(opens the page for the cook)",
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
    // what the app does, moved here from the hero sub (Caleb, Oct 17); the brand line is cut.
    // {R} etc. = the picked relation (Mom by default), filled where it renders.
    h2: "Too far to cook together? {R} films {herself} cooking, and you get {her} homemade recipe.",
    accent: ["homemade", "recipe."],
    sub: "Every family has a dish only one person really knows. Keep it, with them in it.",
    chips: ["Grandma", "Dad"],
    cta: "Get early access",
    link: "How it works",
    deckListLabel: "A few family recipes, shown as examples:",
  },

  howItWorks: {
    eyebrow: "How it works",
    clock: "Tue, 9:30 am",
    h2Lines: ["From their kitchen", "to your phone", "to your stove."],
    // the parent How it works' {herself} while its cook rotates (StepsPlain); not used on /learn
    themselves: "themselves",
    body: "They cook on their own time and talk you through it. homecookd writes the recipe from the videos, and it's ready whenever you are.",
    pill: "See the real app",
    steps: [
      {
        numeral: "1",
        title: "They prop up a phone.",
        pill: "Propped on the rice jar.",
        imageAlt: "A phone on a small tripod on a kitchen counter, ready to record.",
      },
      {
        numeral: "2",
        title: "They show you how.",
        recPill: "● REC 0:42",
        moonChip: "Overnight rise? Two videos, one recipe.",
        imageAlt: "Hands kneading golden dough on a floured counter.",
      },
      {
        numeral: "3",
        title: "They add the videos. Sent.",
        sticker: ["Love,", "Grandma"],
        imageAlt: "The Add a recipe screen in homecookd, with Sunday dumplings typed in and Grandma picked as the cook.",
      },
    ],
  },

  recipeBox: {
    eyebrow: "Your family table",
    clock: "Sun, 6:30 pm · everyone's home",
    h2: "The way they make it, forever.",
    accent: ["forever."],
    body: "Grandma won't cut a noodle, because a long noodle means a long life. Every recipe holds on to little ways like that.",
    note: "three cooks so far. who's next?",
    // the folder header: the app's own family table title, "family" in the accent
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
    // The whole pipeline, word for word the same on /teach (the 50/50 rule): Grandma records, we
    // write it in her words, it's sent, it's passed down. Each row names what its clip shows.
    rows: [
      {
        number: "01",
        clip: "app-add",
        title: "Film it. Pick the videos.",
        body: "The cook films like always, then picks the videos from their phone.",
        chip: "Sunday dumplings · Grandma",
        tab: "Film it",
      },
      {
        number: "02",
        clip: "app-recipe",
        title: "Their recipe, their words.",
        body: "We write it up. “Two heaping rice bowls” stays theirs, ~3 cups beside it.",
        chip: "warm like a baby's bath · ~1 cup",
        tab: "Recipe",
      },
      {
        number: "03",
        clip: "app-keep",
        title: "Send it to your loved ones.",
        body: "It lands at the family table. Tap Share to send it on.",
        chip: "Our family table",
        tab: "Send it",
      },
      {
        number: "04",
        clip: "app-watch",
        title: "Passed down. Cooked again.",
        body: "Anyone in the family can cook it, hear their voice, and ask them about it.",
        chip: "Watch · Mix the dough",
        tab: "Cook it",
      },
    ],
    // The real text the app hands to the share sheet (captured in app-recordings.md).
    sharePayload: "Grandma's Red-Braised Pork Belly by Grandma — from our family table",
    shareLabel: "What Share sends",
    shareSr: "Tapping Share sends this text: “{payload}”",
    tablistLabel: "What the app does",
    pauseTabs: "Pause the app tour",
    playTabs: "Play the app tour",
    playClip: "Play recording",
  },

  everyFamily: {
    h2: "A few minutes a day with Mom.",
    accent: ["Mom."],
    // the word keeps cycling (CycleHeading); it starts on Mom (Caleb, Oct 17)
    cycle: ["Mom", "Dad", "Grandma", "Grandpa", "Auntie", "Uncle"],
    // the word once a cook is picked (the cycle stops there): "Dad."
    explicitWord: "{R}",
    ariaLabel: "A few minutes a day with your family.",
    body: "They tell the story. You catch it after class.",
    listLabel: "Family recipes in this section, shown as examples:",
    pause: "Pause moving recipes",
    play: "Play moving recipes",
  },

  inTheirWords: {
    eyebrow: "Languages",
    // say plainly what the feature does: their words, translated automatically (Caleb, Oct 17)
    h2: "Their words. Translated.",
    accent: ["Translated."],
    body: "They explain it best in Chinese, and you catch about half. Soon you'll follow in English, with their words right above.",
    starAlt: "A grandmother and her granddaughter smile as they fold dumplings together over a steamer basket.",
    sticker: ["Coming to", "the app"],
    radioLabel: "Pick a language",
    saidLabel: "{cook} said",
    youRead: "You read",
    rule: "Their words always stay on top.",
    note: "Today the app is English only. Translation rolls out during early access.",
    pause: "Pause languages",
    play: "Play languages",
    // TODO(native-check): every `original` line needs a native speaker before launch.
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
    h2: "Send it home. Get one back.",
    accent: ["Get", "one", "back."],
    body: "Their recipe finds you, however far away. Send home your first try, and they'll tell you what to tweak.",
    left: {
      title: "Far from home.",
      clock: "Tue, 11:04 pm",
      pill: "You, learning their way",
      imageAlt: "A young man cooking alone at night in a small apartment kitchen.",
    },
    right: {
      title: "A quieter kitchen.",
      pill: "Missing you, too",
      imageAlt: "A woman in her sixties covers her mouth in delight as she looks at her phone in the kitchen.",
    },
    arcRecipeId: "grandma-pork-belly",
    arcCaption: "from {cook}",
    delivered: "Delivered ✓",
    reply: { text: "First try!! The whole hallway came by.", time: "11:52 pm" },
    // The cook's answer, keyed by the arc card's recipe (brief 8.9 picks the recipe from the photo).
    answer: {
      "grandma-pork-belly": "Next time, ten more minutes ♥",
      "dad-chili": "Next time, one more shake ♥",
      "grandma-noodle-soup": "Next time, pull them thinner ♥",
    },
    deliveredTo: "Delivered · {R} ♥",
    // screen-reader version of the story the decorative layer tells
    srStory: "In the illustration, {title} travels from {cook}'s kitchen to the one far from home. A first-try photo comes back: “{reply}” {cook} answers: “{answer}.”",
  },

  measures: {
    marqueeLabel: "Things families say instead of measurements",
    // TODO(native-check): the es, zh and it phrases.
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
    h2: "Their handful. Your ~½ cup.",
    accent: ["~½", "cup."],
    // say the feature plainly (Caleb, Oct 17): their rough amounts become real measurements
    body: "homecookd turns their “a handful” into a real measurement like ~½ cup, right beside their own words.",
    mascotChip: "you've got this!",
    pause: "Pause moving words",
    play: "Play moving words",
  },

  questions: {
    h2: "Good questions.",
    accent: ["questions."],
    note: "better answers than “you'll know,” promise",
    phoneCaption: "homecookd asks a few too.",
    faq: [
      {
        q: "Does {R} need to download anything?",
        a: "Only if they want to add the videos themselves. Otherwise {R} just props up a phone, cooks and talks like always, and sends you the videos to add.",
      },
      {
        q: "Is there any special gear?",
        a: "Just {R's} phone, leaned anywhere it can see the stove and {her} hands.",
      },
      {
        q: "Do they have to speak English?",
        a: "For now, homecookd works in English. Translation rolls out during early access, with more languages over time, and their own words will always stay on top.",
      },
      {
        q: "What if the dish takes all day?",
        a: "{She} can film it in pieces, stop for the overnight soak and pick up again in the morning. Every video goes into the same recipe.",
      },
      {
        q: "How does homecookd write the recipe?",
        a: "Gemini, an AI from Google, watches and listens to the videos, then writes the steps. Amounts stay in the cook's own words, with an estimate like ~1 cup beside them, and their stories come along too.",
      },
      {
        q: "I've never really cooked. Can I do this?",
        a: "Yes. Every step comes with a clip of {R} doing it and amounts you can measure, so your first try can be tonight. Cheaper than takeout, too.",
      },
      {
        q: "Who can see our recipes?",
        // true today (QA B19): recipe media sits at open links in a public bucket, and its library.json
        // lists every recipe; see /privacy
        a: "Your family sees them in the app, and you choose who else gets each one. But they aren't locked: the videos and recipes sit at open web links, and anyone who has a link can open them.",
      },
      {
        q: "How much does it cost?",
        a: "It's free during early access. If that ever changes, we'll tell you first.",
      },
    ],
  },

  finalCta: {
    clock: "This Sunday, 10:00 am?",
    h2Default: "Ask them to teach you.",
    h2Explicit: "Ask {R} to teach you.",
    accent: ["teach", "you."],
    body: "Teaching is how they say I love you. Asking is how you say it back.",
    emailLabel: "Your email",
    emailPlaceholder: "you@example.com",
    submit: "Get early access",
    submitting: "Saving your spot…",
    // parent version only ("" = not shown): what happens next, and the cook's no-download way in
    afterNote: "",
    orJustCook: "",
    error: "That email looks a little off. Mind checking it?",
    networkError: "That didn't go through. Mind trying again?",
    success: "You're on the list. Now go call {R}.",
    shareButton: "Send this to {R}",
    shareTitle: "homecookd",
    shareText: "{R}, will you teach me your best dish this Sunday? Just prop up your phone, cook and talk like always, and send me the video. I'll keep the recipe in your voice.",
    copied: "Copied. Paste it to {R}.",
    // when copying didn't work either: the link is printed right under it (SendPanel)
    sendLink: "Send {R} this link:",
    close: "Close",
    smsLabel: "Text it",
    emailLinkLabel: "Email it",
    emailSubject: "Will you teach me?",
    pills: ["Any phone", "No measuring for the cook", "Free in early access"],
    sticker: ["Free", "Early access"],
    note: "they'll love being asked.",
    // the right-hand star answering the H2 (decorative speech bubble)
    reply: "Sunday? I'll make extra.",
    starLeftAlt: "A grandpa and his teenage grandson talking over a pancake breakfast.",
    starRightAlt: "A grandmother in a green dress pressing tortillas by hand.",
    // one quiet line under the pills (FinalCta/OtherSide), linking to the other version
    // links to the parent version (/teach): what the cook sees before you ask
    otherSide: { lead: "Curious what {R} will see?", link: "Take a look" },
  },

  footer: {
    prompt: "Hungry for home? Get\u00a0early\u00a0access and start with one dish.", // keeps "Get early access" on one line
    button: { before: "Get", after: "early access" },
    buttonA11yLabel: "Get early access",
    linksPrimary: [
      { label: "How it works", href: "#how-it-works" },
      { label: "The app", href: "#see-it-work" },
      { label: "Languages", href: "#in-their-words" },
      { label: "Questions", href: "#questions" },
    ],
    // Contact shows only once CONTACT_EMAIL is set (src/content/site.ts)
    linksSecondary: [
      { label: "Back to top", href: "#top" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Contact", href: "mailto:" },
    ],
    // footer link to the other version (/teach)
    switchLink: "I'm the cook",
    wordmark: "homecookd",
    credits: "Photo credits",
    creditsIntro: "Photos and video from Pexels.",
    creditsThanks: "Thank you to:",
    disclaimer: "App clips are real screen recordings of homecookd, shown with demo recipes and stock cooking video. Other families on this page are illustrations.",
    copyright: "© 2026 homecookd",
  },

  meta: {
    siteName: "homecookd",
    title: "homecookd: cook it like Mom does",
    description: "Too far to cook together? They film themselves cooking, and homecookd turns it into a recipe you can follow, in their own voice. Free in early access.",
    ogAlt: "Cook it like Mom does. homecookd.",
  },

  // aria-labels for the real screen recordings (also used by src/content/media.ts).
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
} as const;

/**
 * The shape both versions share (copy.ts is the kid version, copy.parent.ts the parent version):
 * the same keys and tuple lengths, any words. Keys that point at real things (clips, recipes,
 * languages, links) keep their exact values, so the parent version can't drift from the media.
 */
type Fixed = 'id' | 'clip' | 'recipeId' | 'arcRecipeId' | 'relation' | 'lang' | 'href';
type Widen<T> = T extends string
  ? string
  : T extends object
    ? { readonly [K in keyof T]: K extends Fixed ? T[K] : Widen<T[K]> }
    : T;
export type Copy = Widen<typeof copy>;

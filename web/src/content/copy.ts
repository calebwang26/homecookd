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
    cta: "Make your dish",
    ctaMobile: "Make your dish",
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
    h2: "Too far to cook together? Name the dish you miss, and {R} fills in the rest.",
    accent: ["fills", "in", "the", "rest."],
    sub: "Every family has a dish only one person really knows. Keep it, with them in it.",
    chips: ["Grandma", "Dad"],
    cta: "Make it tonight",
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
        title: "Their recipe lands on your phone.",
        sticker: ["Love,", "Grandma"],
        imageAlt: "Mom’s tomato egg in homecookd: her amounts in her own words, with a play button to hear her say each one.",
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
    note: "real screens, from the site and the app",
    rows: [
      {
        number: "01",
        clip: "web-miss",
        title: "Name the dish you miss.",
        body: "Type it in and get a version you can cook tonight. Then tap Ask Mom.",
        chip: "mom’s tomato egg · ~2 eggs",
        tab: "Ask",
      },
      {
        number: "02",
        clip: "web-answer",
        title: "Mom answers by voice.",
        body: "She hears your note, sees your guess, and fixes it out loud. No app needed.",
        chip: "Hold to talk · 3 questions",
        tab: "She answers",
      },
      {
        number: "03",
        clip: "web-version",
        title: "Her recipe, her words.",
        body: "Her answers land in the recipe. Tap play to hear her say it.",
        chip: "Hear Mom · 0:05",
        tab: "Her recipe",
      },
      {
        number: "04",
        clip: "app-request",
        title: "Then she films it.",
        body: "In the app, she sets a reminder for the day she makes it, and films it like always.",
        chip: "Film it next time you make it",
        tab: "Film it",
      },
    ],
    // The message Ask Mom really sends with the link (MissApp's AskSheet default, in the kid's voice).
    sharePayload: "Mom, how do you make your tomato egg? I'm trying to make it here.",
    shareLabel: "What Ask Mom sends",
    shareSr: "Ask Mom sends this message with the link: “{payload}”",
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
    body: "They explain it best in Chinese, and you catch about half. Now you follow in English, with their words right above.",
    starAlt: "A grandmother and her granddaughter smile as they fold dumplings together over a steamer basket.",
    sticker: ["13", "languages"],
    radioLabel: "Pick a language",
    saidLabel: "{cook} said",
    youRead: "You read",
    rule: "Their words always stay on top.",
    note: "Cooks can talk in any of 13 languages, from Hindi to Tagalog.",
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
        id: "pt",
        chip: "Português Portuguese",
        lang: "pt",
        cook: "Vovó Ana",
        relation: "grandma",
        recipeId: "mom-banana-bread",
        dish: "Banana Bread",
        original: "Banana bem madura, quase preta. É aí que fica doce.",
        english: "Very ripe bananas, almost black. That's when it gets sweet.",
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

  questions: {
    h2: "Good questions.",
    accent: ["questions."],
    note: "better answers than “you'll know,” promise",
    phoneCaption: "homecookd asks a few too.",
    faq: [
      {
        q: "Does {R} need to download anything?",
        a: "No. You send {R} a link, and {R} answers your questions by voice, right in the browser. To film the dish, {R} gets the app.",
      },
      {
        q: "Is there any special gear?",
        a: "Just {R's} phone, leaned anywhere it can see the stove and {her} hands.",
      },
      {
        q: "Do they have to speak English?",
        a: "No. They can cook and answer in any of 13 languages, like Hindi, Mandarin, Spanish, Tagalog, Korean or Arabic. Their own words stay on top, with English below.",
      },
      {
        q: "What if the dish takes all day?",
        a: "{She} can film it in pieces, stop for the overnight soak and pick up again in the morning. Every video goes into the same recipe.",
      },
      {
        q: "How does homecookd write the recipe?",
        a: "Claude, an AI from Anthropic, writes it. From the dish you name, it makes a first version built on estimates, marked with a ~. When the cook answers or films, it uses their own words, and their stories come along too.",
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
    shareButton: "Ask {R} for a dish",
    shareTitle: "homecookd",
    shareText: "{R}, will you teach me your best dish this Sunday? Just prop up your phone, cook and talk like always, and send me the video. I'll keep the recipe in your voice.",
    copied: "Copied. Paste it to {R}.",
    // when copying didn't work either: the link is printed right under it (SendPanel)
    sendLink: "Send {R} this link:",
    close: "Close",
    smsLabel: "Text it",
    emailLinkLabel: "Email it",
    emailSubject: "Will you teach me?",
    pills: ["Starts in your browser", "No measuring for the cook", "Free in early access"],
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
    prompt: "Hungry for home? Name the dish and make it\u00a0tonight.",
    button: { before: "Make your", after: "dish" },
    buttonA11yLabel: "Make your dish",
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
    disclaimer: "App clips are real screen recordings of homecookd, shown with demo recipes. Other families on this page are illustrations.",
    copyright: "© 2026 homecookd",
  },

  meta: {
    siteName: "homecookd",
    title: "homecookd: cook it like Mom does",
    description: "Name the dish you miss and get a version you can cook tonight. Mom answers by voice, and her recipe lands in her own words. Free in early access.",
    ogAlt: "Cook it like Mom does. homecookd.",
  },

  // aria-labels for the real screen recordings (also used by src/content/media.ts).
  appClips: {
    "web-miss": "Screen recording of homecookd.app/miss: typing mom’s tomato egg, getting tonight’s version with estimated amounts, then the Ask Mom sheet with the message.",
    "web-answer": "Screen recording of homecookd.app on Mom’s phone: Caleb wants to make your tomato egg, his guess, three questions she answers by holding to talk, then her version filling in and Sent to Caleb.",
    "web-version": "Screen recording of the kid’s card on homecookd.app: Mom’s tomato egg, From Mom’s kitchen, her amounts in her own words with a play button for each.",
    "app-request": "The homecookd app on the cook’s phone: Leo wants your tomato egg, Leo’s guess, and Film it next time you make it.",
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

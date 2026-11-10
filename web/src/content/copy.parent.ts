// homecookd lander copy, parent version (/teach): the same keys as copy.ts, every word for the cook.
// Source and rationale: docs/lander-copy-audiences.md section C.
// Tokens: {R} = the visitor's own role from the "Cooking as" picker (Mom, Dad, Grandma, Grandpa,
// Auntie, Uncle). {kids} = "kids", or "grandkids" for Grandma and Grandpa (one plural word).
// The hero H1 is fixed (hero.h1Fixed), so hero.sub uses {kids}, not the H1's word.
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
    cta: "Get the app now",
    ctaMobile: "Get the app",
    skipLink: "Skip to how it works",
  },

  hero: {
    // the parent H1 is fixed (h1Fixed below); these rotation keys are kept for the shared Copy shape
    h1Before: "Show your",
    h1After: "how.",
    relationDefault: "kids",
    rotation: ["kids", "daughter", "son", "grandkids"],
    explicitWord: "{kids}",
    // {kids} = kids, or grandkids for Grandma and Grandpa (the picked role)
    // not shown: the hero has no sub (Caleb, Oct 17: too overwhelming)
    sub: "",
    // not shown on /teach (How it works, the next screen, says it); kept for the shared Copy shape
    beats: ["You hit record", "They get the recipe", "Their turn to cook"],
    // three lines everywhere; "forever." sits on the highlighter
    h1Fixed: "Record it once.\nThey'll cook it\nforever.",
    h1Accent: "forever.",
    cta: "Get the app now",
    switchLabel: "Here to learn the recipes?",
    // read after the label by screen readers, so the question says where it goes
    switchSr: "(opens the page for the ones learning to cook)",
    pauseVideo: "Pause video",
    playVideo: "Play video",
    videoAlt: "A mother laughing with her adult son and daughter as they make a salad together in the kitchen.",
    frontCard: {
      recipeId: "mom-salad",
      recPill: "● Recording · 0:42",
      watchPill: "▶ Watch",
    },
  },

  // passDown is not shown on /teach (FEEDBACK-OCT16 C2); kept for the shared Copy shape.
  passDown: {
    h2: "Culture we want to preserve, and pass down.",
    accent: ["preserve,", "and", "pass", "down."],
    sub: "Every family has a dish only one person knows by heart. Pass it on, with you in it.",
    chips: ["Grandma", "Dad"],
    cta: "Get early access",
    link: "How it works",
    deckListLabel: "A few family recipes, shown as examples:",
  },

  howItWorks: {
    // /teach (StepsPlain): the second screen. The three lines read as one H2 sentence; the last one
    // is the accent. {kids} → "grandkids" for Grandma and Grandpa. The eyebrow, clock, body, pill,
    // photo pill, moon chip and sticker are not shown on /teach.
    eyebrow: "How it works",
    clock: "Tue, 9:30 am",
    // The home page's explainer, so it reads right for a cook AND a kid who lands here (Caleb, Oct 17):
    // the cook in the third person ({R} = the "Cooking as" role, else the rotation), the whole family
    // as the reader. "films", not "records": the hero H1 right above starts "Record".
    // line 1 is the cook alone ({R}, rotating Mom → Dad → Grandma → Grandpa in StepsPlain), so the
    // swap never moves the rest of the heading. {herself} reads "themselves" (howItWorks.themselves)
    // while the name rotates, so only that one word changes; once a role is picked it's "himself" or
    // "herself" (QA B22: "Dad films himself cooking").
    h2Lines: ["{R}", "films {herself} cooking. We turn it into a recipe the whole family can follow,", "900 miles away."],
    themselves: "themselves",
    body: "Cook on your own time and talk them through it, like always. homecookd writes the recipe from your videos, and it's ready whenever they are.",
    pill: "See the real app",
    steps: [
      {
        numeral: "1",
        title: "Prop up a phone.",
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
        title: "We write the recipe. Everyone cooks it.",
        sticker: ["Love,", "Grandma"],
        imageAlt: "Mom’s tomato egg in homecookd: her amounts in her own words, with a play button to hear her say each one.",
      },
    ],
  },

  recipeBox: {
    // /teach (FamilyTable): only the H2, centred above the family table (no eyebrow, clock, body or note)
    eyebrow: "Your family table",
    clock: "Sun, 6:30 pm · everyone's home",
    h2: "Your {kids} miss your cooking. Let's fix that.",
    accent: ["Let's fix that."], // one phrase (FamilyTable matches it whole, on its own line)
    body: "Grandma won't cut a noodle, because a long noodle means a long life. Your recipes keep stories like that, too.",
    note: "three cooks so far. yours next?",
    folderTitle: "Our family table",
    folderAccent: "family",
    tablistLabel: "Show recipes from",
    tabs: ["Everyone", "Auntie Lin", "Dad", "Grandma"],
    addTab: "+ Add a recipe",
  },

  seeItWork: {
    // /teach: the H2 says it; no eyebrow, no hand note (empty strings are not rendered)
    eyebrow: "",
    h2: "Here's the real thing.",
    accent: ["real"],
    note: "",
    // identical to the kid rows (the 50/50 rule): a kid landing here still sees the whole journey
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
    // cooking side by side again, from two kitchens
    // "your" + a cycling word that fits both readers: a parent cooks with their son or daughter, a
    // kid with their mom or grandpa (Caleb, Oct 17). The word sits alone on line 2.
    h2: "Back in the kitchen with your mom.",
    accent: ["mom."],
    cycle: ["mom", "dad", "son", "daughter", "grandma", "grandpa"],
    // the word once the visitor's role is picked (the cycle stops there): "kids.", or "grandkids."
    explicitWord: "{kids}",
    ariaLabel: "Back in the kitchen with your family.",
    // the H2 alone (no body); the tiles stand still
    body: "",
    listLabel: "Family recipes in this section, shown as examples:",
    pause: "Pause moving recipes",
    play: "Play moving recipes",
  },

  inTheirWords: {
    eyebrow: "",
    // say plainly what the feature does: your words, translated automatically (Caleb, Oct 17)
    h2: "Your words. Translated.",
    accent: ["Translated."],
    // /teach: no eyebrow or body; the honesty note under the card stays
    body: "",
    starAlt: "A grandmother and her granddaughter smile as they fold dumplings together over a steamer basket.",
    sticker: ["13", "languages"],
    radioLabel: "Pick a language",
    saidLabel: "{cook} said",
    youRead: "They read",
    rule: "Your words always stay on top.",
    note: "Talk in any of 13 languages, from Hindi to Tagalog.",
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
    h2: "Send it off. Get photos back.",
    accent: ["Get", "photos", "back."],
    // /teach: the H2 alone; the scene shows the rest (the cook's answer is the last word)
    body: "",
    left: {
      title: "Far from home.",
      clock: "Tue, 11:04 pm",
      pill: "Learning your way",
      imageAlt: "A young man cooking alone at night in a small apartment kitchen.",
    },
    right: {
      title: "A quieter kitchen.",
      pill: "So proud of them",
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

  questions: {
    h2: "Good questions.",
    accent: ["questions."],
    note: "",
    phoneCaption: "",
    faq: [
      {
        q: "Do I need to download anything?",
        a: "Not to answer your {kids}: their link opens in your browser, and you answer by voice. To film your dish, get the app.",
      },
      {
        q: "I never measure. Is that okay?",
        a: "That's the whole idea. Say “a handful” like always. We keep your words and add a ~ estimate.",
      },
      {
        q: "Do I need anything special?",
        a: "Just your phone, leaned where it can see your hands.",
      },
      {
        q: "Do I have to speak English?",
        a: "No. Cook and talk in any of 13 languages, like Hindi, Mandarin, Spanish, Tagalog, Korean or Arabic. Your own words stay on top.",
      },
      {
        q: "What if the dish takes all day?",
        a: "Record in pieces. Every video goes into the same recipe.",
      },
      {
        q: "How does homecookd write the recipe?",
        a: "Claude, an AI from Anthropic, watches your videos and listens to your answers, then writes the steps. Your words stay, with an estimate like ~1 cup beside them.",
      },
      {
        q: "Who can see my recipes?",
        // true today (QA B19): recipe media sits at open links in a public bucket, and its library.json
        // lists every recipe; see /privacy
        a: "Your family sees them in the app, and you choose who else gets each one. But they aren't locked: your videos and recipes sit at open web links, and anyone who has a link can open them.",
      },
      {
        q: "How much does it cost?",
        a: "It's free during early access. If that ever changes, we'll tell you first.",
      },
    ],
  },

  finalCta: {
    // /teach: the H2, the form and the pills; no clock, body, hand note or star reply
    clock: "",
    // CtaHeading breaks before the accent phrase: "Teach them / your way."
    h2Default: "Teach them your way.",
    h2Explicit: "Teach the {kids} your way.",
    accent: ["your", "way."],
    body: "",
    emailLabel: "Your email",
    emailPlaceholder: "you@example.com",
    submit: "Get early access",
    submitting: "Saving your spot…",
    // under the email button: what happens next (QA B21)
    afterNote: "We'll email you when your spot opens. No card, no spam.",
    // next to the sign-up: the FAQ's easiest way in, for a cook who'd rather not download anything
    orJustCook: "Or wait for your {kids}' link, and answer by voice in the browser.",
    error: "That email looks a little off. Mind checking it?",
    networkError: "That didn't go through. Mind trying again?",
    success: "You're on the list. Now pick your first dish.",
    shareButton: "Send this to your {kids}",
    shareTitle: "homecookd",
    // sent from the cook to the kids, with a link to /learn?for={r} ("Cook it like Grandma does.")
    shareText: "I'd love to teach you my cooking. I'll film myself making your favorite this Sunday, and homecookd turns it into a recipe you can follow, in my own words.",
    copied: "Copied. Paste it to your {kids}.",
    sendLink: "Send your {kids} this link:",
    close: "Close",
    smsLabel: "Text it",
    emailLinkLabel: "Email it",
    emailSubject: "I'd love to teach you my recipes",
    pills: ["Any phone", "No measuring needed", "Free in early access"],
    sticker: ["Free", "Early access"],
    note: "",
    reply: "",
    starLeftAlt: "A grandpa and his teenage grandson talking over a pancake breakfast.",
    starRightAlt: "A grandmother in a green dress pressing tortillas by hand.",
    // links to the kid version (/learn): what the kids see
    otherSide: { lead: "Curious what your {kids} will see?", link: "Take a look" },
  },

  footer: {
    prompt: "Know a dish by heart? Get\u00a0the\u00a0app and start with that one.", // keeps "Get the app" on one line
    button: { before: "Get the app", after: "now" },
    buttonA11yLabel: "Get the app now",
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
    // footer link to the kid version (/learn)
    switchLink: "I'm here to learn",
    wordmark: "homecookd",
    credits: "Photo credits",
    creditsIntro: "Photos and video from Pexels.",
    creditsThanks: "Thank you to:",
    disclaimer: "App clips are real screen recordings of homecookd, shown with demo recipes. Other families on this page are illustrations.",
    copyright: "© 2026 homecookd",
  },

  meta: {
    siteName: "homecookd",
    title: "homecookd: record it once, they'll cook it forever",
    description: "Your kids ask for a dish. Answer by voice, then film it like always. homecookd turns it into a recipe they can follow, in your own words and voice. Free in early access.",
    ogAlt: "Record it once. They'll cook it forever. homecookd.",
  },

  // structural: the same aria-labels as the kid site (they describe the real recordings)
  appClips: {
    "web-miss": "Screen recording of homecookd.app/miss: typing mom’s tomato egg, getting tonight’s version with estimated amounts, then the Ask Mom sheet with the message.",
    "web-answer": "Screen recording of homecookd.app on Mom’s phone: Caleb wants to make your tomato egg, his guess, three questions she answers by holding to talk, then her version filling in and Sent to Caleb.",
    "web-version": "Screen recording of the kid’s card on homecookd.app: Mom’s tomato egg, From Mom’s kitchen, her amounts in her own words with a play button for each.",
    "app-request": "The homecookd app on the cook’s phone: Leo wants your tomato egg, Leo’s guess, and Film it next time you make it.",
  },
};

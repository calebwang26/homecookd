# homecookd v2 PRD

Started 2026-10-29 by Caleb, for the launch that markets to both customers: homesick kids and parent cooks. This is
the guideline for the next version of the app. Every new screen, flow and UI/UX decision is built around the user
pathway below, from how someone first discovers homecookd to becoming a loyal user. When older docs disagree
(`docs/PRD.md`, `docs/build/SPEC.md`, the bible's flows), this wins. More sections will be added; nothing here is
built yet.

## 1. The user pathway (Caleb's words, Oct 29)

### Kids

* Discover through UGC that sells the feeling: the dish only your mom knows, & you can make a version of it tonight
  (very cheap, very simple).
* Click the link in the UGC bio or video. It's hosted on our website to reduce friction & takes them straight to the
  sticky product.
* They type in whatever dish they're really craving from home, add photos & voice notes if they have them, &
  instantly get the tonight version.
  * It's built on estimates. We don't know exactly which ingredients or methods mom actually uses.
  * The sticky product suggests the kid ask a parent or grandparent to fill in the missing gaps.
  * If the kid taps "Ask Mom," a message opens that's written in the kid's voice & editable, e.g. "Mom how do you make
    your tomato egg? I'm trying to make it here." The kid can add a short voice note ("Mom, I miss your tomato egg").
  * Save recipe works like a Twitter bookmark: "Saved to your recipe box. Get it on your phone," with one download
    ask & two reasons (keep it, & know when Mom answers).
* The parent receives the link. Parents are way more motivated to act because they miss their kids more.

### Parent opens the kid's link

* Hear the kid's voice note → see his guess, shown openly as his guess ("Caleb thinks it's 1 tbsp ketchup & no
  sugar") so she wants to correct it → answer the questions by voice → the recipe fills in with her words (slow,
  satisfying animation) → "Sent to Caleb."
* Download pop-up, shown after the "Sent" moment:
  * Headline: "Surprise your kid by filming a video." It's more accurate, your kid misses the sound of your voice, &
    you cook it in a way no one else can replicate. Capture that on video. This leads because it's the strongest
    emotional pull & the only reason that genuinely needs the app.
  * Two short supporting lines underneath:
    * Save this recipe so it never gets lost. It's a little piece of connection you share with your kid.
    * Keep being part of your kid's cooking life. We just connected you over one dish; download to keep doing it.
      The web is limited to one recipe.

### Parents (cold, from Facebook)

* Discover through UGC on Facebook with messaging hyper-targeted to their kids missing their cooking & generational
  recipes dying.
* Click the link → install the app. The first screen gives two options:
  * "Ask your kids what they're craving." This is the main path: mom sends it to her son, & they're connected through
    the app.
  * "Start recording now," for parents who are already at the stove.
* The kid names a dish on the web, with no install needed.
* Mom gets a push: "Caleb wants your braised pork."
* Record: "Next time you make it, tap record," with a reminder she sets ("I make it on Sundays"). There's a fallback,
  "Tell him how you make it now" (a 2-minute voice version), so the kid gets something tonight & the video becomes
  the upgrade.
* The kid gets the recipe & is asked to download to keep it.
* Hypothesis: filming takes much more activation energy, but once their kid asks for a specific dish, parents will
  put in the time.

## 2. What this changes (for whoever builds the next screen)

- **The kid starts on the web, not the app.** The first product a kid touches is a page on homecookd.app: name a
  dish, get tonight's version from estimates, no install. The app comes later, through "Save" and "know when Mom
  answers".
- **The kid's request is the hook for the parent.** A specific ask from her own kid ("Caleb wants your braised pork")
  is what gets a parent to act. Show the kid's guess openly as a guess, so she wants to correct it.
- **The parent's first contribution is by voice, on the web.** She answers a few questions and the recipe fills in
  with her words. Filming is the upgrade, sold right after "Sent to Caleb".
- **One download ask at a time, after the emotional moment,** with at most one headline and two reasons.
- **The web gives one recipe; the app keeps the connection going.**
- **Cold parents get two doors:** ask your kids what they're craving (main), or start recording now. Recording has
  a reminder ("I make it on Sundays") and a 2-minute voice fallback, so the kid gets something tonight.
- **Earlier decisions this overrides:** the Oct 16 cut of the "Ask Mom" creative bet (`docs/agents/memory/
  dual-icp-playbook.md`). Ask Mom is now the core of the kid path. Homie's voice is off for launch (Oct 29); the
  parent's voice answers here are her own voice recordings, not a talk with homie.

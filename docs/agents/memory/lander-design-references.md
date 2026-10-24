---
name: lander-design-references
description: "Caleb's design references & taste for the Edible marketing lander (video hero, giant type, curtain scroll, footer wordmark fill, scroll reveals, photo-led); apply to every lander mockup or build"
metadata:
  type: feedback
---

The Edible lander should be family-centric: intuitive, homey, warm & comfortable, yet clearly a premium service. Combine what Caleb likes from each reference into one cohesive page; never copy a reference's exact structure.

- **a1 Graza hero** (`docs/lander-refs/a1-graza-hero.webp`): a full-bleed video of real cooking behind the hero, so the message lands before anyone reads a word. For Edible: a heartwarming video of a parent & their kid cooking a meal together. He dislikes Graza's small headline.
- **a2 Savor hero** (`a2-savor-hero.webp`): a huge headline that stands out against the background. The hero text & CTA should both be big & readable, with nothing hidden.
- **a3, the savor.it footer** (`a3-savor-footer.mp4` & `.jpg` frames): a giant wordmark across the footer. He wants *that exact animation*: each letter grows outward from its thickest strokes, thin parts last, with a slight left-to-right sweep over ~1.5 s. Build it with a background-colored stroke shrinking to 0 (spec section 8).
- **a4** (no file; the recording was never found): the hero stays put & the section below slides up to cover it.
- **a5, his favorite: the VERO restaurant site**, a Dribbble shot by Muhammad Shofiuddoula (`a5-vero.mp4` & `.jpg` frames):
  - headlines unfurl letter by letter along a small arc as you scroll, then content eases in
  - a chunky, round, soft serif (Recoleta-like); we picked Fraunces with SOFT 100
  - bold color-block sections with swirl patterns, cut-out people in star shapes, scalloped sticker badges
  - lots of photos, 2–5 word headers, airy spacing that never feels empty

- **a6, photo-background section** (`a6-photo-background-section.webp`, a Dribbble shot of an older woman in a warm kitchen): a high-quality, topical photo fills the section background. The subject sits on one side & the text & cards float on the other. On mobile, the photo is blurred wherever text sits on it.

**Branding (Caleb's notes, Oct 12):**
- Brand line: "Culture we want to preserve, and pass down."
- The three problems Edible solves:
  1. Recipe instructions are vague & slow.
  2. The language barrier: we translate so generations can talk.
  3. The distance barrier: kids feel at home, & parents & grandparents show their love.
- Love goes both ways: parents show care by teaching; kids show intentionality & respect by asking & cooking it back.
- On Oct 13 he reframed the pain points as no time, distance & language, & added copy & demo rules: see [[lander-copy-feedback]].

Details are in `docs/lander-spec.md` section 1; final copy is in `docs/lander-copy.md`.

**Workflow:** mockups in Claude Design first, then iterate, then build from the winning mockup.

**Why:** the audiences are college students who miss home & parents aged 50–60. Earlier he asked for smoothness & intuition over flashy features that could break, & said it must not feel like B2B SaaS.

**How to apply:**
- Start from `docs/lander-spec.md`; section 4 holds the references & how they combine.
- Keep the app's palette & look (`docs/lander-refs/app-mockups.webp`).
- Screen recordings dragged into chat land in a macOS temp folder Claude can't read. Look for copies on ~/Desktop instead (filenames have a narrow no-break space before "PM", so match them with a glob).

Related: [[edible-hackathon]], [[lander-reference-dribbble-food]]

---
name: brand-egg
description: "Oct 30 2026: the logo and mascot are a smiling fried egg (the pot is retired); the palette is cream, ink, yolk (main) and dark green (second); no lavender, no peach"
metadata:
  type: project
---

On 2026-10-30 Caleb approved the new brand kit (`docs/brand/`): the logo and mascot are a **smiling fried egg**, and the pot is retired. The palette is four colors: **cream** `#FBF5EA`, **ink** `#1F2430`, **yolk** `#F2A23A` (the main color) and **dark green** `#34430C` (second). Lavender (the kid's color) and peach (Mom's wash) are gone. The final values, light and dark, are `docs/brand/tokens/tokens.css` and `tokens.json`; the web and the app read the same file.

**Why:** Caleb wants the app and the web to match 1:1, and one warm main color (yolk) reads as "home cooking" faster than the old green, lavender and peach set.

**How to apply:**
- Primary actions ("Make my recipe", "Ask Mom", "Get the app") are a yolk fill with ink text, always. Never yolk text on a light background: links and accent text there are yolk-deep `#A3580C`.
- Dark green (with its tint `#E6EBCF`) is for success and Mom's answers (sage rows, checks, "Sent"). Guesses and asks ("Only Mom knows") use the light yolk tint `#FCEBD0`. Recording is `#9A4F47`.
- The mascot is the kit's five egg moods (`web/src/components/primitives/EggMascot.tsx`): hello, listening, made-it, sleepy, oops; one per screen. A dish card with no photo is a white card with the dish name in big Fraunces, never the egg.
- Logo: `Logo.tsx` (the kit's lockup; the mark by rendered size: 64px and up `mark.svg`, 24 to 63px `mark-small.svg`, 23px and under `mark-tiny.svg`; the mark alone on narrow phones). Never type "homecookd" as the logo, never redraw or recolor the SVGs in `web/public/brand/`.
- Every text pair stays at 4.5:1 or better, tap targets are 48px or more, and the focus ring stays visible.

Related: [[brand-homecookd]], [[ios-app-design-references]]

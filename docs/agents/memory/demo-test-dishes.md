---
name: demo-test-dishes
description: "Oct 24: demos, example recipes and testing use Swordfish steak and Poha (real dishes, real footage)"
metadata:
  type: feedback
---

On 2026-10-24 Caleb said that for demos, example recipes and testing, use **Swordfish steak** and **Poha**,
because they're real dishes with real footage.

**Why:** both come from a real cook filming a real dish, so they show what homecookd actually does (video
moments, the cook's voice, Marathi for Poha). Made-up or YouTube recipes don't.

**How to apply:**
- Swordfish steak: bundled id `weed-steak` (the id stays for URLs and caches), `app/assets/data/recipes/weed-steak.json`
  and the public media bucket. English.
- Poha: the Convex recipe "Poha" (`libraryId recipe-pjjjp58gxt44`, files under `recipe-pjjjp58gxt44/` in the
  `edible-media-…` bucket). The cook speaks Marathi. Since Oct 26 Marathi isn't a cook language ([[marathi-dropped]]),
  so Poha stays as an existing recipe and example, not the test for new language work; use the 13 languages for that.
- Pick these two for screenshots, demo scripts, example data and live pipeline checks (align, cover, shorten).
  Don't rerun Chicken Biryani for these.
- A change that touches cook mode or the pipeline is checked on both dishes where it can be.

Related: [[demo-family-shreya]]

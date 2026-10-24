# homecookd lander: build brief (final direction)

Oct 12, 2026 · Synthesized from three director proposals and two judge reviews. Winner: **product-clarity** (judges' combined 98.5), with the judges' grafts applied and every must-fix closed.

**This document wins over** `docs/lander-spec.md`, `docs/lander-copy.md` (v1, still centers "Ammi"), `docs/lander-refs/analysis/secondary-refs-spec.md` and the a7 mapping table wherever they disagree. For anything this brief doesn't cover, use `analysis/a7-motion-spec.md` (motion grammar), `analysis/palette-type.md` (tokens, contrast) and `analysis/secondary-refs-spec.md` (VERO, a6, a8 and a3 recipes), in that order.

**Hard rules for every builder**
1. Show the **real app** only through the real screen recordings in `/media/app/`. Never draw fake app UI inside a phone frame. Translation is website UI, never shown in a phone.
2. Use universal English and rotate relations (Mom / Dad / Grandma / Grandpa / Auntie / Uncle). Balance genders in every chip row, deck and photo set. Other languages appear only as translation examples.
3. Colors: canvas `#F7F7F2` + olive green family + yellows lead. Brown and black are **accents only** (Caveat notes, mascot outline, phone bezel, one black pill on screen).
4. Never show the cannabis demo recipes ("Weed pancakes", "Weed Steak", cook "Miles") or the Gordon/YouTube recipes in any clip, card, tile or frame.
5. No invented stats, reviews, ratings or logos. "AI" appears once, in the FAQ.
6. Server-rendered HTML is always the **final, readable** state. Hidden starting states exist only under `html[data-motion="on"]`.
7. Body text is 18px or more on mobile and 20px on desktop. Nothing meaningful is under 16px. Contrast meets AA and tap targets are at least 48px (CTAs 60–68px).
8. Banned words: AI-powered, leverage, seamless, revolutionize, unlock, supercharge, platform, workflow, solution, cutting-edge, next-gen, agentic, multimodal, pipeline, content, users, onboarding.

---

## 1. Concept and emotional arc

**"Set up the camera. Record. Done."** The page plays like a7, one continuous film. A single object travels down the page: **the family's recipe deck**. It begins as the hero video of a real family cooking, which tucks itself into a recipe card and keeps playing there. The deck fans out, shrinks into a sentence about a phone call home, falls into three steps, folds into a family recipe box, and finally gets sent across the country and answered with a first-try photo.

Each scene answers the visitor's next question:

| # | Visitor asks | Scene answers | Feeling |
|---|---|---|---|
| 1 | What is this? | A family cooking; the video becomes a recipe | Warmth: *that's my family* |
| 2 | Why would I need it? | "You call home: how much?" "A handful." | Recognition, with a small ache |
| 3 | Is it hard? | Set up the camera. Record. Done. | Relief |
| 4 | Where does it live? | One family recipe box, sorted by who taught it | Safety |
| 5 | Is it real? | Real screen recordings in a hand | Trust |
| 6 | Is this for my family? | Floating cards from every kind of family | Belonging |
| 7 | Grandpa doesn't cook in English | Their words, your language | Respect |
| 8 | We live far apart | Send it home, get a photo back | Love, both ways |
| 9 | Now what? | Ask them to teach you | Gentle action |

**Kitchen clock thread.** Caveat timestamps carry a week in one family's life: "Sat, 8:15 pm" (the call) → "Sun, 10:00 am" (set up) → "Sun, 6:30 pm · everyone's home" (the recipe box) → "Tue, 11:04 pm" (far from home, cooking it alone) → "This Sunday, 10:00 am?" (the invitation).

**Voice:** like a warm older sibling. Specific, sensory, a little funny, very short. Headers run 2–6 words; the brand line is the only exception. Body copy is no more than 2 lines per block.

---

## 2. Tech decisions (final)

| Area | Decision | Why |
|---|---|---|
| Framework | **Next.js latest stable (16.x), App Router, TypeScript strict, React 19**, in `/Users/calebwang/Documents/venture-hackathon/web` | Asked for |
| Output | `output: 'export'` (static, deploys to Vercel as static). No route handlers, no `next/headers`, no `useSearchParams` (read `window.location` in effects) | Static-export friendly |
| Styling | **CSS Modules** per component + global `src/styles/tokens.css`, `globals.css`, `type.css`. **No Tailwind.** | Values are bespoke vw/clamp/choreography numbers, and one module per owner means no shared config to fight over |
| Scroll choreography | **GSAP 3.13+ with ScrollTrigger** (`gsap`, `@gsap/react` `useGSAP`) for the 3 scrubbed scenes (DeckFilm, StepsToBox, FarApart) and the footer erosion | Multi-state timelines with labels, pin, scrub and function-based values are clearly better than hand-wiring `useTransform` across ~20 elements |
| Everything else | **`motion` v12** (`motion/react`, plus vanilla `animate`/`inView`/`stagger` from `motion`) for enter reveals, springs, chip pops and wobbles, hover, the translator, FLIP filtering (`layout`), the physics drop and the cloud drift | Lighter API for one-shot and interactive motion |
| Engine rule | **Never animate the same element with both engines.** If a scene hands over to an interactive state, swap layers (see StepsToBox) | Avoids style fights |
| Smooth scroll | **Lenis ON** for desktop wheel only: `(pointer: fine) and (min-width: 1024px) and (prefers-reduced-motion: no-preference)`. `lerp: 0.1`, `autoRaf: false`, driven by `gsap.ticker`, `lenis.on('scroll', ScrollTrigger.update)`, `gsap.ticker.lagSmoothing(0)`. Off on touch (native), off under reduced motion. Anchors use `lenis.scrollTo(target, { offset: -72 })` | a7's glide feel on desktop; native touch scrolling stays trustworthy on phones |
| Fonts | `next/font/google`: **Fraunces** (variable, axes `SOFT`, `WONK`, `opsz`, normal and italic), **DM Sans** (variable, `opsz`, normal and italic), **Caveat** (600, `preload: false`). Non-Latin translation lines (中文, 한국어, हिन्दी) load through a Google Fonts CSS2 `&text=` subset `<link>`, injected when the translation section is within one viewport | Small payload; only 6 lines of CJK and Devanagari |
| Images | `next/image` with a **custom loader** (`src/lib/imageLoader.ts`) that maps to pre-generated WebP widths in `/media/_opt/` (see section 7). `deviceSizes: [640, 960, 1280, 1920]`, `imageSizes: [160, 320, 480]` | next/image needs a loader under static export |
| Video | Plain `<video muted playsInline preload="none|metadata" poster>` with JS-selected source (desktop vs mobile) and IntersectionObserver play/pause | Reliable on iOS |
| Analytics, chat, embeds | None | |
| Packages | `next react react-dom gsap @gsap/react motion lenis` · dev: `typescript @types/react @types/node eslint eslint-config-next sharp simplex-noise d3-contour` | |

**Breakpoints:** `mobile < 768`, `tablet 768–1023` (uses mobile choreography at larger sizes), `desktop ≥ 1024`. Film (pinned/scrubbed) choreography only runs on desktop when `min-height: 600px` is also true. Otherwise scenes use their mobile versions.

`gsap.matchMedia()` conditions (put them in `src/lib/motion/media.ts`):
```ts
export const MQ = {
  desktop: '(min-width: 1024px) and (min-height: 600px) and (prefers-reduced-motion: no-preference)',
  mobile:  '(max-width: 1023px) and (prefers-reduced-motion: no-preference)',
  reduce:  '(prefers-reduced-motion: reduce)',
};
```

---

## 3. Design tokens

### 3.1 `src/styles/tokens.css` (B0 writes this file verbatim, then adds to it only)
```css
:root {
  color-scheme: light;

  /* neutrals */
  --canvas: #F7F7F2;  --surface: #FFFDF7;  --sunken: #EFEFE6;
  --pistachio-wash: #F2F6E1;  --footer-bg: #F1F2DC;
  --hairline: rgba(71, 67, 42, 0.14);  --halo: rgba(71, 67, 42, 0.05);
  --hero-dark: #1E2410;                         /* stage behind the hero sheet corners */

  /* text */
  --ink: #1E2410;  --text: #2D3222;  --muted: #5F6352;
  --ghost: #CDD0BC;                             /* unfilled scrub words. NEVER a final state */
  --cream: #FFFDF7;  --muted-inverse: #C9D0AE;

  /* greens */
  --forest: #34430C;  --forest-swirl: #3D4E10;  --green-deep: #4C5A10;
  --green: #5B6F00;   --green-swirl: #64790A;   --leaf: #788C15;
  --lime: #B2C248;    --chartreuse: #D1E043;    --chartreuse-swirl: #D9E65A;
  --sage: #E6EBCF;    --lime-wash: #EDF2BE;     --olive-ink: #3C4A0B;

  /* yellows */
  --sun: #FEBE29;  --sun-swirl: #FFCB4F;  --highlighter: #FFD24D;
  --lemon: #FFE59A;  --butter: #FFF1C7;

  /* warm accents */
  --tomato: #E95D3D;  --tomato-deep: #C8462A;  --tomato-ink: #A8361B;
  --apricot: #FFB677; --apricot-soft: #FFDDBF; --apricot-ink: #8A3F12;
  --peach: #F9E3CF;   --peach-ink: #6E4A33;    --blush: #FAD6CB;
  --ube: #ECE6F2;     --ube-ink: #3F3558;      --lavender: #ECE6F2;

  /* accent-only */
  --cocoa: #5A3A22;  --black: #121410;

  /* semantic */
  --btn-hero-bg: var(--chartreuse);  --btn-hero-fg: var(--ink);
  --btn-primary-bg: var(--green);    --btn-primary-fg: var(--cream);  --btn-primary-hover: var(--green-deep);
  --btn-soft-bg: var(--sage);        --btn-soft-fg: var(--green-deep);
  --focus-ring: var(--leaf);
  --scrim-strong: rgba(30, 36, 16, 0.70);  --scrim-soft: rgba(30, 36, 16, 0.55);

  /* type families (next/font sets the --font-* variables on <html>) */
  --ff-display: var(--font-display), 'Iowan Old Style', Georgia, serif;
  --ff-text: var(--font-text), system-ui, -apple-system, 'Segoe UI', sans-serif;
  --ff-hand: var(--font-hand), 'Bradley Hand', cursive;

  /* type scale (mobile 390 → desktop 1440) */
  --fs-hero: clamp(3.5rem, 11vw, 11rem);                    /* 56 → 158 */
  --fs-block: clamp(3rem, 1rem + 6vw, 8rem);                /* color-block statements: 48 → 102 */
  --fs-statement: clamp(2.5rem, 1rem + 5.2vw, 6rem);        /* brand line, centered scrub statements: 40 → 91 */
  --fs-manifesto: clamp(2.25rem, 0.8rem + 4.2vw, 5rem);     /* the-call: 36 → 73 */
  --fs-h2: clamp(2.75rem, 1.2rem + 4.6vw, 6.25rem);         /* 44 → 85 */
  --fs-h3: clamp(1.875rem, 1.2rem + 2.2vw, 3.25rem);        /* 30 → 51 */
  --fs-numeral: clamp(4.5rem, 9vw, 9rem);                   /* step-card numerals */
  --fs-marquee: clamp(2.75rem, 1rem + 4.4vw, 5.5rem);       /* 44 → 79 */
  --fs-card-title: clamp(1.375rem, 1.15rem + 0.5vw, 1.75rem); /* 22 → 26 */
  --fs-cook: clamp(1.25rem, 1.05rem + 0.6vw, 1.75rem);      /* the cook's own words: 20 → 25 */
  --fs-lead: clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem);        /* 20 → 24 */
  --fs-body: clamp(1.125rem, 1.05rem + 0.25vw, 1.25rem);    /* 18 → 20 */
  --fs-ui: 1rem;  --fs-ui-lg: 1.125rem;  --fs-eyebrow: 1rem;
  --fs-hand: clamp(1.375rem, 1.2rem + 0.5vw, 1.75rem);      /* Caveat 22 → 28 */

  /* spacing (8pt) */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px;
  --s-7: 40px; --s-8: 48px; --s-9: 64px; --s-10: 80px; --s-11: 96px; --s-12: 128px; --s-13: 160px;
  --gutter: clamp(20px, 7.2vw, 112px);        /* a7 content gutter */
  --gutter-hero: max(20px, 3.5vw);            /* a2 hero anchor */
  --content-max: 1280px;
  --section-pad-y: clamp(72px, 12vh, 168px);
  --stack-eyebrow-h2: 16px; --stack-h2-body: 24px; --stack-body-cta: 40px; --stack-head-visual: clamp(40px, 4vw, 64px);

  /* radii */
  --r-pill: 999px; --r-sm: 12px; --r-md: 16px; --r-photo: 18px; --r-card: 24px;
  --r-media: 28px; --r-big: 32px; --r-sheet: 40px;

  /* shadows */
  --shadow-card: 0 1px 2px rgba(30,36,16,.04), 0 12px 32px -12px rgba(30,36,16,.18);
  --shadow-float: 0 2px 6px rgba(30,36,16,.05), 0 28px 60px -20px rgba(30,36,16,.28);
  --shadow-sheet: 0 -24px 60px rgba(20,22,12,.18);
  --ring-halo: 0 0 0 8px var(--halo);

  /* motion */
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);     /* arrivals, glides */
  --ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);    /* word reveals */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);      /* scrubbed layout morphs only */
  --ease-soft: cubic-bezier(0.22, 1, 0.36, 1);        /* cards/photos rise, video swaps */
  --d-word: 550ms;  --d-word-color: 600ms;  --d-word-color-delay: 120ms;
  --d-para: 400ms;  --d-card: 800ms;  --d-glide: 700ms;  --d-swap: 450ms;
  --d-highlight: 450ms;  --d-idle: 3600ms;

  /* z-index */
  --z-deck: 2; --z-video: 3; --z-text: 4; --z-chips: 5; --z-nav: 50; --z-skip: 100;
}
```
Mirror the motion numbers in `src/lib/motion/tokens.ts` (`EASE.expo = [0.16,1,0.3,1]`, `SCRUB = 0.6`, `STAGGER = { heroWord: .1, word: .07, para: .02, card: .08, letter: .026, footer: .14 }`, and a `HEX` map of token colors for GSAP color tweens, because CSS variables can't be interpolated).

### 3.2 Type roles (`src/styles/type.css`, global classes)

| Class | Font & settings | Size token | Leading / tracking | Used for |
|---|---|---|---|---|
| `.t-hero` | Fraunces 700, `SOFT 100, WONK 0, opsz 144` | `--fs-hero` (mobile <768: `clamp(3.5rem, 15vw, 6.5rem)`) | .9 / −.03em (mobile .95) | Hero H1 |
| `.t-block` | Fraunces 700 + italic 500 `WONK 1` | `--fs-block` | 1.0 / −.03em | Sun and forest block H2s |
| `.t-statement` | Fraunces 500, `SOFT 100` | `--fs-statement` | .98 / −.03em | Brand line, cloud H2, FarApart H2 |
| `.t-manifesto` | Fraunces 500 (cook quotes italic 450 `WONK 1`) | `--fs-manifesto` | 1.08 / −.025em | The call |
| `.t-h2` | Fraunces 560, `SOFT 100` | `--fs-h2` | .96 / −.025em | Left-aligned section H2s |
| `.t-h3` | Fraunces 600, `SOFT 100` | `--fs-h3` | 1.02 / −.02em | Feature titles (a8), card captions |
| `.t-numeral` | Fraunces 800 | `--fs-numeral` | .8 / −.04em | Step numerals |
| `.t-card-title` | Fraunces 600 | `--fs-card-title` | 1.12 / −.01em | Recipe card titles |
| `.t-cook` | Fraunces italic 450, `WONK 1` | `--fs-cook` | 1.3 / 0 | The cook's own words anywhere |
| `.t-lead` | DM Sans 400 | `--fs-lead` | 1.4 / −.005em | Supporting lines |
| `.t-body` | DM Sans 400 | `--fs-body` | 1.55 / 0 | Paragraphs (max 38ch) |
| `.t-ui` | DM Sans 500 | 16px | 1.3 / .005em | Nav, chips, tags, card meta |
| `.t-button` | DM Sans 600 | 18px | 1 / .005em | Buttons |
| `.t-eyebrow` | DM Sans 600, uppercase, last word `--green` (or the block's accent) | 16px | 1.2 / .08em | Eyebrows |
| `.t-hand` | Caveat 600, `--cocoa` on light, `--cream` / `--chartreuse` on dark | `--fs-hand` | 1.1 / 0 | Notes, kitchen clock (never essential info) |

Rules: one italic phrase and one accent color per heading. Never set Fraunces below 20px or DM Sans as a display headline. Italic words use `font-variation-settings: 'SOFT' 100, 'WONK' 1`.

### 3.3 Color by section (page rhythm)

| Section | Background | Accent | Loud block? |
|---|---|---|---|
| Hero (DeckFilm start) | video + olive-black scrim | chartreuse CTA | — |
| Pass-down, The call, How it works, Recipe box | canvas | green words, bold green and sun cards | — |
| See it work | **green `#5B6F00`** + `--green-swirl` ribbon | chartreuse pills, cream text | **yes (1)** |
| Every family (cloud) | canvas | — | breather |
| In their words | **sun `#FEBE29`** + `--sun-swirl` bands | forest/ink text | **yes (2)** |
| Far apart | canvas | tomato heart, green dock | breather |
| Measures | **chartreuse inset panel** on canvas | ink text | **yes (3), inset** |
| Questions | canvas | — | breather |
| Final CTA | **forest `#34430C`** + `--forest-swirl` | chartreuse, sun | **yes (4)** |
| Footer | `--footer-bg #F1F2DC` | green wordmark, chartreuse 14px strip | — |

A canvas section always sits between two loud blocks.

---

## 4. Global behaviors

### 4.1 Motion gating (prevents both the hidden-content trap and the flash)
- `src/app/layout.tsx` inlines this script in `<head>` before any CSS paints:
  ```html
  <script>(function(){var d=document.documentElement;var r=matchMedia('(prefers-reduced-motion: reduce)').matches;d.dataset.motion=r?'off':'on';setTimeout(function(){if(!window.__homecookdHydrated)d.dataset.motion='off'},4000);})();</script>
  ```
- `MotionProvider` sets `window.__homecookdHydrated = true` on mount and listens for reduced-motion changes.
- Every "before" state lives in CSS under `html[data-motion="on"] …:not([data-revealed])`. If JS fails, the 4-second fallback shows everything.
- After `document.fonts.ready` and after the hero poster `load`, `MotionProvider` calls `ScrollTrigger.refresh()`. It also refreshes on `ResizeObserver(document.body)`, debounced 200ms.
- `ScrollTrigger.config({ ignoreMobileResize: true })`; every pinned trigger uses `anticipatePin: 1` and `invalidateOnRefresh: true`.

### 4.2 Reduced motion (`prefers-reduced-motion: reduce`)
- No pins, no scrub, no Lenis. Every scene renders its static final layout (described per section).
- The hero shows its poster with a ▶ "Play video" button; video never autoplays.
- Word and letter reveals: render final. A 200ms opacity fade is allowed and nothing more.
- Marquees and cloud rows stop and become horizontally scrollable (`overflow-x: auto`, `scroll-snap`).
- Off: chip wobble, mascot hop, physics drop, picker auto-advance, relation rotation, sticker spin and footer erosion (show the finished wordmark).

### 4.3 Pause motion (WCAG 2.2.2)
`PauseProvider` holds one global `paused` boolean. These pause controls all toggle it: hero ▶/❚❚, cloud, translator, measures band, mobile app tabs. When paused: hero video pauses; relation rotation, cloud drift, marquee, picker auto-advance, sticker spin and chip wobbles stop. Every auto-advancing thing also **stops on its own after one full cycle** (relation word, cloud italic word, translator, mobile app tabs). Never put `aria-live` on auto-advance; announce only user-initiated changes.

### 4.4 "Cooking with" personalization (quirk 1)
- `RelationProvider` value: `{ relation: 'mom'|'dad'|'grandma'|'grandpa'|'auntie'|'uncle', label: 'Grandma', explicit: boolean, setRelation }`.
- Precedence: `?for=<relation>` in the URL, then `localStorage['homecookd.relation']` (wrap every access in try/catch), then the default `grandma` (explicit = false).
- Read it in `useEffect` (static export). SSR renders the default, so the server HTML says "Grandma".
- `setRelation` writes localStorage and calls `history.replaceState` with `?for=` so the link can be copied and sent.
- Copy uses tokens: `{R}` → label ("Grandma") and `{r}` → slug. `fill(str, rel)` lives in `src/lib/relation.ts`.
- What it drives:
  - the hero word (locks rotation)
  - the call-card name in The call
  - FAQ wording
  - the "Delivered · {R} ♥" chip
  - the final CTA H2 ("Ask {R} to teach you." when explicit, otherwise "Ask them to teach you.")
  - "Send this to {R}" and the share message

### 4.5 Nav tone contract
- Elements may carry `data-nav-tone="hero"`. The nav is "hero tone" (transparent, cream text) while any `[data-nav-tone="hero"]` element covers the top 72px of the viewport. Otherwise it's "float tone" (canvas 88% pill, `backdrop-filter: blur(12px)` with a solid `--canvas` fallback, `--ring-halo`, ink text).
- DeckFilm sets the attribute on its stage and removes it once the sheet covers the viewport, at A22.

### 4.6 GSAP conventions
- Register once in `src/lib/motion/gsap.ts` (`'use client'`, `gsap.registerPlugin(ScrollTrigger)`; export `gsap`, `ScrollTrigger`, `useGSAP`).
- One timeline per scene, built inside `useGSAP(() => { const mm = gsap.matchMedia(); mm.add(MQ.desktop, …); mm.add(MQ.mobile, …) }, { scope })`. Revert on unmount.
- Express geometry in vw/vh through function-based values; measure DOM rects only on refresh, never per frame.
- Default `scrub: 0.6`. Animate only `transform`, `opacity`, `color`, `clip-path` and CSS variables. Never scrub `filter: blur`.
- Time-based "pops" inside scrubbed scenes fire from `onUpdate` progress crossings (once per direction) and play a `motion` animation on a **different element** (the chip's inner wrapper).

---

## 5. Shared primitives (B0 builds them unless another owner is noted)

All live in `web/src/components/primitives/` (or `motion/`, `providers/`, `icons/`) with a co-located `*.module.css`. Each component exports its props type. "Static" below means the SSR, reduced-motion and no-JS rendering.

### Providers (`src/components/providers/`)
| File | Behavior |
|---|---|
| `MotionProvider.tsx` | Sets the hydrated flag, refreshes ScrollTrigger (4.1), exposes `useMotionOK()` (false under reduced motion or `data-motion="off"`) |
| `LenisProvider.tsx` | Mounts Lenis per 2 on desktop only. Exposes `useLenis()`, and `scrollToId(id)` falls back to `el.scrollIntoView({behavior: motionOK ? 'smooth' : 'auto'})`. Intercepts `a[href^="#"]` clicks globally |
| `RelationProvider.tsx` | 4.4 |
| `PauseProvider.tsx` | 4.3, plus `PauseButton` (48px round, cream or ink outline variants, `aria-pressed`, label "Pause motion" / "Play motion"; the hero variant says "Pause video") |

### Motion (`src/components/motion/`, `src/lib/motion/`)
| File | Props | Behavior | Static |
|---|---|---|---|
| `SplitWords.tsx` | `text: string`, `accent?: string[]` (exact words, rendered in `<em>`), `as`, `className`, `slot?: { afterWord: number; node: ReactNode }` | Renders the heading with `aria-label={text}` and children `<span class="w" aria-hidden>` per word (inline-block, words stay intact). Optionally inserts a measured inline slot (`<span data-slot>`) after a word | Plain words, final colors |
| `WordReveal.tsx` | `text`, `accent?`, `as='h2'`, `stagger=.07` (hero .1), `delay=0`, `tone='ink'\|'cream'`, `amount=.6` | a7 M2 on enter via `inView` + `animate` on the spans: opacity 0→1, y .3em→0, blur 8px→0 (550ms, quart), color ghost→ink (cream variant: muted-inverse→cream; accent: pale accent→accent) delayed 120ms. Sets `data-revealed` | Final |
| `wordFill.ts` (GSAP helper) | `addWordFill(tl, root, { to='ink', accentTo='green', at, span, stagger })` | Scrubbed color tween ghost→target per `.w` in reading order, plus y .1em→0. Never blur | n/a (static CSS shows final) |
| `LetterArc.tsx` | `text`, `accent?`, `as`, `variant='arc'\|'grow'`, `trigger='enter'\|'load'` | `arc` = VERO unfurl (secondary spec 4.2): per char, opacity 0→1, scale .2→1, rotate 80→0, x .22em→0, y .6em→0, origin `0% 100%`, 700ms expo, stagger `min(.026, .55/n)`, at top 85%. `grow` = hero baseline grow (4.3): scale .3→1, origin `50% 100%`, 600ms expo, 55ms stagger, all lines start at t = .15s. Words stay intact (`white-space: nowrap` per word) | Final |
| `Reveal.tsx` | `as`, `y=24`, `delay`, `stagger` (for children marked `data-reveal-item`), `amount=.35` | Fade and rise once on enter, 800ms soft ease; images inside go scale 1.04→1 | Final |
| `StickyStage.tsx` | `trackVh: { desktop: number; mobile?: number }`, `stickyOnMobile=false`, `stage: ReactNode`, `children` (normal-flow content), `className` | Renders `<div track style={{height}}><div stage sticky top:0 height:100svh overflow:clip/></div>` plus flow. Exposes refs through a callback (`onReady({track, stage})`) for GSAP. Static: `height:auto`, the stage becomes a normal block | Normal flow |
| `src/lib/deck/layouts.ts` | pure functions | `stack(i,n)`, `fan(i,n,{mobile})`, `stairs(i)`, `grid(i,{cols})`, returning `{x, y, rotate, scale, z}` in vw (y in vh where stated). Formulas in 8.2 and 8.3 | — |
| `CardFan.tsx` | `recipes: Recipe[]`, `layout: 'fan'\|'stack'\|'stairs'`, `mobile?` | Static CSS-positioned deck (transforms from layouts.ts as inline `--x/--y/--r/--s`), soft floor shadow under the fan. Used for SSR and reduced motion and as the initial pose GSAP takes over | Itself |
| `Marquee.tsx` | `children`, `durationSec=45`, `direction='left'\|'right'`, `gap`, `mask=true`, `pauseOnHover=true`, `label` | CSS `@keyframes` on a duplicated track (`translateX(-50%)`), edge fade masks, pauses with `PauseProvider`, hover and focus-within. The duplicate is `aria-hidden`; `label` is rendered visually hidden | Horizontally scrollable, not moving |

### UI (`src/components/primitives/`)
| File | Props | Notes |
|---|---|---|
| `Button.tsx` | `variant: 'hero'\|'primary'\|'soft'\|'outlineCream'\|'outlineInk'\|'black'`, `size: 'lg'(68px)\|'md'(60px)\|'sm'(48px)`, `href?`, `arrow?: boolean`, `rule?: boolean` | VERO pill: label plus a filled circle (52px on lg, 44px on md) with an arrow, inset 8px right. Hover: the circle slides 4px and the label 2px. `rule` renders the Savor "Get —— early access" label with a 36px, 1px rule. Focus: 3px `--focus-ring` with 3px offset. On a dark background use `--chartreuse` for the focus ring |
| `Chip.tsx` | `tone: 'forest'\|'sun'\|'green'\|'tomato'\|'cream'\|'black'`, `tail?: 'bl'\|'bc'\|'br'\|null`, `pop?: boolean` (spring on first in-view, or `popKey` changes), `typing?: boolean` (shows "…" dots for 600ms first), `wobble?: boolean` (rotate ±3°, y ±3px, 3.6s sine, random phase), `rotate?: number`, `children` | Speech bubble, 16–20px DM Sans 500, padding .55em 1em, faint top highlight. Forest uses chartreuse text, sun uses ink, green uses cream, tomato uses ink. The spring (stiffness 500, damping 18) is on the inner wrapper, transform-origin at the tail tip |
| `Pill.tsx` | `tone: 'white85'\|'sage'\|'lemon'\|'lavender'\|'rec'\|'outlineCream'`, `icon?` | Small labels: "▶ Watch", "● REC 0:42", "♥ Saved", "Lean it on anything", moon chip. **Not interactive:** no hover, cursor default |
| `Highlighter.tsx` | `children`, `drawn?: boolean` (controlled for scrub scenes), `color='highlighter'` | `background: linear-gradient(var(--highlighter), var(--highlighter)) no-repeat 0 85% / var(--hl, 100%) 78%`, `box-decoration-break: clone`, padding 0 .12em, radius 3px. Draws in left→right (450ms) on enter when uncontrolled |
| `Sticker.tsx` | `lines: [string, string?]`, `tone: 'sunOnCream'\|'chartreuseOnForest'\|'creamOnSun'`, `size=170`, `spin=true`, `rotate=-8` | VERO scalloped seal: a cream disc holds a wavy seal path (`r(θ)=R·(1−.07·(.5−.5·cos(16θ)))`, 360 points, generated in code). Fraunces 800 uppercase 16px text stays still while the seal ring spins 24s/turn (paused by PauseProvider). `aria-label` is the joined lines |
| `StarClip.tsx` | `image`, `alt`, `size` (CSS length), `rotate`, `ring?: 'sun'\|null`, `popOut?: { src, alt }` | `starClip(8, .62, rot)` polygon (secondary spec 4.5). `ring` draws a sun star 6% larger behind. `popOut` renders an unclipped cutout on top. Enter: scale .6→1, rotate −20°→final, 900ms expo |
| `PhoneFrame.tsx` | `children` (screen), `width` (CSS length), `hand?: boolean`, `tilt=0`, `shadow=true`, `className` | Default: a soft-white CSS phone (bezel `--surface` 10px, 1px `--hairline`, radius `13.5% / 6.2%`, a small `--black` dynamic-island pill), screen aspect **780:1688**. `hand` uses `HAND_PHONE` from `src/content/media.ts` when it isn't null: the `<img>` sits **above** the screen so the fingers overlap the bezel, the screen is positioned to the configured rect and rotation, and the hand bleeds off the container bottom. If `HAND_PHONE` is null, `hand` is ignored |
| `AppClip.tsx` | `name: AppClipName`, `active?: boolean`, `playWhenVisible?: boolean`, `loop=true`, `onEnded?`, `label: string` | `<video muted playsInline disablePictureInPicture preload="none" poster="/media/app/{name}.jpg">`. Controlled: when `active` becomes true, set `currentTime=0` and `play()`; when false, `pause()`. Uncontrolled: play when ≥50% visible. Set `preload="auto"` on the active and next clips only. Fills the screen with `object-fit: cover`. `aria-label={label}`. Static/reduced: poster only plus a ▶ button that plays on tap |
| `RecipeCard.tsx` | `recipe: Recipe`, `face?: 'dish'\|'cook'` (uses `recipe.cookPhoto`), `media?: ReactNode` (replaces the photo, e.g. the hero video slot), `garnish?: { watch?: boolean; rec?: string; sticker?: string; steam?: boolean; saved?: boolean }`, `showEstimate?: boolean`, `tint?: Tint`, `decorative=true` (adds `aria-hidden`), `className`, `style` | 4:5 tinted panel, radius 24, 8px inset; photo radius 18 fills the top 66%. Below: `.t-card-title` "{possessive} {dish}", meta "by {cook} · {time}" (DM Sans 16, tint ink at 80%), and the cook's words on a lemon pill in `.t-cook` (at 20px) with the ~estimate muted beneath when `showEstimate`. `container-type: inline-size`; **≥220px** everything shows, **140–219px** the feel pill and time hide, **<140px** only the photo plus a cook tag (16px chip overlapping the bottom-left) show. `--shadow-card` and halo ring. Steam = 3 cream squiggles drifting over the photo. Bold tints (green, forest, sun, chartreuse) switch text colors per palette-type.md |
| `KitchenClock.tsx` | `time: string`, `tone='cocoa'\|'cream'\|'chartreuse'` | Caveat line with a 1em line-drawn clock glyph. Plain text for screen readers |
| `HandNote.tsx` | `children`, `arrow?: 'left'\|'right'\|'down'\|'up'`, `tone` | Caveat note plus a hand-drawn SVG arrow. At most 1–2 per screen |
| `PotMascot.tsx` | `size=48`, `mood: 'smile'\|'happy'\|'talk'`, `steam?: boolean`, `className` | Port the SVG paths from `app/src/components/icons.tsx` lines 109–136 to web `<svg>` (keep its colors; the brown outline is an allowed accent). `steam` animates the three curls (y −4px, opacity .5→1, 2.4s loop, paused by PauseProvider) |
| `Steam.tsx` | `color='cream'`, `size` | Three wavy squiggles (port `SteamSwirl`, icons.tsx line 138) |
| `Icons.tsx` (`src/components/icons/`) | `size`, `stroke` | UI: play, pause, arrow-right, chevron-down, heart, speaker, moon, check, clock, plus, camera. Share glyphs: message, mail, link, qr, family. Kitchen line icons (1.8px stroke, round caps): whisk, wooden-spoon, ladle, pot, chili, garlic, timer, rolling-pin, flame, scallion |
| `Img.tsx` | next/image props + `blurred?: boolean` | Wraps `next/image` with the custom loader. `blurred` swaps to the pre-blurred `-blur.webp` (a6 mobile layer) |
| `FooterWordmark.tsx` | **owned by B7**; see section 8.12 | |
| `HeroVideo.tsx` | `desktopSrc`, `mobileSrc`, `poster`, `posterMobile`, `focus='52% 45%'`, `className`, `videoRef` | Picks the source on mount (`matchMedia('(max-width: 767px)')`), sets `muted autoplay loop playsInline preload="metadata"`, `object-fit: cover`, `object-position: var(--focus)`. Pauses with PauseProvider and offscreen (IO). Reduced motion: poster plus a ▶ button. The poster is the LCP image: render it as an `<img fetchpriority="high">` under the video, fading out when `playing` fires |

---

## 6. Data and content

### 6.1 Types (`src/content/types.ts`)
```ts
export type Relation = 'mom' | 'dad' | 'grandma' | 'grandpa' | 'auntie' | 'uncle';
export type Tint = 'sage'|'limeWash'|'butter'|'lemon'|'apricotSoft'|'peach'|'blush'|'ube'|'green'|'forest'|'sun'|'chartreuse';
export type AppClipName = 'app-library'|'app-recipe'|'app-cook'|'app-share'|'app-record'|'app-questions';

export interface Recipe {
  id: string;
  dish: string;                 // "Hand-Pulled Noodle Soup"
  cook: string;                 // display name as the family says it: "Grandma", "Auntie Lin", "Grandpa Rey"
  relation: Relation;           // for balance checks & chips
  culture: string;              // "Chinese", "Nigerian" … (alt text, never shown as a label)
  feelQuote: string;            // the cook's own words, English
  feelOriginal?: { text: string; lang: string };  // when said in another language (shown on top)
  estimate: string;             // "~3 cups flour" | "to taste"
  time: string;                 // "~1 hr 15 min"
  tint: Tint;
  image: string;                // dish photo path under /media
  imageAlt: string;
  cookPhoto?: { src: string; alt: string };       // a photo of the cook cooking (used where men must be visible)
  source: 'app' | 'hero' | 'example';             // app = in the real screen recordings
}
```

### 6.2 `src/content/recipes.ts` (21 recipes; B0 writes them exactly)
Possessive titles render as `{cook}'s {dish}`. `app` recipes are spelled exactly as in the screen recordings and use the real covers (copied in section 7).

| id | cook | dish | relation | culture | feelQuote (cook's words) | estimate | time | tint | image | source |
|---|---|---|---|---|---|---|---|---|---|---|
| grandma-noodle-soup | Grandma | Hand-Pulled Noodle Soup | grandma | Chinese | two heaping rice bowls, maybe a little more | ~3 cups flour | ~1 hr 15 min | limeWash | app-covers/grandma-hand-pulled-noodle-soup.jpg | app |
| grandma-pork-belly | Grandma | Red-Braised Pork Belly | grandma | Chinese | the color of tea or honey, never dark | ~3 tbsp rock sugar | ~2 hrs, plus overnight | forest | app-covers/grandma-red-braised-pork.jpg | app |
| dad-chili | Dad | Sunday Chili | dad | American | three big shakes, about a palmful | ~3 tbsp chili powder | ~4 hrs | green | app-covers/dad-sunday-chili.jpg (cookPhoto: stock/photo-dad-son-cooking.jpg) | app |
| dad-fish | Dad | Grilled Fish with Ginger-Scallion Sauce | dad | Cantonese | a piece as big as my thumb | ~2 tbsp minced ginger | ~45 min | sage | app-covers/dad-ginger-scallion-fish.jpg | app |
| auntie-lin-pancakes | Auntie Lin | Scallion Pancakes | auntie | Taiwanese | when it looks like too much, one more handful | ~8 scallions | ~1 hr | blush | app-covers/auntie-lin-scallion-pancakes.jpg | app |
| grandma-dumplings | Grandma | Sunday Dumplings | grandma | Chinese | pleat it like a little purse | ~2 tsp filling each | ~2 hrs | sage | stock/dish-dumplings.jpg | hero |
| mama-jollof | Mama | Jollof Rice | mom | Nigerian | let the bottom catch a little, that's the best part | ~10 min on low | ~1 hr 30 min | apricotSoft | stock/dish-jollof-rice.jpg | example |
| grandpa-rey-adobo | Grandpa Rey | Chicken Adobo | grandpa | Filipino | low and slow, till the vinegar stops biting your nose | ~40 min simmer | ~1 hr | peach | stock/dish-adobo.jpg | example |
| abuela-tamales | Abuela | Tamales | grandma | Mexican | a little handful of salt (orig. `es`: "un puñito de sal") | ~1 tsp | ~4 hrs | blush | stock/dish-tamales.jpg | example |
| abuelo-empanadas | Abuelo | Empanadas | grandpa | Argentine | twelve little pinches around the edge | ~12 folds | ~2 hrs | butter | stock/dish-empanadas.jpg | example |
| papa-dal | Papa | Dal Tadka | dad | Indian | until it smells like home, then the tadka | ~25 min | ~45 min | lemon | stock/dish-dal.jpg | example |
| nani-biryani | Nani | Chicken Biryani | grandma | Pakistani | water as salty as the sea | ~2 tbsp salt | ~3 hrs | sun | stock/dish-biryani.jpg | example |
| dziadek-pierogi | Dziadek | Potato Pierogi | grandpa | Polish | pinch it shut like you mean it | ~24 pierogi | ~2 hrs | sage | stock/dish-pierogi.jpg (cookPhoto: stock/photo-grandpa-chopping.jpg) | example |
| nonna-lasagna | Nonna | Lasagna | grandma | Italian | sauce till it coats the spoon, quanto basta | ~3 cups sauce | ~3 hrs | butter | stock/dish-lasagna.jpg | example |
| dad-shakshuka | Dad | Shakshuka | dad | Tunisian | crack the eggs into little wells | ~6 eggs | ~35 min | chartreuse | stock/dish-shakshuka.jpg | example |
| appa-kimchi-jjigae | Appa | Kimchi Jjigae | dad | Korean | kimchi old enough to be sour | ~2 cups kimchi | ~40 min | ube | stock/dish-kimchi-stew.jpg | example |
| uncle-minh-pho | Uncle Minh | Phở Bò | uncle | Vietnamese | char the onion till it's black, don't be shy | ~1 onion | ~6 hrs | peach | stock/dish-pho.jpg | example |
| nana-apple-pie | Nana | Apple Pie | grandma | American | butter as cold as your hands can stand | ~1 cup cold butter | ~2 hrs | lemon | stock/dish-apple-pie.jpg | example |
| auntie-dee-mac | Auntie Dee | Mac and Cheese | auntie | Southern US | cheese till you can't see the noodles | ~4 cups cheese | ~1 hr | sun | stock/dish-mac-and-cheese.jpg | example |
| grandpa-ken-ramen | Grandpa Ken | Shoyu Ramen | grandpa | Japanese | a splash of shoyu, taste, then one more | ~2 tbsp shoyu | ~2 hrs | limeWash | stock/dish-ramen.jpg | example |
| mom-banana-bread | Mom | Banana Bread | mom | American | bananas uglier than you'd ever eat | ~3 bananas | ~1 hr 10 min | apricotSoft | stock/dish-banana-bread.jpg | example |

Exported selections (B0 defines them so owners don't pick their own):
```ts
export const FAN = ['nonna-lasagna','dziadek-pierogi','mama-jollof','appa-kimchi-jjigae','grandpa-rey-adobo','dad-chili','grandma-dumplings']; // left→right; last = front video card
export const FAN_MOBILE = ['dziadek-pierogi','mama-jollof','appa-kimchi-jjigae','dad-chili','grandma-dumplings'];
export const SHUFFLE = ['mama-jollof','grandpa-rey-adobo','abuela-tamales'];      // The call
export const BOX = ['grandma-noodle-soup','dad-chili','auntie-lin-pancakes','grandma-pork-belly','dad-fish','grandma-dumplings']; // = real family table + the dumplings added in app-record
export const CLOUD_TOP: string[] = [/* 12 ids */];    // together with CLOUD_BOTTOM: all 21 recipes + 3 repeats,
export const CLOUD_BOTTOM: string[] = [/* 12 ids */]; // no adjacent repeats, relations alternate F/M, both rows mix app + example
```
Fan cards `dad-chili` and `dziadek-pierogi` use `face="cook"`, so two men are visibly cooking in the first deck.

### 6.3 `src/content/copy.ts`
Shape: `export const copy = { nav: {...}, hero: {...}, passDown: {...}, theCall: {...}, howItWorks: {...}, recipeBox: {...}, seeItWork: {...}, everyFamily: {...}, inTheirWords: {...}, farApart: {...}, measures: {...}, questions: {...}, finalCta: {...}, footer: {...}, meta: {...} } as const;` Every string comes from section 8 of this brief, verbatim. Strings with `{R}` / `{r}` go through `fill()`. Keys are camelCase per element (e.g. `hero.h1Before`, `hero.h1After`, `hero.sub`, `hero.beats[]`, `hero.cta`, `hero.link`). B0 owns this file. Section owners who need a change leave `// COPY-REQUEST:` in their component, and B7 merges those in Phase 2.

### 6.4 `src/content/media.ts`
- `HERO = { desktop: '/media/stock/hero-1920.mp4', mobile: '/media/stock/hero-mobile-720x1280.mp4', poster: '/media/stock/hero-poster.jpg', posterMobile: '/media/stock/hero-poster-mobile.jpg', focus: '52% 45%', alt: 'A grandmother and her granddaughter laughing as they fold dumplings together at home.' }`
- `APP_CLIPS: Record<AppClipName, { src; poster; label }>`. Each label is a one-line description of what the clip really shows (section 7.2).
- `HAND_PHONE: null | { src; width; height; screen: { left: '%'; top: '%'; width: '%'; height: '%' }; radius: string; rotate: number }`. It stays `null` until the cutout exists.
- `PHOTOS`: role → `{ src, alt }` for every `photo-*.jpg` (section 7.3).

### 6.5 `src/content/credits.ts`
`{ file, title, author, source, license, url }[]`. The asset team fills it, or B0 imports it from `public/media/stock/CREDITS.json` if that file exists. Rendered in the footer's "Photo credits" disclosure.

---

## 7. Media pipeline, assets, contracts and fallbacks (B0)

### 7.1 Scripts (`web/scripts/`)
- `media.mjs` (node + sharp + ffmpeg at `/opt/homebrew/bin/ffmpeg`). It is idempotent and skips any output that already exists unless run with `--force`.
  1. Copy the real app covers: `../data/synthetic/posters/{grandma-hand-pulled-noodle-soup,grandma-red-braised-pork,dad-sunday-chili,dad-ginger-scallion-fish,auntie-lin-scallion-pancakes}.jpg` → `public/media/app-covers/`. (1280×720 covers; cards crop them to center.)
  2. For every jpg in `public/media/{stock,app-covers}`, write WebP q78 at widths 160/320/480/640/960/1280/1920 (never upscaled) to `public/media/_opt/<dir>/<name>-<w>.webp`. `src/lib/imageLoader.ts` rounds up to the nearest generated width.
  3. For each `photo-*.jpg`, write a pre-blurred `-blur.webp` (96px wide, sharp `blur(8)`) for the a6 mobile layer.
  4. Extra app posters: `app-record-add.jpg` (frame at 9.5s, the "Add a recipe" form with "Sunday dumplings" and Grandma selected) and `app-share-end.jpg` (last frame).
  5. Check the hero loop seam: compare the first and last frames (`ffmpeg -ssim`). If the SSIM is under 0.9, write `hero-1920-loop.mp4` and `hero-mobile-loop.mp4` with a 0.6s crossfade of the tail into the head (`xfade=transition=fade:duration=0.6`), CRF 24, `-movflags +faststart`, no audio, desktop ≤ 6MB and mobile ≤ 3MB. `media.ts` points at the loop files when they exist. (There is no hard cut left in the current 14.4s file at a scene threshold of 0.08; only the loop seam needs checking.)
  6. Hero contrast: `ffmpeg -i hero-1920.mp4 -vf "crop=iw*0.66:ih*0.45:0:ih*0.55,signalstats,metadata=print:key=lavfi.signalstats.YAVG" -f null -`. If any YAVG is over 110, raise the bottom scrim stop (section 8.1).
- `swirls.mjs`: simplex-noise (scale 0.0022 on 1600×1000, 2 octaves) plus d3-contour thresholds every 0.11, filling every other band. Writes `public/patterns/swirl-{green,forest,sun,chartreuse}.svg` in the `*-swirl` token color on transparent. Bands are 40–70px wide at 1440 and ≤ 30KB each.

### 7.2 App clips (`/media/app/`, 780×1688, 30fps, all ≤ 1.3MB) and what they really show
| Clip | Length | Shows (verified frame by frame) | Used in |
|---|---|---|---|
| `app-record` | 12.8s | "Before they cook · 1 of 5" prompt cards (Play aloud / Next) → "Upload the videos" → "Add a recipe": types "Sunday dumplings", picks **Grandma**, "Choose videos". **No in-app record button.** | See it work row 01; step card 3 poster |
| `app-recipe` | 10.7s | Family table → Grandma's Hand-Pulled Noodle Soup → ingredients in the cook's words with ~estimates ("two heaping rice bowls, maybe a little more ~3 cups", "a pinch in the palm, two fingers worth · to taste", "warm like a baby's bath ~1 cup"), ticking them off | Row 02 |
| `app-cook` | 13.5s | Dad's Sunday Chili cook mode: "Brown the beef hard" with highlighted cue, **Hear Dad**, story "The first pot", "What made it special" | Row 03 |
| `app-share` | 8.8s | Grandma's Red-Braised Pork Belly; scrolls, then taps the share icon. **The current file never shows the share sheet.** | Row 04 (only after the re-record, see below) |
| `app-library` | 12.2s | "Our family table": chips Everyone / Auntie Lin / Dad / Grandma swap the hero card | Recipe box phone; row 04 fallback |
| `app-questions` | 13.7s | Dad's Sunday Chili → Method → "3 questions to ask Dad" → "Questions for Dad · worth a phone call" | Questions section phone |

**Dependency (must-fix):** re-record `app-share` from the Expo app so the **native share sheet visibly slides up** and holds for ≥ 1.5s at the end. `app/src/app/recipe/[id].tsx:135` already calls `Share.share`. Use the iOS Simulator with the status bar overridden to 9:41, light mode and slow taps, then encode with secondary spec 3.2's ffmpeg line. **Fallback if it isn't ready at integration:** row 04 plays `app-library`, its H3 becomes "Kept at the family table." with the line "Every recipe, sorted by who taught it, one tap from anyone in the family." Sharing is then carried by Far apart, which is labeled as an illustration.

### 7.3 Photos (`/media/stock/photo-*.jpg`, 1333–2000px)
At the time of writing the 16 `photo-*.jpg` files are **byte-identical placeholders** (one md5). The asset team is replacing them. **Before wiring a photo, open it and confirm it matches its filename.** If it doesn't, use the fallback listed and leave `// TODO(asset)`.

| Role | File | Used in | Fallback |
|---|---|---|---|
| Phone propped recording | photo-phone-tripod-kitchen | Step card 1 | photo-cook-recording-phone |
| Hands kneading | photo-hands-kneading | Step card 2 | photo-pinch-into-pot |
| Young adult cooking alone at night | photo-young-adult-cooking-night | Far apart left card | hero-poster crop |
| Parent smiling at phone | photo-parent-phone-call | Far apart right card | photo-family-laughing-table |
| Grandparent teaching grandchild | photo-grandma-granddaughter-woodfire | In their words star | photo-elder-hands-dumpling |
| Grandpa and grandson | photo-grandpa-grandson-breakfast | Final CTA left star | photo-grandpa-chopping |
| Abuela tortillas | photo-abuela-tortillas | Final CTA right star | photo-mom-daughter-cooking |
| Dad and son cooking | photo-dad-son-cooking | Fan card face (dad-chili), cloud tile | dish photo |
| Grandpa chopping | photo-grandpa-chopping | Fan card face (dziadek-pierogi), cloud tile | dish photo |
| Others | elder-hands-dumpling, family-dinner-table, family-laughing-table, mom-daughter-cooking, steaming-pot, pinch-into-pot, cook-recording-phone | Cloud tiles (3), spare | — |

**Hand cutout (a8):** none exists in `web/public` today. Decision: **ship the CSS soft-white phone first** (`PhoneFrame` default). If the asset team delivers `/media/stock/hand-phone.png` (transparent, straight-on iPhone, ≤ 6° tilt, screen knocked out, ~1400px tall), B0 fills `HAND_PHONE` with the measured screen rect and See it work picks it up with no code change. **Request to the asset team:** a Dad or Grandpa cooking clip (`hero-alt-dad-*.mp4`) for a future hero rotation. Until one exists, the deck, cloud, stars and Far apart photos carry gender and culture balance.

---

## 8. Sections (in page order)

Each entry gives: **id · file · owner · background**, then layout, assets, animation, copy (with character limits), static state and acceptance criteria. Desktop geometry is measured at 1440×900 and mobile at 390×844. The section ids are the DOM ids and the anchors.

### 8.0 Nav · `src/components/chrome/Nav/Nav.tsx` · **B7**
- **Desktop:** fixed, 72px tall, side padding `max(20px, 3.5vw)`. Left: pot mascot (32px) + "homecookd" (Fraunces 700, 28px). Center-right links: "How it works" (#how-it-works), "The app" (#see-it-work), "Languages" (#in-their-words), "Questions" (#questions), DM Sans 500 16px; links hide below 1100px. Right: `RelationPicker` (a native `<select>` styled as a pill: visible label "Cooking with:", options Mom / Dad / Grandma / Grandpa / Auntie / Uncle, 48px tall) and a **green** primary pill "Get early access" (48px, → #early-access). The one black pill on screen belongs to the recipe box's "Everyone" tab, so the nav never uses black.
- **Mobile:** logo, compact picker ("with Grandma ▾", still a native select with an accessible label "Cooking with"), "Early access" pill. No hamburger: everything else is reachable by scrolling and from the footer.
- **Tone:** 4.5. The hero tone is transparent with cream text and the picker in cream outline. The float tone is a canvas pill container.
- **Skip link:** first focusable element, "Skip to how it works", visible on focus.
- **Accept:** the nav never covers a heading's first line (sections use `scroll-margin-top: 88px`). The picker updates the hero word, the call card, the FAQ and the CTA live. `?for=dad` loads with Dad everywhere.

### 8.1–8.3 DeckFilm (hero → pass-down → the call) · `src/components/sections/DeckFilm/` · **B1**
One component owns all three beats, because one object travels through them. Files: `DeckFilm.tsx`, `DeckFilm.module.css`, `HeroOverlay.tsx`, `CallCard.tsx`, `timeline.ts` (pure GSAP builder), `static.tsx` (static layout). Ids: `top` (hero block), `pass-down`, `the-call`.

**Film mode** (desktop and mobile with motion OK): one `<section>` track. Desktop height = `100vh + 230vh` of pinned scroll (A: 130 units, B: 100 units). Mobile height = `100vh + 140vh` (A: 80, B: 60). A GSAP `pin: true` stage (100svh) holds these layers, bottom to top:

| z | Layer | Notes |
|---|---|---|
| 0 | Stage background `--hero-dark` | Shows only in the sheet's rounded corners |
| 1 | **Sheet**: `--canvas`, top radius 40px, `--shadow-sheet` | Starts `translateY(100%)` |
| 2 | **Deck**: the 6 non-front fan cards (`RecipeCard`) and the front card's **frame** (the tint panel, title, meta, feel pill and garnish; its photo area is empty) | |
| 3 | **Video window**: a full-stage wrapper with `clip-path: inset(...)` holding `HeroVideo` (inner element scaled) | **Always above the sheet.** It is never covered |
| 4 | Text: HeroOverlay (H1, sub, beats, CTA, link, pause), brand-line block, manifesto block | Text passes over the deck (a7 M8) |
| 5 | Chips, strike SVG, Caveat notes | |

The video wrapper's clip rect and translation are computed from the front card's **photo rect** in layouts.ts coordinates (photo = card inset 8px, top 66%), converted to px on refresh. The inner `<video>` (or the poster `<img>`) scales from 1 to `sCard` (desktop 0.42, mobile 0.55) with `transform-origin` at the faces (`HERO.focus`), so the card shows both faces and isn't a tight crop. Use a uniform scale only (no distortion).

**Timeline A: the hero becomes a recipe card** (local % of A)
| % | What happens |
|---|---|
| load | Video settles from scale 1.12 to 1 over 1.6s (`power2.out`). H1 `LetterArc variant="grow"` starts at .15s. Sub, beats, CTA and link fade up (y 16→0) at .55s with 80ms stagger |
| 0–12 | HeroOverlay moves y 0 → −18vh and fades 1 → 0 (linear). Scrim fades to 0 by 25 |
| 0–22 | Sheet translateY 100% → 0 (in-out). The video window's **bottom inset tracks the sheet's top edge exactly**, so the sheet reads as sliding over the hero (a4). At 22, remove `data-nav-tone="hero"` |
| 10–32 | Video window's left/right/top insets close to the front card's photo rect at its **stack position** (centered, x 50vw, y 60vh). Clip radius goes 0 → 18px. Inner scale goes 1 → sCard. In-out |
| 28–38 | Front card frame fades and scales in around the video (opacity 0→1, scale .96→1). On the photo, the pill "● Recording · 0:42" shows from 28–34, then crossfades to "▶ Watch" from 34–38 (recording → recipe). Title "Grandma's Sunday Dumplings", meta "by Grandma · ~2 hrs", feel pill "pleat it like a little purse" |
| 30–40 | Brand line appears as ghost text (opacity 0→1, centered at 18% vh) |
| 38–44 | The other 6 cards peek out of the stack behind the front card (`stack(i)`) |
| 44–70 | **Fan spread** (expo.out within the range; all cards move together, distance proportional to slot). The front card plus the video window travel to the fan's right end, top z. `addWordFill` on the brand line from 45 to 75; "pass down." fills to `--green` in italic |
| 72 | Chips pop once (time-based): "Grandma" (forest, over the fan's left third, rotate −6°) and "Dad" (sun, right third, +5°). Each shows typing dots for 600ms first, then wobbles |
| 74–86 | Supporting line and CTA row fade and rise into place at 86% vh |
| 86–100 | Hold. The video keeps playing inside the card the whole time |

**Timeline B: the call** (local % of B)
| % | What happens |
|---|---|
| 0–20 | a7 M8 collapse: cards → `stack()` centered at (50vw, 50vh), deck scale → .65. The brand line, supporting line, CTA and chips move y → −60vh and fade (text above the deck) |
| 12–30 | Manifesto block rises y +40vh → 0 (centered at 58% vh), all words ghost |
| 22–34 | The stack shrinks to the inline slot's rect (the slot after "how much?", 1.6em × .9em) and travels into it. From 28–34 the front face crossfades to the **call card** ("{Call} ● 0:42": a round initial avatar, the name and a green connected dot; `{Call}` = the relation label if explicit, otherwise "Mom"). Pause the hero video when the deck scale drops below .3, and resume it if the user scrolls back |
| 34–50 | The call card grows out of the sentence into a 19vw × 22vw stack hovering above line 1 (x 50vw, y 24vh, z above text; cards offset up-right, +2° each). Shuffle the front card: 40 Mama's jollof, 45 Grandpa Rey's adobo (chip "Grandpa: “low and slow”", forest, left of line 1), 50 Abuela's tamales (chip "Abuela: “un puñito”", sun, right). Each new front card slides up from below, scale .9→1 |
| 30–76 | `addWordFill` line 1 → ink, line 2 → `--green` in italic. The highlighter wipe on “A handful.” is driven by `--hl` 0→100% over 52–60. KitchenClock "Sat, 8:15 pm" fades in at 30 above line 1, left |
| 56 | The Abuela chip flips (rotateX 90°→0, 400ms, time-based) to "Abuela: “a little handful”", with "un puñito" kept small (16px) beneath |
| 76–88 | Line 3 stays ghost until 80. A hand-drawn cocoa strike draws across "never written down." (SVG path `stroke-dashoffset` scrubbed 76–84). At 80, a Caveat note "not anymore." pops above the line (cocoa, rotate −4°, time-based). From 80–88, line 3 fills ghost → `--green` |
| 88–100 | The stack tilts to +12° and drops: y +70vh, rotation back to 0. StepsToBox catches it |

**Geometry**
- Desktop fan: 7 cards, **16vw** wide (4:5). `fan(i)`: `t = i/(n−1) − .5`; `x = 50 + t·56` vw (center); `y = 60vh + 8·t²` vw (smile); `rotate = t·14 − 1`° (−8° → +6°); `scale = .88 + .48·t²`; `z = i`. Soft floor shadow: an ellipse 60vw × 4vw at 72vh, blur 30px, 12% ink.
- Mobile fan: 5 cards at **34vw**; `x = 50 + t·58`; `rotate = t·20`; y center 56svh.
- `stack(i)`: `x = −0.6·(n−1−i)` vw, `rotate = −1·(n−1−i)`°, `scale = 1 − .02·(n−1−i)`.

**Desktop layout**
- HeroOverlay: H1 bottom-left at `left: var(--gutter-hero); bottom: 7svh`, 2 lines, max 66vw. Right column at `left: 68vw; width: 26vw`, bottom-aligned to the H1's last baseline: sub (`.t-lead`, cream, 3 lines max), beats row, CTA (`hero` lg, ≥ 300px), "▶ See it work" text link (cream, underline on hover, 48px target). Pause button bottom-right (`right: 3.5vw; bottom: 7svh`).
- Scrim (three layers, olive-black):
  ```css
  background:
    linear-gradient(180deg, rgb(20 22 12/.35) 0%, rgb(20 22 12/0) 18%),
    linear-gradient(0deg, rgb(20 22 12/.72) 0%, rgb(20 22 12/.38) 38%, rgb(20 22 12/0) 64%),
    linear-gradient(90deg, rgb(20 22 12/.42) 0%, rgb(20 22 12/0) 58%);
  ```
  Mobile starts the bottom layer at .80.
- Brand line centered at 18% vh, max 70vw. Supporting line and the CTA row (green primary pill "Get early access" plus text link "How it works ↓") at 86% vh.
- Manifesto block centered at 58% vh, max 80vw, 3 lines.

**Mobile layout**
- Hero: faces in the top 40%. H1 (3 lines, `clamp(3.5rem, 15vw, 6.5rem)`), sub, beats, full-width CTA (60px) and link all fit **above the fold at 390×844**.
- Pass-down: H2 at 9vw centered at 16% svh, fan at 56%, CTA at 88%.
- The call: stack 46vw at the top 22%, text 6 lines below.

**Copy** (limits are in characters)
- Hero:
  - H1: "Cook it like {Grandma} does." (≤ 30). The relation word is Fraunces italic `WONK 1` on `Highlighter`, ink text. It rotates Grandma → Mom → Dad → Grandpa → Grandma every 2.8s (outgoing word fades in 200ms; incoming word plays LetterArc `arc` at 20ms stagger), **one cycle, then it stops**. It doesn't rotate when the relation is explicit or the user pauses. The `aria-label` stays fixed to the current word; there is no live region.
  - Sub: "Prop up a phone while they cook. homecookd turns it into a recipe your family can follow, in their words and their voice." (≤ 120)
  - Beats (one quiet row of 3 cream-outline 16px pills joined by short rules): "Set up the camera" · "Record" · "Done"
  - CTA: "Get early access" → #early-access (scrolls there and focuses the email field)
  - Link: "See it work" with a play glyph → #see-it-work
- Pass-down:
  - H2 (founder's line, verbatim): "Culture we want to preserve, and *pass down.*"
  - Sub: "Every family has a dish only one person really knows. Keep it, with them in it." (≤ 90)
  - CTA "Get early access"; link "How it works"
- The call:
  - L1: "You call home: *how much?*" [call slot]
  - L2: "“A handful.” “You'll know.”"
  - L3: "It was never written down."
  - Note: "not anymore."
  - `aria-label` on the block: "You call home: how much? “A handful.” “You'll know.” It was never written down. Not anymore."

**Static** (SSR, reduced motion, no JS): three normal-flow blocks.
1. Hero: 100svh, poster, scrim, H1 on "Grandma", all copy visible.
2. Pass-down: canvas with 40px top radius and `margin-top: -40px` over the hero (the a4 look), H2 in final colors, `CardFan layout="fan"` with the front card showing `dish-dumplings` (no video), chips, sub, CTA.
3. The call: static stack (Abuela's tamales in front, chips), 3 lines in final colors (L3 green with the strike and the note).

When film mode is on, `DeckFilm` adds `.film` to the root and CSS switches those blocks to absolutely positioned stage layers. The DOM is the same in both modes.

**Accessibility:**
- The video wrapper is `aria-hidden`; HeroVideo's `alt` goes on a `role="img"` figure in the hero block.
- The fan cards are decorative; a visually hidden `<ul>` lists "Some of the family recipes people keep in homecookd: …".
- The pause button controls the video, the relation rotation and the chip wobble.

**Acceptance**
1. Muted, at 1440×900 and 390×844, a first-time viewer reads "a family cooking together" within 3s.
2. The H1 and CTA are the biggest things on screen. Cream text passes AA on the brightest frames (7.1 step 6).
3. Scrolling slides the sheet over the video, and the **same playing video** ends up inside the front card. It is never covered by the sheet.
4. The fan matches `01-hero-final-fan.jpg` proportions: smile arc, −8° → +6°, front card top-right.
5. The deck visibly shrinks into the sentence and grows back out as a stack.
6. No text's final state is `--ghost`.
7. The pin is ≤ 230vh on desktop and ≤ 140vh on mobile, at ≥ 55fps on an M1 and ≥ 45fps on a mid-range Android.
8. clip-path on the video wrapper works in iOS Safari 17+. If `CSS.supports('clip-path', 'inset(0 round 1px)')` is false, use static mode.
9. Reduced motion shows the three static blocks.

### 8.4–8.5 StepsToBox (how it works → recipe box) · `src/components/sections/StepsToBox/` · **B2**
Ids: `how-it-works`, `recipe-box`. Files: `StepsToBox.tsx`, `.module.css`, `StepCard.tsx`, `FolderGrid.tsx` (motion-owned interactive grid), `timeline.ts`.

**Desktop:**
- `StickyStage` track **230vh**. A two-column grid: the left column (from 7.2vw to 40vw) holds two normal-flow text blocks (each `min-height: 100svh`, content vertically centered). The right stage (sticky, from 42vw to 100vw, 100svh) holds the 6-card deck, the folder panel and the phone.
- GSAP scrub trigger: `start: 'top 85%'`, `end: 'bottom bottom'`.

| % | Stage |
|---|---|
| 0–12 | The stack falls in from above (y −60vh, rotate 12° → 0) and unfurls into **stairs** (expo.out). Step cards 0–2 are **18vw × 24vw**; trailing cards 3–5 are 15vw × 19vw. Stage-relative positions (x vw, y vh): (6, 12), (20, 26), (34, 40), (46, 56), (54, 70), (60, 84). The last ones bleed off the bottom-right; z rises toward the bottom-right |
| 12–22 | H2 line *i* fills ghost → ink (line 2 → green) as card *i* lands |
| 22–48 | Hold. The pot mascot (64px) hops card 0 → 1 → 2 at 26 / 34 / 42% (a scrubbed arc, up 6vh then down, squash 1.1/.9 on landing, a steam puff). The REC pill timer on card 2 counts 0:00 → 0:42 with progress. A tiny parallax drift on the whole stair (x −2vw over the hold) |
| 48–72 | **Fold** (a7 M14): the cards move to a 3×2 grid inside the folder panel. Panel: `--surface`, radius 28, `--shadow-card`, stage-relative at left 2vw, top 18vh, width 54vw, height 66vh; it fades in from 48–60 while narrowing from 60vw → 54vw. Grid cards are 16vw × 26vh with a 1.5vw gap. Step cards 0–2 flip `rotateY(180°)` from 52–62 to their **recipe faces** (noodle soup, chili, pancakes; `backface-visibility: hidden`, two faces). Folder tabs slide down onto the panel's top edge from 64–72 |
| 72–100 | A phone (`PhoneFrame` 15vw + `AppClip app-library`, `playWhenVisible`) rises from y +50vh to rest in front of the panel's bottom-right corner (x 46vw, y 34vh; it travels 1.6× the distance for parallax). At **78%** the GSAP deck layer swaps to `FolderGrid` (identical positions, opacity crossfade 150ms) and the tabs become clickable. Below 75% it swaps back |

**FolderGrid** (motion):
- Tabs mirror the app's family-table chips: **Everyone** (`--black` pill, cream text, active), Auntie Lin, Dad, Grandma, **+ Add a recipe** (sage pill, links to #see-it-work). It is a `role="tablist"`.
- Selecting a tab filters the grid with `layout` FLIP (400ms soft ease). Cards leave with opacity and scale .9.
- Grid cards are real list items (`decorative={false}`, `showEstimate`).

**Text block 1:**
- Eyebrow "HOW IT WORKS" and KitchenClock "Sun, 10:00 am".
- H2 on 3 lines: "Set up the camera. / *Record.* / Done." The middle line is `--green`, upright (not italic).
- Body, then pill (`soft`, md) "See the real app" → #see-it-work.

**Step card faces:**
1. Sage: `photo-phone-tripod-kitchen`, numeral "1" (`.t-numeral`, white 90% over the photo's top-left), H3 "Prop up any phone.", Pill "Lean it on anything."
2. Butter: `photo-hands-kneading`, numeral "2", H3 "Record them cooking.", Pill rec "● REC 0:42", lavender moon chip "All-day dish? Record in pieces."
3. Sun: `app-record-add.jpg` cropped to the "Add a recipe" header and the dish field (a real app frame, framed as a mini screen with a 1px hairline, not a full phone), numeral "3", H3 "Add the videos. Done.", Sticker "That's / it." (size 120).

**Text block 2:**
- Eyebrow "YOUR FAMILY TABLE", KitchenClock "Sun, 6:30 pm · everyone's home".
- H2, body, and HandNote "6 recipes, 3 cooks, lots of love" (green, arrow → the folder).
- **Icon cluster:** 9 kitchen line icons in 64px white circles (`--shadow-card`) spawn as dots at scattered positions and drift into a loose cluster with ±10° rotations (motion, 40ms stagger, 600ms, once on enter).

**Mobile** (no sticky, no scrub):
1. Text block 1.
2. Three step **rows**: a 30vw square photo on the left; numeral, H3 and pill on the right; tinted panel radius 24; rows enter with `Reveal` stagger. The mascot sits still on row 3.
3. Text block 2 with the icon cluster above the H2 (6 icons).
4. Tabs, which wrap.
5. FolderGrid with **3 columns × 2 rows** of 28vw cards (RecipeCard falls to its photo + tag level).
6. No phone (app-library already appears in See it work's fallback, and the visual weight is too much here).

**Copy**
- Block 1:
  - H2 "Set up the camera. / Record. / Done."
  - Body: "No measuring, no typing, no script. They cook and talk like always; homecookd writes the steps, amounts and stories." (≤ 120)
  - Pill "See the real app"
- Block 2:
  - H2 "Every recipe, kept together." (≤ 32)
  - Body: "Sorted by who taught it, so Grandma's, Dad's and Auntie Lin's are always one tap away." (≤ 100)

**Static:** both text blocks in flow. Under block 1, `CardFan layout="stairs"` with the 3 step cards. Under block 2, FolderGrid (interactive) with tabs and the icon cluster settled. No phone.

**Accept**
1. The dropped stack from The call appears to land in the stairs (same tilt direction, no gap of more than ~0.3 viewport).
2. The H2 lines fill in sync with the cards.
3. The fold matches `11-burst-cascade-to-grid` / `12-vision-folder-grid-icons` in spirit.
4. Tabs work by keyboard (arrow keys move, Enter/Space selects) and filter exactly like the app (Dad → chili, fish; Grandma → noodle soup, pork belly, dumplings; Auntie Lin → pancakes).
5. No card shows a recipe that isn't in `BOX`.

### 8.6 See it work (the real app, in a hand) · `src/components/sections/SeeItWork/` · **B3**
Id `see-it-work`. Background: full-bleed `--green` with a section-local SVG **ribbon**, one broad (~48px) looping band in `--green-swirl` crossing behind the stage (a8). A soft chartreuse blob sits behind the phone (`filter: blur(60px)`, 30% opacity, static).

**Desktop:**
- Grid `50vw | 1fr`.
- Left: **CSS sticky** stage (top 0, 100svh, `overflow: clip`). `PhoneFrame` with `hand` (falls back to the CSS frame), width `clamp(260px, 21vw, 330px)`, top edge at 9svh, horizontal center at 25vw. Below the phone, 4 progress pills (active: 28px wide in chartreuse; others: 8px in cream at 40%).
- Right column from 55vw, max 34rem:
  - **Intro block** (min 40svh): eyebrow "THE REAL APP" (cream, last word chartreuse), H2 (`.t-h2`, cream, `WordReveal tone="cream"`), HandNote in cream "real screen recordings, straight off our phones" (arrow pointing left).
  - **4 rows**, each `min-height: 52.5svh`, content vertically centered: number pill (chartreuse, ink, 36px tall), H3 (cream), one body line (cream, 100% opacity, never dimmed), one real-app chip (cream outline, 16px).
- **Active row** comes from an IntersectionObserver at the middle line (`rootMargin: '-50% 0px -50% 0px'`). The active row's H3 and pill are at 100%; inactive ones are at 60% (passes 3:1 for large text), with a 2px chartreuse rule on the active row's left edge.
- **Clip swap:** all 4 `AppClip`s are stacked in the screen. The active one restarts at 0 and plays; the others pause. Crossfade 450ms soft ease, plus the phone settles from .985 → 1. Only the active and next clips preload.
- The phone rises 8vh on section enter (`Reveal`). No GSAP, no scrub, nothing to get stuck in.

**Rows**
| # | H3 (≤ 28) | Clip | Body (≤ 90) | Chip |
|---|---|---|---|---|
| 01 | "Add the videos." | app-record | "Five friendly prompts to read aloud first. Then pick the clips from your camera roll." | "Sunday dumplings · Grandma" |
| 02 | "Their words, made clear." | app-recipe | "“Two heaping rice bowls, maybe a little more” stays theirs. ~3 cups sits beside it." | "warm like a baby's bath · ~1 cup" |
| 03 | "Watch it. Hear them say it." | app-cook | "Every step opens their video at that exact moment, in their own voice." | "Hear Dad" (speaker icon) |
| 04 | "Keep it. Send it home." | app-share (after re-record; fallback 7.2) | "Every recipe lives at one family table, and sharing one takes a single tap." | "Our family table" |

**Mobile** (single phone + tabs, ~1.3 viewports):
1. Intro (eyebrow, H2, HandNote).
2. `PhoneFrame` at `min(62vw, 260px)`, centered.
3. Below the phone, a **2×2 grid of feature tabs** (`role="tablist"`). Each tab is ≥ 64px tall and shows its number pill and a short label: "Add videos" / "Their words" / "Watch & hear" / "Keep & share". The active tab is chartreuse with ink text; others are cream outline.
4. The active tab's body line and chip sit under the grid in a `tabpanel`.

Mobile behavior:
- Clips don't loop here. `onEnded` advances to the next tab, **one full cycle, then stop** on tab 4.
- Auto-advance starts only when the phone is ≥ 50% visible and is paused by PauseProvider (a PauseButton sits beside the tabs).
- User taps always win and stop auto-advance.

**Copy:** H2 "See it in their hands." (≤ 24). Note "real screen recordings, straight off our phones".

**Static:** the intro plus the 4 rows in flow, each with its own small phone showing the **poster** and a ▶ button (tap to play). On mobile the tabs work without motion (instant swap, no crossfade).

**Accept**
1. Every clip is a real recording, with nothing overlaid on the screen.
2. Copy matches what each clip shows (7.2).
3. The background is one green edge to edge, with no split.
4. Videos never play offscreen.
5. Only the active and next clips download.
6. The mobile section is ≤ 1.4 viewports.
7. The hand (if present) overlaps the bezel with its fingers.

### 8.7 Every family (the floating recipe cloud, a7 M15) · `src/components/sections/EveryFamily/` · **B4**
Id `every-family`. Canvas, unpinned, `min-height: 100svh` (mobile 90svh).

**Desktop:**
- **Two rows** of 12 tiles each (`CLOUD_TOP`, `CLOUD_BOTTOM`). The top row's band is 8–36% vh and the bottom row's is 64–92% vh. Rendered as `RecipeCard` at tile size (7vw, radius 20%, at the photo + tag level) with the cook tag.
- Each tile sits on a sine wave: `y = 3vw · sin(2π·i/5 + phase)`, its own tilt from −8° to +8°, and a depth scale from .85 to 1.1 (smaller tiles also get 92% saturation).
- Center: PotMascot (40px), H2 (`.t-statement`, `WordReveal`), body line.

Motion:
- **Drift:** motion values driven by `useAnimationFrame`. The top row moves left and the bottom row right, at a base of 2.5vw/s plus `min(|scrollVelocity|·0.002, 6)` vw/s in the same direction (a velocity nudge via `useVelocity(useScroll().scrollY)`). Wrap with a duplicated row (24 nodes per row, modulo the track width).
- **Enter:** tiles rise from +12vh, blur 6px → 0, top row first, 30ms stagger (one-shot).
- **Hover** (pointer: fine): that row pauses, and the tile lifts (scale 1.18, rotate → 0, y −1vw, `--shadow-float`, z top). A `Chip` (cream, tail bc) pops above it with the cook's words in `.t-cook` at 20px and the ~estimate muted beneath.
- **Tap** (touch) toggles the same state, and the row stays paused while a tile is open. Escape or a tap outside closes it.
- **H2 italic word** cycles "something" → "Nonna" → "Abuelo" → "Nai Nai" → "Papa" → "something" every 2.4s (LetterArc arc). One cycle, then it stops; PauseProvider stops it too. The `aria-label` is fixed: "Every family calls them something."

**Mobile:** tiles at 18vw, 7 visible per row, rows at 6–30% and 70–94% svh. H2 at 9.5vw. Drift kept.

**Copy**
- H2: "Every family calls them *something*." (≤ 40)
- Body: "Mom, Dad, Grandma, Grandpa, Nonna, Lolo. Every kitchen has someone worth learning from." (≤ 95)

**Accessibility:**
- Tiles are `aria-hidden` and not focusable (moving targets). A visually hidden list repeats every tile's "{cook}'s {dish}: “{feelQuote}”".
- A PauseButton (ink outline, bottom-right of the section) stops the drift.

**Static:** both rows still, `overflow-x: auto` with snap, the H2 on "something".

**Accept**
1. Reads like `13-thumbnail-cloud.jpg`, with each card a recipe and the cook tags balanced by gender (6 F / 6 M visible per row on desktop).
2. 60fps drift (only 2 row transforms per frame plus static tiles).
3. Hover reveals the cook's words.
4. Nothing is required to read the section.

### 8.8 In their words (translation, website-native) · `src/components/sections/InTheirWords/` · **B5**
Id `in-their-words`. Full-bleed `--sun` with `swirl-sun.svg`, `min-height: 100svh`, ink and forest text.

**Desktop:**
- Left column (7.2vw → 44vw): eyebrow "LANGUAGES" (forest), H2 (`.t-block` with `LetterArc arc`; italic part in forest), body (ink), and a `StarClip` (22vw, rotate −8°) with `photo-grandma-granddaughter-woodfire` bleeding off the bottom-left of the block.
- Right: the **TranslatorCard**. Cream (`--surface`), 560px wide, radius 28, padding 32, `--shadow-float`, centered at 70vw. It must read as **page UI**: no phone, no status bar, no app chrome.
- A `Sticker` with lines "COMING TO" / "THE APP" (sunOnCream, 150px, spinning) overlaps the card's top-right corner.

**TranslatorCard anatomy, top to bottom:**
1. A `role="radiogroup"` with label "Pick a language": 6 chips (48px, wrapping) showing the native name plus English: "中文 Chinese", "Español Spanish", "Tagalog", "हिन्दी Hindi", "한국어 Korean", "Italiano Italian". The selected chip is ink with cream text; the others are `--sunken`.
2. A meta row: relation chip (forest) "{cook} said" and the dish in muted 16px.
3. The **original line**, large: 36–40px, `lang` attribute set, Fraunces italic for Latin scripts and the Noto serif for CJK and Devanagari. A decorative 5-bar waveform sits beside it (`aria-hidden`).
4. A hairline and a label "You read".
5. The **English line** (DM Sans 500, 26px, ink).
6. A footer row: the rule "Their words stay on top. Always." (`.t-ui`, green) and a PauseButton (ink outline, small).

**Lines** (native-speaker check required before launch; leave `// TODO(native-check)` beside each):
| Chip | Cook (relation) | Dish | Original (`lang`) | English |
|---|---|---|---|---|
| 中文 | Grandma (grandma) | Red-Braised Pork Belly (real app) | 糖炒到像茶或蜂蜜的颜色，不要太深。 (`zh-Hans`) | Cook the sugar to the color of tea or honey, never dark. |
| Español | Abuelo (grandpa) | Empanadas | Un puñito de sal, y ya. (`es`) | A little handful of salt, and that's it. |
| Tagalog | Lolo (grandpa) | Chicken Adobo | Hanggang lumambot, mga isang oras. (`tl`) | Until it's tender, about an hour. |
| हिन्दी | Nani (grandma) | Chicken Biryani | इतना भूनो कि घी अलग हो जाए। (`hi`) | Fry it until the ghee separates. |
| 한국어 | Appa (dad) | Kimchi Jjigae | 손맛이야. (`ko`) | It's all in the hands. |
| Italiano | Nonna (grandma) | Lasagna | Sale q.b., quanto basta. (`it`) | Salt, as much as it needs. |

**Behavior**
- **Starting line:** if `navigator.language` starts with one of `zh, es, tl/fil, hi, ko, it`, start on that language (the visitor sees their own family's language first). Otherwise start on 中文 (it ties to the real app's pork belly). English is the only target language. That's a deliberate scope limit: every added target multiplies the native-speaker checks.
- **Auto-advance:** every 3.2s while ≥ 50% visible, **one cycle, then stop**. It stops permanently on any user interaction and also responds to PauseProvider. No `aria-live` on auto-advance; when the user picks a language, the English line is announced (`aria-live="polite"` region updated only on user selection).
- **Change animation:** the original line flips (rotateX 90° → 0, 400ms, perspective 600px); the English line plays `WordReveal` (stagger .04).
- **Fonts:** when the section is within one viewport, append `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@500&family=Noto+Serif+KR:wght@500&family=Noto+Serif+Devanagari:wght@500&display=swap&text=<url-encoded union of the three lines>">`.

**Mobile:**
1. Eyebrow, H2, body, then a star photo (40vw, top-right, overlapping the H2's end).
2. The card at full width (padding 24); chips wrap into 2 rows of 3.
3. The sticker shrinks to 110px and sits top-right.

**Copy**
- H2: "In their words. *In yours.*" (≤ 28)
- Body: "Grandpa explains it best in Tagalog. You read along in English, with his own words kept right on top." (≤ 110)
- Note under the card (`.t-ui`, ink): "Translation arrives during early access. Today's app works in English." (≤ 80)

**Static:** a card on 中文 (or the browser's language) and chips working with instant swaps.

**Accept**
1. Nothing about this section implies it's an app recording.
2. The "coming" sticker and note are visible without interaction.
3. The original is always above the English.
4. Every line has a `lang` attribute.
5. CJK and Devanagari glyphs load (no tofu) and the font request is under 60KB.
6. Keyboard: arrow keys move through the radio group.

### 8.9 Far apart (send it home, get one back) · `src/components/sections/FarApart/` · **B6**
Id `far-apart`. Canvas.

**Desktop:**
- `StickyStage` track **170vh**. Stage: centered H2 at the top (10% vh) with the body line beneath.
- Two photo cards, each 41vw × 58vh, radius 28, at top 30vh (left at x 7.2vw, right at 51.8vw).
- **Left card:** "Far from home." `photo-young-adult-cooking-night`. A bottom scrim (`--scrim-strong` → 0), H3 in cream, KitchenClock "Tue, 11:04 pm" (cream), cream-outline pill "For the one who's learning".
- **Right card:** "A quieter kitchen." `photo-parent-phone-call`, same treatment, pill "For the one who cooks". A PotMascot (88px) **overflows the card's top edge** (a7 M23), with Steam.

GSAP scrub (`start: 'top top'`, `end: 'bottom bottom'`); the cards rise in on a separate trigger, `top 80%` → `top top`.

| % | What happens |
|---|---|
| 0–10 | Hold |
| 10–45 | An **arc card** (`RecipeCard`, 14vw, real cover) lifts off the right card and travels a bezier to the left card's lower-right (control point 18vh above the midpoint; rotate −6° → 5°, scale .9 → 1, `--shadow-float`). Pick the recipe to match the right photo: an adult man → `dad-chili`; an older woman → `grandma-pork-belly`; otherwise `grandma-noodle-soup`. Its caption pill reads "from {cook}" |
| 45 | Chip "Delivered ✓" (green) pops on the left card (time-based) |
| 50–80 | A **reply bubble** (cream Chip with a 64px thumbnail of the same dish's cover and a camera icon) arcs back left → right. Text: "First try!! The whole hallway came by." with a 16px time "11:52 pm" |
| 80 | On the right card, the reply "Next time, one more shake ♥" pops in `.t-cook` (the heart in tomato), then the chip "Delivered · {R} ♥" (tomato tint, ink text) |
| 80–100 | The **share dock** (a7 M18) grows from the center beneath the cards (at 90% vh, overlapping the cards' bottom edge, z above): message, mail, link, QR and family-group glyphs in 56px cream circles, with the PotMascot app icon (88px, green rounded square) in the center. Center first, 50ms ring stagger, time-based |

**Mobile** (no sticky): H2, body, then **two portrait cards side by side** (44vw × 62vw each, gap 4vw), with H3 and pills *below* each photo (on canvas, so the photo needs no blur). The arc card animates across on enter (1.2s), then the reply comes back (1.0s, .6s delay), then the chips pop and the dock appears below. Everything is time-based and fires once at ≥ 50% visible.

**Copy**
- H2 (`.t-statement`, `WordReveal`): "Send it home. *Get one back.*" (≤ 32)
- Body: "Far apart, same recipe. One tap sends it to whoever's hungry, and a first-try photo finds its way back." (≤ 110)
- Labels: "Far from home." / "A quieter kitchen."
- Dock (visually hidden text): "Share a recipe by message, email, link, QR code or the family group."
- Footnote under the dock (`.t-ui`, muted): "Illustration. Sharing in the app uses your phone's share sheet."

**Static:** final positions: the arc card resting on the left card, the reply on the right card, both chips, the dock visible.

**Accept**
1. Both audiences are named and pictured.
2. Sharing is visible as a send and a reply.
3. The dock uses generic glyphs only (no third-party logos).
4. Men and non-East-Asian families are visible (check the photos).
5. The stage holds ≤ 70vh of scroll.

### 8.10 Measures (the chartreuse band, a7 M21–M22) · `src/components/sections/Measures/` · **B4**
Id `measures`. Canvas section with an **inset panel**: 85.5vw wide (mobile `calc(100vw − 32px)`), radius 32, `--chartreuse` with `swirl-chartreuse.svg`, height 78vh (mobile 70svh), centered.

**Layout and content:**
- **Marquee** (`Marquee`, 50s, left, `.t-marquee` = Fraunces 500 at `--fs-marquee`, ink) near the top. Each phrase may carry a 16px DM Sans caption beneath it (its ~estimate or English). Phrases, separated by a 0.6em sun ✿ glyph:
  - "a handful, only the green part"
  - "warm like a baby's bath"
  - "three coins, this thick"
  - "un puñito" (caption "a little handful")
  - "the color of tea or honey"
  - "you'll know"
  - "适量" (caption "as much as feels right")
  - "quanto basta" (caption "as much as it needs")
- Below the marquee, left-aligned in the panel: H2 (`.t-h2`, ink) and the body line.
- **Physics drop** (M22, fake): 12 ingredient stickers, owned by B4 under `Measures/stickers/` (flat SVG illustrations in white 5vw circles: garlic, chili, star anise, scallion, lemon, egg, bay leaf, ginger, dumpling, peppercorn, tomato, cinnamon stick). When the panel's top reaches 40% vh, they spawn in a stream 80ms apart near the top-left under the marquee and fall to a **precomputed** pile along the panel's bottom edge (motion spring, `bounce: .35`; x drift ±4vw; rotate −120° to 120°). The PotMascot (`mood="happy"`) drops last and lands on top, with a cream Chip "you've got this!" (from the app). Plays once.
- **Mobile:** 8 stickers at 14vw, marquee at 11vw.

**Copy**
- H2: "Their handful. Your ~½ cup." (≤ 28)
- Body: "We never replace their words. We just add the ~." (≤ 60)

**Static:** the marquee doesn't move (scrollable), and the pile is rendered at its final positions.

**Accept**
1. Looks like `18-pricing-fan-lime-marquee.jpg` and `19-burst-physics-icons` in spirit.
2. The drop is deterministic and plays only once.
3. A PauseButton stops the marquee.
4. Ink on chartreuse (10.99:1).

### 8.11 Questions · `src/components/sections/Questions/` · **B3**
Id `questions`. Canvas, `min-height: 85svh`.

**Desktop:**
- Grid 5/7. The left column holds H2 (`.t-h2`, `WordReveal`), a HandNote (cocoa) and, below it, `PhoneFrame` at 240px with `AppClip app-questions playWhenVisible`, captioned (`.t-ui`, muted) "homecookd asks a few too."
- The right column holds the accordion: native `<details>`/`<summary>`, 64px rows, 20px question text (DM Sans 600), 18–20px answers, hairline dividers, and a chevron that rotates 180° (motion height animation optional, CSS fallback).

**Mobile:** H2, note, accordion. No phone.

**Copy** (`{R}` comes from the relation):
- H2 "Good questions." Note "better answers than “you'll know,” promise".

| Q (≤ 50) | A (≤ 200) |
|---|---|
| Does {R} need to download anything? | No. Someone in the family props up any phone and records, and {R} just cooks and talks like always. You add the videos in homecookd afterward. |
| Do they have to speak English? | No. They talk the way they always do. Translation arrives during early access, and their own words always stay on top. |
| What if the dish takes all day? | Record in pieces. Stop for the overnight soak, record again in the morning, and add every video to the same recipe. |
| How does homecookd write the recipe? | It watches and listens to the videos with AI, then writes the steps, the amounts in the cook's own words with a ~ estimate, and the stories they told along the way. |
| Who can see our recipes? | Your family. You choose who you send a recipe to. |
| How much does it cost? | It's free during early access. |

**Accept:** works without JS, every summary is ≥ 48px tall, and the AI mention appears once on the whole page (here).

### 8.12 Final CTA (forest block) · `src/components/sections/FinalCta/` · **B5**
Id `early-access`. Full-bleed `--forest` with `swirl-forest.svg`, `min-height: 100svh`.

**Desktop:**
- Two `StarClip`s, 25vw each, bleeding 2vw off the edges and vertically centered:
  - Left: `photo-grandpa-grandson-breakfast`, rotate −8°.
  - Right: `photo-abuela-tortillas` with `ring="sun"`, rotate +12°.
  - Enter: scale .6 → 1, −20° → final, 900ms expo, after the H2.
- Center column, max 760px, in order:
  1. KitchenClock (chartreuse) "This Sunday, 10:00 am?"
  2. H2 (`.t-block`, cream, `LetterArc arc`; italic phrase in chartreuse)
  3. Body (cream, `.t-lead`)
  4. **Form row:** a visible label "Your email" (cream 16px), an input (60px, `--surface`, radius pill, 20px text) and a `hero` Button lg "Get early access"
  5. `outlineCream` Button md "Send this to {R}"
  6. Reassurance pills (cream outline, 16px): "Any phone" · "No typing for the cook" · "Free in early access"
- A `Sticker` with lines "FREE" / "EARLY ACCESS" (chartreuseOnForest, 160px) sits at the top-right of the form.
- A Caveat note (chartreuse) "they'll love being asked." with an arrow toward the share button.

**Mobile:** stars at 36vw in the top corners (partly offscreen), then the column at full width with buttons and input full width, the sticker at 110px.

**Form behavior:**
- If `process.env.NEXT_PUBLIC_EARLY_ACCESS_URL` is set, POST `email` (form-urlencoded) with fetch; otherwise skip the request.
- Either way, show the thank-you state in place, announced through `role="status"`: "You're on the list. Now go call {R}."
- Nothing is stored locally. Validate with `type="email" required`; the error text sits under the input in cream.

**Share behavior:**
- `navigator.share({ title: 'homecookd', text, url })`. The text: "{R}, will you teach me your best dish this Sunday? You just cook and talk like always. I'll keep the recipe in your voice." The url: `location.origin + '/?for=' + r`.
- Fallback: copy to the clipboard, show "Copied. Paste it to {R}.", and offer `sms:?&body=` and `mailto:?subject=&body=` links.

**Copy**
- H2: "Ask {them|R} to *teach you.*" Uses the relation label when explicit, otherwise "them". (≤ 32)
- Body: "Teaching is how they say I love you. Asking is how you say it back." (≤ 75)

**Static:** all visible; stars at their final rotation.

**Accept**
1. Cream on forest passes (10.56:1).
2. Chartreuse focus rings are visible on forest.
3. Native share opens on iOS and Android.
4. The thank-you state works without an endpoint.

### 8.13 Footer (a3 Savor) · `src/components/sections/Footer/` + `src/components/primitives/FooterWordmark.tsx` · **B7**
Id `footer`. `--footer-bg`, `min-height: 90svh`, padding 112px top / `max(20px, 2.8vw)` sides / 48px bottom.

**Layout:**
- **Top row** (12-column grid):
  - Two link columns (DM Sans 18px, 28px rows): "How it works · The app · Languages · Questions" and "Back to top · Contact" (`mailto:` from `NEXT_PUBLIC_CONTACT_EMAIL`, hidden if unset).
  - A right block from col 8: the prompt (30px DM Sans 400, ≤ 3 lines) and a `primary` lg Button with `rule`, label "Get —— early access" → #early-access.
- **Wordmark:** 180px below. "homecookd" in lowercase Fraunces 800, `SOFT 100, opsz 144`, `--green`, `line-height .8`, `letter-spacing −.01em`, fit edge to edge: measure on `document.fonts.ready` and set `font-size = targetWidth / (measuredWidth / currentFontSize)`, re-fitting on resize.
- **Legal row:** 60px below the wordmark, 16px, `--muted`: a "Photo credits" `<details>` (from credits.ts), "App clips are real screen recordings. Other recipes and families on this page are illustrations.", "© 2026 homecookd".
- **Chartreuse strip:** 14px tall, full-bleed, at the very bottom.

**The a3 animation (exact):**
- One span per letter. Each span has `-webkit-text-stroke: var(--erode) var(--footer-bg)` and `paint-order: normal` (stroke paints over fill). z-index descends left → right so a later letter's stroke never bites a finished neighbor.
- The hidden state applies only under `html[data-motion="on"]`: `--erode: .26em`.
- Tween with GSAP `fromTo(letters, {'--erode': fs*.26 + 'px'}, {'--erode': '0px', duration: 1.0, ease: 'power2.inOut', stagger: 0.14})`, once, when the wordmark's top reaches 85% of the viewport. Thick stems and bowls show first as slivers; hairlines, joins and serifs arrive last; the sweep runs left → right; total ≈ 1.7s.
- At the end, remove the stroke property (a class) so no 0-width hairline remains.
- After the last letter, three Steam squiggles rise once from above the final "e" (2s), then stop.
- **Safari check:** if text-stroke shows artifacts, switch to the per-letter SVG `<mask>` version (secondary spec 5.3) behind the same props. **Reduced motion and no JS:** the finished wordmark.

**Copy:** prompt "Hungry for home? Get early access and cook with them first." (≤ 70)

**Accept**
1. Side by side with `a3-savor-footer.mp4`: the same grow-from-thickest-strokes look, left → right, about 1.7s, played once.
2. The wordmark spans the content width within ±1%.
3. No pattern sits behind the wordmark.

---

## 9. Global page structure

### 9.1 `src/app/page.tsx` (server component, B0)
```tsx
<SkipLink href="#how-it-works" />
<Nav />
<main id="main">
  <DeckFilm />        {/* #top, #pass-down, #the-call */}
  <StepsToBox />      {/* #how-it-works, #recipe-box */}
  <SeeItWork />       {/* #see-it-work */}
  <EveryFamily />     {/* #every-family */}
  <InTheirWords />    {/* #in-their-words */}
  <FarApart />        {/* #far-apart */}
  <Measures />        {/* #measures */}
  <Questions />       {/* #questions */}
  <FinalCta />        {/* #early-access */}
</main>
<Footer />            {/* #footer */}
```
B0 creates every section file as a **stub** with its final id, background color and approximate final height (so anchors and neighboring scenes behave), then hands ownership over. `src/app/layout.tsx` sets up the providers in this order: `MotionProvider > PauseProvider > RelationProvider > LenisProvider`. It also applies the font variables to `<html lang="en">`, includes the motion-gating script, sets `body { background: var(--canvas); overflow-x: clip }` and adds `scroll-margin-top: 88px` to sections.

### 9.2 SEO and metadata (B0 in `layout.tsx`, B7 for the OG image)
- `title`: "homecookd: cook it like Grandma does" (≤ 60)
- `description`: "Prop up a phone while they cook. homecookd turns it into a recipe your family can follow, in their words and their voice. Free in early access." (≤ 160)
- `metadataBase` from `NEXT_PUBLIC_SITE_URL`. `openGraph` (type website, siteName homecookd) and `twitter: summary_large_image`. `themeColor: '#F7F7F2'`, `robots: index, follow`, `alternates.canonical: '/'`.
- `src/app/opengraph-image.tsx` (B7): 1200×630 `ImageResponse`, statically generated. The hero poster on the left 60% under the olive scrim, "Cook it like *Grandma* does." in Fraunces (fetch the font file in the route at build), and the pot mascot plus "homecookd" in the bottom-right on canvas.
- Favicon: `src/app/icon.svg` (the pot mascot on transparent) and `src/app/apple-icon.png` (180×180, mascot on `--canvas`). Both B0.
- JSON-LD: `Organization` (name, url) only. No ratings.

---

## 10. Scroll budget

| Section | Desktop (document vh) | Mobile (≈ vh) | Pinned or sticky? |
|---|---|---|---|
| DeckFilm | 100 + 230 | 100 + 140 | GSAP pin (one track, two beats) |
| StepsToBox | 230 | ~180 | CSS sticky + scrub (desktop only) |
| See it work | ~250 | ~130 | CSS sticky phone, native scroll (desktop only) |
| Every family | 100 | 90 | — |
| In their words | 100 | ~120 | — |
| Far apart | 170 | ~110 | CSS sticky + scrub (desktop only) |
| Measures | 90 | 75 | — |
| Questions | 85 | ~90 | — |
| Final CTA | 100 | ~110 | — |
| Footer | 90 | ~85 | — |
| **Total** | **≈ 15.5 viewports** | **≈ 12 viewports** | 1 GSAP pin; 3 sticky stages |

Mobile is longer than the judges' "about 10" because columns stack. It stays well under the proposals' 13–18 thanks to the single-phone tab pattern, side-by-side Far apart cards and step rows. Nobody is ever trapped: the hero's "See it work" link and the nav anchors skip any scene, and no scene blocks scrolling. **Rule for builders:** a section may not exceed its row in this table. If yours needs more, cut cards first, then distance.

---

## 11. Performance budget

| Item | Budget |
|---|---|
| LCP (4G, Moto G-class) | < 2.5s. The LCP element is the hero poster `<img fetchpriority="high">` (desktop ≤ 200KB, mobile ≤ 120KB WebP) |
| CLS / INP | < 0.05 / < 200ms |
| First-load JS (gzip) | ≤ 190KB total: Next + React ≈ 95, GSAP + ScrollTrigger ≈ 45, motion ≈ 35 (use `LazyMotion` + `domAnimation` with `m.` components where possible), Lenis ≈ 4. Sections below the fold load with `next/dynamic` (`ssr: true`) so their JS splits |
| Fonts | Fraunces variable (latin + latin-ext, both styles) ≈ 160KB; DM Sans ≈ 45KB; Caveat ≈ 25KB (`preload: false`). Noto subsets ≤ 60KB, loaded on demand |
| Hero video | Desktop ≤ 6MB, mobile ≤ 3MB, `preload="metadata"`, starts after the poster paints. Never loaded under reduced motion or `Save-Data` (poster only) |
| App clips | ≤ 1.3MB each, `preload="none"`, only the active and next clips get `auto` |
| Images | Deck and cards 640w WebP ≤ 60KB; tiles 320w ≤ 25KB; photos 1280w ≤ 180KB. Preload only the hero poster and the 7 fan images |
| Runtime | Animate only transform, opacity, color, clip-path and CSS vars. Blur only in one-shot enters on ≤ 20 elements, then `filter: none`. Set `will-change` only while a scene is active. Nothing per-frame except the 2 cloud rows and ScrollTrigger. Pause every video and loop offscreen |
| Targets | Lighthouse mobile: Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95. 60fps on desktop and ≥ 45fps on a mid-range Android in DeckFilm. If a scene drops below that, cut its card count first |

---

## 12. Accessibility checklist (every builder, B7 verifies)
- [ ] SSR/no-JS shows every section's final, readable layout. Hidden states exist only under `data-motion="on"`, with the 4s safety fallback.
- [ ] Reduced motion: no pins, no autoplay, no rotation, no drift, no erosion; posters with ▶ buttons.
- [ ] One `<h1>` (the hero). Section headings in order (H2 per section, H3 inside). Split-text headings carry `aria-label` with `aria-hidden` spans.
- [ ] Contrast: AA everywhere, using palette-type.md section 3 pairs only. Hero text is checked on the brightest frames. `--ghost` is never a final state. No `--muted` on green or forest; no cream on chartreuse, sun or highlighter.
- [ ] Body ≥ 18px on mobile and 20px on desktop; UI ≥ 16px. Text under 16px only inside decorative (`aria-hidden`) cards, with the same content in an accessible list.
- [ ] Tap targets ≥ 48px; CTAs 60–68px; form input 60px.
- [ ] Visible focus: 3px `--leaf` ring (chartreuse on dark blocks) with a 3px offset, on every interactive element, including the picker, tabs, chips that are buttons and summaries.
- [ ] Keyboard: tablists and radiogroups use arrow keys. The cloud tiles and decorative pills aren't focusable. The skip link works.
- [ ] Pause controls (4.3) for the hero video, rotation, cloud, translator, marquee and mobile app tabs. Every auto-advance stops after one cycle. No `aria-live` on auto changes.
- [ ] Videos have posters, `aria-label`s that describe what the recording shows, and no sound.
- [ ] `lang` on every non-English line; Spanish and Italian use latin-ext glyphs from Fraunces.
- [ ] Alt text on every meaningful photo; decorative tiles are `alt=""` / `aria-hidden`.
- [ ] Every form field has a visible label; errors are text, not color only; the success message uses `role="status"`.
- [ ] Nothing requires hover or a gesture; every hover reveal also works on tap or focus.
- [ ] Zoom to 200% doesn't break layouts (no fixed-height text containers; pinned stages fall back to static under `max-height: 600px`).

---

## 13. File ownership and phases

### Phase 0: Foundation (**B0**, blocking; deliver in two drops)
**Drop 1 (others can start on this):**
1. Scaffold `web/` with `create-next-app@latest` in a scratch directory (`--ts --app --src-dir --eslint --no-tailwind --import-alias "@/*"`). Move it into `web/` **without touching `web/public/media/`**. `.claude/launch.json` already has a "lander" config (`npm run dev -- --port 3000`).
2. `next.config.ts`: `output: 'export'` and an `images` custom loader with the sizes from section 2.
3. `package.json` scripts: `dev`, `build`, `lint`, `typecheck`, `media` (`node scripts/media.mjs`), `swirls`.
4. `src/styles/{tokens,globals,type}.css`, `src/app/fonts.ts`, `src/app/layout.tsx` (the gating script, providers, metadata), `src/app/page.tsx` and all section stubs.
5. `src/content/{types,recipes,copy,media,credits}.ts` (complete).
6. `src/lib/{relation,share,imageLoader}.ts` and `src/lib/motion/{gsap,tokens,media,wordFill}.ts`, `src/lib/deck/layouts.ts`.
7. All providers.
8. Every primitive in section 5 except FooterWordmark, **with final props and a working basic implementation**.

**Drop 2:**
1. Run `scripts/media.mjs` and `scripts/swirls.mjs` and commit their outputs: `public/media/_opt/`, `public/media/app-covers/`, the extra posters and `public/patterns/`.
2. `icon.svg` and `apple-icon.png`.
3. Polish the primitives (springs, container queries, PhoneFrame hand mode).
4. Write a usage example for each primitive at the top of its file.

### Phase 1: Sections in parallel (each builder edits only the files they own)
| Builder | Owns (create and edit) | May import (read-only) |
|---|---|---|
| **B1** DeckFilm | `src/components/sections/DeckFilm/**` | everything shared |
| **B2** StepsToBox | `src/components/sections/StepsToBox/**` | ″ |
| **B3** SeeItWork + Questions | `src/components/sections/SeeItWork/**`, `src/components/sections/Questions/**` | ″ |
| **B4** EveryFamily + Measures | `src/components/sections/EveryFamily/**`, `src/components/sections/Measures/**` (incl. `Measures/stickers/`) | ″ |
| **B5** InTheirWords + FinalCta | `src/components/sections/InTheirWords/**`, `src/components/sections/FinalCta/**` | ″ |
| **B6** FarApart | `src/components/sections/FarApart/**` | ″ |
| **B7** Chrome, footer, SEO, QA | `src/components/chrome/**` (Nav, RelationPicker, SkipLink), `src/components/sections/Footer/**`, `src/components/primitives/FooterWordmark.tsx`, `src/app/opengraph-image.tsx` | ″ |
| **B0** (continues) | All shared files: `src/styles/**`, `src/app/{layout,page,fonts}.*`, `src/content/**`, `src/lib/**`, `src/components/{primitives,motion,providers,icons}/**` (except FooterWordmark), `scripts/**`, `public/**`, `package.json`, `next.config.ts` | — |

**Rules**
- **Don't edit files you don't own.** If you need a change to a shared file, wrap or copy the primitive locally inside your folder and leave `// PRIMITIVE-REQUEST: <what and why>` (or `// COPY-REQUEST:`). B0 or B7 merges these.
- New dependencies go through B0. Section folders hold only `.tsx`, `.ts`, `.module.css` and SVG.
- Every builder, before finishing:
  - `npm run typecheck && npm run lint && npm run build` pass (static export to `web/out`).
  - Check at 1440×900, 1024×768, 390×844 and with reduced motion emulated, in the "lander" preview.
  - Confirm the section's acceptance criteria in this brief.
  - Confirm the section stays within its row of the scroll budget.

### Phase 2: Integration and QA (**B7**, with B0 for shared fixes)
1. Merge the PRIMITIVE-REQUEST and COPY-REQUEST comments.
2. Check the seams between scenes, especially DeckFilm → StepsToBox: the dropped stack should land.
3. Run the section 12 checklist and Lighthouse mobile/desktop.
4. Test iOS Safari: clip-path on video, the footer text-stroke, sticky inside the pinned track, `svh` units.
5. Final copy pass against banned words. No cannabis or Gordon content anywhere (grep for "weed", "Miles", "Gordon").

---

## 14. Open items for the founder and the asset team
1. **app-share re-record** showing the native share sheet (7.2). It blocks row 04's preferred version.
2. **Translation in the app:** the lander shows it as website UI with a "coming to the app" seal, because `CLAUDE.md` scopes the hackathon app to English. Should we add a minimal "original / English" toggle to the app's quote line and record it? If yes, row 02 or a 5th row can show it for real.
3. **Real photos:** the 16 `photo-*.jpg` files are currently identical placeholders. The roles are in 7.3. We still need a **Dad or Grandpa hero clip** for rotation, and a hand-holding-phone cutout (optional; the CSS frame ships).
4. **Native-speaker checks** for the 6 translator lines and the 3 marquee phrases in other languages.
5. **Early-access endpoint** (`NEXT_PUBLIC_EARLY_ACCESS_URL`), contact email and the production URL (`NEXT_PUBLIC_SITE_URL`).
6. **Photo credits** for every stock file (`credits.ts`).

# homecookd brand handoff (v1, Oct 29 2026)

For: Claude Code (or any engineer) rolling the new homecookd identity into the website (`web/`) & the iPhone app (`app/`). Everything you need is in this folder. Do not redraw, recolor or re-space the logo; use the files as they are.

Design source: the "homecookd egg logo" canvas (https://claude.ai/artifact/FmEPT2NC3mLL7ChBcWXRJ3). The files here are the source of truth if the two ever disagree.

## 1. What changed

- The company is **homecookd** (lowercase, always one word). It was "Edible". The old pot logo & pot mascot are retired.
- The new mark is a **smiling fried egg** (the "I made it!" face). It is the logo & the mascot at once. Four more moods exist for in-app moments (section 6).
- The style rules: very round, two main colors (white & yolk) with a dark ink outline, only a few shapes.

## 2. Decisions & defaults to confirm

These were set as defaults. If Caleb changes one, change it in `tokens/` & re-export; nothing else needs redesigning.

- **Yolk color:** `#F2A23A`.
- **Fonts:** Fraunces (headings & wordmark) + DM Sans (body & UI). Caveat stays for the cook's handwritten notes only. This replaces Newsreader in the app.

## 3. Files

```
svg/
  mark.svg                    main logo, use at 64px & up
  mark-small.svg              thicker lines, no shine: 24–63px
  mark-tiny.svg               no face: 23px & below (favicons)
  mark-mono.svg               one-color (ink + white), for print/engraving/stamps
  mark-reversed.svg           for dark backgrounds
  wordmark.svg                "homecookd" outlined (no font needed), ink
  wordmark-cream.svg          same, cream, for dark backgrounds
  lockup-horizontal.svg       mark + wordmark, default lockup
  lockup-horizontal-reversed.svg
  lockup-stacked.svg          mark above wordmark, for square spaces
  mascot/hello.svg, listening.svg, made-it.svg, sleepy.svg, oops.svg
png/app/
  icon-1024.png               iOS / Expo app icon (opaque, square; the OS rounds corners)
  adaptive-icon-foreground.png  Android adaptive foreground (transparent, safe-zone sized)
  splash-icon.png             Expo splash image (transparent)
png/web/
  favicon.ico (16/32/48), favicon.svg, favicon-16.png, favicon-32.png
  apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png
  og-image.png (1200×630)
tokens/
  tokens.css                  CSS custom properties, light + dark
  tokens.json                 same values for the app / any build step
```

## 4. Color

| Token | Hex | Use |
|---|---|---|
| yolk | `#F2A23A` | Yolk, accent fills, app icon background, highlights. Not for small text on light backgrounds. |
| yolk-deep | `#A3580C` | Accent **text** & links on cream or white (4.9:1). |
| ink | `#1F2430` | Outlines, body text, primary buttons. |
| cream | `#FBF5EA` | Page background. |
| white | `#FFFFFF` | Cards, the egg white. |
| muted | `#5B554E` | Secondary text (6.8:1 on cream). |
| line | `#E6DDCF` | Hairlines & card borders. |

Dark mode (the app has one): background `#15181F`, surface `#1F2430`, text cream, muted `#C9C1B4`, borders `#343A48`. Yolk works as text on dark (8.5:1). Primary buttons flip to a yolk background with ink text. Use `mark-reversed.svg` / `lockup-horizontal-reversed.svg` on dark. All values are in `tokens/`.

## 5. Type

- **Display / headings: Fraunces**, weight 600–650, variation axes `SOFT 100` & `opsz 144` (that's what gives it the soft, round look), letter-spacing −0.02em. Use sentence case.
- **Body & UI: DM Sans**, 400 for body, 500–600 for labels & buttons.
- **Handwriting: Caveat**, only for things the cook "wrote" (quotes, feel amounts). Never for UI.
- **Wordmark:** always use `wordmark.svg` or a lockup file, never live text, so it renders identically everywhere.

Web (Next.js), load with `next/font/google`:

```ts
import { Fraunces, DM_Sans, Caveat } from "next/font/google";
export const fraunces = Fraunces({ subsets: ["latin"], axes: ["SOFT", "opsz"], variable: "--hc-font-display", display: "swap" });
export const dmSans = DM_Sans({ subsets: ["latin"], variable: "--hc-font-body", display: "swap" });
export const caveat = Caveat({ subsets: ["latin"], variable: "--hc-font-hand", display: "swap" });
// headings: font-variation-settings: "SOFT" 100, "opsz" 144; font-weight: 650;
```

App (Expo): `@expo-google-fonts/fraunces`, `@expo-google-fonts/dm-sans` & `@expo-google-fonts/caveat`. Those packages ship static weights without the SOFT axis, so app headings will look slightly sharper than the web. That's acceptable for v1. If it bothers us later, bundle the variable Fraunces file & set the axes.

## 6. Logo & mascot usage

**Pick the file by rendered size:** 64px & up → `mark.svg`; 24–63px → `mark-small.svg`; 23px & under → `mark-tiny.svg`. The small files are drawn with thicker lines on purpose; don't scale `mark.svg` down instead.

**Clear space:** keep empty space around the mark equal to 25% of its width. **Minimum size:** 16px for the mark, 96px wide for the horizontal lockup.

**Backgrounds:** cream, white or yolk → normal files. Ink or dark → reversed files. Never on photos without a solid tile behind it.

**Don't:** recolor the yolk per page, add shadows/gradients/glows, stretch it, rotate it, put a different face on the logo, outline the wordmark, or type "homecookd" in another font.

**Mascot moods** (the logo is "made-it"):

| File | Use it for |
|---|---|
| `made-it.svg` | The logo. Also success moments: "I made it", recipe published, first dish cooked. |
| `hello.svg` | Greetings: home screen header, onboarding, welcome emails. |
| `listening.svg` | While the cook's voice is playing (Hear the cook, voice notes). |
| `sleepy.svg` | Empty states: no recipes yet, nothing in this tab. |
| `oops.svg` | Errors: upload failed, offline, something went wrong. |

One mascot per screen, at most. The mascot never speaks for the cook; it reacts.

## 7. Website checklist (`web/`, Next.js static export on Vercel)

1. Copy `tokens/tokens.css` into the global styles & map existing color/font variables onto the `--hc-*` tokens. Remove the old palette values once nothing references them.
2. Load fonts as in section 5 & apply the variables on `<html>`.
3. Icons via Next's file conventions in the `app/` directory: `favicon.ico`, `icon.svg` (use `png/web/favicon.svg`) & `apple-icon.png` (use `apple-touch-icon.png`). Put `icon-192.png`, `icon-512.png` & `icon-maskable-512.png` in `public/` & reference them from a web manifest (`purpose: "maskable"` on the maskable one). Set `theme_color` & `background_color` to `#FBF5EA`.
4. Social card: the lander currently generates a dynamic OG image. Either update its template to the new lockup, cream background & the "Cook it like Grandma does." line, or replace it with `png/web/og-image.png`. Keep the `?for=<relation>` personalization if the dynamic route supports it.
5. Header/nav & footer: replace the old logo with `lockup-horizontal.svg` (mark alone on narrow phones below ~360px). Inline the SVG or use `<img>` with `alt="homecookd"`.
6. Replace every pot illustration with the matching mascot mood (section 6). Search the codebase for the pot asset names & any `pot` components.
7. Rename user-facing "Edible" to "homecookd": page titles, metadata, alt text, copy, share text, email templates. Search case-insensitively for `edible`. **Don't** rename the Vercel project, env vars, bucket names or repo paths without asking Caleb; those are infrastructure, not branding.
8. Check: no text in yolk on light backgrounds (use yolk-deep), focus rings visible, every tap target ≥ 48px, the site works at 360px wide, dark mode uses the reversed logo.

## 8. App checklist (`app/`, Expo)

1. `app.json`/`app.config`: `name` → "homecookd"; `icon` → `png/app/icon-1024.png`; `splash.image` → `png/app/splash-icon.png` with `backgroundColor: "#FBF5EA"` (dark: `"#15181F"`); Android `adaptiveIcon.foregroundImage` → `adaptive-icon-foreground.png` with `backgroundColor: "#F2A23A"`. Check whether `slug`/`scheme`/bundle IDs should change before touching them; ask Caleb.
2. Theme: load `tokens/tokens.json` into the existing theme object for light & dark.
3. Fonts: swap Newsreader → Fraunces for headings; DM Sans & Caveat stay.
4. Replace the pot mascot & illustrations with the mascot SVGs (`react-native-svg`), following the table in section 6: home greeting → hello, Hear the cook sheet → listening, cook-mode "Done" → made-it, empty family table → sleepy, failed upload card → oops.
5. Rename "Edible" in all user-facing strings, including the share-sheet text ("… from our family table").

## 9. Done when

- No pot artwork & no user-facing "Edible" remain in `web/` or `app/`.
- Favicon, home-screen icon & social card show the egg on a real device / link preview.
- Light & dark both use the right logo files & pass contrast.
- The logo files in the repo are byte-identical to this folder's.

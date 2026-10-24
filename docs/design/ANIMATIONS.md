# homecookd motion spec (from Caleb's reference recording, Oct 15)

Source: `~/Desktop/Screen Recording 2026-10-15 at 9.10.49 PM.mov` (18 s, a Luma iOS clip viewed on
Mobbin). Frame sheets: `docs/design/animation-ref/` (timestamps are seconds into the recording).
Copy the *motion*, not Luma's look: every animation uses homecookd's colors, type and shapes from the
Hearth bible (`docs/design/hearth-bible/`).

Motion rules for the whole app: fast in, gentle settle, never bouncy-cartoonish. Use springs for
anything the finger touches, timing curves for things that appear on their own. Respect Reduce
Motion (`AccessibilityInfo.isReduceMotionEnabled` / `useReducedMotion` in Reanimated): replace
movement with plain fades of <= 150 ms.

## 1. Launch: sparkle bloom, then reveal (sheet 1, 1.9 s to 3.3 s)
What happens: a white screen; a small gradient four-point sparkle appears at the centre (2.0 s), blooms
outward with a soft radial glow for ~0.25 s (2.1 to 2.3 s), holds, then shrinks back to a small
crisp sparkle (2.8 s). At 3.0 s the sparkle grows huge (fills the screen as a mask), and the home
screen is revealed through a pink-tinted wipe that clears within ~0.15 s (3.1 to 3.2 s).
homecookd version:
- Background `#F7F7F2`. The mark is homecookd's pot mascot (or a four-point sparkle in green `#5B6F00`
  to sun `#FEBE29` gradient). Steam curls draw in while it blooms.
- Timeline (total ~1.2 s, then hand off to the first screen):
  - 0 ms: mark at scale 0.2, opacity 0.
  - 0 to 280 ms: scale 0.2 -> 1.15, opacity 0 -> 1, a radial glow (sun `#FEBE29` at 35% -> 0)
    expands behind it. Easing: `Easing.out(Easing.cubic)`.
  - 280 to 700 ms: settle 1.15 -> 1.0 (spring, damping 14, stiffness 160); steam curls draw.
  - 700 to 900 ms: shrink to 0.85.
  - 900 to 1150 ms: the mark scales up to ~14x and fades out while the first screen (Profiles)
    fades in from opacity 0 and scale 1.03 -> 1.0, tinted by a lavender `#ECE6F2` wash that clears.
- Runs once per cold start, as an overlay above the navigator; never blocks taps after 1.2 s.

## 2. Scrolling (overview sheet, 4.0 s to 6.5 s)
- Large title at the top of each tab screen scrolls away with the content; a compact sticky header
  (title 17 px DM Sans 600, centred) fades in from 0 to 1 over the first 48 px of scroll, on a
  frosted background (`expo-blur` BlurView intensity ~40, tint light, plus `rgba(247,247,242,0.72)`).
- Content passes *under* the floating pill tab bar, which is frosted as well (blur + 0.88 cream).
- Lists use native momentum scrolling; no custom physics. Cards fade+rise in on first mount
  (`FadeInDown.duration(380).delay(index * 40)`, translateY 12 -> 0), only once per screen mount.

## 3. Tapping a card opens the detail (sheet 2, 6.9 s to 7.6 s)
What happens: the tapped row's image lifts out and grows into the detail screen's hero; the detail
card expands from the row's position (6.9 to 7.1 s) and fills the screen by ~7.3 s while the list
behind dims to ~70% and slightly scales down. Total ~350 ms.
homecookd version:
- On press-in the card scales to 0.97 (spring). On press, navigate; the detail screen enters with
  its hero image starting at scale 0.92 / translateY 24 / opacity 0.6 and springing to 1 (damping 18,
  stiffness 180), the rest of the detail content fades up 80 ms later.
- Back navigation reverses it (hero shrinks slightly while fading).
- Implement with Reanimated entering/exiting animations on the detail's hero + content (stack
  animation `fade` underneath). Shared-element transitions are optional; do not depend on them.

## 4. Bottom sheet slides up (sheet 3, 9.43 s to 9.93 s)
What happens: tapping Register blurs and darkens the page behind, and a sheet slides up from the
bottom (9.55 s) carrying the item's square thumbnail, title and date, with a round close button top
right and one big pill button pinned at the bottom ("Confirm Registration"). ~350 ms.
homecookd version (used by the Share sheet, the Ask sheet, the "Get the app" web popup, the record
confirm):
- Backdrop: BlurView intensity 30 + `rgba(30,36,16,0.35)`, fades in over 220 ms.
- Sheet: translateY from its height to 0 with a spring (damping 20, stiffness 220, mass 0.9),
  top corners 32, grabber 36x5 `rgba(30,36,16,0.18)`. Tap backdrop or close to dismiss
  (translateY back to height, 240 ms `Easing.in(Easing.cubic)`). Drag-down to dismiss is a bonus,
  never the only way.

## 5. Button press, loading, success (sheet 3, 11.6 s to 13.8 s) ← the button animation
What happens:
- 11.68 s: press. The pill button dims (pressed state, slightly darker, scale ~0.97).
- 11.8 to 12.6 s: the label is replaced by a small spinner inside the same button (button keeps its
  size); the content above stays.
- 12.7 s: the sheet's content fades out.
- 13.05 s: a small green dot appears at the top-centre of the sheet and grows into a check badge
  (13.05 to 13.3 s); the check stroke draws on.
- 13.3 to 13.6 s: a coloured ring pulses out around the badge and fades, with ~10 tiny confetti dots
  bursting outward and fading.
- 13.55 to 13.8 s: the title ("You're In") and a one-line subtitle fade up beneath the badge.
- Hold ~1.4 s, then the sheet slides down (15.3 s) and the page behind shows the new state
  ("You're Going" line, primary button now reads "My Ticket").
homecookd version (the shared `ActionButton` + `SuccessBurst` components):
- Every tappable control: press-in scale 0.96 + opacity 0.9 (spring damping 15, stiffness 300),
  release back to 1. Light haptic (`expo-haptics` selection) on primary actions.
- `ActionButton` states: `idle -> pressed -> loading (spinner replaces label, width locked, 180 ms
  crossfade) -> success | error`. Minimum loading time 450 ms so the spinner is never a flash.
- `SuccessBurst`: green `#5B6F00` circle grows 0 -> 1 (spring), cream check stroke draws (220 ms),
  a sun `#FEBE29` ring scales 1 -> 1.8 while fading, 10 confetti dots (green, sun, peach `#F9E3CF`,
  lavender `#ECE6F2`) fly 28 to 44 px outward and fade, title (Fraunces 26) + subtitle fade up 8 px.
- Used for: Send recipe ("Sent to Leo"), Send a message/voice note (small inline version: the
  message bubble pops in with scale 0.9 -> 1), Web sign-up ("You're in"), Answer with your voice
  ("Leo will hear it").
- Afterwards the underlying screen shows the new state (e.g. "Sent to Leo ✓" chip) like Luma's
  "You're Going".

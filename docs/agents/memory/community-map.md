---
name: community-map
description: "Oct 24: Community is one simple dish map; information only appears on tap"
metadata:
  type: project
---

On 2026-10-24 Caleb replaced the Community list with a simplified map (PR #33): "homecookd must be very simple
and accessible, information only appears on tap." The kid tab is "Dishes near you": the title, one bordered square
map with a round photo per nearby dish (rounded to the ~1 km grid; families in the same cell share one circle with a
count, so the floormates show as "3" in your building), "You" in the middle, and one line, "Tap a dish to see whose
it is." By default there's no search, chips, group-by, sheet, list or footnote.

**Why:** Caleb wants the app very simple and accessible. The first Community screen ("Near you": chips, a dinner
card, family cards, a footnote) showed everything at once; the map shows only the neighbors' dishes and leaves every
detail one tap away.

**How to apply:**
- Don't add controls or text to the default map screen. A new Community feature goes behind a tap (the dish card,
  the shared circle's row, or the card that a tap on "You" opens, which holds your dinners and "Host a dinner").
- The map is drawn (react-native-svg), not real map tiles: no react-native-maps or other native module, so it ships
  by EAS Update.
- Positions never go finer than the stored grid cell. The card's quote is always one of the cook's own step quotes.

Related: [[declutter-first]], [[demo-family-shreya]]

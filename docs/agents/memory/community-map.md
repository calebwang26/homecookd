---
name: community-map
description: "Oct 24: Community is one simple dish map; information appears on tap, one step and one button at a time"
metadata:
  type: project
---

On 2026-10-24 Caleb replaced the Community list with a simplified map (PR #33): "homecookd must be very simple
and accessible, information only appears on tap." The kid tab is "Dishes near you": the title, one bordered square
map (330 pt on a 390 pt phone) with a round photo per nearby dish (rounded to the ~1 km grid; families in the same
cell share one circle with a count, so the floormates show as "3" in your building), "You" in the middle, and under
it one line, "Tap a dish to see whose it is.", and ONE button, "Share your recipe". There's no search, chips,
group-by, sheet, list or footnote.

Later the same day (v2, "meeting up, one step at a time") he set the connect flow: a dish's card has ONE button,
"Connect with <cook>" ("See the recipe" is gone). It swaps to a chooser: back ‹, "<cook>'s <dish>", then big rows,
a title and one line each, the first green: "Join <host>'s dinner" (only when one is open), "Swap recipes", "Host a
dinner". "Share your recipe" opens its own chooser: "Put it on the map" (homie asks the cook first) and "Host a
dinner". Never all options at once.

**Why:** Caleb wants the app very simple and accessible. The first Community screen ("Near you": chips, a dinner
card, family cards, a footnote) showed everything at once; the map shows only the neighbors' dishes and leaves every
detail one tap away, and each tap shows only the next step.

**How to apply:**
- Don't add controls or text to the default map screen. A new Community feature goes behind a tap (the dish card,
  a chooser row, the shared circle's row, or the card that a tap on "You" opens, which holds your dinners, swaps
  and "Host a dinner").
- One button per card; more choices go in a chooser that replaces the card, with a back ‹.
- Only the cook shares a recipe. A kid's "Put it on the map" becomes homie's yes/no question to her, and only her
  clear yes shares it.
- The map is drawn (react-native-svg), not real map tiles: no react-native-maps or other native module, so it ships
  by EAS Update.
- Positions never go finer than the stored grid cell. The card's quote is always one of the cook's own step quotes.

Related: [[declutter-first]], [[demo-family-shreya]]

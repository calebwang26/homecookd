---
name: homie-size-and-centre
description: "Oct 24: homie's circle is exactly the height of the controls beside it (48 pt in headers, 60 pt in cook mode's bar), drawn at real size (never blurry), and centred whenever the row is symmetric"
metadata:
  type: project
---

On 2026-10-24 Caleb said:
- "the Homie circle is bigger than the C kind of oval shape … That should be the exact same height to preserve UI
  continuity … Make sure to standardize Homie's height for all."
- "When I hold down Homie, the logo turns really, really blurry."
- "center homie when you can and when it makes sense … If it's like perfectly symmetrical, just make homie aligned
  in the center."

**The rule (`app/src/lib/homie/logic.ts`):**
- `HOMIE_SIZE = { header: 48, bar: 60 }`: the height of the controls beside it. The header buttons and the profile
  pill are 48. Cook mode's Back and Next are 60, and its bar is Back · homie · Next with equal gaps.
- The pot is drawn at its real size, never a small one scaled up, so it stays sharp when held.
- A symmetric row centres homie: the dish page, with Back on the left and the heart on the right. With Share there
  too, the row isn't even, so homie joins Share and the heart at the right, 12 pt apart like them. Once the photo
  scrolls away, homie glides to the corner, off the words.
- Rows that aren't even keep homie at the right: tabs (a large title on the left), pages with only a Back button,
  and my-recipe (its scrolled title takes the centre). The my-recipe exception is waiting for Caleb's OK.

**Why:** homie is part of the row, not a sticker on it. Same height and centred when the row is even reads as one
designed bar.

**How to apply:** a new screen that shows homie picks a `header` kind in `homieRoute`. If its row is even, set
`centred`. Never give homie a size that isn't one of these two.

---
name: community-tab-off
description: Oct 25: the kid's Community tab was hackathon-only and is now hidden; the code stays so it can come back
metadata:
  type: project
---

On 2026-10-25 Caleb said: "deactivate the community tab in the kids homepage. we don't want anymore, that was
purely for the hackathon".

**Why:** Community ("Dishes near you", the map, dinners) was built for the hackathon's sponsor demo. The kid side is
Home, Recipes and Ask.

**How to apply:**
- The tab is hidden with `href: null` in `app/src/app/kid/_layout.tsx`. Its screen, `app/src/app/community/*`,
  `app/src/app/dinner/*` and the Convex functions stay, so it can come back by removing `href: null`.
- Don't add new Community features or links to it. A Community page opened from an old link goes Back to the kid
  home (`goBack` in `app/src/components/community/DetailPage.tsx`).
- Ask Caleb before deleting the Community code or data for good.

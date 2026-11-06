---
name: moss-sync-off-after-approval
description: "Oct 31: stop sending recipes to Moss once 1.0 is out of App Review; don't just remove the keys, or a deleted account's words stay in Moss"
metadata:
  type: project
---

On 2026-10-31 Caleb chose to stop the Moss sync after Apple approves 1.0 ("Yes, after approval"). With homie off
(`homie-off`), the latest app never searches Moss, but Convex still sends every family's recipes there. It's extra
work, and family recipes go to one more outside service, for a search nobody on the latest app can use.

**Why it waits:** the build in App Review was described as still including voice cooking, the one thing that searches
Moss (`voice/src/cook.ts`). The consent sheet and `/privacy` also name Moss, and they stay true while recipes are sent.

**How to apply** (Convex & accounts owns this; the switch is built, Nov 5, `MOSS_SYNC=off` in `convex/moss.ts`):
1. Start only when 1.0 is out of review and the live build has `HOMIE_ON = false`. Confirm both first.
2. Don't remove `MOSS_PROJECT_ID` or `MOSS_PROJECT_KEY` from Convex to stop it. Recipes would still finish, but
   `syncFamily` would skip Moss entirely, so a deleted account's steps and stories would stay in its index.
3. Add one switch in `convex/moss.ts`, such as `MOSS_SYNC=off`. While it's off, a sync sends nothing and deletes the
   family's index. Jobs still finish through `worker.synced`, and account deletion still removes what's in Moss.
4. Also clear `mossIndexedAt` while it's off. Otherwise `worker:reindexMissing` skips those recipes later.
5. Flip the switch (Caleb's OK is this decision, but tell him when it happens), run a sync for every family, then check
   that Moss lists no `family-*` indexes. The commands, after the code is deployed (it changes nothing while unset):
   `CONVEX_OVERRIDE_ACCESS_TOKEN=… npx convex env set --deployment grand-dragon-649 MOSS_SYNC off`, then
   `npx convex run worker:syncAllFamilies`, then list Moss's indexes (`node scripts/check-moss.mjs` or the Moss MCP).
6. Only then update the consent sheet, `/privacy`, the reviewer notes and the App Store answers, under the App Review
   guard (`app-review-guard`).
7. The voice service needs no change: with no index, search returns nothing, and an older build's question goes to the cook.

**Bringing homie back:** turn the sync back on (`npx convex env remove MOSS_SYNC`) and run `worker:reindexMissing` before `HOMIE_ON` goes back to true, or
voice cooking finds nothing.

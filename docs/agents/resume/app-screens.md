# Resume: App screens & recording (Oct 29, overnight)

Branch: `claude/phase5-cold-parents`, local only (push freeze until Apple approves). Worktree:
`.claude/worktrees/in-app-recording-4c5510`.

## Done
- **Phase 5 (cold parents)**, approved by the Merge Agent at b7e633166. Design: `docs/design/phase5-cold-parents/`
  (README, mockups, `phase5-built.jpg`). Canvas: https://claude.ai/artifact/EmDq3ZioiEUsrKkBx5H7jy.
- **Real Convex calls** (6bb3386b6), in soft mode: the stub is used until claude/dish-ask is deployed. In
  `lib/cravings.ts` and `lib/live/convex.ts`: cravingLink, sendCravingVoice (an action, after files:uploadUrl),
  setCravingDay, and forCook (live).
- **claude/dish-ask merged locally** (0379cb0cc), as the Merge Agent asked.

## Next
1. The push-ask one-liner on the Merge Agent's integration branch. Don't merge notif-linking yourself. Exact call
   (also in the TODO in `app/src/app/parent/home.tsx`):
   `onSent={() => me && askForPushSoon({ kind: 'cook-craving-sent', profileId: me.id, name: '' })}` on `<CravingSheet>`.
2. **`/dish/[id]`** (the kid's card in the app, V2-LINKING.md §2.6). The mockup is done (d6b7699ce; README section
   "/dish/[id]", `dish-card.jpg`, canvas artboards 11–13) and waiting on the Merge Agent's OK. Build it once that OK
   comes and Convex & accounts' `dishAsks.get` and `dishAsks.forMe` land, with the "Your kid" fallback (item 3).
3. **A blank `kidName`:** forCook sends "" when the kid deleted their account. Show a words key ("Your kid") in
   AskCard and on the request screens.

## Known gaps (not for 1.1)
- A recording sent from the glasses doesn't mark its ask filmed (TODO in `lib/askReminders.ts`).
- Which ask she's filming is kept only in memory, so a send that resumes after a relaunch doesn't mark it.

## Checks
```bash
cd app && npx tsc --noEmit && npx expo lint
cd app && for f in scripts/test-*.mjs; do node $f | tail -1; done
```
Web screenshots: start `homecookd-web` (launch.json), then use the Playwright script in the session scratchpad. It
uses `?as=mom` with `&preview=craving` or `&preview=doors`, and stubs the stored language-choice flag (no writes).

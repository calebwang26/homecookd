# Resume: App Store, web & builds (saved Oct 29, weekly usage at 97%)

## In progress: /miss tester feedback (Caleb: "build all of it right now")
- Branch `claude/kid-miss-feedback`, local, worktree `../hc-kid-feedback`, base origin/main (after #170).
  - Phase A commits: 97f3ab814, 0da03a248.
- Contract: DISH-ASK-SPEC.md §10 on `claude/dish-kid-edits` (PR #171): relation `none`, ask items with `about`, `edits`.
  - `short` on lines is specced (5e7819678) but not built yet; the web treats it as optional.
- **Done (phase A):**
  1. "Help us get it right" label.
  2. "No one in particular" chip and the "Ask someone" picker, wired to cards/update `{relation}`.
  3. UI for tap-to-ask with "+" toggles and the "Only Mom knows" block, on local state.
  4. UI for fixing a line yourself (a "you" mark), on local state.
  5. One label: "Our guess. Mom knows the rest."
  6. Short steps (tap to expand).
- **Mockup sent to the Master Agent for approval:** `scratchpad/kid-feedback-mockup.png`, made from `scratchpad/kid-feedback-shots/*.png`.
- **Open decisions** (the Master Agent's answer decides them):
  - The cap is 3 open at a time. The server's open cap is 3 and the total is 6. To allow 6 at once, the server's cap has to change; on the web it's `ASK_OPEN_MAX` in `web/src/lib/dish/shape.ts`.
  - Two Ask buttons: the block's button and the dock's.
  - When nothing is chosen, the block says "Tap + on anything to ask".
  - No toast yet for a 422 or 409 on an edit.

## Phase B (after approval)
1. Wire it up:
   - send `edits` through `updateCard`;
   - send `askItems(card, guess, picked)` to `askQuestions` from AskSheet, which still sends the 3 suggestions today;
   - use the server's returned `guess` instead of the local overlay;
   - show a toast for 422 and 409.
2. Update `web/scripts/qa/dish-e2e.mjs`. It still expects "Tonight's version", "We guessed. Mom knows." and the per-line "Ask Mom" tags, so it fails until updated. Add checks for none and Ask someone, the toggles, the cap, and edits reaching M2.
3. Run `npm run build`, `npm run lint` and `npm run typecheck`. Add a STATE.md line. Merge origin/main, push, `gh pr create`, check that mergeStateStatus is CLEAN, and send the PR to the Master Agent.

## Also open
- After v2 (#165) is live: check homecookd.app/miss and /a at phone width.
- Keep the 1.1 checklist current in the handoff doc.
- TODO(caleb): a line naming Claude and Cartesia under the main buttons.

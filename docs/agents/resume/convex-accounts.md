# Resume: Convex & accounts (v2 Phases 1 and 5)

Last updated Oct 29, about 09:30 UTC, at 90% of the weekly limit. Everything is committed locally on the branch below.
Nothing is pushed: the push freeze holds until Apple approves 1.0.

## Where it is
- **Branch:** `claude/dish-ask`, worktree `.claude/worktrees/dish-ask`, off `origin/main` ba889173b.
- **Contract:** `docs/build/DISH-ASK-SPEC.md`. §1–§7 cover Phase 1, the web flow; §8 covers Phase 5, cravings from the app.
- **Phase 1:** done; the Master Agent approved it with two fixes, and both are in.
  - Client IP is `CF-Connecting-IP`, proven on a dev deployment (88dfff332).
  - The kid's dish voice note is kept privately (f3aaf6442).
- **Phase 5:** done and approved (f3aaf6442).
- **`dishAsks.forMe` / `get`:** done (bbf90ce06, spec §9), for the app's `/dish/[id]`.
- **Web-port additions:** done (bfe525942): 429 `budget`, `kidVoiceS`, `inLang.version`.
- **Tests:** `npx vitest run` passes 217/217, and `npx tsc -p convex --noEmit` is clean. Real codegen reproduced
  `_generated/api.d.ts` exactly.
- **Live model checks:** about $0.13 of the $10 test budget.

## Next
1. Wait for the Master Agent's integration ping (combining branches for the v2 batch).
2. Merge notes for the Merge Agent:
   - `pushEvents.requested` is a marked comment in `convex/dishAsks.ts` `create`. It becomes a call once
     `claude/v2-notif-linking-e8fdb5` is merged.
   - That branch already adds the `pushEvents.answered` calls in `dishAsks.ts`; take its version of those spots.
3. After Apple approves 1.0 and Caleb tests the web flow (the deploy checklist):
   - set `DISH_IP_SALT` in Convex env;
   - run a live alert test;
   - deploy with `npx convex deploy --preview-name hackathon -y`, then check `expiresAt` is still null.
4. Stretch work only if asked: linking a filmed recipe back to its craving card (`pushEvents.filmed` from
   `worker.published`).

## Open questions
- These are Caleb's numbers to tune, all marked `TODO(caleb)`:
  - `DAILY_BUDGET_USD = 10` and `MOM_OVERAGE_USD = 1` in `convex/lib/dishAskValues.ts`;
  - `CRAVING_PER_DAY = 5` and `CRAVING_TOTAL = 20` in `convex/lib/cravingLinks.ts`.
- When a kid deletes their account, the card stays for Mom and keeps the kid's Ask Mom `message`, which may name them.

## Commands to pick up
```bash
cd /Users/calebwang/Documents/GitHub/hackathon-homecookd/.claude/worktrees/dish-ask
git log --oneline origin/main..HEAD          # this branch's commits
npx vitest run && npx tsc -p convex --noEmit
```

Live model checks run the model layer directly, never a deployment (scripts are in this session's scratchpad):
```bash
npx --yes tsx@4.19.2 --env-file=.env <script>.ts
```

Real codegen runs against the separate dev deployment `dutiful-mockingbird-919`, never grand-dragon-649. Move
`.env` aside first, because the CLI trips on the preview key in it, and put it back after:
```bash
mv .env .env.off
T=$(grep '^CONVEX_OVERRIDE_ACCESS_TOKEN=' /Users/calebwang/Documents/GitHub/hackathon-homecookd/.env | cut -d= -f2- | tr -d "\"'")
CONVEX_OVERRIDE_ACCESS_TOKEN="$T" CONVEX_DEPLOYMENT=dev:dutiful-mockingbird-919 npx convex codegen
mv .env.off .env
```

The end-of-turn hook's `convex codegen` check always fails in this worktree, because the shared `.env` holds the
preview deploy key. It's harmless.

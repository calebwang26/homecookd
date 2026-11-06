# Resume: Convex & accounts

Last updated Oct 30, 12:05 UTC, right after the weekly limit reset. The pause line is now 99% weekly
(Caleb, Oct 30).

## Where it is
- All v2 backend work is merged on `main` and deployed to grand-dragon-649:
  - Phase 1, the web flow;
  - Phase 5, cravings;
  - `forMe` / `get`;
  - the web-port additions;
  - §10, the kid shapes the card (#171);
  - `short` step lines (#172).
- The contract is `docs/build/DISH-ASK-SPEC.md` §1–§10.
- Live env, checked by name only on Oct 30: `DISH_IP_SALT`, `ANTHROPIC_API_KEY` and `CARTESIA_API_KEY` are set.
  `DISH_MODEL` is unset, so the default is Haiku 5.5.
- All the Phase 4 push calls are wired: `pushEvents.requested` from craving cards, and `pushEvents.answered` at
  the three merge-done spots.
- The live budget-alert test ran on Oct 30 at 17:59 UTC with Caleb's OK (`dishAsks:budgetAlert`, day "TEST, please
  ignore"). The push reached the ntfy topic, and Caleb confirmed the email reached team@homecookd.app. Don't send it again.

## Open
- **ntfy email limit:** the free ntfy account sends at most 5 emails a day, counted per sending IP, and Convex's
  servers may share theirs with other customers. If an alert email goes missing, check that first; a paid ntfy
  plan counts per account.
- **Stop the Moss sync after Apple approves 1.0** (Caleb, Oct 31): not built yet, and held until then. The steps are in
  `docs/agents/memory/moss-sync-off-after-approval.md`.
- **Upload ownership:** planned, not built: `docs/build/UPLOAD-OWNERSHIP.md`. It waits for the Master Agent's go.
- **Stretch, only if asked:** `pushEvents.filmed({askId, recipeId})` from `worker.published` when a filmed
  recipe answers a craving card. That needs the job to carry `dishAskId`.
- **Caleb's numbers** (`TODO(caleb)`):
  - `DAILY_BUDGET_USD = 10` and `MOM_OVERAGE_USD = 1` in `convex/lib/dishAskValues.ts`;
  - `CRAVING_PER_DAY = 5` and `CRAVING_TOTAL = 20` in `convex/lib/cravingLinks.ts`.

## Commands
```bash
npx vitest run && npx tsc -p convex --noEmit
```

Real codegen runs against the separate dev deployment `dutiful-mockingbird-919`, with `.env` moved aside so
the preview key doesn't trip the CLI:
```bash
mv .env .env.off
T=$(grep '^CONVEX_OVERRIDE_ACCESS_TOKEN=' /Users/calebwang/GitHub/homecookd/homecookd/.env | cut -d= -f2- | tr -d "\"'")
CONVEX_OVERRIDE_ACCESS_TOKEN="$T" CONVEX_DEPLOYMENT=dev:dutiful-mockingbird-919 npx convex codegen
mv .env.off .env
```

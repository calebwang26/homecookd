---
name: auto-ship-merged-prs
description: "Oct 25: the Merge Agent ships every merged fix/feature PR to TestFlight without asking, then tells Caleb what to test"
metadata:
  type: feedback
---

On 2026-10-25 Caleb told the Merge Agent: "after u receive new fixes/feature PRs, auto ship them to testflight and
notify me so i can test them in the app".

**Why:** Caleb tests on his phone and wants each fix there quickly, without approving every deploy.

**How to apply:**
- Only the Merge Agent ships, and only after the PR passed its checks and merged. Other sessions send PRs and don't
  deploy, so there are never two EAS Updates at once.
- From a clean copy of merged main, in order: Convex if `convex/` changed, `voice/deploy.sh` if `voice/` changed,
  one EAS Update (channel `production`, `EXPO_NO_DOTENV=1` plus the two `EXPO_PUBLIC_*` URLs) if `app/` changed, and a
  restart of the laptop pipeline worker if `pipeline/` changed. PRs that land close together share one update.
- A native change needs a TestFlight build (`eas build -p ios --profile production --auto-submit`).
- Log the versions in `docs/agents/STATE.md`, then tell Caleb what to test.
- Supabase `api` deploys and destructive data changes still need his explicit OK.

Related: [[merge-agent-approval]], `docs/agents/MERGE-PLAYBOOK.md`.

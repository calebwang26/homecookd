#!/usr/bin/env bash
# Deploys run this first. When a merge changes staging's Terraform and its code together, Terraform has to go first: a deploy copies the
# newest task definition, so it only picks up a new setting if the apply got there. Needs GH_TOKEN with actions: read.
# Stops the deploy if the apply was refused or failed, since the code may depend on it. Caleb re-runs it after applying.
set -u

[ "${APPLY_SWITCH:-}" = on ] || { echo "Auto-apply is off, so there's nothing to wait for."; exit 0; }
git diff --name-only HEAD~1 HEAD | grep -qE '^infra/(envs/staging|modules)/' || { echo "This merge didn't change staging's Terraform."; exit 0; }

# 46 minutes: a little over the apply's own limit, with time for GitHub to list the run.
for _ in $(seq 1 92); do
  RESULT=$(gh run list --workflow apply-staging.yml --commit "$GITHUB_SHA" --limit 1 --json status,conclusion,createdAt --jq '.[0] | "\(.status) \(.conclusion) \(.createdAt)"' 2>/dev/null)
  case "$RESULT" in
    "completed success "* | "completed skipped "*) echo "The apply is done."; exit 0 ;;
    # Either a newer merge took its place in the queue, and that run applies this commit's Terraform too, or someone stopped it part way,
    # which can leave staging half applied. Only a newer run that finished well says it's safe to go on.
    "completed cancelled "*)
      NEWER=$(gh run list --workflow apply-staging.yml --branch main --limit 20 --json status,conclusion,createdAt --jq "[.[] | select(.createdAt > \"${RESULT##* }\") | \"\(.status) \(.conclusion)\"] | join(\",\")" 2>/dev/null)
      case "$NEWER" in
        *"completed success"*) echo "That apply was replaced by a newer one, which finished. Going ahead."; exit 0 ;;
        *queued* | *in_progress* | *waiting* | *pending* | *requested*) ;;
        *) echo "That apply was cancelled, and no newer one finished, so staging may be half applied. This deploy stops."; exit 1 ;;
      esac
      ;;
    "completed "*) echo "The apply for this commit didn't succeed ($RESULT), so this deploy stops. Re-run it once staging is applied."; exit 1 ;;
  esac
  sleep "${APPLY_POLL_S:-30}"
done
echo "Gave up waiting for the apply."
exit 1

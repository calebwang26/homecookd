#!/usr/bin/env bash
# Tells Caleb that .github/workflows/apply-staging.yml stopped: by email through the staging alerts topic, and in the run's summary.
# The message holds resource names and the reasons from plan_check.py, which name fields and never values. It's safe to email.
# If the login itself failed, SNS can't be reached either, and the failed run in GitHub is all there is (infra/README.md).
set -u

case "${APPLY_OUTCOME:-}" in
  failure | cancelled) PARTLY="Terraform stopped during the apply, so some of it may have gone through. Read the run first." ;;
  *) PARTLY="Nothing was applied." ;;
esac

if [ "${REFUSED:-}" = true ]; then
  HEADLINE="The safety check refused this plan, so it needs you."
  DETAILS="$(cat "${RUNNER_TEMP:-.}/verdict.txt" 2>/dev/null || echo "The check stopped without giving a reason. See the run.")"
else
  HEADLINE="The staging apply stopped: it failed or was cancelled, not refused."
  DETAILS="See the run for which step. A state lock held for over 10 minutes also lands here. Don't force-unlock unless you know no apply is running."
fi

MESSAGE="$HEADLINE $PARTLY

Commit: $(git rev-parse HEAD 2>/dev/null || echo unknown)
Run: ${RUN_URL:-unknown}

$DETAILS

To apply it yourself, after reading the plan:

  git switch aws-migration && git pull
  cd infra/envs/staging
  AWS_PROFILE=homecookd terraform init -backend-config=\"bucket=homecookd-tfstate-\$(aws sts get-caller-identity --profile homecookd --query Account --output text)\"
  AWS_PROFILE=homecookd terraform plan -out=human.tfplan
  AWS_PROFILE=homecookd terraform apply human.tfplan

If the same merge changed api/, pipeline/ or web/, its deploy waited for this and stopped too. Re-run it from Actions afterward."

# An ARN could reach this text through a resource's name, so the account id comes out here as well.
MESSAGE="$(printf '%s' "$MESSAGE" | sed -E 's/[0-9]{12}/<account>/g')"

printf '%s\n' "$MESSAGE"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '```\n%s\n```\n' "$MESSAGE" >> "$GITHUB_STEP_SUMMARY"
fi

aws sns publish --topic-arn "$TOPIC" --subject "homecookd staging: a merge did not apply" --message "$MESSAGE" >/dev/null \
  && echo "Emailed through the alerts topic." \
  || echo "Couldn't reach the alerts topic: the login probably failed. This failed run is the only signal."

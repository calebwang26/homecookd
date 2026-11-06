#!/usr/bin/env python3
"""Turns a real `terraform show -json` plan into a test fixture: no account id, no addresses, no email.

    python3 infra/scripts/scrub_plan.py plan.raw.json > infra/scripts/fixtures/staging-plan.json
    python3 infra/scripts/scrub_plan.py --changes plan.raw.json   # only what differs, for one entry of staging-variants.json
    python3 infra/scripts/scrub_plan.py --backend tfdata/terraform.tfstate > infra/scripts/fixtures/backend.json

It works on the text, so a value inside a JSON string (a policy, a container definition) is scrubbed too. Check the result by
eye before committing it. The plan on disk holds whatever the state holds, so never commit the raw one.
"""
import json
import re
import sys

ACCOUNT = "123456789012"
RULES = [
    (r"\b\d{12}\b", ACCOUNT),
    (r"[A-Za-z0-9._%+-]+@(?!example\.com)[A-Za-z0-9-]+\.[a-z]{2,}", "alerts@example.com"),
    # Public names of the load balancer, the database and CloudFront.
    (r"[a-z0-9-]+\.[a-z0-9-]+\.us-west-2\.elb\.amazonaws\.com", "lb.example.us-west-2.elb.amazonaws.com"),
    (r"homecookd-staging-\d+\.us-west-2\.elb\.amazonaws\.com", "lb.example.us-west-2.elb.amazonaws.com"),
    (r"[a-z0-9-]+\.[a-z0-9]+\.us-west-2\.rds\.amazonaws\.com", "db.example.us-west-2.rds.amazonaws.com"),
    (r"\b[a-z0-9]{10,16}\.cloudfront\.net", "example.cloudfront.net"),
    # A random id gitleaks' generic rule reads as a key.
    (r'(origin_access_control_id\\*"\s*:\s*\\*")[A-Za-z0-9]{10,}', r"\1EXAMPLEOACID"),
    (r"\b(ec2|ip)-\d+-\d+-\d+-\d+\b", r"\1-198-51-100-1"),
    # Every IP that isn't part of a CIDR block: the NAT's public and private addresses.
    (r"\b(?!0\.0\.0\.0\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b(?!/)", "198.51.100.1"),
]


def scrub(text):
    for pattern, replacement in RULES:
        text = re.sub(pattern, replacement, text)
    return text


def changes_only(plan):
    return {
        "variables": plan["variables"],
        "changes": [r for r in plan["resource_changes"] if r["change"]["actions"] != ["no-op"]],
    }


if __name__ == "__main__":
    mode = sys.argv[1] if sys.argv[1].startswith("--") else None
    plan = json.loads(scrub(open(sys.argv[-1]).read()))
    if mode == "--changes":
        plan = changes_only(plan)
    elif mode == "--backend":
        plan = {"backend": {k: plan["backend"][k] for k in ("type", "config")}}
    else:
        # Copies of what resource_changes already says, and the bulk of the file. The check doesn't read them.
        for key in ("planned_values", "relevant_attributes", "resource_drift", "prior_state"):
            plan.pop(key, None)
    json.dump(plan, sys.stdout, sort_keys=True)
    print()

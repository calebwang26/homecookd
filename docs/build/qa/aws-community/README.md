# Community on AWS staging (Nov 3, 2026)

How to run these proofs again: [../AWS-PROOFS.md](../AWS-PROOFS.md).

The app's web build (375×812) with `EXPO_PUBLIC_BACKEND=aws` against staging. Two test families: Asha shared a test
recipe and hosted a dinner of it; Nadia asked to join and Asha said yes.

1. Nadia's dinner page (`/dinner/<id>`, which a `/d` invite link opens even with the Community tab hidden), from
   `GET /v1/dinners/:id`: the dish, "Hosted by Asha", tomorrow, the place and **the private address, shown because
   she's an accepted guest**, "You're in", "2 going", and "Invite friends". Its "Report or block" link is at the
   page's foot (under the sticky button here).

Not pressed here: Report or block. On staging each one emails the team's alerts address, so they're proven by unit
tests (`test-aws-community`), not on staging. Both test people were deleted afterwards.

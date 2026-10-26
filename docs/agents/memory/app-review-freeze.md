# App Review freeze (Oct 26, 2026)

Until Apple approves homecookd 1.0, don't change what App Review checks. A PR that touches these needs Caleb's OK
in chat first, and the reviewer notes in App Store Connect (Salik's doc "homecookd App Store submission for Salik")
must be updated to match before it ships:

- **Sign-in path the reviewer uses:** `app/src/app/join.tsx`, `join-code.tsx`, `i.tsx`,
  `app/src/components/signin/SignInScreen.tsx` ("Have a family code?", the terms line), `app/src/app/index.tsx`
  ("Who's in the kitchen?"), `convex/sessions.ts`, `convex/lib/auth.ts`.
- **AI consent (5.1.2(i)):** `app/src/app/consent.tsx`, `app/src/lib/aiConsent.ts`, the consent gate in
  `app/src/app/_layout.tsx`.
- **Delete account (5.1.1(v)):** `app/src/components/profiles/DeleteAccountSheet.tsx`, `deleteAccount` /
  `accountRemoval` in `app/src/lib/session.tsx`, `app/src/lib/auth/apple.ts`, `convex/account.ts`, `convex/apple.ts`.
- **Report and block (1.2):** `app/src/components/community/ReportSheet.tsx`, `report.ts`,
  `app/src/app/community/[id].tsx`, `app/src/app/dinner/[id].tsx`, `convex/lib/safety.ts`, `convex/lib/moderation.ts`,
  `convex/reports.ts`, `convex/alerts.ts`.
- **Links Apple opens:** `app/src/lib/links.ts`, `web/src/app/privacy/`, `web/src/app/terms/` (both repos).
- **Listing assets:** the icon and name in `app/app.json` / `app/assets/images/icon.png`, `docs/app-store/screenshots/`.
- **Review data:** the TEST family's code and its faces (Mom, Dad, Grandma, Leo, Maya, Reviewer) and its
  Chicken Biryani recipe. Don't delete or rename them, or change the code.

Everything else ships as usual (EAS Updates, new TestFlight builds). Bug fixes inside these files are fine with
Caleb's OK. The freeze ends when Apple approves 1.0; then delete this file and its lines in AGENTS.md and README.md.

**Why:** the reviewer follows the notes step by step; a changed screen or broken sign-in is a rejection, and every
rejection costs days.
**How to apply:** before editing a listed path, stop and ask Caleb; the Merge Agent holds any PR touching them
without his OK quoted in the PR.

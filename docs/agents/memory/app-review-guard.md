# App Review guard (Oct 26, 2026)

Nothing is frozen. A PR that touches what Apple's reviewer checks (paths below) does two extra things, in the same PR:

1. **Apple check first (the most important step; a rejection costs days).** Re-read the guidelines it touches
   (1.2 shared content, 2.1 completeness and demo access, 2.3 accurate metadata, 4.8 sign-in, 5.1.1 privacy and
   deletion, 5.1.2 data sharing and AI consent) at https://developer.apple.com/app-store/review/guidelines/ and say
   in the PR, per guideline, why the change still passes. If it doesn't, change the PR until it does, or stop and
   ask Caleb.
2. **Then update every place that describes it**, and ship them together:
   - the handoff doc "homecookd App Store submission for Salik" (https://claude.ai/artifact/Ew2JKrCAeqDbWb7eNuQ2ST):
     the reviewer notes, App Privacy and age rating answers, screenshots list. Claude sessions edit it with the Docs
     connector; Codex asks Caleb to pass the change on;
   - homecookd.app/privacy and /terms (`web/`, plus the same PR in calebwang26/homecookd, which deploys the site);
   - App Store Connect itself if it's already filled (Caleb or Salik edits it; list the exact field changes in the PR);
   - new screenshots in `docs/app-store/screenshots/` if a screen in them changed.
   Then merge (Merge Agent), deploy as usual, and note in STATE.md what changed for App Review.

The paths:

- **Sign-in path the reviewer uses:** `app/src/app/join.tsx`, `join-code.tsx`, `i.tsx`,
  `app/src/components/signin/SignInScreen.tsx` ("Have a family code?", the terms line), `app/src/app/index.tsx`
  ("Who's in the kitchen?"), `convex/sessions.ts`, `convex/lib/auth.ts`.
- **AI consent (5.1.2(i)):** `app/src/lib/aiConsent.ts` (`ensureAiConsent`), the sheet
  `app/src/components/consent/AiConsentSheet.tsx` (mounted in `app/src/app/_layout.tsx`), and every place that asks
  before sending (listed in `app/scripts/test-consent.mjs`). Since Oct 26 it's a small sheet at first use, not a
  screen after sign-in.
- **Delete account (5.1.1(v)):** `app/src/components/profiles/DeleteAccountSheet.tsx`, `deleteAccount` /
  `accountRemoval` in `app/src/lib/session.tsx`, `app/src/lib/auth/apple.ts`, `convex/account.ts`, `convex/apple.ts`.
- **Report and block (1.2):** `app/src/components/community/ReportSheet.tsx`, `report.ts`,
  `app/src/app/community/[id].tsx`, `app/src/app/dinner/[id].tsx`, `convex/lib/safety.ts`, `convex/lib/moderation.ts`,
  `convex/reports.ts`, `convex/alerts.ts`.
- **Links Apple opens:** `app/src/lib/links.ts`, `web/src/app/privacy/`, `web/src/app/terms/` (both repos).
- **Listing assets:** the icon and name in `app/app.json` / `app/assets/images/icon.png`, `docs/app-store/screenshots/`.
- **Review data:** the TEST family's code and its faces (Mom, Dad, Grandma, Leo, Maya, Reviewer) and its
  Chicken Biryani recipe. Don't delete or rename them, or change the code.

**Why:** Caleb wants work to keep shipping during review, but never at the cost of a rejection, and the reviewer
follows the notes step by step, so the notes, legal pages and answers must always match the build.
**How to apply:** before editing a listed path, plan both steps; the Merge Agent holds a PR that touches them
without the Apple check written in it and the matching doc/page updates. The guard ends when Apple approves 1.0
(then keep it for later versions if Caleb wants).

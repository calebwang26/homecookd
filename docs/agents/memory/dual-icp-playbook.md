---
name: dual-icp-playbook
description: "Oct 16 2026 research playbook on the parent-vs-kid two-customer problem (phone sign-in, iMessage invites, lander without the chooser gate); artifact link and the recommended direction"
metadata:
  type: project
---

On 2026-10-16 Caleb asked how to handle homecookd's two customers (parent cooks and homesick kids, about 1:1) in two places: app sign-in and the lander's "which one are you?" gate. He wanted research on companies with a similar split first. The playbook is at https://claude.ai/artifact/Hx5WQYFg5SmUzyVLJrxN9Z.

**Recommended direction (not yet approved or built):**
- **Lander:** replace the gate with one shared page, a headline both sides relate to, and two hero buttons (Greenlight-style).
  - Route known traffic straight to /teach or /learn: invite and share links that carry the role, `?aud=` ad links, a saved choice, and the Snapchat in-app browser.
  - Log chooser picks for about 3 weeks before A/B testing.
  - Facebook is no parent signal: Pew 2025 has 68% of 18–29s vs 74% of 50–64s on it.
- **Sign-in:** phone number plus a texted code through Twilio Verify, called from the `api` edge function. Use the autofill props, and the domain-bound format `@homecookd.app #code` once TestFlight has associated domains.
- **Invites:** sent from the user's own Messages via expo-sms. The invite is keyed to the invited phone number: tap the link, tap "Text me the code", tap the autofilled code. Pending invites resolve whenever that number verifies.
- **Not feasible yet:** zero-tap recognition. iOS never exposes the device's number, and carrier silent auth is beta or sales-only.

**Caleb's decisions later on Oct 16 (these replace the playbook where they conflict):**
- **Free, no Twilio.** Sign-in order: iMessage invite link, then Sign in with Apple, then Sign in with Google (for Android).
- **Invite links are trusted.** Whoever taps first joins and the link dies; no "is that him?" confirm, because it adds friction.
- **Safety stays passive:** a family-chat note when someone joins, Remove in the members list, a 14-day expiry, and joining only on an explicit tap.

**Lander decisions (Oct 16, from Caleb):**
- **Default home page is the parent version.** The hero has a very clear button that asks the visitor whether they're here to learn the recipes; tapping it switches the page to the kid version in place.
- **Copy is still about 50/50.** Only the hero and the emotional headers target one side. "Here's the real app" walks the whole pipeline in neutral words, so a kid reading the parent page still understands it.
- **Context routing stays:** app links, tagged ads, a saved choice, and Snapchat.
- **Creative bets cut** (Ask Mom, kid sets up Mom's kitchen, recording without the app, holiday asks). First users are trusted friends and family, and the test is whether they download the app.

**Built and merged Oct 17 (PR #3):** `/` is the parent page (headline "Record it once. They'll cook it forever.", hero button "Here to learn the recipes?"; the kid hero has "Are you the cook?"), the chooser is gone, routing is in `web/src/lib/audience-gate.ts`, and beacons go to `POST /web-events` (built by the two-sided branch).

**Caleb's Oct 17 rules:**
- "How it works" is NOT shared word for word. The parent version is the default page, so it must read right for parents AND kids (third person: "Mom films herself cooking…"). The kid version stays written for kids.
- Share previews keep the PARENT card (invites and recipe links) "to show who the cook is." No neutral card.

**Blockers found during the research:**
- homecookd.app/.well-known/apple-app-site-association returns 404.
- `app/app.json` has no associatedDomains.
- Share links allow 5 joins each.
- The family code is one secret shared by the whole family.

**Why:** Caleb wants the lowest-friction sign-in for parents who aren't techy, and no gate on the lander.

**How to apply:** if Caleb says to build any of this, start from the playbook's build order. He must create the Twilio account and add its keys to Supabase secrets himself.

Related: [[lander-icp-problems]], [[brand-homecookd]], [[git-pr-workflow]]

**Google Cloud project for Google sign-in (Oct 16, from Caleb):** `project-11b9fc8a-1108-4ea8-a3b`. It still needs a consent screen and OAuth client IDs for iOS, Android and web; Caleb creates those himself.

**Hero headline chosen (Oct 16, from Caleb):** "Record it once. They'll cook it forever." This goes on the default parent home page.

**Built Oct 16–17 (PR #6, branch `two-sided`):** Problems 1, 2 and 5 plus the backend; spec in `docs/build/FEEDBACK-OCT16c.md`.
- **Backend:** `api` v8 is live and migration `two_sided` is applied (devices, identities, invites, lander_events, profiles.removed_at). Live test: `supabase/tests/two_sided_live.mjs` on the TEST family.
- **Still open, TODO(caleb):**
  - bundle id and Team ID (APPLE_AUDIENCES and AASA `TEAMID.BUNDLEID`);
  - Google client ids;
  - NEXT_PUBLIC_APP_STORE_URL;
  - then a new TestFlight build.

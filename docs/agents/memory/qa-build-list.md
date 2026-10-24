---
name: qa-build-list
description: "Oct 17 2026 synthetic QA run (8 personas + crawler) and the approvable 30-item fix list artifact; how to read Caleb's approvals"
metadata:
  type: project
---

On 2026-10-17 eight synthetic personas (Linda, Priya, Robert, Jake, Dad, Leo, Mom+Grandma, Maya) and a crawler tested the website and the app's web build, on the TEST family only. The result is a private artifact: https://claude.ai/artifact/4AWM9mkP3rhXzYUHMpHKBH ("homecookd Persona QA").

- **Build list:** items B01–B30 sit at the top of the page. Each has its problem, what to build, files, a done-when check, risks and the finding numbers it fixes. The 25 ranked findings with screenshots, the dead ends, journeys and "not planned" entries are below.
- **Caleb's choices** are stored in the artifact's db, collection `decisions`, one doc per item id (`B01`…). Each doc holds `status` (approve / review / skip / null), `note` and `at`. Read them with ArtifactData `list`.
- **Items that touch decisions Caleb already made** (flagged in each item's risk): B06, B09, B12, B16, B26, B28. B19 needs his facts about video privacy first: the recipe videos sit in a public bucket and the pipeline uses Gemini.

**Shipped Oct 18:** 29 of 30 were approved and built in PR #24 (main 7fa3e66). The cooked_photos migration is applied and api v11 is deployed; live tests pass 129/129, api-smoke 23/23. B15 (dish card on the app's sign-in screen) stayed in review: Caleb thought /r already works, but that's the web page; B15 is for the app opening a link while signed out, which only matters once TestFlight exists. Oct 18 follow-ups: CONTACT_EMAIL is team@homecookd.app (PR #25), which turns on /privacy's "write to us … what to delete" promise. Caleb said keep the FAQ line "If that ever changes, we'll tell you first." MADE_BY is still empty (hidden) until he gives it.

**Why:** Caleb wants to approve fixes from this list and then have Claude build each approved one with full context.

**How to apply:** when he says "build the approved items", read `decisions`, then ship each approved item as its own small PR (merge main first). Honor his notes, and treat "review" items as questions to ask him first. The App UI session owns the home and profile screens, so tell it what changed.

Related: [[testflight-live]], [[git-pr-workflow]]

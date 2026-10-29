# Resume: Notifications & linking (JOIN-SIMPLE build)

Worktree `.claude/worktrees/musing-tereshkova-544b3c`, branch `claude/join-simple`, off `claude/v2-batch`
(60340e07c). Local only (push freeze). Design `docs/build/JOIN-SIMPLE.md` and the mockups
(`docs/design/join-simple/join-simple.jpg`) are approved by the head agent ("Master Agent", local_13c06a2b-…).

## Done (committed)
- The design + decisions (§8): role chips; a solo family's recipes move; the old paths retire 30 days after 1.1 is
  live.
- Convex `links.moved` + `verifyMoved` / `signMoved` (convex/links.ts, lib/joinTicket.ts): 245 vitest pass.
- `scripts/test-family-link.mjs`: the TEST family's never-expiring reviewer link (prints the SQL; run at deploy).

## In flight when written (check `git status`; subagents leave their files uncommitted)
- **Supabase (subagent):**
  - `join_links` migration 20261029100000;
  - `POST /join-links` (+ revoke);
  - peek for 22-char tokens;
  - accept → 426;
  - signInWith `join_token` (22-char link or 16-char old invite) / `link_ticket` / `role` / `move`, and the move with
    its signed `moved` receipt;
  - `/auth/link` removed;
  - files: `supabase/functions/api/joinLinks.ts`, `index.ts`, `link.ts`, `supabase/tests/joinLinks_test.ts`.
- **App (subagent):**
  - the i.tsx join card (name + chips + Apple) and the move card ("You're in <A>. Join <B> instead?");
  - ClaimLink: name + Apple with the ticket;
  - join.tsx first screen: Apple only + "Tap it again";
  - the invisible clipboard pickup;
  - join-code.tsx and PasteInvite deleted;
  - session signInWith options + the needs-move status; `api.joinLink()`.

## Next
1. Review each subagent's diff. Run:
   - `npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/`, then `deno check`;
   - `npx vitest run` and `npx tsc -p convex --noEmit`;
   - in app/: `npx tsc --noEmit && npx expo lint`, plus `node scripts/test-{signin,links,consent,words,retention}.mjs`.
2. Commit by name; add a STATE.md Change log line, including the old paths retiring 30 days after 1.1 is live
   (TODO(caleb)).
3. Tell App screens & recording `api.joinLink()` is ready, for AddFamilySheet and their removal of per-person invites.
4. Send the head agent the review packet (branch, commits, files, tests).

## Open
- The web /i page is done by App Store, web & builds on `claude/join-simple-web` (fe9c4edc5). Its headline is "Join
  <family_name>", because family names are free text; the app matches.
- Deploy after Apple approves: the migrations 20261029090000 and 20261029100000, `LINK_JOIN_SECRET`, the api (check
  Salik first), then run `node scripts/test-family-link.mjs` and its SQL for the reviewer notes.

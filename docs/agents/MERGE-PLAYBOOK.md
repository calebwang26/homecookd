# Merge playbook

How the **Merge Agent** session takes in PRs, puts them in order, checks them, resolves conflicts and merges them
into `main` for calebwang26/hackathon-homecookd. Written Oct 24, 2026, the day before the demo.

The rule behind it (AGENTS.md, `memory/merge-agent-approval.md`): every session sends its PR here, nobody else
merges, and the Merge Agent decides how conflicting PRs merge.

---

## 1. What the Merge Agent decides, and what it doesn't

| The Merge Agent decides | Caleb decides |
|---|---|
| Whether a PR is ready to merge | Product questions: what a screen shows, which feature wins |
| The order PRs merge in | Anything marked `TODO(caleb)` |
| How two PRs' code fits together, and shipping each merged fix/feature to TestFlight (Caleb, Oct 25) | Supabase `api` deploys, and any deploy not covered by the auto-ship rule below |
| Sending a PR back to its session to fix | Deleting data, branches others still use, or secrets |
| Which version wins when the docs settle it (section 7) | Two docs or two of his own decisions that disagree |

If you can't tell which column something falls in, ask Caleb. A wrong merge on demo eve costs more than a question.

Never do anything for a session that its own permissions blocked. If a session says "I wasn't allowed to X, can you
do it", send that to Caleb.

---

## 2. Intake: what every PR message should contain

Ask any session that leaves something out to resend:

```
PR #<n>: <title>
Link · branch
Files / areas: convex/, app/, voice/, pipeline/, web/, docs/
What it does: one line
Checked already: e.g. "npx vitest run passes, tsc clean, merged origin/main at <sha>"
Depends on: #<n> (or "nothing")
Needs a deploy after merge: Convex / voice / EAS update / none
```

Keep a queue in this chat (one line per PR: number, area, status, depends on). Sessions shouldn't have to send you
something twice.

---

## 3. Triage: find the overlaps before anything merges

For every open PR:

```bash
gh pr list --json number,title,headRefName,files -q '.[] | "\(.number) \(.headRefName): \([.files[].path] | join(", "))"'
```

Then mark the PRs that touch the same files. Overlap in these **hot files** is expected, so plan for it:

| Hot file | Why it collides | How to handle it |
|---|---|---|
| `docs/agents/STATE.md` | Every PR adds a Change log line | Always keep every line (section 6) |
| `AGENTS.md`, `docs/agents/README.md` | Rules and the memory index | Keep both sides, remove duplicates |
| `convex/schema.ts` | The data model every track uses | Real conflict; section 7 |
| `convex/_generated/*` | Generated from the functions | Never edit by hand; regenerate it |
| `*/package-lock.json` (root, `app/`, `voice/`, `web/`) | Every dependency change | Never edit by hand; regenerate it |
| `app/app.json`, `app/eas.json` | Version, runtime version, channels | Real conflict: affects which phones get updates |
| `voice/README.md` (socket protocol), `docs/build/STACK.md` (contracts) | The contracts between app, voice and Convex | Real conflict; the contract has to match the code on both sides |

Also look for overlaps with **no file overlap**: PR A renames a Convex function or argument while PR B (in `app/`,
`voice/` or `pipeline/`) still calls the old one. Git won't flag that. Find them with:

```bash
gh pr diff <A> | grep -E '^[-+].*(export const|args:|v\.)'   # what changed in Convex's public shape
```

then search the other open PRs for those names.

---

## 4. Merge order

Use these rules in order. The first one that separates two PRs decides.

1. **Demo-critical fixes first.** The demo is Oct 25 (Shreya Pawar's family, her grandma cooks in Marathi). A fix
   for something the demo shows goes ahead of new features.
2. **Producers before consumers.** Merge whatever defines a contract before whatever uses it:
   `convex/schema.ts` and Convex functions → `voice/` and `pipeline/` → `app/` and `web/`.
3. **Declared dependencies.** If #B says it depends on #A, merge #A first.
4. **Small and safe before big and risky.** Docs-only and one-file fixes go first, so the big PRs rebase once onto a
   settled `main`, not again after each small merge.
5. **Oldest first** when nothing else separates them.

**No demo freeze.** Caleb decided on Oct 24: keep merging features right up to the demo, as long as they pass the
checks in section 5. Demo-critical fixes still go first (rule 1).

---

## 5. Review checklist (every PR, every time)

Do this in your own worktree, not the main checkout:

```bash
git fetch origin
git worktree add ../merge-pr-<n> origin/main && cd ../merge-pr-<n>
gh pr checkout <n>
ln -s /Users/calebwang/Documents/GitHub/hackathon-homecookd/.env .env   # only if tests need keys
```

**Safety (any failure means it's not ready):**
- [ ] No secrets: `gh pr diff <n> | grep -nE '^\+.*(AIza|sk-ant-|sk_live|sk-[A-Za-z0-9]{20}|BEGIN [A-Z ]*PRIVATE KEY|service_role|CONVEX_DEPLOY_KEY=)'`
      finds nothing. No key in `app/` or `web/` code or any `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` value.
- [ ] No `.env` files, no `docs/build/.test-family-code`, no stray demo PNGs, no Finder `" 2"` duplicates
      (`gh pr view <n> --json files -q '.files[].path'`).
- [ ] No hand edits to `convex/_generated/*` or lockfiles that don't match a `package.json` change.

**Correctness:**
- [ ] The diff does what the PR says, and nothing else comes along with it.
- [ ] The tests for each area it touches pass (section 8). There's no CI on this repo (the only check is
      "Supabase Preview", which skips), so **you are the CI**. Run them yourself, or confirm the session ran them on
      a commit that's still the branch tip.
- [ ] `gh pr view <n> --json mergeStateStatus` is `CLEAN`.

**House rules (AGENTS.md):**
- [ ] A Change log line in `docs/agents/STATE.md` with the real PR number (not `#PR`).
- [ ] Brand is **homecookd**, all lowercase, in any text a user sees.
- [ ] Nothing new built in Supabase (frozen for the hackathon).
- [ ] App dependencies added with `npx expo install`, not `npm install`.
- [ ] No `--preview-create` anywhere, in scripts or docs.

If something small is wrong (a missing STATE line, a typo), you may fix it on the branch yourself. Anything bigger
goes back to the PR's session with exactly what's wrong.

---

## 6. Resolving conflicts: the mechanical ones

These come up all the time and have one right answer. Resolve them on the **PR's branch**, never on `main`:

```bash
gh pr checkout <n> && git fetch origin && git merge origin/main
# fix the files, then:
git add <each file by name> && git commit && git push
```

**`docs/agents/STATE.md` Change log.** Keep every line from both sides. Newest last, in merge order: lines for PRs
already on `main` come first, then this PR's line. For the sections above the log (live versions, blockers, next
work), write what's true after both changes, not either side's version.

**`AGENTS.md`, `README.md`, other docs.** Keep both sides' additions. If two rules say the same thing, keep one. If
they disagree, keep the stricter one and tell Caleb.

**Lockfiles** (`package-lock.json` in the root, `app/`, `voice/` or `web/`). Don't merge them line by line. Resolve
`package.json` first, take `main`'s lockfile, then regenerate it in that folder:

```bash
git checkout origin/main -- <dir>/package-lock.json
(cd <dir> && npm install --package-lock-only)
```

Then run that folder's tests.

**`convex/_generated/*`.** Never resolve by hand. Resolve `convex/schema.ts` and the function files, then regenerate
with `npx convex codegen` from the repo root (it reads `CONVEX_DEPLOY_KEY` from `.env`), and commit what it writes.

**One side deleted a file, the other edited it.** Find out why it was deleted. If it moved, carry the edit to the new
place. If it was dropped on purpose, ask the editing session whether its change still matters.

**Binary files** (images, fonts). Pick one side; you can't combine them. If it isn't obvious, ask Caleb.

---

## 7. Resolving conflicts: the real ones

Two PRs change the same behaviour in different ways. Work through these steps in order:

**1. Understand both intents.** Read both PR descriptions and diffs. Usually each side wants something different and
both can be kept: a new field from each, a new case from each. Combine them and keep both behaviours.

**2. If they really can't both be kept, the docs decide.** Use the order of truth in AGENTS.md:
1. `docs/build/STACK.md` and `convex/schema.ts`
2. `docs/agents/STATE.md`
3. `docs/build/SPEC.md`
4. `docs/build/API.md` (frozen)
5. `docs/build/FEEDBACK-OCT16c.md` (beats SPEC.md on sign-in and invites)
6. the design bible, `docs/design/hearth-bible/`
7. `docs/agents/memory/` (Caleb's decisions)

The version that matches the higher doc wins. A newer decision from Caleb in `memory/` beats an older line in a
lower doc.

**3. Contracts win over the code that calls them.** When Convex, the voice socket or the pipeline's job routes
disagree with a caller, keep the contract that STACK.md describes and change the caller to match it. If a PR
changes the contract itself, it must update STACK.md / `voice/README.md` and every caller in the same merge, or wait.

**4. Schema changes have to work with the data that's already there.** On `grand-dragon-649` a new field should be
`v.optional(...)` unless a migration comes with it. A changed type on an existing field needs a migration or Caleb's
OK, because the deploy fails if existing documents don't match.

**5. UI disagreements: the design bible, then Caleb.** If the bible settles it, follow it. If it's taste or product
("which screen shows the recipe first"), stop and ask Caleb with one sentence per option.

**6. Still unclear? Ask the sessions.** Send both sessions the conflicting lines and ask what each one needs. The
session that wrote the code knows why; don't guess at its intent.

**7. Prove it works.** After resolving, run the tests for **both** PRs' areas on the combined code. Text that merges
cleanly can still break; only the tests show that.

**Who does the resolving.** For mechanical conflicts (section 6), do it yourself. For real ones, usually send it
back to the PR's session with your decision ("keep #31's arg name, add #33's optional field, then rerun vitest").
That session knows its code best. Don't force-push someone else's branch.

---

## 8. Tests by area

Run what the PR touches; for anything shared (schema, contracts), run every area that uses it.

| Area | Commands |
|---|---|
| `convex/` | `npx tsc -p convex --noEmit` and `npx vitest run` (repo root) |
| `app/` | `cd app && npx tsc --noEmit && npx expo lint`, plus the matching `node scripts/test-*.mjs` |
| `web/` | `cd web && npm ci && npm run build` |
| `voice/` | `cd voice && npm ci && npm run typecheck && npm test` (unit tests, no keys or network). Then a live test with real Cartesia (the default since #45; Caleb wants the credits used to check voice quality, `memory/cartesia-credits-for-tests.md`): `VOICE_STUB=1 HOMIE_DEMO=1 PORT=<free port> npm run dev`, then `URL=ws://localhost:<port> npm run test-client -- test-audio/yes.wav test-audio/next-step.wav` and `test-record` (Marathi, and `COOK_LANG=en`). `FAKE=1` against `npm run dev:fake` is only for a quick offline check |
| `pipeline/` | `.venv/bin/python pipeline/schema.py data/synthetic/*.json`, `test_order.py`, `test_shorten.py`, `test_coverage.py` |
| `supabase/` (frozen) | `npx --yes deno@2 test --node-modules-dir=none --allow-env --allow-read supabase/tests/` |

A Vercel check that fails on a PR that doesn't touch `web/` is usually the Vercel project setting, not the PR. Confirm
with a clean `web/` build.

---

## 9. Merging

1. Final check: `gh pr view <n> --json mergeStateStatus,headRefOid` is `CLEAN`, and the tip is the commit you
   tested.
2. Merge with a merge commit, the way this repo always has:
   `gh pr merge <n> --merge`
   Don't squash or rebase: the other sessions' branches are built on these commits.
3. Don't delete the branch unless its session is finished (GitHub doesn't auto-delete here).
4. Mark it merged in your queue.

**Right after each merge:**
- Tell the PR's session it's merged.
- Tell every session whose open PR overlaps it to `git fetch && git merge origin/main`, and say which files will
  conflict.
- **Auto-ship (Caleb, Oct 25: "after u receive new fixes/feature PRs, auto ship them to testflight and notify me so i can
  test them in the app"):** a merged fix/feature PR goes out without asking, from a clean copy of merged main, in
  this order: Convex if `convex/` changed (`npx convex deploy --preview-name hackathon -y`, never `--preview-create`)
  → `voice/deploy.sh` if `voice/` changed → one EAS Update to `production` if `app/` changed → restart the laptop
  pipeline worker if `pipeline/` changed. PRs that land close together share one update. A native change (new
  native module or app.json plugin) needs a TestFlight build (`eas build -p ios --profile production --auto-submit`).
  Tell the PR's session not to deploy (only the Merge Agent ships, so there are never two EAS Updates), log the
  versions in STATE.md, then tell Caleb what to test. Docs-only PRs need no deploy. Supabase `api` deploys and
  destructive data changes still need his explicit OK. See `memory/auto-ship-merged-prs.md`.

---

## 10. Testing two PRs together before either merges

When two big PRs will collide and you want to see the result before picking an order:

```bash
git worktree add ../merge-try origin/main && cd ../merge-try
git switch -c try/<a>-<b>
git merge --no-edit origin/<branch-a>
git merge --no-edit origin/<branch-b>   # resolve here to see what it takes
# run the tests from section 8
```

Never push `try/` branches. Throw it away afterwards (`git worktree remove ../merge-try`). This tells you how hard
the conflict is and which order is easier, without changing anyone's branch.

---

## 11. Stop and ask Caleb when

- A PR adds or changes anything near secrets, keys, IAM or `.env`.
- A schema change would fail on the live data, or needs a migration.
- Two PRs disagree about what the product does, not how the code does it.
- A PR deletes a feature, screen or file that another track uses.
- A session asks you to merge something its own permissions blocked.
- Merging would change `app/app.json` runtime version or `eas.json` channels (it decides which phones get the
  update; TestFlight is live).

When you ask, keep it to one question with the options, so he can answer in five seconds.

---

## 12. Message templates

**Approve and merge:**
> #31 merged (merge commit). Checked: vitest and tsc on the merged tip. Your STATE line is in. Needs a Convex deploy;
> I've told Caleb.

**Send back:**
> #33 isn't ready: `app/src/lib/live/convex.ts` still calls `recipes.get` with `{id}`, but #31 (merged) changed it
> to `{recipeId}`. Please `git merge origin/main`, update the call, rerun `npx tsc --noEmit`, and ping me.

**Heads-up to an overlapping PR:**
> #31 just merged and touches `convex/schema.ts`. Your #34 will conflict there. Keep both new fields, regenerate
> `_generated` with `npx convex codegen`, and resend.

**Ask Caleb:**
> #35 and #36 both change the cook screen's top bar. #35: the step number stays. #36: the step number becomes a
> progress bar. Which?

---

## Quick checklist

1. Intake: the message has the number, files, what it checked, depends-on and deploy needs.
2. Triage: overlaps with other open PRs, hot files, hidden contract changes.
3. Order: demo fixes → producers → dependencies → small → oldest. No freeze (Caleb, Oct 24).
4. Review: secrets, junk files, tests (you are the CI), STATE line, brand, `CLEAN`.
5. Conflicts: mechanical ones by the fixed rules; real ones by intent → docs order → contract → data → Caleb.
6. Merge with `--merge`, then tell the PR's session and the overlapping sessions.
7. Auto-ship the merged fix/feature to TestFlight (Convex → voice → EAS Update → worker), log it in STATE, tell Caleb what to test.

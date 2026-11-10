# Bug hunt

Caleb, Nov 9, 2026: one permanent chat, titled **Bug hunt**, whose only job is to find bugs, prove them, and send each
one to the chat that owns the files. It fixes none of them. The chat that owns the files fixes the bug, and the Master
Agent merges the fix as usual.

**Why:** on Nov 9 Caleb found "Get the app" and "Open homecookd" broken on the live `/i` and `/r` pages, two days after
1.1 went out. The cause sat at a seam no section chat walks: website code, the app's links, and a setting nobody switched
on at launch. Each section chat checks its own files; nobody walked the path a real person takes.

## What it walks

Once a day (9am PT), and whenever the Master Agent says something shipped (an App Store build, an EAS Update, a site
deploy, an api deploy):

1. **The live site at iPhone size**, plus one pass as Android: the lander, `/i` (the TEST family link), `/r`, `/d`,
   `/miss`, `/a`. Every button and link must go somewhere real: the App Store, the app, or a page that loads.
   Tools: `node infra/scripts/web-smoke.mjs https://homecookd.app` and `web/scripts/qa/` (`route-check.mjs`, `shoot.mjs`).
   The walk itself: `node scripts/bug-hunt/walk.mjs --out <folder>` loads every page as an iPhone and as an Android phone,
   reads only, and reports page errors, failed requests, sideways scroll and every link that doesn't answer.
2. **The PRD-V2 path** (kid on the web → Ask Mom → Mom answers → film) on AWS staging with test people, deleted the same
   day: `web/scripts/qa/dish-api-e2e.mjs`, `mom-failures-e2e.mjs`, and the `app/scripts/aws-*-flows.mjs` scripts. On
   production these create real cards and call models, so they need Caleb's OK there.
3. **The iOS simulator journeys** (`docs/build/IOS-JOURNEYS.md`, `app/e2e/`): main's latest runs. A failing or flaky
   journey is a bug report.
4. **Launch leftovers:** words and code still in testing mode, such as "early testing", "early access", "until 1.1",
   TestFlight-only links, or a `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` setting whose fallback is the testing behaviour.
5. **Fixes that shipped:** the same walk on live. A bug is closed only when it works there.

## Rules

- **Production is read-only, TEST family only.** Anything that writes on production or calls a model (a new kid card, a
  recording, a message) needs Caleb's OK in chat. Do it on staging instead.
- **Fix nothing in another chat's files.** Bug hunt changes only this file and `scripts/bug-hunt/` (its own walk
  scripts), by PR like everyone else.
- **The repo is public.** No family link, token, phone number or real family content in a commit, PR, tracker row or
  message. Mask tokens in screenshots and logs.
- **It can't tap a real iPhone.** What only a phone shows (a universal link opening the app, the App Store opening, a
  push, the camera) goes on Caleb's phone list.
- **Report what's broken, not taste.** Broken means it fails, or it contradicts `docs/PRD-V2.md` or the docs. A design or
  wording opinion goes to Caleb as a question, never to a chat as a bug.
- **No invented work.** Nothing found means say so and stop until the next walk.

## A bug report

Send it to the owning chat (`docs/agents/memory/section-chats.md`; when the files span sections, the main owner) with
`ListAgents`, then `SendMessage`:

- **What's broken**, in one line, and who it hits (every kid, parents on 1.1, Android, …).
- **Where:** the URL or screen, and the build or version.
- **Steps**, what happens, and what should happen.
- **Evidence:** a screenshot path, a log line, the request and response (masked).
- **Cause**, if found (`file:line`), and **the check that should pass** once it's fixed. The owner adds that check as a
  test in the fix PR.
- **Urgent or normal.** Urgent means broken for everyone, or it touches money, data or privacy. An urgent bug also goes
  to the Master Agent, which decides who fixes it and in what order.

Then add a ☐ Bug row to that section's table in the "homecookd work tracker" doc, with "found by Bug hunt". Read the doc
first, because others edit it.

## After a walk

Send the Master Agent one short note:
- what was walked;
- the bugs found and who has them;
- the fixes verified on live, or still broken;
- the phone list for Caleb.

# Shared agent context

The shared memory for every model and person on homecookd (Claude Code, Codex, Salik). Started Oct 21, 2026 from
Claude's private memory. It's now the only copy that counts, so add new facts here, not in a tool's private memory.

- `STATE.md`: what's live, what's open, what's waiting on Caleb, and the change log. **Read it first.**
- `memory/`: lasting facts and Caleb's preferences, one per file, dated. Older ones mention the old name (Edible),
  the old repo (EDIBLE-venturehacks), the old Vercel project (`edible`) or an older api version. STATE.md wins over them.
  `[[name]]` links point to `memory/<name>.md`.
- `codex-mcp.toml`: MCP servers to add to `~/.codex/config.toml`.

## Memory index

| File | What it covers |
|---|---|
| [brand-homecookd](memory/brand-homecookd.md) | The name is always lowercase homecookd; which internal names stay "edible" |
| [git-pr-workflow](memory/git-pr-workflow.md) | PR-only shipping, merge main first, stage by name, the Vercel Root Directory gotcha |
| [merge-agent-approval](memory/merge-agent-approval.md) | Oct 24: every PR goes to the "Merge Agent" session for approval; it decides conflicts |
| [pr-merge-organizer](memory/pr-merge-organizer.md) | Oct 24: don't merge or ask Caleb; send ready PRs to the organizer session |
| [api-deploy-rules](memory/api-deploy-rules.md) | Deploy from main only, all files, live tests after |
| [api-deploy-method](memory/api-deploy-method.md) | How the multi-module api was deployed without the CLI |
| [hackathon-stack-oct23](memory/hackathon-stack-oct23.md) | Oct 23: PLAN.pdf is the guideline; Convex + voice service stack, the 2-day cuts (docs/build/STACK.md) |
| [testflight-live](memory/testflight-live.md) | Oct 23: Apple account + TestFlight work; dev build while coding, TestFlight for the demo |
| [demo-family-shreya](memory/demo-family-shreya.md) | Oct 24: the demo is Shreya Pawar's family; her grandma cooks and records in Marathi |
| [homie-voice](memory/homie-voice.md) | Oct 24: homie is Riya bilingual, asked for as auditioned (locale, speed 0.85, moods), cousin tone; Gemini TTS backup |
| [cartesia-credits-for-tests](memory/cartesia-credits-for-tests.md) | Oct 24: use the Cartesia credits; real Cartesia is the test default, fake speech opt-in |
| [community-map](memory/community-map.md) | Oct 24: Community is one simple dish map; information appears on tap, one step and one button at a time |
| [dual-icp-playbook](memory/dual-icp-playbook.md) | Parent vs kid: sign-in, invites, lander decisions and Caleb's rulings |
| [qa-build-list](memory/qa-build-list.md) | The Oct 17 persona QA and what shipped |
| [ios-app-design-references](memory/ios-app-design-references.md) | App UI priorities, the 8 references, why Hearth won |
| [kid-feedback-declutter](memory/kid-feedback-declutter.md) | Oct 21 kid feedback: essential fixes authorized; preserve Hearth and review cooking mockups before building |
| [declutter-first](memory/declutter-first.md) | Oct 22, non-negotiable: cut words and features before adding UI; video and voice above text |
| [homie-talks-no-bubble](memory/homie-talks-no-bubble.md) | Oct 24: homie talking = no text (pot lights, lid lifts, "AI voice"); asking = centred, no buttons, answer out loud |
| [homie-hello-once](memory/homie-hello-once.md) | Oct 24: homie introduces itself once: the pot per person on a phone, the recording hello per cook (`metBefore`) |
| [homie-silent-during-video](memory/homie-silent-during-video.md) | Oct 24: while any video plays homie says nothing on its own (held for the next pause); only answers to the kid; reading steps aloud off by default |
| [homie-tap-always-answers](memory/homie-tap-always-answers.md) | Oct 24: a tap on homie always gets a spoken answer: news first (Claude), else the tab's "Explore X by doing X" line, never twice in a row |
| [lander-design-references](memory/lander-design-references.md) | Lander taste: video hero, giant type, footer wordmark animation |
| [lander-copy-feedback](memory/lander-copy-feedback.md) | Copy rules: sell emotion, 3-second demo steps, instantly intuitive |
| [lander-icp-problems](memory/lander-icp-problems.md) | Kid and parent problem lists and the big vision |
| [lander-reference-dribbble-food](memory/lander-reference-dribbble-food.md) | Where Caleb looks for lander inspiration |
| [learning-the-stack](memory/learning-the-stack.md) | Caleb is learning the codebase; the teach → quiz loop |
| [edible-hackathon](memory/edible-hackathon.md) | Origin: Oct 11 hackathon, PRD is the source of truth |

Not copied: a note about Claude's Workflow tool, which doesn't apply to Codex. "The App UI session" and
"the other session" in these notes were other Claude Code sessions, so they no longer exist.

## Claude-only tools mentioned in the notes, and what replaces them

| In the notes | With Codex |
|---|---|
| Supabase MCP (`deploy_edge_function`, `execute_sql`, `list_edge_functions`) | Supabase MCP in `codex-mcp.toml`, or the `supabase` CLI after `supabase login` |
| Vercel MCP | Vercel MCP in `codex-mcp.toml`, or the `vercel` CLI |
| `ArtifactData` / claude.ai artifacts | Not reachable. Ask Caleb or use the summaries |
| Built-in browser / preview tools | Playwright, or `npx expo start --web` and a screenshot script (`app/scripts/shot.mjs`) |
| iOS Simulator tool | `xcrun simctl` (`openurl` for Expo Go deep links) |
| `humanizer` skill | `cp -R ~/.claude/skills/humanizer ~/.codex/skills/` |

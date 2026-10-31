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
| [v2-user-pathway](memory/v2-user-pathway.md) | Oct 29: the next version is built around one user pathway (kid on the web → Ask Mom → parent answers by voice → film in the app); docs/PRD-V2.md |
| [app-review-guard](memory/app-review-guard.md) | A PR touching what App Review checks: Apple check first, then update the reviewer notes, answers and legal pages in the same PR |
| [brand-homecookd](memory/brand-homecookd.md) | The name is always lowercase homecookd; which internal names stay "edible" |
| [brand-egg](memory/brand-egg.md) | Oct 30: the logo and mascot are a smiling egg (the pot is retired); palette Kitchen tile: pale sage page, ink, yolk (main), bottle green (second); no lavender or peach; `docs/brand/` |
| [git-pr-workflow](memory/git-pr-workflow.md) | PR-only shipping, merge main first, stage by name, the Vercel Root Directory gotcha |
| [merge-agent-approval](memory/merge-agent-approval.md) | Oct 24: every PR goes to the "Merge Agent" session for approval; it decides conflicts |
| [auto-ship-merged-prs](memory/auto-ship-merged-prs.md) | Oct 25: the Merge Agent ships each merged fix/feature PR to TestFlight without asking, then tells Caleb what to test |
| [section-chats](memory/section-chats.md) | Oct 26: one permanent chat owns each codebase section; the Merge Agent routes work to them |
| [claude-cost-settings](memory/claude-cost-settings.md) | Oct 26: homie's recording check on Haiku, Opus fast mode off, to keep Claude spend down |
| [eval-cheap-by-default](memory/eval-cheap-by-default.md) | Oct 28: the language eval runs only the languages a change touches, 5-min clips, Batch API, $3 cap |
| [pr-merge-organizer](memory/pr-merge-organizer.md) | Oct 24: don't merge or ask Caleb; send ready PRs to the organizer session |
| [api-deploy-rules](memory/api-deploy-rules.md) | Deploy from main only, all files, live tests after |
| [api-deploy-method](memory/api-deploy-method.md) | How the multi-module api was deployed without the CLI |
| [hackathon-stack-oct23](memory/hackathon-stack-oct23.md) | Oct 23: PLAN.pdf is the guideline; Convex + voice service stack, the 2-day cuts (docs/build/STACK.md) |
| [testflight-live](memory/testflight-live.md) | Oct 23: Apple account + TestFlight work; dev build while coding, TestFlight for the demo |
| [demo-family-shreya](memory/demo-family-shreya.md) | Oct 24: the demo is Shreya Pawar's family; her grandma cooks and records in Marathi |
| [demo-test-dishes](memory/demo-test-dishes.md) | Oct 24: demos, examples and tests use Swordfish steak and Poha (real dishes, real footage) |
| [homie-off](memory/homie-off.md) | Oct 29: homie's voice is switched off for launch (`lib/homie/switch.ts`); no code deleted; legal text left as is |
| [homie-voice](memory/homie-voice.md) | Oct 24: homie is Riya bilingual, asked for as auditioned (locale, speed 0.85, moods), cousin tone; Gemini TTS backup |
| [cook-languages](memory/cook-languages.md) | Oct 24: 12 more cook languages on Cartesia (ink-whisper) + Claude, no Gemini; Oct 26: the cook's whole app in her language (language screen, `lib/words`) |
| [marathi-dropped](memory/marathi-dropped.md) | Oct 26: Marathi is no longer a cook language; 13 integrated languages (English + 12) |
| [gemini-credits-nearly-gone](memory/gemini-credits-nearly-gone.md) | Oct 24: Gemini has ~$10 left; new model calls use Claude (text, images) or Cartesia (audio) |
| [claude-cartesia-quality-first](memory/claude-cartesia-quality-first.md) | Oct 26: Claude + Cartesia run the whole AI backend (Muse goes too); quality first, then the cheapest model that holds it |
| [model-migration-after-hackathon](memory/model-migration-after-hackathon.md) | Oct 24: the move off Gemini starts after Sun Oct 25, 8pm; one PR per step, each behind an env flag with Gemini as the rollback |
| [cartesia-credits-for-tests](memory/cartesia-credits-for-tests.md) | Oct 24: use the Cartesia credits; real Cartesia is the test default, fake speech opt-in |
| [community-map](memory/community-map.md) | Oct 24: Community is one simple dish map; information appears on tap, one step and one button at a time |
| [dual-icp-playbook](memory/dual-icp-playbook.md) | Parent vs kid: sign-in, invites, lander decisions and Caleb's rulings |
| [qa-build-list](memory/qa-build-list.md) | The Oct 17 persona QA and what shipped |
| [ios-app-design-references](memory/ios-app-design-references.md) | App UI priorities, the 8 references, why Hearth won |
| [kid-feedback-declutter](memory/kid-feedback-declutter.md) | Oct 21 kid feedback: essential fixes authorized; preserve Hearth and review cooking mockups before building |
| [declutter-first](memory/declutter-first.md) | Oct 22, non-negotiable: cut words and features before adding UI; video and voice above text |
| [homie-talks-no-bubble](memory/homie-talks-no-bubble.md) | Oct 24: homie talking = no text (pot lights, lid lifts, "AI voice"); asking = centred, no buttons, answer out loud |
| [homie-hello-once](memory/homie-hello-once.md) | Oct 24: homie introduces itself once: the pot per person on a phone, the recording hello per cook (`metBefore`) |
| [homie-guidance-only](memory/homie-guidance-only.md) | Oct 24: while a cook films, homie gives guidance (how much, show it to the camera, the plate), never cooking advice |
| [homie-waits-for-answers](memory/homie-waits-for-answers.md) | Oct 24: the wrap-up waits for her whole answer (3.5 s / 4 s Marathi of quiet), never talks over her; quiet 5 s → "still there?", 5 s more → a kind let-off, no more questions; "not now" skips one |
| [homie-counts-end-questions](memory/homie-counts-end-questions.md) | Oct 25: after "I'm done" homie says how many questions it has (and the plate photo), asks them back to back, and the app keeps homie big in the middle until they're over (`hold`) |
| [in-app-recording](memory/in-app-recording.md) | Oct 24: phone recording films inside the app at 1080p (VisionCamera 4) so homie stays live; the audio-session rules; the flip-camera button (a file boundary while filming, video not mirrored) |
| [community-tab-off](memory/community-tab-off.md) | Oct 25: the kid's Community tab is hidden (hackathon only); the code stays so it can come back |
| [never-signed-out-by-a-crash](memory/never-signed-out-by-a-crash.md) | Oct 24: a crash or a passing error never signs anyone out (only Sign out or the exact "This phone was signed out." 401 forget the key); an in-app recording the app dies on after "I'm done" (or a Send upload) is sent again; one it dies in while filming is offered on Home (Oct 26) |
| [homie-silent-during-video](memory/homie-silent-during-video.md) | Oct 24: while any video plays homie says nothing on its own (held for the next pause); only answers to the kid; reading steps aloud off by default |
| [homie-tap-always-answers](memory/homie-tap-always-answers.md) | Oct 24: a tap on homie always gets a spoken answer: news first (Claude), else the screen's one line about its big button; "I'm right here." on a repeat tap |
| [homie-judges-who-was-talking](memory/homie-judges-who-was-talking.md) | Oct 24: in cook mode Claude judges whether the kid was talking to homie (silent if not); "homie" spelled loosely is a strong yes; no wake word |
| [homie-docked-cook-bar](memory/homie-docked-cook-bar.md) | Oct 24: cook mode is Back · homie · Next (even spacing), homie like Siri, no chips; tap asks, long press mutes; one smooth expand, light blur |
| [homie-siri-states](memory/homie-siri-states.md) | Oct 24: Siri-like states (off white · lit halo · listening ring · thinking · speaking), truthful to the mic; a tap is on/off, never navigates |
| [homie-mic-on-demand](memory/homie-mic-on-demand.md) | Oct 24: the mic is on only when homie is tapped on, or 8 s after a step line or nudge; cost numbers per cook and per 1M credits |
| [homie-step-lines](memory/homie-step-lines.md) | Oct 24: every step change says the step's short line at once, Sonic audio made ahead and cached; no read-aloud offer |
| [homie-size-and-centre](memory/homie-size-and-centre.md) | Oct 24: homie is as tall as its neighbours (48 header, 60 bar), drawn at real size, centred when the row is symmetric |
| [homie-no-guessed-roles](memory/homie-no-guessed-roles.md) | Oct 24: homie never guesses a family role or gender; names and the family's word, else "your family" / "your loved one" |
| [homie-tap-hold-and-audio-handoff](memory/homie-tap-hold-and-audio-handoff.md) | Oct 25: cook mode tap = homie on (talks, then listens), hold = "Ask <cook> anything"; whatever was tapped last (homie or video) has the sound |
| [unanswered-part-is-approved](memory/unanswered-part-is-approved.md) | Oct 24, Caleb: a part of a proposal he doesn't reply to is approved as proposed |
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

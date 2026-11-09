# Explicit state machines, one machine per PR (Caleb, Nov 8, 2026)

**The decision.** After two production freezes on launch day (#402, #410: BottomSheet's flags plus ~20 callers'
hard-coded "wait for the sheet" delays), Caleb asked for every implicit state machine to be made explicit in a way
that "will elevate all three: the user experience (UX), developer experience (DX), and agent experience (AX) always,
without breaking anything." A read-only survey found 55 (app 14, api 15, pipeline 14, web 12). The ranked list, the
pattern and the rollout: `docs/agents/STATE-MACHINES.md` (the write-up Caleb read is a private artifact; this file and
the index are the repo's copy).

**Why.** Impossible states are the bugs users hit; one table instead of twenty files is what a developer edits; a table
plus a real transition test is what an agent reads instead of re-deriving the lifecycle from scattered ifs, which is
how the first freeze was misdiagnosed.

**How to apply.** One small, dependency-free pattern per language, the same words everywhere:
- TypeScript (app, web): a pure module exporting `states`, `events` and `transition(state, event) → state | null`, plus
  one `useMachine` hook. Components send events and never set flags. A `null` transition is a no-op (logged in dev).
- Postgres (api): the lifecycle column has a CHECK; every transition is a conditional UPDATE that names the state it
  leaves and reports whether a row changed; derived states (expired, paused, zombie) live in one view or function.
  Model: the move-request flow.
- Python (pipeline): a `Lifecycle` enum, an `ALLOWED` set of `(from, to)` pairs and `advance()`; any file that doubles
  as a state marker is written with a temp file and an atomic rename.
Each machine is its own PR by its owner chat. The Master Agent merges a lifecycle PR only with (1) the table, (2) a real
test of every state × event (not a regex on source), and (3) identical behaviour, or a bug Caleb approved by name.
**CI (Nov 8):** a machine file carries `state-machine-test: <its test>` as a header line, and `scripts/check-machine-tests.mjs` (CI's `changes` job) fails a PR that changes the file without the test. Add the marker when you make a machine explicit.
Each machine's file starts with a 20-line block: states, events, guards, the one invariant. Add every machine to
`docs/agents/STATE-MACHINES.md`.

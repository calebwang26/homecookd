---
name: cartesia-credits-for-tests
description: "Oct 24: use the Cartesia credits for real voice tests; real Cartesia is the test default, fake speech is opt-in"
metadata:
  type: feedback
---

On 2026-10-24 Caleb said: "we have 1.24 million credits - use it for tests to ensure quality of the cartesia
functions and voice".

**Why:** homie's voice is the product's feel; only a real Ink 2 + Sonic run shows whether the voice, the
transcription and the timing are right. The waste worth cutting is in real use (a socket left open streams silence
at 3 credits a second), not in testing.

**How to apply:**
- Voice tests use real Cartesia by default: `test-client` and `test-record` stream to real Ink 2 and Sonic (#45).
  Fake speech (`FAKE=1` against `npm run dev:fake`) is only an opt-in for quick offline checks.
- Every PR that touches `voice/` gets a live run before it's called done: the kid client and `test-record` in
  Marathi and English, on a local `VOICE_STUB=1` service (check the port is free first). Report the numbers.
- The Merge Agent runs a live voice test too for PRs touching `voice/` (`docs/agents/MERGE-PLAYBOOK.md`, the checks
  table).
- When a voice setting changes, render listening samples of homie's real lines and send them to Caleb.
- Unit tests (`npm test`) still use fakes: they must run with no keys or network.

Related: [[homie-voice]]

# Glasses through the laptop bridge

The edible-glasses firmware streams to a laptop over UDP, not to the VM. The laptop's receiver, run with `--cloud` (`receiver/cloud_bridge.py` in edible-glasses), connects that stream to everything here. It also adds the two things the direct path doesn't have: a full backup and live analysis.

```
glasses --UDP--> laptop receiver --+-- sessions/<sid>/raw/*.bin                      (lossless local copy)
                                   +-- ws  VM /ingest, ~8 fps + audio                  (INGEST.md format; homie's /frame/latest)
                                   +-- gs://<uploads>/glasses-backup/<rid>/<sid>/raw/   (every minute)
                                   +-- 30 s windows -> Gemini -> Convex /glasses/live-events
                                   +-- on "ended": full video from the backup -> gs://<uploads>/glasses-<rid>/NN.mp4
                                                   -> Convex /glasses/finished (with videoGaps)
```

## Pairing

The laptop polls `/glasses/active` every 2 s, as the VM does, with `x-glasses-secret`. It binds every glasses session that is streaming to the live glasses recording.

- **Glasses reboot mid-cook:** the glasses get a new session id, which becomes the next clip (`02.mp4`). The worker already takes a folder of clips.
- **Before the recording starts:** the laptop keeps what the glasses sent before it went to `recording`. The intro is in the video too. The VM drops it.

## Who uploads the video

The laptop and the VM both try to upload. The laptop usually wins.

- **The laptop's video:** built from everything it saved. Any `--sd` copy from the glasses fills more gaps. Lost Wi-Fi to the cloud never shows in the recipe.
- **The VM's head start rule:** when the hello says `fw: "edible-glasses-bridge …"`, the VM waits `BRIDGE_GRACE_S` (180 s) after "ended" before it muxes its own copy.
- **When the VM's turn comes:** it asks `/glasses/active {recordingId}`.
  - If the reply has a `jobId`, the laptop already finished. The VM drops its copy and stops.
  - If there is no `jobId`, it uploads as before. The VM stays the fallback.
- **If both upload anyway:** `ifGenerationMatch=0` means the second upload of `01.mp4` gets "already there". `/glasses/finished` returns the existing job.

Only the video goes under `glasses-<rid>/`, because the worker treats every object there as a clip. Backups and gap lists go under `glasses-backup/<rid>/`. Both live in the uploads bucket, so the 14-day lifecycle applies.

## Live analysis → Convex

`POST /glasses/live-events` (`x-glasses-secret`), one call per window:

```json
{"recordingId": "...", "sessionId": "<glasses session>", "sessionStartedAt": 1761300000000,
 "windowStartS": 30, "windowEndS": 60, "ok": true, "reason": "only when ok is false",
 "events": [{"kind": "step|ingredient|cue|quote|story|marker", "atS": 32.5, "endS": 50,
             "title": "Fry the onions", "text": "...", "saidAs": "thoda sa", "quoteOriginal": "...",
             "confidence": 0.8}]}
```

- **Times:** glasses-session seconds, which start at `sessionStartedAt`.
- **Failed windows:** a window that failed, fell behind or had no footage arrives with `ok: false`. It still carries the cook's button taps (`marker`).
- **Where it's stored:** `liveWindows` and `liveEvents` in `convex/schema.ts`.
- **For the app:** `liveEvents.forRecording` gives the live log, in wall-clock ms.
- **For the worker:** `/worker/claim` adds three lists, all in video seconds from `videoStartedAt`:
  - `liveLog`, the events
  - `liveGaps`, the windows that weren't analysed
  - `videoGaps`, spans with no footage even in the backup
- **In the prompts:** `pipeline/prompts.py live_block` turns these into hints for extraction and the merge. The video wins over a note. A note inside a video gap is kept as the only record of that moment.

## Tests

- `npx vitest run convex/glasses.test.ts`
- `.venv/bin/python glasses/ingest/test_server.py` (the `test_bridge_*` cases)
- `.venv/bin/python pipeline/test_prompts.py`
- In edible-glasses: `pytest tests/test_cloud_bridge.py`

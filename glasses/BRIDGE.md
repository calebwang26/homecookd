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
- **The VM's head start rule:** when the hello says `fw: "edible-glasses-bridge …"`, the VM waits `BRIDGE_GRACE_S` (30 min) after "ended" before it muxes its own copy.
- **When the VM's turn comes:** it asks `/glasses/active {recordingId}`.
  - If the reply has a `jobId`, the laptop already finished. The VM drops its copy and stops.
  - If there is no `jobId`, it uploads as before. The VM stays the fallback.
- **If both upload anyway:** `ifGenerationMatch=0` means the second upload of `01.mp4` gets "already there". `/glasses/finished` returns the existing job.

Only the video goes under `glasses-<rid>/`, because the worker treats every object there as a clip. Backups and gap lists go under `glasses-backup/<rid>/`. Both live in the uploads bucket, so the 14-day lifecycle applies.

## Demo path: the cook saves the video herself (no automatic job)

By default the laptop does not create a job on "I'm done". It builds the full video from its backup (15 fps), uploads it to the public media bucket as `glasses-<rid>/full.mp4`, and reports it with `POST /glasses/video`. The VM sees `videoSaved` in `/glasses/active` and stands down. On Record, `components/record/GlassesVideoCard` (from `glasses.videos`) says "on its way" while the laptop builds, then shows **Save to Photos**: it downloads the video and opens the share sheet, where "Save Video" puts it in Photos. She sends it with Start recording → Videos I took, which makes the one job. `--auto-job` brings back the automatic job. On the laptop, `tools/run_receiver.sh` runs it all and restarts it if it stops.

Every job still in the pipeline gets a progress row on Home and Recipes, including jobs this phone didn't send. Its × calls `jobs.cancel`, and a cancelled job ignores the worker. `npx convex run jobs:cancelUnfinished` clears the whole queue.

## Live picture → the cook's phone

About seven times a second (the receiver's `--frame-every 0.15`, up to 3 uploads in flight), the laptop sends the newest JPEG to `POST /glasses/frame?recordingId=<id>&session=<glasses session>&t=<ms>` (`x-glasses-secret`, raw `image/jpeg`, at most 512 KB). Convex drops a frame older than the one it keeps, from the same glasses session. Convex keeps one frame per recording in `liveFrames`, plus its file in storage, and deletes the previous file each time. Frames for a recording that has ended are refused. `liveEvents.frame` gives the recording screen the frame's URL and time. `components/record/GlassesView` shows the picture with "Glasses live", or "Waiting for your glasses…" once the frame is over 5 s old. `--frame-every` sets how often it sends (0 turns it off). The video uploaded on "I'm done" is built at 15 fps (`--cloud-fps`), so the recipe's video plays smoothly. The AI still samples it at 1 fps.

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

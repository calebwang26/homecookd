# Glasses → VM ingest (contract for the firmware)

Our ESP32-S3 glasses (camera + mic + Wi-Fi) stream to a small always-free Google Cloud VM, not to a laptop
or the phone. The VM saves the stream, and when the cook says "I'm done" on her phone it makes one MP4, uploads it
to the GCS uploads bucket and creates the Convex job. homie's live questions come from the phone's mic
(STACK.md, "homie while recording"); the glasses' audio only goes into the video.

```
ESP32 ──ws──► VM /ingest ──► disk (frames + PCM) ──ffmpeg──► MP4 (H.264 + AAC) ──► gs://<uploads>/glasses-<recordingId>/01.mp4
                 │                                                                   └──► Convex /glasses/finished → job
                 └── GET /frame/latest (voice service, every ~5 s, x-glasses-secret)
```

Glasses that stream to a laptop instead (edible-glasses, `receiver.py --cloud`) reach the VM through the laptop bridge;
see BRIDGE.md.

## What the firmware sends

One WebSocket: `ws://<vm-ip>:8090/ingest?device=<GLASSES_DEVICE_KEY>`. Use a phone hotspot at the venue
(guest Wi-Fi often blocks it, and the ESP32 is 2.4 GHz only). Reconnect with backoff whenever it drops; the VM
appends to the same recording.

Every message is binary, with a 13-byte header, then the payload:

| Bytes | Field |
|---|---|
| 0 | kind: `1` = JPEG frame, `2` = PCM audio |
| 1–8 | device time in microseconds since boot (uint64, little-endian), when the frame or the first sample was captured |
| 9–12 | payload length in bytes (uint32, little-endian) |
| 13… | payload |

- **Video:** baseline JPEG, 640×480 (VGA) or smaller, 5–10 fps is plenty. Gemini reads 1 fps; the kid's clips
  look better at higher rates.
- **Audio:** 16 kHz mono signed 16-bit little-endian PCM, ~100 ms per message (3200 bytes). Send it continuously,
  including silence. Device times must come from the same clock as the frames.
- **Hello:** the first text message after connecting is `{"type":"hello","fw":"<version>","w":640,"h":480,"fps":8}`.
- **Keepalive:** the VM pings every 15 s; the ESP32 library's automatic pong is enough.

The VM answers with text messages: `{"type":"ready"}`, `{"type":"recording","recordingId":"…"}` once the cook
has started on her phone (frames sent before that are dropped), and `{"type":"stopped"}` when she says "I'm done".
The firmware can ignore them. They're there for an LED, if there is one.

## What the VM does (`glasses/ingest/`)

- Checks `device` against `GLASSES_DEVICE_KEY`.
- Every 2 s, asks Convex `/glasses/active` which recording is live. It writes frames and PCM to
  `/var/glasses/<recordingId>/` with the device timestamps, and maps device time to wall clock from the first
  message after each recording starts (`videoStartedAt` = wall-clock ms of the first kept frame).
- On `ended` (or 60 s with no data while `wrapping_up`), it muxes with ffmpeg: frames at their real timestamps
  (variable frame rate → constant 15 fps H.264) plus the PCM as AAC. Then it uploads the MP4 with the VM's service
  account and calls `/glasses/finished`.
- A recording that never ended (the phone died) stops getting the glasses once a newer one is live, or once it's
  over 12 h old. It's finished with what it has, and the frames go to the newer one.
- A recording with no frames (the glasses were off) fails right away; there's no video, so there's no job.
- Once the job exists, or the recording is abandoned or fails, it deletes the frames, audio and MP4. Only
  `meta.json` stays.
- Serves `GET /frame/latest?recording=<id>` (`x-glasses-secret`) with the newest JPEG, for homie, and `GET /health`
  (`{ok, glasses}`; the recording, frame count and upload queue only with `x-glasses-secret`).
- Runs on an e2-micro (us-central1 or us-west1, Free Tier) under systemd. `glasses/vm/setup.sh` creates it.
- `glasses/ingest/fake_glasses.py <video.mp4>` replays any video as frames + PCM in this format, so the path can be
  tested before the hardware is ready.

# Live feed setup (Mac)

**Cooking day? Read [MVP.md](MVP.md): two commands and five taps.**

Goal: glasses camera + microphone streaming live to your laptop, viewable at http://localhost:8000 and available to your own code.

What you need: the XIAO ESP32S3 Sense, a USB-C **data** cable, your power bank, your phone (hotspot), your Mac.

## A. Laptop software (one time, ~15 min)

1. Install Homebrew if you don't have it (paste in Terminal):
   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
2. Install Python and ffmpeg:
   ```
   brew install python ffmpeg
   ```
3. Unzip `edible-glasses.zip`, then in Terminal:
   ```
   cd ~/Downloads/edible-glasses        # wherever you unzipped it
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
4. Install **Arduino IDE 2** from https://www.arduino.cc/en/software and open it.
5. Arduino IDE > Settings > **Additional boards manager URLs**, paste:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
6. Tools > Board > Boards Manager, search **esp32**, install **"esp32 by Espressif Systems"** version **3.x** (this code is compile-tested on 3.3.12).

No USB driver is needed on a Mac.

## B. Put the board together (2 min)

1. Line up the camera board's connector with the one on the back of the main board and press until it clicks.
2. Snap the antenna onto the small gold socket on the main board: hook one edge in, press the other edge down. **Always attach the antenna before powering on.**
3. Stick on the heatsink from the box.

## C. Load the firmware (10 min)

1. Arduino IDE > File > Open > `firmware/edible_glasses/edible_glasses.ino`. Three tabs open: `edible_glasses.ino`, `config.h`, `glasses.cpp`.
2. In the **config.h** tab, put in your phone hotspot's exact name and password (case-sensitive):
   ```
   #define WIFI_NETWORKS { \
     {"Salik's iPhone", "yourpassword"}, \
   }
   ```
   Leave `RECEIVER_HOST` as `""`: the glasses find your laptop by themselves.
3. On the iPhone: Settings > Personal Hotspot > **Allow Others to Join** on, and **Maximize Compatibility** on (the board only does 2.4 GHz Wi-Fi). Campus eduroam will not work.
4. Plug the board into the Mac with the USB-C cable.
5. Tools menu:
   - Board > esp32 > **XIAO_ESP32S3**
   - Port > **/dev/cu.usbmodem…**
   - PSRAM > **OPI PSRAM**  (the camera fails without this)
   - Leave everything else at its default.
6. Click **Upload** (the → arrow). The first compile takes a few minutes.
   - If it can't find the board or the upload fails: hold the **BOOT** button, tap **RESET**, release BOOT, and click Upload again. Press RESET once when it finishes.
7. Tools > **Serial Monitor**, set to **115200 baud**, press RESET on the board. You should see the camera name (OV3660 or OV5640), the Wi-Fi network it joined, and `Ready. Streaming starts automatically`.

## D. Go live

1. Join your Mac to the **same phone hotspot**.
2. In Terminal, in the project folder:
   ```
   source .venv/bin/activate
   python receiver/receiver.py --no-build
   ```
   (`--no-build` = just stream and save the raw data. Drop it later to also build MP4s when you stop recording.)
3. macOS asks "Do you want the application Python to accept incoming network connections?" Click **Allow**. If you missed it: System Settings > Network > Firewall > Options, set Python to Allow.
4. Open **http://localhost:8000**. Within a few seconds the Serial Monitor prints `Found receiver at …`, the page turns green, and the camera appears. Click **Listen to the microphone** to hear it.
5. Unplug the board from the Mac and plug it into the power bank. It restarts and streams again on its own.

Board controls (the BOOT button): hold 1.5 s = stop / start, tap = step marker, double-tap = change mode. Orange LED on = streaming to the laptop; on with a blink every 2 s = recording but not reaching the laptop.

## E. Your own processing

Two ways to get the live data:

- **In Python:** edit `receiver/hooks.py`. `on_frame(jpeg, t, mode)` gets every frame, `on_audio(pcm, t)` gets every 100 ms of audio. Keep them fast; hand heavy work to a thread or queue.
- **From any program:** read `http://localhost:8000/video.mjpg` (MJPEG), `/latest.jpg`, `/audio.pcm` (raw 16-bit little-endian PCM, 16 kHz, mono, streamed), `/status.json`.

The audio is already the exact format Gemini's Live API takes (`audio/pcm;rate=16000`), and frames are JPEGs (`image/jpeg`). The Live API takes at most 1 frame per second, so send every other frame. Live transcription is a Live API setting (`input_audio_transcription`).

## F. Send it to homecookd (cloud, live analysis, backup)

`--cloud` connects the receiver to the homecookd app (Convex, the GCS buckets, the glasses VM):

1. One time: `cp .env.example .env` and fill it in from homecookd's `.env`, then `gcloud auth login` (for the uploads).
2. On the phone, start a glasses recording in the app as usual.
3. `python receiver/receiver.py --cloud`. Within 2 s of the glasses streaming, the receiver prints `paired with recording …`.

While the cook cooks, the receiver does four things:

- Saves everything to `sessions/` exactly as before.
- Relays about 8 fps and the audio to the VM, so homie can see.
- Copies the raw files to `gs://<uploads>/glasses-backup/<recording>/` every minute.
- Sends each 30 s of footage to Gemini and posts the steps it sees to Convex, where the app shows them live.

When the cook says "I'm done", the receiver builds the full video from its own copy (Wi-Fi drops to the cloud don't matter) and uploads it as `glasses-<recording>/01.mp4`. It then creates the recipe job, and the job uses the live notes as hints.

- **Data use:** the backup sends the raw stream, about 2 Mbit/s at the current 23 fps AI mode. A phone hotspot handles it. To use less, set `AI_FRAME_MS` in config.h (for example `125` for 8 fps).
- **Flags:**
  - `--no-live` skips Gemini.
  - `--relay-fps 0` skips the VM.
  - `--live-window 20` gives quicker but costlier live notes.
- **If the laptop dies before the upload finishes:** restart it with `--cloud`, which picks the recording up again. Or run it by hand:
  `python receiver/cloud_bridge.py finish sessions/<id> --recording <recordingId> [--sd /Volumes/SD/EDG/<id>.bin]`

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No port in Arduino / upload fails | Use a data cable (not charge-only); hold BOOT, tap RESET, release BOOT, upload again |
| `camera init failed` | Camera board not fully clicked in, or PSRAM not set to OPI PSRAM |
| Never joins Wi-Fi | Exact hotspot name/password; iPhone "Maximize Compatibility" on; keep the phone's hotspot screen open while it joins |
| Joins Wi-Fi but never `Found receiver` | Allow Python in the macOS firewall. Still nothing: on the Mac run `ipconfig getifaddr en0`, put that IP in `RECEIVER_HOST` in config.h, upload again |
| Picture upside down or mirrored | In glasses.cpp change `s->set_vflip(s, 1)` to `0`, or `set_hmirror` to `1`; upload again |
| Choppy video, freezes, or board very hot | In config.h set `AI_FRAME_SIZE` to `FRAMESIZE_VGA`, or `JPEG_QUALITY` to `20`; keep the heatsink on |
| Power bank switches itself off | Some banks cut out at low draw; try another bank or its "low current" mode |
| Silence on the audio | Check the level bar moves when you talk; the mic is the tiny hole on the camera board, keep it uncovered |

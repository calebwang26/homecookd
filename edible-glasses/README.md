# Edible capture glasses

**Start here: [SETUP.md](SETUP.md)** has the exact steps to get the live feed running (Mac). Live view at http://localhost:8000; your live-processing code goes in `receiver/hooks.py`.

Clip-on glasses that stream a cook's first-person video and voice to a laptop, which turns the session into the folder Edible's Gemini pipeline expects, and then into `recipe.json`.

```
glasses (firmware/)  --Wi-Fi-->  receiver.py  -->  sessions/<id>/  -->  extract.py (Gemini x4)  -->  recipe.json
        \-- microSD copy of every packet --> session_builder.py --sd  (fills Wi-Fi gaps)
```

## Folder map

| Path | What it is |
| --- | --- |
| `firmware/edible_glasses/` | Arduino sketch for the XIAO ESP32-S3 Sense. Edit `config.h`, code is in `glasses.cpp`. |
| `receiver/receiver.py` | Runs on the laptop. Live view on :8000, saves packets, cuts 15-min chunks live, builds the session folder on stop. |
| `receiver/live.py` | Browser live view, raw MJPEG / PCM streams, and the broadcast that lets the glasses find the laptop. |
| `receiver/hooks.py` | Your live-processing code: called for every frame, audio block and button event. |
| `receiver/session_builder.py` | Rebuilds a session folder from raw packets, optionally merging the SD-card copy. |
| `receiver/edg_protocol.py` | The packet format shared with the firmware. |
| `pipeline/extract.py` | Uploads each chunk to Gemini, gets structured steps back, then merges. |
| `pipeline/merge.py` | Chunk results to one recipe with session-time steps (dedupes the overlaps). |
| `pipeline/schema.py`, `prompt.md` | What Gemini is asked for and the JSON it must return. |
| `tools/fake_glasses.py` | Simulated glasses, so you can test everything before the parts arrive. |
| `tests/test_pipeline.py` | End-to-end test: fake glasses, Wi-Fi gap, SD backfill, fake Gemini, merge. |

## 1. Laptop setup (do this now, before parts arrive)

```bash
cd edible-glasses
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt pytest
brew install ffmpeg              # or: winget install ffmpeg
pytest -q tests                  # 4 tests, ~20 s, no hardware or API key needed
```

Try the live flow with fake glasses:

```bash
cd receiver
python receiver.py --cook "Ammi" --relationship mother --languages Urdu,English --dish "Chicken biryani"
# second terminal:
python ../tools/fake_glasses.py --seconds 120 --gap 40:50
```

## 2. Arduino setup (do this now too)

1. Install the Arduino IDE 2.
2. File > Preferences > Additional Boards Manager URLs: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. Tools > Board > Boards Manager: install **esp32 by Espressif, version 3.x** (tested to compile with 3.3.12).
4. Tools > Board: **XIAO_ESP32S3**. Tools > PSRAM: **OPI PSRAM** (the camera fails without it).
5. Open `firmware/edible_glasses/edible_glasses.ino` and put your Wi-Fi / hotspot name and password in `config.h`. Leave `RECEIVER_HOST` empty: the glasses find the laptop automatically.
6. Optional: if your board came with the **OV5640** autofocus camera, install the library *OV5640 Auto Focus for ESP32 Camera* ([github.com/0015/ESP32-OV5640-AF](https://github.com/0015/ESP32-OV5640-AF)) and uncomment `USE_OV5640_AF` in `config.h`. The Serial Monitor prints which camera you have at boot.

When the board arrives: plug in USB-C, Upload, open Serial Monitor at 115200. If the upload fails, hold **BOOT**, plug in USB, release, and upload again.

## No-solder build (default)

`config.h` ships with `NO_SOLDER_BUILD` on: the board runs from a USB-C power bank, the board's own orange LED is the recording light, and the SD card is unused. Nothing to solder. Comment out `NO_SOLDER_BUILD` once you've added the external LED on D0 to get SD backup back.

## 3. Using the glasses

| Action on the BOOT button | Effect |
| --- | --- |
| Hold 1.5 s | Stop or restart recording (it starts by itself at power-on). |
| Single tap | Step marker ("new step starts now"). |
| Double tap | Change mode: AI (720p, 2 fps) > playback (VGA, 10 fps) > simmer (1 frame / 8 s, voice-activated audio). |

LED solid = streaming to the laptop. LED blinking off briefly every 2 s = Wi-Fi lost (with the SD card fitted, still recording to it; in the no-solder build, that stretch is lost). LED flashes 3 times at power-on = no SD card (soldered build only).

## 4. After a session

```bash
# if receiver.py reported Wi-Fi gaps: put the glasses' microSD in the laptop, then
python receiver/session_builder.py sessions/<id> --sd /Volumes/<card>/EDG/<id>.bin

export GEMINI_API_KEY=...        # https://aistudio.google.com/apikey
python pipeline/extract.py sessions/<id>          # or run receiver.py with --extract to do this live
```

`sessions/<id>/recipe.json` has the title, cook, ingredients (with the cook's own words and an estimated amount) and timed steps (`start_s` / `end_s` into `full.mp4`), plus quotes, doneness cues and stories. Map it to the Expo app's recipe format in one small adapter.

Check the Gemini API data terms for your tier before uploading real family video; `extract.py` deletes each uploaded file after use.

## Known limits

- Battery runtime and fps on real hardware are untested estimates; measure them on the first build.
- The ESP32-S3 cannot read its own battery voltage without an extra wire, so there is no low-battery warning.
- `merge.py` writes Edible-style JSON; the field names may need renaming to match the app.

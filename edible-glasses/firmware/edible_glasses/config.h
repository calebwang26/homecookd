// ===== Edible capture glasses: settings you edit before flashing =====
#pragma once

// Wi-Fi networks to try, in order. Add your phone hotspot as a backup.
// (The ESP32-S3 only does 2.4 GHz Wi-Fi. On an iPhone hotspot turn on
// "Maximize Compatibility".)
// {"YOUR_HOME_WIFI", "YOUR_PASSWORD"},
#define WIFI_NETWORKS { \
  {"YOUR_HOTSPOT_NAME", "YOUR_HOTSPOT_PASSWORD"}, \
}

// The laptop running receiver/receiver.py.
// Leave RECEIVER_HOST empty ("") and the glasses find the laptop by itself:
// receiver.py broadcasts on DISCOVERY_PORT every second. Only fill in an IP
// (macOS: ipconfig getifaddr en0) if discovery doesn't work on your network.
#define RECEIVER_HOST ""
#define RECEIVER_PORT 7070
#define DISCOVERY_PORT 7071

// Start streaming as soon as the board powers on (no button press needed).
// Holding BOOT for 1.5 s still stops / restarts recording.
#define AUTO_START 1

// ---- No-solder build ----
// Leave this ON to use the board's own orange LED as the recording light.
// That LED shares GPIO21 with the SD card, so the SD card is NOT used
// (Wi-Fi gaps can't be backfilled). Comment it out once you've soldered
// an external LED to D0 and want SD backup back.
#define NO_SOLDER_BUILD

// Pins (XIAO ESP32-S3 Sense)
#ifdef NO_SOLDER_BUILD
#define LED_PIN        21   // onboard orange user LED
#define LED_ACTIVE_LOW 1    // it lights when the pin is LOW
#else
#define LED_PIN        1    // D0 -> 220 ohm -> red LED -> GND  (recording light)
#define LED_ACTIVE_LOW 0
#endif
#define BUTTON_PIN   0    // the board's own BOOT button; no wiring needed
#define SD_CS_PIN    21   // fixed by the Sense board
#define MIC_CLK_PIN  42   // fixed by the Sense board
#define MIC_DATA_PIN 41   // fixed by the Sense board

// Capture settings per mode (see the spec's "Capture modes" table)
#define AI_FRAME_MS        0     // CHANGED: up to 25 fps (was 100 = 10 fps)
#define PLAYBACK_FRAME_MS  100    // 10 fps
#define SIMMER_FRAME_MS    8000   // 1 frame every 8 s
#define JPEG_QUALITY       18     // CHANGED: smaller frames = fewer UDP packets to lose (was 15). 0-63, lower = better quality
// Resolution in AI mode. If fps stays low and "skipped=" climbs in the Serial
// Monitor, change to FRAMESIZE_HVGA (480x320) or FRAMESIZE_QVGA (320x240).
#define AI_FRAME_SIZE      FRAMESIZE_VGA  // 640x480

// Simmer mode only sends audio when someone is talking.
#define SIMMER_VOICE_RMS       600   // raise if fan noise keeps triggering it
#define SIMMER_VOICE_HANG_MS   2500  // keep sending this long after speech stops

// Button timing
#define LONG_PRESS_MS   1500  // hold = start / stop recording
#define DOUBLE_TAP_MS   400   // two taps = change capture mode

// Uncomment if your board shipped with the OV5640 (autofocus) camera AND you
// installed the "ESP32_OV5640_AF" Arduino library. Without it the OV5640
// still works, just at a fixed focus.
// #define USE_OV5640_AF
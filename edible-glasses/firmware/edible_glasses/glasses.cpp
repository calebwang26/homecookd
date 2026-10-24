// Edible capture glasses firmware — Seeed XIAO ESP32-S3 Sense
//
// Streams timestamped JPEG frames, 16 kHz mono audio and button events to
// receiver/receiver.py over Wi-Fi, and writes the same packets to the microSD
// card so any Wi-Fi gap can be backfilled after the session.
//
// Arduino IDE settings:
//   Board:  XIAO_ESP32S3   (esp32 by Espressif, core 3.x)
//   Tools > PSRAM: "OPI PSRAM"          <- required for the camera
//   Tools > Partition Scheme: default is fine
//
// Controls (the board's BOOT button):
//   hold 1.5 s  -> start / stop recording (LED on = recording)
//   single tap  -> step marker
//   double tap  -> cycle capture mode: AI -> playback -> simmer
//
// Packet format (little-endian), shared with receiver/edg_protocol.py:
//   magic "EDG1" | type u8 | mode u8 | reserved u16 | seq u32 | t_ms u32 | len u32 | payload

#include <Arduino.h>
#include <algorithm>
#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiUdp.h>
#include <SD.h>
#include <SPI.h>
#include <ESP_I2S.h>
#include "esp_camera.h"
#include "config.h"
#include <lwip/sockets.h>
#include <esp_wifi.h>

// ---- live-latency settings (override in config.h if you like) ----
#ifndef MAX_FRAME_AGE_MS
#define MAX_FRAME_AGE_MS 250    // never send a frame older than this: skip to the newest one
#endif
#ifndef MAX_AUDIO_AGE_MS
#define MAX_AUDIO_AGE_MS 1500   // after a stall, drop audio older than this instead of lagging
#endif
#ifndef NET_BACKLOG_LIMIT
#define NET_BACKLOG_LIMIT 3     // skip capturing a frame while this many packets wait to be sent
#endif
#ifndef TRANSPORT_UDP
#define TRANSPORT_UDP 1         // 1 = UDP (no connection to drop, lowest latency); 0 = TCP
#endif
#ifndef SEND_DEADLINE_MS
#define SEND_DEADLINE_MS 1500   // give up on a stuck connection after this long and reconnect
#endif

#ifdef USE_OV5640_AF
#include "ESP32_OV5640_AF.h"
OV5640 ov5640 = OV5640();
#endif

// ---------- protocol ----------
enum PacketType : uint8_t { PKT_HELLO = 1, PKT_JPEG = 2, PKT_PCM = 3, PKT_EVENT = 4, PKT_END = 5 };
enum Mode : uint8_t { MODE_AI = 0, MODE_PLAYBACK = 1, MODE_SIMMER = 2 };
static const char *MODE_NAMES[] = {"ai", "playback", "simmer"};

struct __attribute__((packed)) PacketHeader {
  char magic[4];
  uint8_t type;
  uint8_t mode;
  uint16_t reserved;
  uint32_t seq;
  uint32_t t_ms;
  uint32_t len;
};

struct Packet {
  PacketHeader hdr;
  uint8_t *data;  // PSRAM, freed by the IO task
};

// ---------- camera pins (XIAO ESP32-S3 Sense) ----------
#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM  10
#define SIOD_GPIO_NUM  40
#define SIOC_GPIO_NUM  39
#define Y9_GPIO_NUM    48
#define Y8_GPIO_NUM    11
#define Y7_GPIO_NUM    12
#define Y6_GPIO_NUM    14
#define Y5_GPIO_NUM    16
#define Y4_GPIO_NUM    18
#define Y3_GPIO_NUM    17
#define Y2_GPIO_NUM    15
#define VSYNC_GPIO_NUM 38
#define HREF_GPIO_NUM  47
#define PCLK_GPIO_NUM  13

// ---------- state ----------
struct WifiCred { const char *ssid; const char *pass; };
static const WifiCred WIFI_LIST[] = WIFI_NETWORKS;

WiFiMulti wifiMulti;
WiFiClient client;
I2SClass I2S;

QueueHandle_t packetQueue;  // capture -> SD task
QueueHandle_t netQueue;     // SD task -> network task
SemaphoreHandle_t seqMutex;

volatile bool recording = false;
volatile Mode mode = MODE_AI;
volatile bool sdOk = false;
volatile bool streaming = false;  // data is reaching the receiver (read by the LED)
volatile uint32_t lastBeaconMs = 0;  // last time the receiver's broadcast was heard
volatile uint32_t droppedPackets = 0;
volatile uint32_t skippedFrames = 0;   // not captured because the network was behind
volatile uint32_t staleDropped = 0;    // captured but too old to be worth sending
volatile uint32_t framesCaptured = 0;  // for the fps numbers in the status line
volatile uint32_t framesSent = 0;

char sessionId[17] = {0};
uint8_t sessionRaw[8] = {0};   // same id as bytes, used in UDP headers
uint32_t sessionStartMs = 0;
uint32_t seqCounter = 0;
const char *sensorName = "unknown";

// HELLO payload kept so it can be re-sent on every reconnect.
char helloJson[256];

// ---------- helpers ----------
static uint32_t sessionMs() { return millis() - sessionStartMs; }

// Builds a packet and hands it to the IO task. Takes ownership of `data`
// (must come from ps_malloc / heap_caps_malloc). Returns false if dropped.
static bool enqueue(PacketType type, uint8_t *data, uint32_t len, uint32_t tMs) {
  Packet *p = (Packet *)malloc(sizeof(Packet));
  if (!p) { free(data); droppedPackets++; return false; }
  memcpy(p->hdr.magic, "EDG1", 4);
  p->hdr.type = type;
  p->hdr.mode = (uint8_t)mode;
  p->hdr.reserved = 0;
  if (type == PKT_HELLO || type == PKT_END) {
    p->hdr.seq = 0xFFFFFFFF;  // control packets are outside the numbered stream
  } else {
    xSemaphoreTake(seqMutex, portMAX_DELAY);
    p->hdr.seq = seqCounter++;
    xSemaphoreGive(seqMutex);
  }
  p->hdr.t_ms = tMs;
  p->hdr.len = len;
  p->data = data;
  if (xQueueSend(packetQueue, &p, 0) != pdTRUE) {
    // Queue full: the network or SD is too slow. Drop rather than stall capture.
    free(p->data);
    free(p);
    droppedPackets++;
    return false;
  }
  return true;
}

static void enqueueText(PacketType type, const char *text, uint32_t tMs) {
  size_t n = strlen(text);
  uint8_t *buf = (uint8_t *)ps_malloc(n);
  if (!buf) { droppedPackets++; return; }
  memcpy(buf, text, n);
  enqueue(type, buf, n, tMs);
}

static void sendEvent(const char *name, uint32_t tMs) {
  char json[128];
  snprintf(json, sizeof(json), "{\"event\":\"%s\",\"mode\":\"%s\",\"dropped\":%lu}",
           name, MODE_NAMES[mode], (unsigned long)droppedPackets);
  enqueueText(PKT_EVENT, json, tMs);
}

// ---------- camera ----------
static framesize_t frameSizeFor(Mode m) {
  return m == MODE_PLAYBACK ? FRAMESIZE_VGA : AI_FRAME_SIZE;  // playback is always 640x480
}

static uint32_t frameIntervalFor(Mode m) {
  switch (m) {
    case MODE_PLAYBACK: return PLAYBACK_FRAME_MS;
    case MODE_SIMMER: return SIMMER_FRAME_MS;
    default: return AI_FRAME_MS;
  }
}

static bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = FRAMESIZE_HD;  // allocate buffers for the largest size used
  c.jpeg_quality = JPEG_QUALITY;
  c.fb_count = 3;  // camera fills one buffer while we copy another: higher fps
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;  // always the freshest frame, never a stale one

  if (esp_camera_init(&c) != ESP_OK) return false;

  sensor_t *s = esp_camera_sensor_get();
  switch (s->id.PID) {
    case OV2640_PID: sensorName = "OV2640"; break;
    case OV3660_PID: sensorName = "OV3660"; break;
    case OV5640_PID: sensorName = "OV5640"; break;
    default: sensorName = "unknown";
  }
  // The Sense camera is mounted upside down relative to the board text.
  // If your video comes out rotated, flip these two.
  s->set_vflip(s, 1);
  s->set_hmirror(s, 0);

#ifdef USE_OV5640_AF
  if (s->id.PID == OV5640_PID) {
    ov5640.start(s);
    if (ov5640.focusInit() == 0) ov5640.autoFocusMode();
  }
#endif
  return true;
}

void cameraTask(void *) {
  Mode lastMode = (Mode)255;  // forces the frame size to be applied on the first frame
  uint32_t nextShot = 0;
  for (;;) {
    if (!recording) { vTaskDelay(pdMS_TO_TICKS(50)); nextShot = 0; continue; }
    Mode m = mode;
    if (m != lastMode) {
      sensor_t *s = esp_camera_sensor_get();
      s->set_framesize(s, frameSizeFor(m));
      lastMode = m;
      nextShot = 0;
    }
    uint32_t now = sessionMs();
    if (now < nextShot) { vTaskDelay(pdMS_TO_TICKS(std::min<uint32_t>(nextShot - now, 50))); continue; }
    nextShot = now + frameIntervalFor(m);

    // Backpressure: if the network is behind, don't pile up frames (that is what
    // makes a live feed lag). Audio keeps flowing; video resumes when it drains.
    if (!sdOk && uxQueueMessagesWaiting(netQueue) + uxQueueMessagesWaiting(packetQueue) > NET_BACKLOG_LIMIT) {
      skippedFrames++;
      vTaskDelay(pdMS_TO_TICKS(5));  // wait for the network instead of spinning the CPU
      continue;
    }
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) continue;
    uint32_t t = sessionMs();
    uint8_t *copy = (uint8_t *)ps_malloc(fb->len);
    if (copy) {
      memcpy(copy, fb->buf, fb->len);
      enqueue(PKT_JPEG, copy, fb->len, t);
      framesCaptured++;
    } else {
      droppedPackets++;
    }
    esp_camera_fb_return(fb);
  }
}

// ---------- microphone ----------
static const uint32_t SAMPLE_RATE = 16000;
static const size_t BLOCK_SAMPLES = 1600;  // 100 ms
static const size_t BLOCK_BYTES = BLOCK_SAMPLES * 2;

static bool initMic() {
  I2S.setPinsPdmRx(MIC_CLK_PIN, MIC_DATA_PIN);
  return I2S.begin(I2S_MODE_PDM_RX, SAMPLE_RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
}

void micTask(void *) {
  int16_t *block = (int16_t *)heap_caps_malloc(BLOCK_BYTES, MALLOC_CAP_INTERNAL);
  uint64_t samplesThisSession = 0;
  uint32_t audioStartMs = 0;
  bool wasRecording = false;
  uint32_t lastVoiceMs = 0;

  for (;;) {
    size_t got = I2S.readBytes((char *)block, BLOCK_BYTES);  // blocks ~100 ms; keeps DMA drained
    if (!recording) { wasRecording = false; continue; }
    if (got != BLOCK_BYTES) continue;
    if (!wasRecording) {
      // First block of a session: anchor audio time to the session clock,
      // then advance by sample count so audio never jitters.
      wasRecording = true;
      samplesThisSession = 0;
      audioStartMs = sessionMs() - 100;
    }
    uint32_t t = audioStartMs + (uint32_t)(samplesThisSession * 1000 / SAMPLE_RATE);
    samplesThisSession += BLOCK_SAMPLES;

    if (mode == MODE_SIMMER) {
      // Voice gate: only send blocks with speech (plus a short hangover).
      uint64_t sq = 0;
      for (size_t i = 0; i < BLOCK_SAMPLES; i++) sq += (int32_t)block[i] * block[i];
      uint32_t rms = (uint32_t)sqrt((double)sq / BLOCK_SAMPLES);
      if (rms >= SIMMER_VOICE_RMS) lastVoiceMs = t;
      if (t - lastVoiceMs > SIMMER_VOICE_HANG_MS) continue;
    }

    uint8_t *copy = (uint8_t *)ps_malloc(BLOCK_BYTES);
    if (!copy) { droppedPackets++; continue; }
    memcpy(copy, block, BLOCK_BYTES);
    enqueue(PKT_PCM, copy, BLOCK_BYTES, t);
  }
}

// ---------- IO: SD card task, then network task ----------
// The SD task never waits on the network: Wi-Fi scans or a missing receiver
// can stall the network task without costing a single packet on the card.
File sdFile;

static void writePacket(Print &out, Packet *p) {
  out.write((uint8_t *)&p->hdr, sizeof(PacketHeader));
  if (p->hdr.len) out.write(p->data, p->hdr.len);
}

static void freePacket(Packet *p) {
  if (p->data) free(p->data);
  free(p);
}

void sdTask(void *) {
  uint32_t lastFlush = 0;
  for (;;) {
    Packet *p = nullptr;
    if (xQueueReceive(packetQueue, &p, pdMS_TO_TICKS(200)) == pdTRUE) {
      if (sdOk) {
        if (p->hdr.type == PKT_HELLO) {
          char path[40];
          snprintf(path, sizeof(path), "/EDG/%s.bin", sessionId);
          sdFile = SD.open(path, FILE_WRITE);
        }
        if (sdFile) writePacket(sdFile, p);
        if (p->hdr.type == PKT_END && sdFile) { sdFile.flush(); sdFile.close(); }
      }
      if (xQueueSend(netQueue, &p, 0) != pdTRUE) freePacket(p);  // network behind: SD has it
    }
    if (sdFile && millis() - lastFlush > 1000) { sdFile.flush(); lastFlush = millis(); }
  }
}

// Sends all of buf, or gives up after the deadline (a stuck link should
// reconnect in ~1.5 s instead of freezing the feed for 10 s).
static bool sendAll(const uint8_t *buf, size_t len, uint32_t deadlineMs) {
  int fd = client.fd();
  if (fd < 0) return false;
  size_t done = 0;
  while (done < len) {
    int r = send(fd, buf + done, len - done, MSG_DONTWAIT);
    if (r > 0) { done += r; continue; }
    if (r < 0 && errno != EAGAIN && errno != EWOULDBLOCK) return false;
    if ((int32_t)(millis() - deadlineMs) >= 0) return false;
    vTaskDelay(pdMS_TO_TICKS(3));
  }
  return true;
}

static bool sendPacket(const PacketHeader &h, const uint8_t *data) {
  uint32_t deadline = millis() + SEND_DEADLINE_MS;
  return sendAll((const uint8_t *)&h, sizeof(PacketHeader), deadline) &&
         (h.len == 0 || sendAll(data, h.len, deadline));
}

static bool sendHello() {
  PacketHeader h;
  memcpy(h.magic, "EDG1", 4);
  h.type = PKT_HELLO; h.mode = (uint8_t)mode; h.reserved = 0;
  h.seq = 0xFFFFFFFF;
  h.t_ms = sessionMs();
  h.len = strlen(helloJson);
  size_t a = client.write((uint8_t *)&h, sizeof(h));
  size_t b = client.write((const uint8_t *)helloJson, h.len);
  return a == sizeof(h) && b == h.len;
}

// ---------- Wi-Fi connect + diagnostics ----------
static const char *authName(wifi_auth_mode_t a) {
  switch (a) {
    case WIFI_AUTH_OPEN: return "open";
    case WIFI_AUTH_WEP: return "WEP";
    case WIFI_AUTH_WPA_PSK: return "WPA";
    case WIFI_AUTH_WPA2_PSK: return "WPA2 (password)";
    case WIFI_AUTH_WPA_WPA2_PSK: return "WPA/WPA2 (password)";
    case WIFI_AUTH_WPA2_ENTERPRISE: return "ENTERPRISE (username login - won't work)";
    case WIFI_AUTH_WPA3_PSK: return "WPA3 (password)";
    case WIFI_AUTH_WPA2_WPA3_PSK: return "WPA2/WPA3 (password)";
    default: return "other";
  }
}

// Lists the 2.4 GHz networks the board can see, and says whether each
// network in config.h was found. 5 GHz-only networks never show up here.
static void printScan() {
  Serial.println("---- Wi-Fi scan (2.4 GHz networks the board can see) ----");
  int n = WiFi.scanNetworks();
  for (int i = 0; i < n && i < 25; i++) {
    bool mine = false;
    for (const auto &w : WIFI_LIST) if (WiFi.SSID(i) == w.ssid) mine = true;
    Serial.printf("%s %-32s  signal %4d dBm  ch %2d  %s\n", mine ? "->" : "  ", WiFi.SSID(i).c_str(),
                  (int)WiFi.RSSI(i), (int)WiFi.channel(i), authName(WiFi.encryptionType(i)));
  }
  for (const auto &w : WIFI_LIST) {
    bool seen = false;
    for (int i = 0; i < n; i++) if (WiFi.SSID(i) == w.ssid) seen = true;
    if (!seen)
      Serial.printf("NOT FOUND: \"%s\" - it is 5 GHz-only, out of range, or the name in config.h "
                    "doesn't match exactly (spaces and capitals count)\n", w.ssid);
  }
  Serial.println("-----------------------------------------------------------");
  WiFi.scanDelete();
}

// Tries 15 dBm first (good range without the instability some boards show at
// full power), then full power, then low power as a last resort.
static bool connectWifi(uint32_t timeoutMs) {
  static const wifi_power_t levels[] = {WIFI_POWER_15dBm, WIFI_POWER_19_5dBm, WIFI_POWER_8_5dBm};
  static const char *names[] = {"15", "19.5", "8.5"};
  for (int i = 0; i < 3; i++) {
    WiFi.setTxPower(levels[i]);
    if (wifiMulti.run(timeoutMs) == WL_CONNECTED) {
      Serial.printf("Wi-Fi connected to %s at %s dBm, IP %s, signal %d dBm\n", WiFi.SSID().c_str(), names[i],
                    WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
      return true;
    }
    Serial.printf("Wi-Fi: no connection at %s dBm\n", names[i]);
  }
  return false;
}

static void onWifiDisconnect(WiFiEvent_t, WiFiEventInfo_t info) {
  uint8_t r = info.wifi_sta_disconnected.reason;
  const char *hint = "";
  if (r == 15 || r == 204 || r == 202) hint = " -> wrong password?";
  else if (r == 201) hint = " -> network not found (5 GHz-only or name mismatch?)";
  else if (r == 210 || r == 211) hint = " -> network found but its security type isn't supported (enterprise login?)";
  else if (r == 203) hint = " -> access point refused the board (too many devices, or MAC filtering)";
  Serial.printf("Wi-Fi disconnected, reason %u%s\n", r, hint);
}

// ---------- receiver discovery ----------
// receiver.py broadcasts "EDG-RECEIVER <tcp port>" on DISCOVERY_PORT.
WiFiUDP discoveryUdp;
bool discoveryOpen = false;
IPAddress receiverIp;
uint16_t receiverPort = RECEIVER_PORT;
bool receiverKnown = false;

static void pollDiscovery() {
  if (strlen(RECEIVER_HOST) > 0) {
    if (!receiverKnown && receiverIp.fromString(RECEIVER_HOST)) receiverKnown = true;
    return;
  }
  if (!discoveryOpen) discoveryOpen = discoveryUdp.begin(DISCOVERY_PORT);
  int n;
  while ((n = discoveryUdp.parsePacket()) > 0) {
    char buf[64] = {0};
    int len = discoveryUdp.read(buf, sizeof(buf) - 1);
    if (len > 13 && strncmp(buf, "EDG-RECEIVER ", 13) == 0) {
      IPAddress ip = discoveryUdp.remoteIP();
      uint16_t port = (uint16_t)atoi(buf + 13);
      lastBeaconMs = millis();
      if (!receiverKnown || ip != receiverIp || port != receiverPort) {
        receiverIp = ip;
        receiverPort = port ? port : RECEIVER_PORT;
        receiverKnown = true;
        Serial.printf("Found receiver at %s:%u\n", receiverIp.toString().c_str(), receiverPort);
        client.stop();  // reconnect to the (new) address
      }
    }
  }
}

// ---------- UDP transport ----------
// Each packet is split into datagrams of at most 1460 bytes:
//   "EDU1" | type u8 | mode u8 | frag u16 | frags u16 | reserved u16 |
//   session 8 bytes | seq u32 | t_ms u32 | total_len u32 | data
// A lost datagram loses one frame or 100 ms of audio; nothing ever stalls
// or reconnects. receiver.py reassembles them.
static const size_t UDP_MAX = 1460;  // fits one Wi-Fi frame (1500 MTU - IP/UDP headers)
struct __attribute__((packed)) UdpHeader {
  char magic[4];
  uint8_t type, mode;
  uint16_t frag, frags, reserved;
  uint8_t session[8];
  uint32_t seq, t_ms, total;
};
static const size_t UDP_DATA = UDP_MAX - sizeof(UdpHeader);
int udpSock = -1;
uint8_t udpBuf[UDP_MAX];
volatile uint32_t udpSendFails = 0;

static bool udpSendPacket(const PacketHeader &h, const uint8_t *data, int repeats) {
  if (udpSock < 0) {
    udpSock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (udpSock < 0) return false;
  }
  struct sockaddr_in to = {};
  to.sin_family = AF_INET;
  to.sin_port = htons(receiverPort);
  to.sin_addr.s_addr = (uint32_t)receiverIp;
  uint16_t frags = h.len ? (h.len + UDP_DATA - 1) / UDP_DATA : 1;
  for (int rep = 0; rep < repeats; rep++) {
    for (uint16_t f = 0; f < frags; f++) {
      UdpHeader *u = (UdpHeader *)udpBuf;
      memcpy(u->magic, "EDU1", 4);
      u->type = h.type; u->mode = h.mode; u->frag = f; u->frags = frags; u->reserved = 0;
      memcpy(u->session, sessionRaw, 8);
      u->seq = h.seq; u->t_ms = h.t_ms; u->total = h.len;
      size_t off = (size_t)f * UDP_DATA;
      size_t n = h.len ? std::min(UDP_DATA, (size_t)h.len - off) : 0;
      if (n) memcpy(udpBuf + sizeof(UdpHeader), data + off, n);
      bool ok = false;
      for (int attempt = 0; attempt < 25 && !ok; attempt++) {  // lwIP buffers full: wait a moment
        ok = sendto(udpSock, udpBuf, sizeof(UdpHeader) + n, MSG_DONTWAIT, (struct sockaddr *)&to, sizeof(to)) >= 0;
        if (!ok) vTaskDelay(pdMS_TO_TICKS(2));
      }
      if (!ok) { udpSendFails++; return false; }
    }
  }
  return true;
}

static void sendHelloUdp() {
  PacketHeader h;
  memcpy(h.magic, "EDG1", 4);
  h.type = PKT_HELLO; h.mode = (uint8_t)mode; h.reserved = 0;
  h.seq = 0xFFFFFFFF;
  h.t_ms = sessionMs();
  h.len = strlen(helloJson);
  udpSendPacket(h, (const uint8_t *)helloJson, 1);
}

void netTask(void *) {
  uint32_t lastWifiTry = 0, lastConnectTry = 0;
  for (;;) {
    // Keep Wi-Fi and the receiver link up (these calls may block this task only).
    if (WiFi.status() != WL_CONNECTED) {
      streaming = false;
      if (discoveryOpen) { discoveryUdp.stop(); discoveryOpen = false; }
      if (millis() - lastWifiTry > 15000) {
        lastWifiTry = millis();
        static uint8_t fails = 0;
        if (!connectWifi(5000) && (++fails % 4 == 1)) printScan();  // scan about once a minute
      }
    } else {
      pollDiscovery();
    }
#if TRANSPORT_UDP
    bool udpLink = WiFi.status() == WL_CONNECTED && receiverKnown &&
                   (strlen(RECEIVER_HOST) > 0 || millis() - lastBeaconMs < 3500);
    {
      streaming = recording && udpLink;
      static uint32_t lastHello = 0;
      if (streaming && millis() - lastHello > 1000) { lastHello = millis(); sendHelloUdp(); }
    }
#else
    if (WiFi.status() == WL_CONNECTED && receiverKnown && recording && !client.connected() &&
        millis() - lastConnectTry > 2000) {
      lastConnectTry = millis();
      if (client.connect(receiverIp, receiverPort, 1000)) {
        client.setNoDelay(true);
        client.setTimeout(1000);  // ms
        if (!sendHello()) client.stop();
      }
    }
    streaming = recording && client.connected();
#endif

    Packet *p = nullptr;
    if (xQueueReceive(netQueue, &p, pdMS_TO_TICKS(100)) != pdTRUE) continue;
#if TRANSPORT_UDP
    if (p->hdr.type != PKT_HELLO && udpLink) {
      uint32_t age = sessionMs() - p->hdr.t_ms;
      bool stale = (p->hdr.type == PKT_JPEG && age > MAX_FRAME_AGE_MS) ||
                   (p->hdr.type == PKT_PCM && age > MAX_AUDIO_AGE_MS);
      if (stale) staleDropped++;
      else if (udpSendPacket(p->hdr, p->data, (p->hdr.type == PKT_EVENT || p->hdr.type == PKT_END) ? 3 : 1) &&
               p->hdr.type == PKT_JPEG) framesSent++;
    }
    freePacket(p);
    continue;
#endif
    if (p->hdr.type == PKT_HELLO) {
      lastConnectTry = 0;  // new session: connect right away (hello is sent on connect)
    } else if (client.connected()) {
      uint32_t age = sessionMs() - p->hdr.t_ms;
      bool stale = (p->hdr.type == PKT_JPEG && age > MAX_FRAME_AGE_MS) ||
                   (p->hdr.type == PKT_PCM && age > MAX_AUDIO_AGE_MS);
      if (stale) {
        staleDropped++;  // live view: skip ahead instead of showing old frames
      } else if (!sendPacket(p->hdr, p->data)) {
        Serial.println("Link stalled; reconnecting");
        client.stop();   // receiver drops the partial packet and resyncs
      }
      if (p->hdr.type == PKT_END) client.stop();
    }
    freePacket(p);
  }
}

// ---------- session control ----------
static void startSession() {
  uint32_t r1 = esp_random(), r2 = esp_random();
  snprintf(sessionId, sizeof(sessionId), "%08lx%08lx", (unsigned long)r1, (unsigned long)r2);
  for (int i = 0; i < 4; i++) { sessionRaw[i] = r1 >> (24 - 8 * i); sessionRaw[4 + i] = r2 >> (24 - 8 * i); }
  xSemaphoreTake(seqMutex, portMAX_DELAY);
  seqCounter = 0;
  xSemaphoreGive(seqMutex);
  droppedPackets = 0;
  sessionStartMs = millis();
  snprintf(helloJson, sizeof(helloJson),
           "{\"session_id\":\"%s\",\"firmware\":\"edible-glasses 0.1\",\"sensor\":\"%s\","
           "\"sample_rate\":%lu,\"mode\":\"%s\",\"sd\":%s}",
           sessionId, sensorName, (unsigned long)SAMPLE_RATE, MODE_NAMES[mode], sdOk ? "true" : "false");
  enqueueText(PKT_HELLO, helloJson, 0);
  sendEvent("start", 0);
  recording = true;
  Serial.printf("Recording started, session %s\n", sessionId);
}

static void stopSession() {
  uint32_t t = sessionMs();
  sendEvent("stop", t);
  recording = false;
  vTaskDelay(pdMS_TO_TICKS(300));  // let the camera and mic tasks finish their last packet
  enqueue(PKT_END, nullptr, 0, t);
  Serial.printf("Recording stopped after %lu s, %lu packets dropped\n",
                (unsigned long)(t / 1000), (unsigned long)droppedPackets);
}

// ---------- button + LED ----------
uint32_t pressStart = 0;
bool pressed = false;
bool longHandled = false;
uint32_t pendingTapAt = 0;      // time of a first tap waiting to see if a second comes
uint32_t pendingTapSessionMs = 0;

static void handleButton() {
  bool down = digitalRead(BUTTON_PIN) == LOW;
  uint32_t now = millis();

  if (down && !pressed) {
    pressed = true; pressStart = now; longHandled = false;
  }
  if (down && pressed && !longHandled && now - pressStart >= LONG_PRESS_MS) {
    longHandled = true;
    pendingTapAt = 0;
    if (recording) stopSession(); else startSession();
  }
  if (!down && pressed) {
    pressed = false;
    if (!longHandled && now - pressStart > 30) {  // a tap (30 ms debounce)
      if (pendingTapAt && now - pendingTapAt <= DOUBLE_TAP_MS) {
        pendingTapAt = 0;
        mode = (Mode)((mode + 1) % 3);
        if (recording) sendEvent("mode", sessionMs());
        Serial.printf("Mode: %s\n", MODE_NAMES[mode]);
      } else {
        pendingTapAt = now;
        pendingTapSessionMs = recording ? sessionMs() : 0;
      }
    }
  }
  // A single tap is confirmed once the double-tap window passes.
  if (pendingTapAt && !pressed && now - pendingTapAt > DOUBLE_TAP_MS) {
    if (recording) sendEvent("marker", pendingTapSessionMs);
    pendingTapAt = 0;
  }
}

static void updateLed() {
  uint32_t now = millis();
  bool on;
  if (!recording) {
    on = false;
  } else if (!streaming) {
    on = (now % 2000) > 150;  // solid with a brief blink every 2 s = recording to SD only
  } else {
    on = true;
  }
  digitalWrite(LED_PIN, (on != LED_ACTIVE_LOW) ? HIGH : LOW);
}

// ---------- setup / loop ----------
void setup() {
  Serial.begin(115200);
  delay(1500);  // give the USB serial port time to appear so the boot messages aren't lost
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  digitalWrite(LED_PIN, LED_ACTIVE_LOW ? HIGH : LOW);  // off

  packetQueue = xQueueCreate(96, sizeof(Packet *));
  netQueue = xQueueCreate(64, sizeof(Packet *));
  seqMutex = xSemaphoreCreateMutex();

  if (!psramFound()) Serial.println("ERROR: PSRAM not found. Set Tools > PSRAM > OPI PSRAM.");
  if (!initCamera()) Serial.println("ERROR: camera init failed. Check the camera ribbon.");
  if (!initMic()) Serial.println("ERROR: microphone init failed.");

#ifdef NO_SOLDER_BUILD
  sdOk = false;  // GPIO21 is driving the LED instead
  Serial.println("No-solder build: onboard LED is the recording light, SD card disabled.");
#else
  sdOk = SD.begin(SD_CS_PIN);
#endif
  if (sdOk) {
    if (!SD.exists("/EDG")) SD.mkdir("/EDG");
  } else {
    Serial.println("WARNING: no SD card. Wi-Fi gaps cannot be backfilled.");
#ifndef NO_SOLDER_BUILD
    for (int i = 0; i < 6; i++) { digitalWrite(LED_PIN, i % 2); delay(120); }
    digitalWrite(LED_PIN, LOW);
#endif
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);  // steadier streaming; costs some battery
  // Never fall back to slow 802.11b rates (1-11 Mbps): they eat airtime in a crowded room.
  esp_wifi_config_11b_rate(WIFI_IF_STA, true);
  WiFi.onEvent(onWifiDisconnect, ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  for (const auto &w : WIFI_LIST) wifiMulti.addAP(w.ssid, w.pass);
  // connectWifi tries 15 dBm, then full power, then 8.5 dBm.
  if (!connectWifi(8000)) printScan();
  Serial.printf("Wi-Fi: %s  IP: %s  camera: %s\n",
                WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : "not connected",
                WiFi.localIP().toString().c_str(), sensorName);

  xTaskCreatePinnedToCore(sdTask, "sd", 8192, nullptr, 3, nullptr, 0);
  xTaskCreatePinnedToCore(netTask, "net", 8192, nullptr, 2, nullptr, 0);
  xTaskCreatePinnedToCore(micTask, "mic", 6144, nullptr, 4, nullptr, 1);
  xTaskCreatePinnedToCore(cameraTask, "cam", 6144, nullptr, 2, nullptr, 1);
#if AUTO_START
  Serial.println("Ready. Streaming starts automatically (hold BOOT 1.5 s to stop).");
  startSession();
#else
  Serial.println("Ready. Hold BOOT 1.5 s to start recording.");
#endif
}

void loop() {
  handleButton();
  updateLed();
  static uint32_t lastStatus = 0, lastCap = 0, lastSent = 0;
  if (millis() - lastStatus > 5000) {  // one status line every 5 s in the Serial Monitor
    lastStatus = millis();
    uint32_t cap = framesCaptured, sent = framesSent;
    float capFps = (cap - lastCap) / 5.0, sentFps = (sent - lastSent) / 5.0;
    Serial.printf("[fps] captured=%.1f sent=%.1f  %s\n", capFps, sentFps,
                  sentFps < capFps * 0.8 ? "<- Wi-Fi is the limit right now" : "(camera speed is the limit)");
    lastCap = cap; lastSent = sent;
    Serial.printf("[status] wifi=%s ip=%s rssi=%d receiver=%s streaming=%s recording=%s mode=%s dropped=%lu skipped=%lu stale=%lu udpfail=%lu\n",
                  WiFi.status() == WL_CONNECTED ? WiFi.SSID().c_str() : "no",
                  WiFi.localIP().toString().c_str(), WiFi.status() == WL_CONNECTED ? (int)WiFi.RSSI() : 0,
                  receiverKnown ? receiverIp.toString().c_str() : "searching",
                  streaming ? "yes" : "no", recording ? "yes" : "no",
                  MODE_NAMES[mode], (unsigned long)droppedPackets, (unsigned long)skippedFrames,
                  (unsigned long)staleDropped, (unsigned long)udpSendFails);
  }
  delay(10);
}
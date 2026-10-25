---
name: in-app-recording
description: "Oct 24: a phone recording films inside homecookd (VisionCamera, 1080p) so homie stays live; glasses dropped as the main path"
metadata:
  type: project
---

On 2026-10-24 Caleb approved: almost every cook films on a phone propped on the counter, and the glasses' live video
was too low in frame rate, so phone recording happens **inside the app**, at **1080p**, with homie live the whole
time. Before, Record opened the iOS camera and homie's socket and mic closed until the video came back.

**What it is (`app/src/components/record/useInAppCamera.ts`, `CameraCard`, `PlateMoment`, `app/src/app/recording.tsx`):**
- `react-native-vision-camera` 4.7.3, back camera, 1080p 30 fps, H.264 at 6 Mbps (~2 GB for 45 min), with sound.
- Saved in 5-minute files (`documents/recordings/<recordingId>/part-NN.mp4`), so a crash or kill loses at most one
  file. Leaving the app (lock, call, home screen) finishes the file at once; a short trip (Control Center) films
  again by itself, a real one shows "Recording stopped while you were away" with a resume button and "I'm done".
- The screen stays awake (`expo-keep-awake`). The camera card above the record button shows the shot from the
  hello on, with "● 4:07".
- homie stays live: the mic stream and `/record` socket stay open; a 640 px still goes to homie every 5 s; a lost
  line keeps retrying every 10 s while filming. At the end homie asks for the plate, the card grows to the middle,
  one shutter tap, and the photo becomes the recipe's cover (`live.setCover`, worker claim `coverUrl`).
- Builds without VisionCamera (Expo Go, web, TestFlight builds before this one) and a denied camera permission
  fall back to the system camera, so an EAS Update with this JS is safe on old builds.

**Why VisionCamera 4 (not expo-camera, not VisionCamera 5):** iOS has one audio session, shared by homie's mic
(`@siteed/audio-studio`), homie's voice (expo-audio) and the camera's sound. VisionCamera 4 records sound through
its own capture session with `automaticallyConfiguresApplicationAudioSession = false` and only sets PlayAndRecord /
VideoRecording / [MixWithOthers, AllowBluetoothA2DP, DefaultToSpeaker, AllowAirPlay] when that differs. expo-camera 57
and VisionCamera 5 let AVCaptureSession reconfigure the session itself (mic stream stops, voice can go to the
earpiece).

**How to apply (the audio-session rules):**
- The mic runs in exactly the camera's settings while filming in the app (`lib/live/camera` `CAMERA_AUDIO_SESSION`,
  `mic.start({ camera: true })`).
- audio-studio deactivates the session every time it starts or stops. So the mic must be running before a file
  starts, and must never start or stop while a file is being written (`homie.cameraFilming`); it may restart only
  between two files (`beforeResume`, `betweenFiles`).
- Not yet proven on a real iPhone (no device build yet on Oct 24): the first device test is "record 2+ minutes
  while homie talks; the video has her voice; homie's mic stream keeps going".
- Oct 24, the first TestFlight try crashed at "Sending it to …": the finished file was moved with the async
  `File.move()` and its old tmp path uploaded. Files move with `moveSync`, and a note keeps each recording queued
  until Convex has its job ([[never-signed-out-by-a-crash]]).
- Related: [[homie-guidance-only]], [[testflight-live]].

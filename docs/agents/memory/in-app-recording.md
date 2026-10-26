---
name: in-app-recording
description: "Oct 24: a phone recording films inside homecookd (VisionCamera, 1080p) so homie stays live; glasses dropped as the main path; a flip-camera button (a file boundary while filming)"
metadata:
  type: project
---

On 2026-10-24 Caleb approved: almost every cook films on a phone propped on the counter, and the glasses' live video
was too low in frame rate, so phone recording happens **inside the app**, at **1080p**, with homie live the whole
time. Before, Record opened the iOS camera and homie's socket and mic closed until the video came back.

**What it is (`app/src/components/record/filming.ts` the files, `useInAppCamera.ts` the VisionCamera wiring,
`CameraCard`, `PlateMoment`, `app/src/app/recording.tsx`):**
- `react-native-vision-camera` 4.7.3, back camera by default, 1080p 30 fps, H.264 at 6 Mbps (~2 GB for 45 min), with sound.
- **Flip camera (Oct 24, Caleb: "make the camera flip logo VERY clear"):** a 68 pt cream button with the iPhone's
  filled flip-camera icon at 42 pt (SF Symbol `arrow.triangle.2.circlepath.camera.fill`, an SVG copy on Android/web)
  and her word under it at 17 pt ("कॅमेरा बदला" / "Flip camera"; `FlipCameraButton`), right of the camera card at its
  bottom (at least 56 pt under homie's corner pot, so on an iPhone SE the two don't read as a pair), and right of the
  shutter in the plate photo's big view. Hidden under homie's questions and once the plate photo is taken. It works
  in every phase. **While filming, a flip is a file boundary** (`filming.ts`): finish the file, switch `device` (and
  its 1080p format), wait for VisionCamera's `onInitialized` again (it fires after every device change, once the new
  outputs exist), `betweenFiles`, a new file, `onResume(gapS)` (about a second of gap). No footage is lost. The
  camera's sound has its own capture session, which a device change doesn't touch, so for the audio a flip is the
  same as a 5-minute roll. start, resume, roll and flip run one at a time (`serial`) so a file never starts on
  outputs that are about to be rebuilt; a roll only ends the file it was set for; after "I'm done" a flip first waits
  for the last file to be saved; a still waits 1.2 s after a flip (VisionCamera says ready before the new format is
  committed, and a still is its last frame). If the other camera isn't ready in 5 s: a fresh `<Camera>` (key bump)
  on the one that worked (VisionCamera compares with its last good setup and may not set the old device up again).
  The front camera's preview, video and stills are mirrored, like a selfie (VisionCamera's default; no `isMirrored`
  prop). Oct 25: `isMirrored={false}` stored every front clip upside down (display-matrix rotation 90 where the back
  camera's is -90): iOS mirrors front-camera frames itself, and VisionCamera only takes that over and turns its
  rotation to match when mirroring is on. So a front clip's packet text reads reversed; if that matters, the pipeline
  can flip front clips back (it would need to know which clips were front: not sent today).
  Each recording starts on the back camera again.
- **A camera that doesn't come back never leaves the clock ticking over nothing** (`filming.ts` `stuck`): a flip whose
  fresh camera fails too, a resume whose camera isn't ready, or a file that fails by itself: no file starts,
  filming goes to 'paused' (homie is told), the screen says "The camera stopped. Your video so far is saved."
  (`trouble`), and the `<Camera>` starts over. A file that never says it ended is let go after 10 s.
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
  between two files (`beforeResume`, `betweenFiles`: a 5-minute roll or a flip while filming).
- Never start a file right after changing the `<Camera>`'s `device`: wait for its next `onInitialized`
  (`filming.ts` `waitReady`), or the recording is on outputs VisionCamera is about to remove.
- "Open" means until the file is saved, not until stopRecording: `betweenFiles`/`beforeResume` wait for that. Both get
  `goesOn()`; mark the mic busy again (`homie.cameraFilming(true)`) only if it's true, or after "I'm done" the mic
  is never stopped. The order rules are tested in node with a fake camera (`test-recording-ui.mjs`, "filming:").
- Not yet proven on a real iPhone (no device build yet on Oct 24): the first device test is "record 2+ minutes
  while homie talks; the video has her voice; homie's mic stream keeps going". For the flip: "flip twice while
  filming; three files, each with sound, the front one upright (mirrored like a selfie); homie's mic never stops".
- Oct 24, the first TestFlight try crashed at "Sending it to …": the finished file was moved with the async
  `File.move()` and its old tmp path uploaded. Files move with `moveSync` (#77), and a note keeps each recording
  queued until Convex has its job and every file is uploaded ([[never-signed-out-by-a-crash]]).
- Related: [[homie-guidance-only]], [[testflight-live]].

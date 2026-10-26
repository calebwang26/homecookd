// Filming in the app (lib/live/camera): the back camera (or the front one, after a flip) at 1080p 30 fps
// with sound, saved in 5-minute files (CHUNK_MS) under documents/recordings/<recordingId>/, so a crash or
// a kill loses at most the file it was writing. Leaving the app (a lock, a call, the home screen) finishes
// the current file at once and the camera waits ("paused"); back in the app it films again by itself after
// a short trip (Control Center), else when she taps. Every FRAME_EVERY_MS while filming, a small still
// (640 px JPEG, base64) goes to `onFrame` for homie. The files themselves (start, roll, pause, resume, stop,
// flip, and what happens when the camera doesn't come back) are filming.ts; this wires it to VisionCamera.
//
//   const cam = useInAppCamera({ recordingId, on, onFrame, onPause, onResume, beforeResume, betweenFiles, onSaved });
//                                     `on`: the screen still needs the camera (the hello, filming, the plate photo)
//   <CameraCard cam={cam} />          the preview (it must be on screen for the camera to run)
//   await cam.start()                 filming begins (waits for the camera to be ready)
//   const clips = await cam.stop()    finishes the last file: the draft clips, in order
//   await cam.resume()                after a pause: beforeResume (homie's mic restarts), then a new file
//   const uri = await cam.still()     a full-size still (the plate photo), or null
//   await cam.flip()                  the other camera (cameraLogic flipSteps); while filming, a file boundary
//   cam.facing 'back' | 'front'    cam.canFlip (both cameras, ready, no flip running)    cam.flipping
//   cam.phase  'idle' | 'filming' | 'paused' | 'done'    cam.filmedMs()    cam.error    cam.trouble
//   onSaved(clips)                    each file saved in documents/: every file so far (the crash note)
//
// The audio session (lib/live/camera CAMERA_AUDIO_SESSION): homie's mic must already be running before a
// file starts, and must not start or stop while one is open; `beforeResume` (after a pause) and
// `betweenFiles` (a 5-minute roll, a flip while filming) are the only places it may restart. Both get
// `goesOn()`: false once "I'm done" was pressed, so the mic isn't marked busy again after the end.
// `onResume(gapS)` tells homie how much wall time the video skipped.
//
// A flip changes the <Camera>'s `device` (and its 1080p format) while no file is open. VisionCamera 4.7
// then rebuilds the capture session's input and outputs (CameraSession+Configuration.swift) and calls
// `onInitialized` again; the next file starts only after that, since a recording started on the old
// outputs would lose them mid-file. The camera's sound has its own capture session, which a device change
// leaves alone, so for the audio a flip is the same as a roll. A camera that doesn't come back gets a
// fresh <Camera> (`cameraKey`, CameraCard's key); `trouble` = it stopped by itself (the screen says so).
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { Camera, CameraDevice, CameraDeviceFormat } from 'react-native-vision-camera';

import { imageManipulator, visionCamera } from '@/lib/live/camera';

import type { DraftClip } from './draft';
import { chunkName, FRAME_EVERY_MS, FRAME_WIDTH, resumesBySelf, stopsFilming, type CameraPhase, type Facing } from './cameraLogic';
import { Filming } from './filming';

export const VIDEO_BITRATE_MBPS = 6; // 1080p30 H.264: ~2 GB for 45 minutes (the pipeline makes a 720p copy anyway)
const FPS = 30;

const vc = visionCamera();
const useDevice: (f: Facing) => CameraDevice | undefined = vc ? (f) => vc.useCameraDevice(f) : () => undefined;
const useFormat: (d: CameraDevice | undefined) => CameraDeviceFormat | undefined = vc
  ? (d) => vc.useCameraFormat(d, [{ videoResolution: { width: 1920, height: 1080 } }, { fps: FPS }])
  : () => undefined;

export type { CameraPhase, Facing };

type Options = {
  recordingId: string | null;
  on: boolean;
  onFrame?: (jpegBase64: string) => void;
  onPause?: () => void;
  onResume?: (gapS: number) => void;
  /** Runs between two files after a pause (restart homie's mic in the camera's audio settings). */
  beforeResume?: (goesOn: () => boolean) => Promise<void>;
  /** Runs between two files while filming: a roll, a flip (a mic that waited for the camera starts here). */
  betweenFiles?: (goesOn: () => boolean) => Promise<void>;
  /** A file was saved in documents/: every file so far (recording.tsx keeps the crash note with them). */
  onSaved?: (clips: DraftClip[]) => void;
};

const fileUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

/**
 * Moves a finished file out of tmp into documents/recordings/<id>/part-NN.mp4 (tmp can be purged). The move
 * must be done before this returns (moveSync; expo-file-system's `move` is async): the upload reads this path,
 * and an upload task for a file that isn't there crashes the app (TestFlight build 5, Oct 24).
 */
function keep(path: string, recordingId: string | null, n: number): string {
  try {
    const dir = new Directory(Paths.document, 'recordings', recordingId ?? 'unsaved');
    if (!dir.exists) dir.create({ intermediates: true });
    const target = new File(dir, chunkName(n));
    if (target.exists) target.delete();
    new File(fileUri(path)).moveSync(target);
    return target.uri;
  } catch (e) {
    console.warn('[camera] could not move the file; it stays in tmp', String(e).slice(0, 160));
    return fileUri(path);
  }
}

function remove(uri: string) {
  try {
    new File(fileUri(uri)).delete();
  } catch {
    // already gone
  }
}

export function useInAppCamera({ recordingId, on, onFrame, onPause, onResume, beforeResume, betweenFiles, onSaved }: Options) {
  const ref = useRef<Camera | null>(null);
  /** The <Camera> element's ref (CameraCard passes it on). */
  const setCamera = useCallback((c: Camera | null) => {
    ref.current = c;
  }, []);
  const cbs = useRef({ onFrame, onPause, onResume, beforeResume, betweenFiles, onSaved, recordingId });
  useEffect(() => {
    cbs.current = { onFrame, onPause, onResume, beforeResume, betweenFiles, onSaved, recordingId };
  });
  // The files: one Filming for the screen's life, talking to whichever <Camera> is mounted.
  const [filming] = useState(() => new Filming());
  useEffect(() => {
    filming.connect(
      {
        startRecording: (finished, failed) => {
          const cam = ref.current;
          if (!cam) throw new Error('no camera on screen');
          cam.startRecording({
            fileType: 'mp4',
            videoCodec: 'h264',
            onRecordingFinished: (v) => finished({ path: v.path, duration: v.duration, width: v.width, height: v.height }),
            onRecordingError: (e) => failed({ code: e.code, message: e.message }),
          });
        },
        stopRecording: () => ref.current?.stopRecording() ?? Promise.resolve(),
        keep: (path, n) => keep(path, cbs.current.recordingId, n),
      },
      {
        onPause: () => cbs.current.onPause?.(),
        onResume: (gap) => cbs.current.onResume?.(gap),
        beforeResume: (goesOn) => cbs.current.beforeResume?.(goesOn) ?? Promise.resolve(),
        betweenFiles: (goesOn) => cbs.current.betweenFiles?.(goesOn) ?? Promise.resolve(),
        onSaved: (clips) => cbs.current.onSaved?.(clips),
      },
    );
    return () => filming.dispose(); // leaving the screen never leaves the camera recording
  }, [filming]);
  const view = useSyncExternalStore(filming.subscribe, filming.snapshot);

  // Both cameras are looked up; `facing` picks one, and the format follows it in the same render.
  const back = useDevice('back');
  const front = useDevice('front');
  const device = view.facing === 'front' ? front : back;
  const format = useFormat(device);
  const twoCameras = !!back && !!front && back.id !== front.id;
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  // Camera and microphone, asked once here (VisionCamera refuses `audio` without the mic).
  const [permission, setPermission] = useState<'asking' | 'granted' | 'denied'>(vc ? 'asking' : 'denied');
  useEffect(() => {
    if (!vc) return;
    let alive = true;
    void (async () => {
      const camera = await vc.Camera.requestCameraPermission().catch(() => 'denied');
      const mic = camera === 'granted' ? await vc.Camera.requestMicrophonePermission().catch(() => 'denied') : 'denied';
      if (alive) setPermission(camera === 'granted' && mic === 'granted' ? 'granted' : 'denied');
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onInitialized = useCallback(() => filming.initialized(), [filming]);
  const onError = useCallback(
    (e: { code?: string; message?: string }) => {
      console.warn('[camera]', e.code, e.message);
      filming.cameraError(e.message ?? String(e.code));
    },
    [filming],
  );
  const start = useCallback(() => filming.start(), [filming]);
  const stop = useCallback(() => filming.stop(), [filming]);
  const resume = useCallback(() => filming.resume(), [filming]);
  const flip = useCallback(() => (twoCameras ? filming.flip() : Promise.resolve(false)), [filming, twoCameras]);

  // Leaving the app ends the file at once; coming back films again by itself after a short trip.
  const away = useRef<{ since: number; background: boolean } | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (stopsFilming(s)) {
        if (filming.phase === 'filming') {
          away.current = { since: Date.now(), background: s === 'background' };
          void filming.pause();
        } else if (away.current && s === 'background') away.current.background = true;
        return;
      }
      const trip = away.current;
      away.current = null;
      if (trip && filming.phase === 'paused' && resumesBySelf(Date.now() - trip.since, trip.background)) void filming.resume();
    });
    return () => sub.remove();
  }, [filming]);

  // homie's look at the stove while filming.
  const framing = useRef(false);
  const flippingNow = view.flipping;
  useEffect(() => {
    if (view.phase !== 'filming' || flippingNow || !onFrame) return;
    const t = setInterval(async () => {
      const cam = ref.current;
      const m = imageManipulator();
      // No manipulator in this build: no stills (a full-size one is too big for the socket); homie just listens.
      if (!cam || !m || framing.current || !cbs.current.onFrame) return;
      framing.current = true;
      let path: string | null = null;
      try {
        const snap = await cam.takeSnapshot({ quality: 70 });
        path = fileUri(snap.path);
        const small = await m.manipulateAsync(path, [{ resize: { width: FRAME_WIDTH } }], { compress: 0.6, format: m.SaveFormat.JPEG, base64: true });
        if (small.base64) cbs.current.onFrame?.(small.base64);
        remove(small.uri);
      } catch {
        // No picture this time: homie just listens.
      } finally {
        if (path) remove(path);
        framing.current = false;
      }
    }, FRAME_EVERY_MS);
    return () => clearInterval(t);
  }, [view.phase, flippingNow, onFrame]);

  /** A full-size still from the camera (the plate photo), saved as a JPEG; null if the camera can't. */
  const still = useCallback(async (): Promise<string | null> => {
    // Right after a flip the last frame can still be the other camera's: wait for the new one's.
    await filming.readyForStill();
    const cam = ref.current;
    if (!cam) return null;
    try {
      const snap = await cam.takeSnapshot({ quality: 90 });
      return fileUri(snap.path);
    } catch (e) {
      console.warn('[camera] still', String(e).slice(0, 120));
      return null;
    }
  }, [filming]);

  return {
    /** null while it asks for the camera and mic; false = film with the system camera instead. */
    usable: permission === 'asking' ? null : permission === 'granted' && !!vc && !!device,
    Camera: vc?.Camera ?? null,
    setCamera,
    device,
    format,
    fps: FPS,
    bitRate: VIDEO_BITRATE_MBPS,
    /** CameraCard's <Camera> key: a new one is a fresh camera session (a camera that didn't come back). */
    cameraKey: view.cameraKey,
    /** The camera runs while the app is in front and the screen still needs it. */
    active: appActive && on,
    phase: view.phase,
    error: view.error,
    /** The camera stopped by itself (filming is paused): "The camera stopped. Your video so far is saved." */
    trouble: view.trouble,
    /** Which camera films, and whether a flip is running (its button waits). */
    facing: view.facing,
    flipping: view.flipping,
    /** Both cameras exist (else no flip button). */
    twoCameras,
    /** The flip button works: both cameras, the camera ready, no flip running. */
    canFlip: twoCameras && view.ready && !view.flipping,
    onInitialized,
    onError,
    start,
    stop,
    resume,
    flip,
    still,
    /** Video filmed by `now` (render it with a ticking clock). */
    filmedMs: (now: number) => view.doneMs + (view.since === null ? 0 : Math.max(0, now - view.since)),
  };
}

export type InAppCamera = ReturnType<typeof useInAppCamera>;
export type CameraHandle = Camera;

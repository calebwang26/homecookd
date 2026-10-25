// Filming in the app (lib/live/camera): the back camera at 1080p 30 fps with sound, saved in 5-minute
// files (CHUNK_MS) under documents/recordings/<recordingId>/, so a crash or a kill loses at most the
// file it was writing. Leaving the app (a lock, a call, the home screen) finishes the current file at
// once and the camera waits ("paused"); back in the app it films again by itself after a short trip
// (Control Center), else when she taps. Every FRAME_EVERY_MS while filming, a small still (640 px JPEG,
// base64) goes to `onFrame` for homie.
//
//   const cam = useInAppCamera({ recordingId, on, onFrame, onPause, onResume, beforeResume, betweenFiles });
//                                     `on`: the screen still needs the camera (the hello, filming, the plate photo)
//   <CameraCard cam={cam} />          the preview (it must be on screen for the camera to run)
//   await cam.start()                 filming begins (waits for the camera to be ready)
//   const clips = await cam.stop()    finishes the last file: the draft clips, in order
//   await cam.resume()                after a pause: beforeResume (homie's mic restarts), then a new file
//   const uri = await cam.still()     a full-size still (the plate photo), or null
//   cam.phase  'idle' | 'filming' | 'paused' | 'done'    cam.filmedMs()    cam.error
//
// The audio session (lib/live/camera CAMERA_AUDIO_SESSION): homie's mic must already be running before a
// file starts, and must not start or stop while one is being written; `beforeResume` (after a pause) and
// `betweenFiles` (a 5-minute roll) are the only places it may restart. `onResume(gapS)` tells homie how
// much wall time the video skipped.
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Camera, CameraDevice, CameraDeviceFormat } from 'react-native-vision-camera';

import { imageManipulator, visionCamera } from '@/lib/live/camera';

import { CHUNK_MS, chunkClip, chunkName, filmedMs, FRAME_EVERY_MS, FRAME_WIDTH, gapS, resumesBySelf, stopsFilming, type Chunk } from './cameraLogic';
import type { DraftClip } from './draft';

export const VIDEO_BITRATE_MBPS = 6; // 1080p30 H.264: ~2 GB for 45 minutes (the pipeline makes a 720p copy anyway)
const FPS = 30;
const READY_WAIT_MS = 10_000;

const vc = visionCamera();
const useDevice: () => CameraDevice | undefined = vc ? () => vc.useCameraDevice('back') : () => undefined;
const useFormat: (d: CameraDevice | undefined) => CameraDeviceFormat | undefined = vc
  ? (d) => vc.useCameraFormat(d, [{ videoResolution: { width: 1920, height: 1080 } }, { fps: FPS }])
  : () => undefined;

export type CameraPhase = 'idle' | 'filming' | 'paused' | 'done';

type Options = {
  recordingId: string | null;
  on: boolean;
  onFrame?: (jpegBase64: string) => void;
  onPause?: () => void;
  onResume?: (gapS: number) => void;
  /** Runs between two files after a pause (restart homie's mic in the camera's audio settings). */
  beforeResume?: () => Promise<void>;
  /** Runs at each 5-minute roll, between the two files (a mic that waited for the camera starts here). */
  betweenFiles?: () => Promise<void>;
};

const fileUri = (path: string) => (path.startsWith('file://') ? path : `file://${path}`);

/**
 * Moves a finished file out of tmp into documents/recordings/<id>/part-NN.mp4 (tmp can be purged) and
 * returns where it is now. The move must be the sync one: `move()` is async in expo-file-system 57, so
 * reading the uri right after it gave the old tmp path, the file was gone from there a moment later,
 * and the upload of a file that isn't there crashed the app (Oct 24, TestFlight build 5).
 */
function keep(path: string, recordingId: string | null, n: number): string {
  const tmp = new File(fileUri(path));
  try {
    const dir = new Directory(Paths.document, 'recordings', recordingId ?? 'unsaved');
    if (!dir.exists) dir.create({ intermediates: true });
    const target = new File(dir, chunkName(n));
    if (target.exists) target.delete();
    tmp.moveSync(target);
    if (target.exists) return target.uri;
  } catch (e) {
    console.warn('[camera] could not move the file; it stays in tmp', String(e).slice(0, 160));
  }
  return tmp.uri;
}

function remove(uri: string) {
  try {
    new File(fileUri(uri)).delete();
  } catch {
    // already gone
  }
}

export function useInAppCamera({ recordingId, on, onFrame, onPause, onResume, beforeResume, betweenFiles }: Options) {
  const ref = useRef<Camera | null>(null);
  /** The <Camera> element's ref (CameraCard passes it on). */
  const setCamera = useCallback((c: Camera | null) => {
    ref.current = c;
  }, []);
  /** What has been filmed, for the clock: the finished files' length, and since when the current one runs. */
  const [clock, setClock] = useState<{ doneMs: number; since: number | null }>({ doneMs: 0, since: null });
  const device = useDevice();
  const format = useFormat(device);
  const [phase, setPhaseState] = useState<CameraPhase>('idle');
  const [error, setError] = useState<string | null>(null);
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

  const phaseRef = useRef<CameraPhase>('idle');
  const setPhase = useCallback((p: CameraPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);
  const chunks = useRef<Chunk[]>([]);
  /** The file being written: when it started, and resolvers for its end. */
  const current = useRef<{ startedAt: number; done: Promise<void>; finish: () => void } | null>(null);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollRef = useRef<() => Promise<void>>(async () => {});
  const ready = useRef<{ promise: Promise<boolean>; resolve: (ok: boolean) => void } | null>(null);
  if (ready.current == null) {
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    ready.current = { promise, resolve };
  }
  const cbs = useRef({ onFrame, onPause, onResume, beforeResume, betweenFiles, recordingId });
  useEffect(() => {
    cbs.current = { onFrame, onPause, onResume, beforeResume, betweenFiles, recordingId };
  });

  const onInitialized = useCallback(() => ready.current?.resolve(true), []);
  const onError = useCallback((e: { code?: string; message?: string }) => {
    console.warn('[camera]', e.code, e.message);
    setError(e.message ?? String(e.code));
  }, []);

  /** Starts one file; it rolls over to the next after CHUNK_MS while filming. */
  const startFile = useCallback(async (): Promise<boolean> => {
    const cam = ref.current;
    if (!cam || current.current) return !!current.current;
    const startedAt = Date.now();
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    current.current = { startedAt, done, finish };
    setClock((c) => ({ ...c, since: startedAt }));
    const n = chunks.current.length + 1;
    try {
      cam.startRecording({
        fileType: 'mp4',
        videoCodec: 'h264',
        onRecordingFinished: (video) => {
          const uri = keep(video.path, cbs.current.recordingId, n);
          chunks.current.push({ uri, startedAt, durationMs: Math.round(video.duration * 1000), width: video.width, height: video.height });
          current.current = null;
          setClock({ doneMs: filmedMs(chunks.current, null, 0), since: null });
          finish();
        },
        onRecordingError: (e) => {
          console.warn('[camera] recording error', e.code, e.message);
          current.current = null;
          setClock((c) => ({ ...c, since: null }));
          finish();
        },
      });
    } catch (e) {
      console.warn('[camera] could not start a file', String(e).slice(0, 160));
      current.current = null;
      finish();
      return false;
    }
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = setTimeout(() => void rollRef.current(), CHUNK_MS);
    return true;
  }, []);

  /** Finishes the file being written (resolves once it's saved). */
  const endFile = useCallback(async () => {
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = null;
    const c = current.current;
    if (!c) return;
    await ref.current?.stopRecording().catch((e) => console.warn('[camera] stop', String(e).slice(0, 120)));
    await c.done;
  }, []);

  /** Every CHUNK_MS: finish this file and start the next (homie hears the small gap between them). */
  const roll = useCallback(async () => {
    if (phaseRef.current !== 'filming') return;
    await endFile();
    if (phaseRef.current !== 'filming') return;
    await cbs.current.betweenFiles?.().catch(() => {});
    if (phaseRef.current !== 'filming') return;
    const at = Date.now();
    if (await startFile()) cbs.current.onResume?.(gapS(chunks.current.at(-1), at));
  }, [endFile, startFile]);
  useEffect(() => {
    rollRef.current = roll;
  });

  const start = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current !== 'idle') return phaseRef.current === 'filming';
    const ok = await Promise.race([ready.current!.promise, new Promise<boolean>((r) => setTimeout(() => r(false), READY_WAIT_MS))]);
    if (!ok || !(await startFile())) {
      setError('The camera didn’t start.');
      return false;
    }
    setPhase('filming');
    return true;
  }, [startFile, setPhase]);

  const pause = useCallback(async () => {
    if (phaseRef.current !== 'filming') return;
    setPhase('paused');
    cbs.current.onPause?.();
    await endFile();
  }, [endFile, setPhase]);

  const resume = useCallback(async (): Promise<boolean> => {
    if (phaseRef.current !== 'paused') return phaseRef.current === 'filming';
    await cbs.current.beforeResume?.().catch(() => {});
    if (phaseRef.current !== 'paused') return false;
    const at = Date.now();
    if (!(await startFile())) return false;
    setPhase('filming');
    cbs.current.onResume?.(gapS(chunks.current.at(-1), at));
    return true;
  }, [startFile, setPhase]);

  const stop = useCallback(async (): Promise<DraftClip[]> => {
    if (phaseRef.current !== 'done') {
      setPhase('done');
      await endFile();
    }
    return chunks.current.map((c, i) => chunkClip(c, i + 1)); // part-01.mp4 first, as on disk
  }, [endFile, setPhase]);

  // Leaving the app ends the file at once; coming back films again by itself after a short trip.
  const away = useRef<{ since: number; background: boolean } | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setAppActive(s === 'active');
      if (stopsFilming(s)) {
        if (phaseRef.current === 'filming') {
          away.current = { since: Date.now(), background: s === 'background' };
          void pause();
        } else if (away.current && s === 'background') away.current.background = true;
        return;
      }
      const trip = away.current;
      away.current = null;
      if (trip && phaseRef.current === 'paused' && resumesBySelf(Date.now() - trip.since, trip.background)) void resume();
    });
    return () => sub.remove();
  }, [pause, resume]);

  // homie's look at the stove while filming.
  const framing = useRef(false);
  useEffect(() => {
    if (phase !== 'filming' || !onFrame) return;
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
  }, [phase, onFrame]);

  /** A full-size still from the camera (the plate photo), saved as a JPEG; null if the camera can't. */
  const still = useCallback(async (): Promise<string | null> => {
    const cam = ref.current;
    if (!cam) return null;
    try {
      const snap = await cam.takeSnapshot({ quality: 90 });
      return fileUri(snap.path);
    } catch (e) {
      console.warn('[camera] still', String(e).slice(0, 120));
      return null;
    }
  }, []);

  // Leaving the screen never leaves the camera recording.
  useEffect(
    () => () => {
      if (rollTimer.current) clearTimeout(rollTimer.current);
      if (current.current) void ref.current?.stopRecording().catch(() => {});
    },
    [],
  );

  return {
    /** null while it asks for the camera and mic; false = film with the system camera instead. */
    usable: permission === 'asking' ? null : permission === 'granted' && !!vc && !!device,
    Camera: vc?.Camera ?? null,
    setCamera,
    device,
    format,
    fps: FPS,
    bitRate: VIDEO_BITRATE_MBPS,
    /** The camera runs while the app is in front and the screen still needs it. */
    active: appActive && on,
    phase,
    error,
    onInitialized,
    onError,
    start,
    stop,
    resume,
    still,
    /** Video filmed by `now` (render it with a ticking clock). */
    filmedMs: (now: number) => clock.doneMs + (clock.since === null ? 0 : Math.max(0, now - clock.since)),
  };
}

export type InAppCamera = ReturnType<typeof useInAppCamera>;
export type CameraHandle = Camera;

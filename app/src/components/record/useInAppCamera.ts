// Filming in the app (lib/live/camera): the back camera (or the front one, after a flip) at 1080p 30 fps
// with sound, saved in 5-minute files (CHUNK_MS) under documents/recordings/<recordingId>/, so a crash or
// a kill loses at most the file it was writing. Leaving the app (a lock, a call, the home screen) finishes
// the current file at once and the camera waits ("paused"); back in the app it films again by itself after
// a short trip (Control Center), else when she taps. Every FRAME_EVERY_MS while filming, a small still (640 px JPEG,
// base64) goes to `onFrame` for homie.
//
//   const cam = useInAppCamera({ recordingId, on, onFrame, onPause, onResume, beforeResume, betweenFiles });
//                                     `on`: the screen still needs the camera (the hello, filming, the plate photo)
//   <CameraCard cam={cam} />          the preview (it must be on screen for the camera to run)
//   await cam.start()                 filming begins (waits for the camera to be ready)
//   const clips = await cam.stop()    finishes the last file: the draft clips, in order
//   await cam.resume()                after a pause: beforeResume (homie's mic restarts), then a new file
//   const uri = await cam.still()     a full-size still (the plate photo), or null
//   await cam.flip()                  the other camera (cameraLogic flipSteps); while filming, a file boundary
//   cam.facing 'back' | 'front'    cam.canFlip (both cameras, ready, no flip running)    cam.flipping
//   cam.phase  'idle' | 'filming' | 'paused' | 'done'    cam.filmedMs()    cam.error
//
// The audio session (lib/live/camera CAMERA_AUDIO_SESSION): homie's mic must already be running before a
// file starts, and must not start or stop while one is being written; `beforeResume` (after a pause) and
// `betweenFiles` (a 5-minute roll, a flip while filming) are the only places it may restart. `onResume(gapS)`
// tells homie how much wall time the video skipped.
//
// A flip changes the <Camera>'s `device` (and its 1080p format) while no file is written. VisionCamera 4.7
// then rebuilds the capture session's input and outputs (CameraSession+Configuration.swift) and calls
// `onInitialized` again; the next file starts only after that, since a recording started on the old
// outputs would lose them mid-file. The camera's sound has its own capture session, which a device change
// leaves alone, so for the audio a flip is the same as a roll. start, resume, the roll and the flip run one
// at a time (`serial`); leaving the app and "I'm done" never wait.
import { Directory, File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Camera, CameraDevice, CameraDeviceFormat } from 'react-native-vision-camera';

import { imageManipulator, visionCamera } from '@/lib/live/camera';

import {
  CHUNK_MS,
  chunkClip,
  chunkName,
  filmedMs,
  FLIP_SETTLE_MS,
  FLIP_WAIT_MS,
  flipSteps,
  FRAME_EVERY_MS,
  FRAME_WIDTH,
  gapS,
  otherFacing,
  resumesBySelf,
  stopsFilming,
  type CameraPhase,
  type Chunk,
  type Facing,
} from './cameraLogic';
import type { DraftClip } from './draft';

export const VIDEO_BITRATE_MBPS = 6; // 1080p30 H.264: ~2 GB for 45 minutes (the pipeline makes a 720p copy anyway)
const FPS = 30;
const READY_WAIT_MS = 10_000;

const vc = visionCamera();
const useDevice: (f: Facing) => CameraDevice | undefined = vc ? (f) => vc.useCameraDevice(f) : () => undefined;
const useFormat: (d: CameraDevice | undefined) => CameraDeviceFormat | undefined = vc
  ? (d) => vc.useCameraFormat(d, [{ videoResolution: { width: 1920, height: 1080 } }, { fps: FPS }])
  : () => undefined;

export type { CameraPhase, Facing };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** A promise for "the camera is ready", resolved from outside. */
function deferred() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

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

export function useInAppCamera({ recordingId, on, onFrame, onPause, onResume, beforeResume, betweenFiles }: Options) {
  const ref = useRef<Camera | null>(null);
  /** The <Camera> element's ref (CameraCard passes it on). */
  const setCamera = useCallback((c: Camera | null) => {
    ref.current = c;
  }, []);
  /** What has been filmed, for the clock: the finished files' length, and since when the current one runs. */
  const [clock, setClock] = useState<{ doneMs: number; since: number | null }>({ doneMs: 0, since: null });
  // Both cameras are looked up; `facing` picks one, and the format follows it in the same render.
  const back = useDevice('back');
  const front = useDevice('front');
  const [facing, setFacing] = useState<Facing>('back');
  const facingRef = useRef<Facing>('back');
  const device = facing === 'front' ? front : back;
  const format = useFormat(device);
  const twoCameras = !!back && !!front && back.id !== front.id;
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
  const rollRef = useRef<(startedAt: number) => Promise<void>>(async () => {});
  /** The camera is set up for the current device: VisionCamera's onInitialized (again after every flip). */
  const ready = useRef<ReturnType<typeof deferred> | null>(null);
  if (ready.current == null) ready.current = deferred();
  const [initialized, setInitialized] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const flippingRef = useRef(false);
  /** start, resume, the roll and the flip, one at a time. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const serial = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job);
    queue.current = run.catch(() => {});
    return run;
  }, []);
  const cbs = useRef({ onFrame, onPause, onResume, beforeResume, betweenFiles, recordingId });
  useEffect(() => {
    cbs.current = { onFrame, onPause, onResume, beforeResume, betweenFiles, recordingId };
  });

  const onInitialized = useCallback(() => {
    ready.current?.resolve(true);
    setInitialized(true);
  }, []);
  /** Waits until the camera is ready for the device it has now (a flip meanwhile: the new one). */
  const waitReady = useCallback(async (ms: number): Promise<boolean> => {
    const until = Date.now() + ms;
    for (;;) {
      const r = ready.current!;
      const ok = await Promise.race([r.promise, sleep(until - Date.now()).then(() => false)]);
      if (!ok) return false;
      if (r === ready.current) return true;
    }
  }, []);
  /** Points the <Camera> at the other device and waits until VisionCamera has set it up. */
  const switchTo = useCallback(
    async (f: Facing): Promise<boolean> => {
      const old = ready.current!;
      ready.current = deferred();
      old.resolve(true); // whoever waits on the old camera now waits for this one (waitReady)
      setInitialized(false);
      facingRef.current = f;
      setFacing(f);
      return waitReady(FLIP_WAIT_MS);
    },
    [waitReady],
  );
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
    rollTimer.current = setTimeout(() => void rollRef.current(startedAt), CHUNK_MS);
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

  /** Between two files while filming: homie's mic may restart, then the next file (homie hears the gap). */
  const nextFile = useCallback(async () => {
    if (phaseRef.current !== 'filming' || current.current) return;
    await cbs.current.betweenFiles?.().catch(() => {});
    if (phaseRef.current !== 'filming' || current.current) return;
    const at = Date.now();
    if (await startFile()) cbs.current.onResume?.(gapS(chunks.current.at(-1), at));
  }, [startFile]);

  /** Every CHUNK_MS: finish this file and start the next. Not if that file has ended already (a flip, a pause). */
  const roll = useCallback(
    (startedAt: number) =>
      serial(async () => {
        if (phaseRef.current !== 'filming' || current.current?.startedAt !== startedAt) return;
        await endFile();
        await nextFile();
      }),
    [serial, endFile, nextFile],
  );
  useEffect(() => {
    rollRef.current = roll;
  });

  const start = useCallback(
    (): Promise<boolean> =>
      serial(async () => {
        if (phaseRef.current !== 'idle') return phaseRef.current === 'filming';
        if (!(await waitReady(READY_WAIT_MS)) || !(await startFile())) {
          setError('The camera didn’t start.');
          return false;
        }
        setPhase('filming');
        return true;
      }),
    [serial, waitReady, startFile, setPhase],
  );

  const pause = useCallback(async () => {
    if (phaseRef.current !== 'filming') return;
    setPhase('paused');
    cbs.current.onPause?.();
    await endFile();
  }, [endFile, setPhase]);

  const resume = useCallback(
    (): Promise<boolean> =>
      serial(async () => {
        if (phaseRef.current !== 'paused') return phaseRef.current === 'filming';
        await cbs.current.beforeResume?.().catch(() => {});
        if (phaseRef.current !== 'paused') return false;
        // Ready already after a lock or a call; after a flip while paused, this waits for the new camera.
        await waitReady(FLIP_WAIT_MS);
        const at = Date.now();
        if (phaseRef.current !== 'paused' || !(await startFile())) return false;
        setPhase('filming');
        cbs.current.onResume?.(gapS(chunks.current.at(-1), at));
        return true;
      }),
    [serial, waitReady, startFile, setPhase],
  );

  /**
   * The other camera (cameraLogic flipSteps). While filming: the file ends, the camera switches, a new
   * file starts on the other one (homie hears the gap), and the mic is never touched while a file is
   * written. If the other camera isn't ready in FLIP_WAIT_MS: back to the one that worked. False when
   * nothing changed.
   */
  const flip = useCallback(async (): Promise<boolean> => {
    if (!twoCameras || flippingRef.current) return false;
    flippingRef.current = true;
    setFlipping(true);
    try {
      return await serial(async () => {
        const from = facingRef.current;
        const steps = flipSteps(phaseRef.current);
        if (steps.includes('endFile')) await endFile();
        const switched = await switchTo(otherFacing(from));
        if (!switched) {
          console.warn('[camera] the other camera did not get ready; back to', from);
          await switchTo(from);
        }
        if (steps.includes('startFile')) await nextFile();
        else await sleep(FLIP_SETTLE_MS);
        return switched;
      });
    } finally {
      flippingRef.current = false;
      setFlipping(false);
    }
  }, [twoCameras, serial, endFile, switchTo, nextFile]);

  const stop = useCallback(async (): Promise<DraftClip[]> => {
    if (phaseRef.current === 'done') return chunks.current.map((c, i) => chunkClip(c, i + 1));
    setPhase('done');
    await endFile();
    return chunks.current.map((c, i) => chunkClip(c, i + 1));
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
      // Mid-flip the picture may still be the other camera's: none this time.
      if (!cam || !m || framing.current || flippingRef.current || !cbs.current.onFrame) return;
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
    /** Which camera films, and whether a flip is running (its button waits). */
    facing,
    flipping,
    /** Both cameras exist (else no flip button). */
    twoCameras,
    /** The flip button works: both cameras, the camera ready, no flip running. */
    canFlip: twoCameras && initialized && !flipping,
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
    flip,
    still,
    /** Video filmed by `now` (render it with a ticking clock). */
    filmedMs: (now: number) => clock.doneMs + (clock.since === null ? 0 : Math.max(0, now - clock.since)),
  };
}

export type InAppCamera = ReturnType<typeof useInAppCamera>;
export type CameraHandle = Camera;

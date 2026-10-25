// The in-app camera's files, without React: start, the 5-minute roll, pause, resume, stop and the flip.
// useInAppCamera wires it to VisionCamera's <Camera> and to React (useSyncExternalStore on `snapshot`);
// node scripts/test-recording-ui.mjs drives it with a fake camera. The rules it keeps:
//   - homie's mic may restart only while no file is open (being written or still being saved):
//     `betweenFiles` (a roll, a flip while filming) and `beforeResume` run only then. Both get `goesOn()`,
//     false once "I'm done" has been pressed (then the mic must not be marked busy again).
//   - a file starts only once the camera is ready for its current device: VisionCamera's onInitialized
//     (`initialized()`), again after every flip and every fresh <Camera>.
//   - start, resume, the roll and the flip run one at a time (`serial`); pause and stop never wait.
//   - a camera that doesn't come back never leaves the clock ticking over nothing: a failed flip gets a
//     fresh <Camera> (`cameraKey`) on the camera that worked; if that doesn't come up either, or a resume
//     can't start, or a file fails by itself, no file starts, filming goes to 'paused' (homie is told),
//     `trouble` is set (the screen says so) and the <Camera> starts over again.
//   - nothing waits forever on the camera: a file that never says it ended is let go after endWaitMs.
//
//   const f = new Filming(); f.connect(camera, events)    camera: start/stop a file, keep a finished one
//   f.start() / f.pause() / f.resume() / f.flip() / await f.stop() -> the clips, in order
//   f.initialized()   from <Camera onInitialized>     f.snapshot()   what the screen shows
import { CHUNK_MS, chunkClip, END_WAIT_MS, filmedMs, FLIP_SETTLE_MS, FLIP_WAIT_MS, flipSteps, gapS, otherFacing, READY_WAIT_MS, type CameraPhase, type Chunk, type Facing } from './cameraLogic';
import type { DraftClip } from './draft';

/** A finished file as the camera reports it (seconds, pixels). */
export type Recorded = { path: string; duration: number; width: number; height: number };

/** What Filming needs from the camera: VisionCamera's <Camera> in the app, a fake in the tests. */
export type FilmingCamera = {
  /** Starts one file; exactly one of the two callbacks comes later. Throws when it can't start. */
  startRecording(finished: (v: Recorded) => void, failed: (e: { code?: string; message?: string }) => void): void;
  stopRecording(): Promise<void>;
  /** Moves a finished file somewhere safe (file number n, from 1); returns where it is now. */
  keep(path: string, n: number): string;
};

export type FilmingEvents = {
  onPause?: () => void;
  onResume?: (gapS: number) => void;
  /** Between two files after a pause (homie's mic restarts). `goesOn()`: still filming or paused. */
  beforeResume?: (goesOn: () => boolean) => Promise<void>;
  /** Between two files while filming: a roll, a flip (a mic that waited may start). */
  betweenFiles?: (goesOn: () => boolean) => Promise<void>;
};

export type FilmingTimes = { chunkMs: number; readyWaitMs: number; flipWaitMs: number; endWaitMs: number; settleMs: number };
export const TIMES: FilmingTimes = { chunkMs: CHUNK_MS, readyWaitMs: READY_WAIT_MS, flipWaitMs: FLIP_WAIT_MS, endWaitMs: END_WAIT_MS, settleMs: FLIP_SETTLE_MS };

/** What the screen shows. A new object on every change. */
export type FilmingView = {
  phase: CameraPhase;
  facing: Facing;
  /** Bumped for a fresh <Camera> (its React key). */
  cameraKey: number;
  /** The camera is set up for its device (the flip button works). */
  ready: boolean;
  flipping: boolean;
  /** The camera stopped by itself: "The camera stopped. Your video so far is saved." */
  trouble: boolean;
  error: string | null;
  /** The clock: the finished files' length, and since when the open one runs (null = none). */
  doneMs: number;
  since: number | null;
};

type OpenFile = { startedAt: number; done: Promise<void>; ending: boolean };

const NO_CAMERA: FilmingCamera = {
  startRecording: () => {
    throw new Error('no camera connected');
  },
  stopRecording: async () => {},
  keep: (path) => path,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

function deferred() {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

export class Filming {
  private view: FilmingView = { phase: 'idle', facing: 'back', cameraKey: 0, ready: false, flipping: false, trouble: false, error: null, doneMs: 0, since: null };
  private listeners = new Set<() => void>();
  private chunks: Chunk[] = [];
  private open: OpenFile | null = null;
  private files = 0;
  private ready = deferred();
  private readyAt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private rollTimer: ReturnType<typeof setTimeout> | null = null;
  private camera: FilmingCamera = NO_CAMERA;
  private on: FilmingEvents = {};
  private t: FilmingTimes;

  constructor(times: Partial<FilmingTimes> = {}) {
    this.t = { ...TIMES, ...times };
  }

  /** The camera and the screen's callbacks (useInAppCamera does it in an effect, once). */
  connect(camera: FilmingCamera, on: FilmingEvents) {
    this.camera = camera;
    this.on = on;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  snapshot = () => this.view;
  get phase() {
    return this.view.phase;
  }
  /** When the open file started (the roll timer's file), or null. */
  get openSince() {
    return this.open?.startedAt ?? null;
  }

  private set(patch: Partial<FilmingView>) {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }
  private goesOn = () => this.view.phase === 'filming' || this.view.phase === 'paused';

  /** One at a time: start, resume, the roll, the flip. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => {});
    return run;
  }

  // ---- the camera being ready ----

  /** VisionCamera's onInitialized: the camera is set up for its device. */
  initialized() {
    this.ready.resolve(true);
    this.readyAt = Date.now();
    this.set({ ready: true });
  }
  cameraError(message: string | null) {
    this.set({ error: message });
  }

  /** Until the camera is ready for the device it has now (a switch meanwhile: the new one). */
  private async waitReady(ms: number): Promise<boolean> {
    const until = Date.now() + ms;
    for (;;) {
      const r = this.ready;
      const ok = await Promise.race([r.promise, sleep(until - Date.now()).then(() => false)]);
      if (!ok) return false;
      if (r === this.ready) return true;
    }
  }
  /** The camera changes (another device, or a fresh <Camera>): wait for its own onInitialized. */
  private unready() {
    const old = this.ready;
    this.ready = deferred();
    old.resolve(true); // whoever waited on the old one now waits for this one (waitReady)
    this.set({ ready: false });
  }
  private async switchTo(facing: Facing, fresh: boolean): Promise<boolean> {
    this.unready();
    this.set(fresh ? { facing, cameraKey: this.view.cameraKey + 1 } : { facing });
    return this.waitReady(this.t.flipWaitMs);
  }
  /** The camera didn't come back: no file, 'paused' (homie waits), the trouble line, a fresh <Camera>. */
  private stuck() {
    this.clearRoll();
    if (this.view.phase === 'filming') {
      this.setPhase('paused');
      this.on.onPause?.();
    }
    this.unready();
    this.set({ trouble: true, cameraKey: this.view.cameraKey + 1 });
  }
  /** For a still (the plate photo): the camera ready, and a flip's new frames arriving (settleMs). */
  async readyForStill(): Promise<boolean> {
    const ok = await this.waitReady(this.t.flipWaitMs);
    await sleep(this.readyAt + this.t.settleMs - Date.now());
    return ok;
  }

  // ---- files ----

  private setPhase(phase: CameraPhase) {
    this.set({ phase });
  }
  private clearRoll() {
    if (this.rollTimer) clearTimeout(this.rollTimer);
    this.rollTimer = null;
  }
  private clockNow() {
    this.set({ doneMs: filmedMs(this.chunks, null, 0), since: this.open?.startedAt ?? null });
  }

  /** Starts one file; it rolls over to the next after chunkMs while filming. */
  private startFile(): boolean {
    if (this.open) return true;
    const startedAt = Date.now();
    const n = ++this.files;
    let finish!: () => void;
    const file: OpenFile = { startedAt, done: new Promise<void>((r) => (finish = r)), ending: false };
    const closed = () => {
      if (this.open === file) this.open = null;
      finish();
    };
    this.open = file;
    this.clockNow();
    try {
      this.camera.startRecording(
        (v) => {
          const uri = this.camera.keep(v.path, n);
          this.chunks.push({ uri, startedAt, durationMs: Math.round(v.duration * 1000), width: v.width, height: v.height });
          this.chunks.sort((a, b) => a.startedAt - b.startedAt);
          closed();
          this.clockNow();
        },
        (e) => {
          console.warn('[camera] recording error', e.code, e.message);
          const byItself = !file.ending;
          closed();
          this.clockNow();
          // Nothing is being filmed now: the clock mustn't tick on over nothing.
          if (byItself && this.view.phase === 'filming' && !this.open) this.stuck();
        },
      );
    } catch (e) {
      console.warn('[camera] could not start a file', String(e).slice(0, 160));
      this.files -= 1;
      closed();
      this.clockNow();
      return false;
    }
    this.clearRoll();
    this.rollTimer = setTimeout(() => void this.roll(startedAt), this.t.chunkMs);
    return true;
  }

  /** Until this file is saved; one that never says so is let go after endWaitMs. */
  private async settled(file: OpenFile, stop: boolean) {
    const ended = (async () => {
      if (stop) await this.camera.stopRecording().catch((e) => console.warn('[camera] stop', String(e).slice(0, 120)));
      await file.done;
      return true;
    })();
    if (await Promise.race([ended, sleep(this.t.endWaitMs).then(() => false)])) return;
    console.warn('[camera] a file never said it ended; letting it go');
    if (this.open === file) this.open = null;
    this.clockNow();
  }

  /** Finishes the open file (resolves once it's saved). */
  private async endFile() {
    this.clearRoll();
    const file = this.open;
    if (!file) return;
    file.ending = true;
    await this.settled(file, true);
  }

  /** Between two files while filming: homie's mic may restart, then the next file (homie hears the gap). */
  private async nextFile() {
    if (this.view.phase !== 'filming' || this.open) return;
    await this.on.betweenFiles?.(this.goesOn).catch(() => {});
    if (this.view.phase !== 'filming' || this.open) return;
    const at = Date.now();
    if (this.startFile()) this.on.onResume?.(gapS(this.chunks.at(-1), at));
    else this.stuck();
  }

  start(): Promise<boolean> {
    return this.serial(async () => {
      if (this.view.phase !== 'idle') return this.view.phase === 'filming';
      if (!(await this.waitReady(this.t.readyWaitMs)) || this.view.phase !== 'idle' || !this.startFile()) {
        this.set({ error: 'The camera didn’t start.' });
        return false;
      }
      // A camera that failed during the hello and came back: a later lock says "stopped", not "trouble".
      this.set({ trouble: false });
      this.setPhase('filming');
      return true;
    });
  }

  /** Every chunkMs: finish this file and start the next. Not if that file has ended already (a flip, a pause). */
  roll(startedAt: number): Promise<void> {
    return this.serial(async () => {
      if (this.view.phase !== 'filming' || this.open?.startedAt !== startedAt) return;
      await this.endFile();
      await this.nextFile();
    });
  }

  /** Leaving the app: the file ends at once (never waits for the queue). */
  async pause() {
    if (this.view.phase !== 'filming') return;
    this.setPhase('paused');
    this.on.onPause?.();
    await this.endFile();
  }

  resume(): Promise<boolean> {
    return this.serial(async () => {
      if (this.view.phase !== 'paused') return this.view.phase === 'filming';
      // The pause's file may still be saving: the mic restarts only once it is.
      if (this.open) await this.settled(this.open, false);
      await this.on.beforeResume?.(this.goesOn).catch(() => {});
      if (this.view.phase !== 'paused' || this.open) return false;
      // Ready already after a lock or a call; after a flip or a fresh <Camera>, this waits for it.
      if (!(await this.waitReady(this.t.flipWaitMs))) {
        this.stuck();
        return false;
      }
      const at = Date.now();
      if (!this.startFile()) {
        this.stuck();
        return false;
      }
      this.setPhase('filming');
      this.set({ trouble: false });
      this.on.onResume?.(gapS(this.chunks.at(-1), at));
      return true;
    });
  }

  /** "I'm done": the open file ends; the clips, in order (also while a flip or a roll runs). */
  async stop(): Promise<DraftClip[]> {
    this.clearRoll();
    if (this.view.phase !== 'done') {
      this.setPhase('done');
      await this.endFile();
    } else if (this.open) await this.settled(this.open, false);
    return this.chunks.map((c, i) => chunkClip(c, i + 1));
  }

  /**
   * The other camera (cameraLogic flipSteps). While filming: the file ends, the camera switches, and a new
   * file starts on the other one. Otherwise a file still being saved is saved first, and a still waits
   * settleMs. If the other camera doesn't get ready: a fresh <Camera> on the one that worked. True when
   * the camera changed.
   */
  flip(): Promise<boolean> {
    // Not before the camera is first ready (a late onInitialized would count for the other camera).
    if (this.view.flipping || !this.view.ready) return Promise.resolve(false);
    this.set({ flipping: true });
    return this.serial(async () => {
      try {
        const steps = flipSteps(this.view.phase);
        if (steps.includes('endFile')) await this.endFile();
        else if (this.open) await this.settled(this.open, false);
        const from = this.view.facing;
        const switched = await this.switchTo(otherFacing(from), false);
        if (!switched) {
          // VisionCamera may have dropped the old input and, comparing with its last good setup, won't set
          // the old device up again: a fresh <Camera> on the camera that worked.
          console.warn('[camera] the other camera did not get ready; a fresh camera on the', from);
          if (!(await this.switchTo(from, true))) {
            this.stuck();
            return false;
          }
        }
        if (steps.includes('startFile')) await this.nextFile();
        else await sleep(this.t.settleMs);
        return switched;
      } finally {
        this.set({ flipping: false });
      }
    });
  }

  /** Leaving the screen never leaves the camera recording. */
  dispose() {
    this.clearRoll();
    if (this.open) void this.camera.stopRecording().catch(() => {});
  }
}

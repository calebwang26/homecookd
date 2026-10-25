// The in-app camera's rules, pure (node scripts/test-recording-ui.mjs): how long one file runs, how
// often homie gets a picture, the gap between two files that the video doesn't have, how much has been
// filmed, the clock under the picture, when leaving the app stops the camera and when coming back starts
// it again by itself, the draft clip each finished file becomes, and the flip between the back and the
// front camera (what it does in each phase, where its button goes).
import type { DraftClip } from './draft';

export type CameraPhase = 'idle' | 'filming' | 'paused' | 'done';

/** Each file is finished after this long and a new one starts, so a crash or a kill loses at most this. */
export const CHUNK_MS = 5 * 60_000;
/** homie's look at the stove: one small still this often (the glasses' rate). */
export const FRAME_EVERY_MS = 5000;
export const FRAME_WIDTH = 640;
/** Away from the app no longer than this, without reaching the background (Control Center, a banner): filming goes on by itself. */
export const AUTO_RESUME_MS = 5000;

/** One finished file. `startedAt` is when it began (epoch ms), `durationMs` how long it runs. */
export type Chunk = { uri: string; startedAt: number; durationMs: number; width: number; height: number };

export const chunkName = (n: number) => `part-${String(n).padStart(2, '0')}.mp4`;

/** Seconds between the end of one file and the start of the next: wall time the video doesn't have. */
export function gapS(prev: Pick<Chunk, 'startedAt' | 'durationMs'> | undefined, nextStartedAt: number): number {
  if (!prev) return 0;
  return Math.max(0, Math.round((nextStartedAt - (prev.startedAt + prev.durationMs)) / 100) / 10);
}

/** Video filmed so far: the finished files, plus the one running since `currentSince` (null = none). */
export function filmedMs(chunks: Pick<Chunk, 'durationMs'>[], currentSince: number | null, now: number): number {
  return chunks.reduce((a, c) => a + c.durationMs, 0) + (currentSince === null ? 0 : Math.max(0, now - currentSince));
}

/** "4:07", "1:02:33". */
export function clockLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Leaving the app (any state but active) stops the current file at once, before iOS takes the camera. */
export const stopsFilming = (appState: string) => appState !== 'active';

/** Back in the app: start filming again by itself only after a short trip that never reached the background. */
export function resumesBySelf(awayMs: number, reachedBackground: boolean): boolean {
  return !reachedBackground && awayMs <= AUTO_RESUME_MS;
}

/** A finished file as a clip on the Send path (sendDraft): an mp4 with its length in ms, like the picker's. */
export function chunkClip(c: Chunk, n: number): DraftClip {
  return {
    key: `${c.uri}#camera`,
    asset: { uri: c.uri, width: c.width, height: c.height, type: 'video', duration: c.durationMs, fileName: chunkName(n), mimeType: 'video/mp4' },
    source: 'camera',
    recordedAt: new Date(c.startedAt).toISOString(),
    selected: true,
  };
}

// ---- Flipping between the back and the front camera ----

export type Facing = 'back' | 'front';
export const otherFacing = (f: Facing): Facing => (f === 'back' ? 'front' : 'back');

/** How long a flip waits for the other camera to be ready before it goes back to the one that worked. */
export const FLIP_WAIT_MS = 5000;
/** Not filming: a moment after the other camera is ready, so the plate photo has its picture, not the old one's. */
export const FLIP_SETTLE_MS = 400;

/**
 * What a flip does in each phase. While a file is being written the flip is a file boundary, like the
 * 5-minute roll: finish the file, switch the camera, homie's mic may restart (betweenFiles), a new file on
 * the other camera (homie hears the small gap). The mic never starts or stops while a file is written.
 * Before filming, while paused and after "I'm done" there is no file: only the camera switches (the next
 * file, or the plate photo, uses it).
 */
export type FlipStep = 'endFile' | 'switch' | 'betweenFiles' | 'startFile';
export function flipSteps(phase: CameraPhase): FlipStep[] {
  return phase === 'filming' ? ['endFile', 'switch', 'betweenFiles', 'startFile'] : ['switch'];
}

/**
 * Where the flip button goes: beside the camera card, beside the shutter in the plate photo's big view,
 * or nowhere (no card, a phone with one camera, homie's question over the screen, the plate photo taken).
 */
export function flipPlace(s: { camera: boolean; twoCameras: boolean; asking: boolean; plate: boolean; photo: boolean }): 'card' | 'shutter' | null {
  if (!s.camera || !s.twoCameras || s.asking) return null;
  if (s.plate) return s.photo ? null : 'shutter';
  return 'card';
}

/** Room under the flip button for one line of its label. */
export const FLIP_LABEL_ROOM = 24;

/**
 * The flip button and its label beside the card: centred in the space to its right, at the card's
 * bottom (a camera's controls sit low, and up by the middle it crowds homie's corner pot on a small phone).
 */
export function flipBeside(card: { x: number; y: number; width: number; height: number }, screenWidth: number, button: number) {
  const from = card.x + card.width;
  const space = screenWidth - from;
  const width = Math.max(button, Math.min(space - 8, 104));
  return { left: from + Math.max(4, (space - width) / 2), top: card.y + card.height - button - FLIP_LABEL_ROOM, width };
}

// One place for range playback ("Watch" a step's video, "Hear" the cook's words).
//
// AUDIO: one shared player for the whole app, so only one voice plays at a time (tapping another
// "Hear" stops the first). Works for recipe clips (a range inside voice.m4a) and voice notes.
//   const hear = useClipAudio({ url: recipe.media.audio_url, start_s: 42, end_s: 118 });
//   hear.toggle(); hear.phase ('idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error');
//   hear.progress (0..1 through the range), hear.elapsed / hear.duration (seconds)
//
// VIDEO: `useClipVideo(url, start, end)` drives an expo-video player that seeks to `start`, plays,
// and pauses itself once `currentTime >= end`. Render it with <ClipVideo/> (components/media).
// Only a tap, the end of the range, leaving the screen (or another voice starting) and the app going
// to the background pause a step clip. iOS saying "not playing" never does: it says that while it
// loads more, while it weighs its buffer after a seek, and after the system stopped it. The phase
// stays 'playing' with `buffering` true (a spinner, not a Play button); once it has loaded and still
// isn't moving a second later, it is asked to play again. Nothing for 30 s is an error to retry.
// (`whole`, with native controls, still reads "not playing" while loaded as their pause.)
//
// One voice at a time, both ways: a video starting stops the audio, and audio starting (or another
// video) pauses any playing video. The audio player keeps the app's audio session active when it
// pauses: expo-audio otherwise deactivates the shared session 100 ms after a pause, and iOS then
// stops the video that just started (Caleb's "videos keep pausing", Oct 22).
//
// FOLLOWING ALONG: `usePlayhead(select)` reads where a step video is right now (one plays at a
// time), so a list can light up the line being said (Substeps). `playFrom(at)` jumps the clip to a
// line's start and plays (tapping a substep).
//
// Ported from the old PlayerSheet: after a seek, time updates are ignored for a moment so a stale
// position never pauses playback early. The end of the range still counts inside that moment when the
// update is close to where the seek went (a scrub just before the end stops at the end).
//
// LISTENING: a clip that carries `heard` (a cook's recorded voice, never a voice note) is measured
// per play; once a play ends, is stopped or is replaced after reaching 3 s, the listener that
// lib/listening.ts registers logs a 'heard' event (RETENTION-HANDOFF 2.3). Once per play.
import { useEventListener } from 'expo';
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import type { Recipe, Step } from './types';

export type Phase = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/** A range inside a media file. `end_s` null = play to the end of the file. */
export type AudioClip = {
  url: string | null | undefined;
  start_s?: number | null;
  end_s?: number | null;
  /** Distinguishes two clips of the same file (defaults to url + range). */
  key?: string;
  /** A cook's recipe voice: log 'heard' once a play of it reaches 3 s (lib/listening.ts). Voice notes leave it out. */
  heard?: { recipe_id: string; cook_id: string | null };
};

/** One play of a `heard` clip that lasted >= 3 s, from its start. */
export type HeardPlay = { recipe_id: string; cook_id: string | null; duration_s: number; start_s: number };
const HEARD_MIN_S = 3;
let heardListener: ((p: HeardPlay) => void) | null = null;
let heardNow: { meta: NonNullable<AudioClip['heard']>; start: number; last: number; listened: number } | null = null;
// The current clip's tag, so scrubbing back after its end starts a new measure.
let heardMeta: AudioClip['heard'] | null = null;

/** lib/listening.ts registers the sender once, so this file needs no api or session import. */
export function setHeardListener(fn: ((p: HeardPlay) => void) | null) {
  heardListener = fn;
}

/** Ends the current play's measure; reports it when it reached 3 s. */
function flushHeard() {
  const p = heardNow;
  heardNow = null;
  if (!p || !heardListener) return;
  const duration = Math.floor(p.listened);
  if (duration < HEARD_MIN_S) return;
  try {
    heardListener({ ...p.meta, duration_s: duration, start_s: p.start });
  } catch {
    // logging never breaks playback
  }
}

/** Counts listening up to `to` (seconds in the file). */
function countHeard(to: number) {
  if (!heardNow) return;
  heardNow.listened += Math.max(0, to - heardNow.last);
  heardNow.last = to;
}

const SEEK_GRACE_MS = 800;
const LOAD_TIMEOUT_MS = 20_000;
// A native seek that hasn't settled by then is let go, so it can't hold up every later scrub.
const SEEK_TIMEOUT_MS = 3_000;
// The big family recordings can take 16 s to start on a slow connection.
const VIDEO_TIMEOUT_MS = 30_000;
// An update this close to where the last seek went is fresh, even inside the grace.
const NEAR_S = 2;
// Loaded but not moving this long while it should play: asked to play again (iOS stopped it).
const NUDGE_MS = 1_000;
// A time update this far before the step's start is outside it (a hair before is rounding).
const BEFORE_START_S = 0.5;
// Audio seeks land within this of the target (expo-audio's default lets iOS land anywhere near).
const AUDIO_SEEK_TOLERANCE_MS = 100;

export function clipKey(c: AudioClip): string {
  return c.key ?? `${c.url ?? ''}#${Math.floor(c.start_s ?? 0)}-${c.end_s ?? 'end'}`;
}

// ---------------------------------------------------------------------------------------------
// Shared audio engine

type EngineState = {
  key: string | null;
  phase: Phase;
  /** Absolute position in the file (seconds). */
  position: number;
  start: number;
  end: number | null;
  /** File duration once known. */
  fileDuration: number;
  error: string | null;
};

let state: EngineState = { key: null, phase: 'idle', position: 0, start: 0, end: null, fileDuration: 0, error: null };
const listeners = new Set<() => void>();
let player: AudioPlayer | null = null;
let playerUrl: string | null = null;
let statusSub: { remove: () => void } | null = null;
let pendingStart = false;
let ignoreUntil = 0;
let seeking = false;
let seekVersion = 0;
let seekQueue: Promise<void> = Promise.resolve();
let loadTimer: ReturnType<typeof setTimeout> | null = null;

function set(next: Partial<EngineState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function clearLoadTimer() {
  if (loadTimer) clearTimeout(loadTimer);
  loadTimer = null;
}

/** The native seek, or SEEK_TIMEOUT_MS, whichever comes first. */
function settle(seek: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SEEK_TIMEOUT_MS);
  });
  return Promise.race([seek, late]).finally(() => clearTimeout(timer));
}

// Serialize native seeks: a slow initial seek must not finish after a newer scrub or clip switch.
function requestAudioSeek(position: number) {
  const p = player;
  if (!p) return;
  const version = ++seekVersion;
  seeking = true;
  p.pause();
  seekQueue = seekQueue.catch(() => {}).then(async () => {
    if (version !== seekVersion || p !== player) return;
    try {
      await settle(p.seekTo(position, AUDIO_SEEK_TOLERANCE_MS, AUDIO_SEEK_TOLERANCE_MS));
      if (version !== seekVersion || p !== player) return;
      seeking = false;
      ignoreUntil = Date.now() + SEEK_GRACE_MS;
      if (state.phase === 'playing') p.play();
    } catch {
      if (version !== seekVersion || p !== player) return;
      seeking = false;
      set({ phase: 'error', error: 'seek' });
    }
  });
}

function beginRange() {
  if (!player) return;
  pendingStart = false;
  clearLoadTimer();
  set({ phase: 'playing', position: state.start, error: null });
  requestAudioSeek(state.start);
}

function onStatus(s: AudioStatus) {
  if (s.duration && Number.isFinite(s.duration) && s.duration !== state.fileDuration) state.fileDuration = s.duration;
  if (s.error) {
    pendingStart = false;
    clearLoadTimer();
    set({ phase: 'error', error: s.error });
    return;
  }
  if (pendingStart) {
    if (s.isLoaded) beginRange();
    return;
  }
  if (seeking) return;
  const fresh = Date.now() >= ignoreUntil;
  const position = fresh ? s.currentTime : state.position;
  if (state.phase === 'playing') {
    if (fresh) countHeard(Math.min(s.currentTime, state.end ?? Infinity));
    // Inside the grace too when it is near where the seek went: a scrub to just before the end
    // stops there, not in the next step's words.
    const near = Math.abs(s.currentTime - state.position) < NEAR_S;
    if (state.end != null && s.currentTime >= state.end && (fresh || near)) {
      countHeard(state.end);
      player?.pause();
      set({ phase: 'ended', position: state.end });
      flushHeard();
      return;
    }
    if (fresh && s.didJustFinish) {
      set({ phase: 'ended', position: s.duration || s.currentTime });
      flushHeard();
      return;
    }
  }
  if (Math.abs(position - state.position) >= 0.05) set({ position });
}

function ensurePlayer(url: string): AudioPlayer {
  if (player && playerUrl === url) return player;
  try {
    statusSub?.remove();
    player?.remove();
  } catch {
    // already released
  }
  ++seekVersion;
  seeking = false;
  seekQueue = Promise.resolve();
  // keepAudioSessionActive: a pause must not end the session a step video is playing in (see top).
  player = createAudioPlayer(url, { updateInterval: 250, keepAudioSessionActive: true });
  playerUrl = url;
  const currentPlayer = player;
  statusSub = player.addListener('playbackStatusUpdate', (status) => {
    if (player === currentPlayer) onStatus(status);
  });
  return player;
}

/** Plays `clip` (or resumes it when it is the paused current clip). */
export function playClip(clip: AudioClip) {
  const url = clip.url;
  if (!url) return;
  const key = clipKey(clip);
  const start = Math.max(0, Math.floor(clip.start_s ?? 0));
  const end = clip.end_s != null && clip.end_s > start ? clip.end_s : null;

  if (state.key === key && player && playerUrl === url) {
    if (state.phase === 'paused') {
      pauseVideos();
      set({ phase: 'playing' });
      if (!seeking) player.play();
      return;
    }
    if (state.phase === 'playing' || state.phase === 'loading') return;
  }

  // A new clip (or a replay): stop whatever is playing, then load / seek.
  pauseVideos();
  player?.pause();
  flushHeard();
  heardMeta = clip.heard ?? null;
  heardNow = clip.heard ? { meta: clip.heard, start, last: start, listened: 0 } : null;
  const p = ensurePlayer(url);
  set({ key, start, end, position: start, fileDuration: p.duration || 0, phase: 'loading', error: null });
  if (p.isLoaded) {
    beginRange();
  } else {
    pendingStart = true;
    clearLoadTimer();
    // Status events normally report the load; poll too, in case none arrives before playback.
    const startedAt = Date.now();
    const tick = () => {
      if (!pendingStart || state.key !== key) return;
      if (p === player && p.isLoaded) return beginRange();
      if (Date.now() - startedAt > LOAD_TIMEOUT_MS) {
        pendingStart = false;
        set({ phase: 'error', error: 'timeout' });
        return;
      }
      loadTimer = setTimeout(tick, 250);
    };
    loadTimer = setTimeout(tick, 250);
  }
}

export function pauseAudio() {
  if (!player) return;
  if (state.phase === 'playing') {
    player.pause();
    set({ phase: 'paused' });
  } else if (state.phase === 'loading') {
    pendingStart = false;
    clearLoadTimer();
    set({ phase: 'idle', key: null });
  }
}

/** Seek within the current clip, preserving pause/play state and excluding skipped time from listening. */
export function seekAudio(elapsed: number, onlyKey?: string) {
  if (!player || !state.key || (onlyKey && state.key !== onlyKey) || !Number.isFinite(elapsed)) return;
  if (state.phase === 'loading' || state.phase === 'error' || state.phase === 'idle') return;
  const end = state.end == null ? state.fileDuration : state.fileDuration > 0 ? Math.min(state.end, state.fileDuration) : state.end;
  if (end <= state.start) return;
  const position = Math.max(state.start, Math.min(end, state.start + elapsed));
  const atEnd = position >= end;
  // Back from the end: a new listen (the last one was reported when it ended).
  if (state.phase === 'ended' && !atEnd && !heardNow && heardMeta) heardNow = { meta: heardMeta, start: position, last: position, listened: 0 };
  if (heardNow) heardNow.last = position;
  if (atEnd) {
    // To the end is the end of this listen, as if it had played there.
    player.pause();
    flushHeard();
  }
  ignoreUntil = Date.now() + SEEK_GRACE_MS;
  set({ position, phase: atEnd ? 'ended' : state.phase === 'ended' ? 'paused' : state.phase });
  requestAudioSeek(position);
}

/** Stops any clip (e.g. when a video starts or a sheet closes). */
export function stopAudio(onlyKey?: string) {
  if (onlyKey && state.key !== onlyKey) return;
  flushHeard();
  heardMeta = null;
  ++seekVersion;
  seeking = false;
  // A seek still stuck in the native player must not hold up the next play of the same file.
  seekQueue = Promise.resolve();
  pendingStart = false;
  clearLoadTimer();
  if (!state.key) return; // nothing current: the native player is already still
  try {
    player?.pause();
  } catch {
    // released
  }
  set({ key: null, phase: 'idle' });
}

const getState = () => state;

/** The engine's raw state (which clip is current, its phase and position). */
export function useNowPlaying(): EngineState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export type ClipAudio = {
  /** This clip's phase ('idle' when another clip, or nothing, is current). */
  phase: Phase;
  isCurrent: boolean;
  playing: boolean;
  /** Seconds into the clip. */
  elapsed: number;
  /** Clip length in seconds (range length, else the file duration once known, else 0). */
  duration: number;
  /** 0..1 through the clip. */
  progress: number;
  available: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  replay: () => void;
  stop: () => void;
  seek: (elapsed: number) => void;
};

/**
 * Range playback on the shared audio player. Pass null / a clip without url when there is no audio
 * (sample recipes): `available` is false and play() does nothing.
 */
export function useClipAudio(clip: AudioClip | null, opts: { stopOnUnmount?: boolean } = {}): ClipAudio {
  const s = useNowPlaying();
  const key = clip?.url ? clipKey(clip) : null;
  const isCurrent = !!key && s.key === key;
  const start = Math.max(0, Math.floor(clip?.start_s ?? 0));
  const end = clip?.end_s != null && clip.end_s > start ? clip.end_s : null;
  const knownEnd = isCurrent && s.fileDuration > 0 ? (end == null ? s.fileDuration : Math.min(end, s.fileDuration)) : end;
  const duration = knownEnd == null ? 0 : Math.max(0, knownEnd - start);
  const elapsed = isCurrent ? Math.max(0, Math.min(duration > 0 ? duration : Infinity, s.position - start)) : 0;
  const phase: Phase = isCurrent ? s.phase : 'idle';
  const progress = isCurrent ? (phase === 'ended' ? 1 : duration > 0 ? Math.min(1, elapsed / duration) : 0) : 0;

  const url = clip?.url ?? null;
  const rawEnd = clip?.end_s ?? null;
  const customKey = clip?.key;
  // `heard` rides along by value (a new object each render must not make a new callback).
  const heardRecipe = clip?.heard?.recipe_id ?? null;
  const heardCook = clip?.heard?.cook_id ?? null;
  const current = useCallback(
    (): AudioClip | null =>
      url
        ? { url, start_s: start, end_s: rawEnd, key: customKey, heard: heardRecipe ? { recipe_id: heardRecipe, cook_id: heardCook } : undefined }
        : null,
    [url, start, rawEnd, customKey, heardRecipe, heardCook],
  );

  const play = useCallback(() => {
    const c = current();
    if (c) playClip(c);
  }, [current]);
  const pause = useCallback(() => {
    if (key && state.key === key) pauseAudio();
  }, [key]);
  const replay = useCallback(() => {
    const c = current();
    if (!c) return;
    if (state.key === key) set({ phase: 'ended' }); // forces a fresh seek
    playClip(c);
  }, [current, key]);
  const stop = useCallback(() => {
    if (key) stopAudio(key);
  }, [key]);
  const toggle = useCallback(() => {
    const c = current();
    if (!c) return;
    if (state.key === key && (state.phase === 'playing' || state.phase === 'loading')) pauseAudio();
    else playClip(c);
  }, [current, key]);

  // Stop this clip when the component goes away (or switches to another clip).
  const stopOnUnmount = opts.stopOnUnmount ?? true;
  useEffect(() => {
    if (!stopOnUnmount || !key) return;
    return () => stopAudio(key);
  }, [stopOnUnmount, key]);

  return {
    phase,
    isCurrent,
    playing: phase === 'playing',
    elapsed,
    duration,
    progress,
    available: !!clip?.url,
    play,
    pause,
    toggle,
    replay,
    stop,
    seek: (elapsed) => { if (key) seekAudio(elapsed, key); },
  };
}

/** The Hear clip for a step of a recipe (null url for samples without audio). */
export function stepAudioClip(recipe: Recipe | null | undefined, step: Pick<Step, 'start_s' | 'end_s'> | null | undefined): AudioClip | null {
  if (!recipe || !step) return null;
  const start = Math.max(0, Math.floor(step.start_s || 0));
  let end = step.end_s && step.end_s > start ? step.end_s : start + 30;
  if (recipe.media.duration_s > 0) end = Math.min(end, recipe.media.duration_s);
  return { url: recipe.media.audio_url, start_s: start, end_s: end };
}

/** Splits a quote into sentences ("…" and "..." count as sentence ends). */
export function splitSentences(quote: string | null | undefined): string[] {
  if (!quote) return [];
  const parts = quote.match(/[^.!?…]+(?:[.!?…]+["”’)]*|$)/g) ?? [quote];
  const lines = parts.map((p) => p.trim()).filter(Boolean);
  return lines.length ? lines : [quote.trim()];
}

/** The sentence roughly playing at `progress` (proportional by length; no per-line timestamps). */
export function subtitleAt(quote: string | null | undefined, progress: number): string | null {
  const lines = splitSentences(quote);
  if (!lines.length) return null;
  if (lines.length === 1) return lines[0];
  const total = lines.reduce((n, l) => n + l.length, 0) || 1;
  let acc = 0;
  for (const line of lines) {
    acc += line.length;
    if (progress < acc / total) return line;
  }
  return lines[lines.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Following along

// The step video playing now (one at a time) and where it is, in seconds in its file.
let videoHead: { owner: object; url: string; at: number } | null = null;
const headListeners = new Set<() => void>();

function setVideoHead(next: typeof videoHead) {
  videoHead = next;
  for (const l of headListeners) l();
}

function subscribeHead(l: () => void) {
  headListeners.add(l);
  return () => {
    headListeners.delete(l);
  };
}

/** Where the step video of `video` (its URL) is while it plays, in seconds in the file; else null. */
export function playheadAt(video: string | null | undefined): number | null {
  return video && videoHead && videoHead.url === video ? videoHead.at : null;
}

/** Re-renders only when `select()` (reading playheadAt) gives a new value, e.g. a line's index. */
export function usePlayhead<T>(select: () => T): T {
  return useSyncExternalStore(subscribeHead, select, select);
}

/**
 * Chapter gaps for a range's bar, like YouTube's: where each later substep starts, as 0..1 of
 * [start, end]. None when fewer than two substeps have a start, or for starts outside the range.
 */
export function chapterMarks(starts: readonly (number | null | undefined)[] | null | undefined, start: number, end: number): number[] {
  const len = end - start;
  const timed = (starts ?? []).filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  if (timed.length < 2 || !(len > 0)) return [];
  return timed
    .map((t) => (t - start) / len)
    .filter((f) => f > 0.01 && f < 0.99)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Video

// Kept outside components so the React Compiler doesn't treat these as mutating hook values.
function seekVideo(p: VideoPlayer, seconds: number) {
  p.currentTime = seconds;
}

// Each mounted clip's "pause now", so only one voice plays at a time.
const videoPausers = new Map<VideoPlayer, () => void>();

/** Pauses every playing video but `except` (audio starting, or another video starting). */
function pauseVideos(except?: VideoPlayer) {
  for (const [p, pause] of videoPausers) if (p !== except) pause();
}

/** Silence: stops the voice and pauses every video (a screen losing focus to a pushed one). */
export function stopAllMedia() {
  stopAudio();
  pauseVideos();
}

export type ClipVideoState = {
  player: VideoPlayer;
  phase: Phase;
  /** Playing, but not moving (loading more, or iOS holding it): show a spinner, not a Play button. */
  buffering: boolean;
  /** Absolute time in the video (seconds). */
  now: number;
  elapsed: number;
  duration: number;
  seek: (elapsed: number) => void;
  /** Plays from `at` (seconds in the file, kept inside the range), e.g. a substep's start. */
  playFrom: (at: number) => void;
  /** 0..1 through the range. */
  progress: number;
  /** Video width / height once known (else the hint, else 16:9). */
  aspect: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  replay: () => void;
};

/**
 * An expo-video player locked to [start, end]. `whole` plays the full video (native controls, no
 * stop). `autoPlay` starts as soon as the source is ready (default true); `at` (seconds in the file,
 * inside the range) is where that first play starts instead of `start` (the full-screen player
 * picking up where the inline one was). A seek asked for before the source is ready lands there,
 * paused, once it is (the inline clip coming back from full screen).
 */
export function useClipVideo(
  url: string | null,
  start: number,
  end: number | null,
  opts: { whole?: boolean; autoPlay?: boolean; aspectHint?: number | null; muted?: boolean; at?: number | null } = {},
): ClipVideoState {
  const whole = !!opts.whole;
  const autoPlay = opts.autoPlay ?? true;
  const s0 = Math.max(0, Math.floor(start || 0));
  const e0 = end != null && end > s0 ? end : null;
  const [phase, setPhase] = useState<Phase>(url ? 'loading' : 'error');
  const [buffering, setBuffering] = useState(false);
  // From `at` when it is inside the range: closed (or retried) before it was ready, the full-screen
  // player hands back where it was asked to start, not the step's start.
  const at0 = !whole && opts.at != null && opts.at > s0 && (e0 == null || opts.at < e0) ? opts.at : s0;
  const [now, setNow] = useState(at0);
  const [aspect, setAspect] = useState(opts.aspectHint || 16 / 9);
  const [fileDuration, setFileDuration] = useState(0);
  const started = useRef(false);
  const ignore = useRef(0);
  // Where the last seek went; whether we asked it to play (loading more is not a pause); whether it
  // is loading more right now; and whether something else started before it was ready (no autoplay).
  const target = useRef(s0);
  const wanted = useRef(false);
  const waiting = useRef(false);
  const skipStart = useRef(false);
  // Where the first play starts (opts.at), and a seek asked for while still loading (both absolute).
  const firstAt = useRef(opts.at ?? null);
  const pendingSeek = useRef<number | null>(null);
  // Whether the native player is really moving; bumped when it is loaded but still while it should play.
  const [moving, setMoving] = useState(false);
  const [stalled, setStalled] = useState(0);

  const player = useVideoPlayer(url, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.loop = false;
    p.muted = !!opts.muted;
  });

  const applySize = (size: { width: number; height: number } | null | undefined) => {
    if (size && size.width > 0 && size.height > 0) setAspect(size.width / size.height);
  };

  const jump = (seconds: number) => {
    ignore.current = Date.now() + SEEK_GRACE_MS;
    target.current = seconds;
    seekVideo(player, seconds);
    setNow(seconds);
  };
  const resume = () => {
    wanted.current = true;
    stopAudio(); // never talk over the video
    pauseVideos(player);
    player.play();
    setPhase('playing');
  };
  const halt = (next: Phase) => {
    wanted.current = false;
    player.pause();
    setPhase(next);
  };
  const begin = () => {
    started.current = true;
    const at = firstAt.current;
    firstAt.current = null;
    jump(whole ? 0 : at != null && at > s0 && (e0 == null || at < e0) ? at : s0);
    resume();
  };
  // The source is ready for the first time: a seek that waited lands (paused), else autoplay.
  const ready = () => {
    if (started.current) return;
    const waited = pendingSeek.current;
    if (waited != null) {
      pendingSeek.current = null;
      firstAt.current = null; // "Watch again" then starts the step over
      started.current = true;
      jump(waited);
      setPhase(e0 != null && waited >= e0 ? 'ended' : 'paused');
    } else if (autoPlay && !skipStart.current) begin();
    else setPhase((p) => (p === 'loading' ? 'idle' : p));
  };

  useEventListener(player, 'sourceLoad', ({ availableVideoTracks, duration }) => {
    applySize(availableVideoTracks[0]?.size);
    setFileDuration(duration);
  });
  useEventListener(player, 'videoTrackChange', ({ videoTrack }) => applySize(videoTrack?.size));
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay') ready();
    if (status === 'error') {
      wanted.current = false;
      setPhase('error');
    }
    // Once started, 'loading' means it stopped to load more of the file.
    waiting.current = started.current && status === 'loading';
    setBuffering(waiting.current);
    if (status === 'readyToPlay' && started.current && wanted.current && !player.playing) setStalled((n) => n + 1);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    setMoving(isPlaying);
    if (isPlaying) {
      // A play nobody asked for (a late event from before a pause): the tap wins.
      if (!whole && !wanted.current) {
        player.pause();
        return;
      }
      wanted.current = true;
      setPhase('playing');
      return;
    }
    if (!wanted.current) return;
    // Native controls (`whole`): "not playing" while loaded is their Pause.
    if (whole && !waiting.current && player.status !== 'loading') {
      wanted.current = false;
      setPhase((prev) => (prev === 'playing' ? 'paused' : prev));
      return;
    }
    // Loading more, weighing its buffer, or stopped by the system: still playing (a spinner).
    setStalled((n) => n + 1);
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    const fresh = Date.now() >= ignore.current;
    // The end of the step; inside the seek grace too when the update is near where the seek went.
    if (!whole && e0 != null && currentTime >= e0 && (fresh || (wanted.current && Math.abs(currentTime - target.current) < NEAR_S))) {
      halt('ended');
      jump(e0);
      return;
    }
    if (!fresh) return;
    if (!whole && currentTime < s0 - BEFORE_START_S) {
      jump(s0); // re-arms the grace, so a slow seek isn't asked for again on every update
      return;
    }
    setNow(currentTime);
  });
  useEventListener(player, 'playToEnd', () => {
    wanted.current = false;
    setPhase('ended');
  });

  // In case the source was ready before our listeners attached (checked right after mount).
  useEffect(() => {
    const t = setTimeout(() => {
      applySize(player.videoTrack?.size);
      setFileDuration(player.duration || 0);
      if (player.status === 'readyToPlay') ready();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // Loaded but still not moving while it should play: AVPlayer usually goes on by itself; if it
  // hasn't a moment later, iOS stopped it (an interruption, the audio session), so ask again. Never a
  // pause: only a tap, the range end or leaving pauses.
  useEffect(() => {
    if (!stalled) return;
    const t = setTimeout(() => {
      if (!wanted.current || player.playing || player.status !== 'readyToPlay') return;
      try {
        player.play();
      } catch {
        // released
      }
    }, NUDGE_MS);
    return () => clearTimeout(t);
  }, [stalled, player]);

  // The app going to the background: expo-video pauses every player (VideoManager.onAppBackgrounded),
  // with no event when it was loading more. Show what it did.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'background' || !wanted.current) return;
      wanted.current = false;
      try {
        player.pause();
      } catch {
        // released
      }
      setPhase((p) => (p === 'playing' ? 'paused' : p));
    });
    return () => sub.remove();
  }, [player]);

  // Audio or another video starting pauses this one (or, still loading, keeps it from starting).
  useEffect(() => {
    videoPausers.set(player, () => {
      if (!started.current) skipStart.current = true;
      if (!wanted.current) return;
      wanted.current = false;
      try {
        player.pause();
      } catch {
        // released
      }
      setPhase((p) => (p === 'playing' ? 'paused' : p));
    });
    return () => {
      videoPausers.delete(player);
    };
  }, [player]);

  // Following along (usePlayhead): where this clip is while it plays; let go when it stops or goes.
  useEffect(() => {
    if (url && phase === 'playing') setVideoHead({ owner: player, url, at: now });
    else if (videoHead?.owner === player) setVideoHead(null);
  }, [player, url, phase, now]);
  useEffect(
    () => () => {
      if (videoHead?.owner === player) setVideoHead(null);
    },
    [player],
  );

  // Nothing for VIDEO_TIMEOUT_MS (still loading, or not moving while it should play): an error, with a retry.
  const still = buffering || !moving;
  const stuck = !!url && (phase === 'loading' || (phase === 'playing' && still));
  useEffect(() => {
    if (!stuck) return;
    const t = setTimeout(() => {
      wanted.current = false;
      waiting.current = false;
      try {
        player.pause();
      } catch {
        // released
      }
      setBuffering(false);
      setPhase('error');
    }, VIDEO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [stuck, player]);

  const rangeStart = whole ? 0 : s0;
  const rangeEnd = whole ? fileDuration : e0 != null ? (fileDuration > 0 ? Math.min(e0, fileDuration) : e0) : fileDuration;
  const range = Math.max(0, rangeEnd - rangeStart);
  const progress = phase === 'ended' ? 1 : range > 0 ? Math.min(1, Math.max(0, (now - rangeStart) / range)) : 0;

  return {
    player,
    phase,
    buffering: still && phase === 'playing',
    now,
    elapsed: Math.max(0, Math.min(range, now - rangeStart)),
    duration: range,
    seek: (elapsed) => {
      if (!Number.isFinite(elapsed) || phase === 'error') return;
      if (phase === 'loading' && !started.current) {
        const to = rangeStart + Math.max(0, elapsed);
        pendingSeek.current = e0 != null && !whole ? Math.min(e0, to) : to;
        return;
      }
      if (range <= 0 || phase === 'loading') return;
      const to = Math.max(rangeStart, Math.min(rangeEnd, rangeStart + elapsed));
      jump(to);
      if (to >= rangeEnd) halt('ended');
      else if (phase === 'ended' || !started.current) setPhase('paused');
      // Moved before the first play: Play goes on from here, not from the step's start.
      started.current = true;
    },
    playFrom: (at) => {
      if (whole || !Number.isFinite(at) || phase === 'error') return;
      const to = Math.max(s0, e0 != null ? Math.min(at, e0) : at);
      pendingSeek.current = null;
      if (!started.current) {
        // Not playing yet: the first play starts there (now, or once the source is ready).
        firstAt.current = to;
        skipStart.current = false;
        if (phase !== 'loading') begin();
        return;
      }
      jump(to);
      resume();
    },
    progress,
    aspect,
    play: () => {
      if (!started.current || phase === 'ended') begin();
      else resume();
    },
    pause: () => {
      if (phase === 'playing') halt('paused');
    },
    toggle: () => {
      if (phase === 'playing') halt('paused');
      else if (!started.current || phase === 'ended') begin();
      else resume();
    },
    replay: begin,
  };
}

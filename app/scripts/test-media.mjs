// Range playback regressions with controllable native player stand-ins. No network or family writes.
//   node scripts/test-media.mjs
// 'react' is a tiny hook stand-in (state and refs per mounted clip, effects run when their deps
// change, unmount() runs the cleanups); timers are fake so 3 s seek and 30 s load timeouts run at once.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const stub = (src) => 'data:text/javascript,' + encodeURIComponent(src);
const stubs = {
  expo: stub(`export const useEventListener = (_p, event, fn) => { globalThis.__videoEvents[event] = fn; };`),
  'expo-audio': stub(`export function createAudioPlayer(_source, options) {
    const p = { isLoaded: true, duration: 600, currentTime: 0, playing: false, options, pauses: 0,
      addListener(_event, fn) { this.emit = (s) => fn({ isLoaded: true, duration: this.duration, ...s }); return { remove() {} }; },
      seekTo(t, ...tolerance) { this.currentTime = t; this.tolerance = tolerance; return Promise.resolve(); },
      play() { this.playing = true; }, pause() { this.playing = false; this.pauses++; }, remove() {} };
    globalThis.__audio = p; return p;
  }`),
  'expo-video': stub(`export function useVideoPlayer(_url, setup) { const p = globalThis.__video; setup(p); return p; }`),
  // An iPhone: AppState listeners are kept so a test can send the app to the background.
  'react-native': stub(`globalThis.__appState = new Set();
    export const Platform = { OS: 'ios' };
    export const AppState = { addEventListener(_type, fn) { globalThis.__appState.add(fn); return { remove() { globalThis.__appState.delete(fn); } }; } };`),
  react: stub(`
    export const useCallback = f => f;
    export const useSyncExternalStore = (_subscribe, get) => get();
    const slot = () => globalThis.__hookIndex++;
    export function useState(value) { const i = slot(); const s = globalThis.__hooks;
      if (!(i in s)) s[i] = value;
      return [s[i], next => { s[i] = typeof next === 'function' ? next(s[i]) : next; }]; }
    export function useRef(value) { const i = slot(); const s = globalThis.__hooks;
      return s[i] ??= { current: value }; }
    export function useEffect(fn, deps) { const i = slot(); const s = globalThis.__hooks; const prev = s[i];
      if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, k) => Object.is(d, prev.deps[k]))) return;
      if (prev && typeof prev.cleanup === 'function') prev.cleanup();
      s[i] = { effect: true, deps, cleanup: undefined };
      s[i].cleanup = fn(); }
  `),
};
registerHooks({ resolve(specifier, ctx, next) {
  return stubs[specifier] ? { url: stubs[specifier], shortCircuit: true } : next(specifier, ctx);
} });
const M = await import('../src/lib/media.ts');
const actualNow = Date.now;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let clock = actualNow();
Date.now = () => clock;
// Fake timers on the same clock: advance() runs whatever falls due.
const timers = new Map();
let timerId = 0;
globalThis.setTimeout = (fn, ms = 0) => { const id = ++timerId; timers.set(id, { fn, at: clock + ms }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
const advance = (ms) => {
  clock += ms;
  for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
    if (t.at > clock || !timers.has(id)) continue;
    timers.delete(id);
    t.fn();
  }
};
const tick = () => { clock += 1000; };
const flush = () => new Promise(resolve => setImmediate(resolve));
/** Runs a hand-off fade to its end (each step schedules the next, so the clock moves a step at a time). */
const fadeBy = () => { for (let t = 0; t <= M.HANDOFF_FADE_MS + 25; t += 25) advance(25); };

/** One mounted <ClipVideo/>'s hook, with its own state, listeners and stand-in player. */
function mountVideo(url, start, end, opts) {
  const hooks = [];
  const events = {};
  const player = { currentTime: 0, duration: 100, status: 'readyToPlay', playing: false, videoTrack: null,
    play() { this.playing = true; }, pause() { this.playing = false; } };
  const render = () => {
    globalThis.__hooks = hooks;
    globalThis.__hookIndex = 0;
    globalThis.__videoEvents = events;
    globalThis.__video = player;
    return M.useClipVideo(url, start, end, opts);
  };
  const unmount = () => { for (const h of hooks) if (h && h.effect && typeof h.cleanup === 'function') h.cleanup(); };
  const ready = () => {
    render();
    events.sourceLoad({ duration: player.duration, availableVideoTracks: [] });
    player.status = 'readyToPlay';
    events.statusChange({ status: 'readyToPlay' });
    if (player.playing) events.playingChange({ isPlaying: true }); // AVPlayer started moving
    return render();
  };
  /** iOS: AVPlayer stops moving (timeControlStatus waiting / paused) with `status` as given. */
  const still = (status = 'readyToPlay') => {
    player.status = status;
    if (status !== 'readyToPlay') events.statusChange({ status });
    player.playing = false;
    events.playingChange({ isPlaying: false });
    return render();
  };
  /** AVPlayer moving again (on its own, or after a nudge). */
  const moves = () => {
    if (player.status !== 'readyToPlay') { player.status = 'readyToPlay'; events.statusChange({ status: 'readyToPlay' }); }
    player.playing = true;
    events.playingChange({ isPlaying: true });
    return render();
  };
  return { render, events, player, unmount, ready, still, moves };
}

try {
  const heard = [];
  M.setHeardListener(event => heard.push(event));
  const clip = { url: 'test-audio', start_s: 40, end_s: 60, heard: { recipe_id: 'test', cook_id: null } };
  M.playClip(clip);
  await flush();
  tick();
  const audio = globalThis.__audio;
  audio.emit({ currentTime: 42 });
  M.seekAudio(15, M.clipKey(clip));
  await flush();
  assert.equal(audio.currentTime, 55, 'seek is relative to clip start');
  assert.deepEqual(audio.tolerance, [100, 100], 'audio seeks ask for a precise landing (iOS defaults to anywhere near)');
  audio.emit({ currentTime: 42 });
  assert.equal(M.useNowPlaying().position, 55, 'stale pre-seek updates do not move the scrubber backwards');
  tick();
  audio.emit({ currentTime: 56 });
  M.pauseAudio();
  M.seekAudio(5);
  await flush();
  assert.equal(M.useNowPlaying().phase, 'paused', 'seeking a paused clip must not autoplay');
  M.stopAudio();
  assert.equal(heard.length, 1);
  assert.equal(heard[0].duration_s, 3, 'skipped seconds must not count as listening');

  M.playClip(clip); await flush(); tick();
  M.seekAudio(-100);
  await flush();
  assert.equal(audio.currentTime, 40, 'cannot seek before the clip');
  M.seekAudio(100);
  await flush();
  assert.equal(audio.currentTime, 60, 'cannot seek beyond the clip');
  assert.equal(M.useNowPlaying().phase, 'ended');
  M.seekAudio(10);
  await flush();
  assert.equal(M.useNowPlaying().phase, 'paused', 'can scrub back after reaching the end');
  M.seekAudio(1, 'another-clip');
  await flush();
  assert.equal(audio.currentTime, 50, 'stale controls cannot seek another clip');
  M.seekAudio(NaN);
  await flush();
  assert.equal(audio.currentTime, 50);
  M.stopAudio();
  assert.equal(heard.length, 1, 'scrubbing alone must not record listening');

  M.playClip({ url: 'short-file', start_s: 10, end_s: 900 }); await flush(); tick();
  globalThis.__audio.emit({ duration: 80, currentTime: 10 });
  M.seekAudio(800);
  await flush();
  assert.equal(globalThis.__audio.currentTime, 80, 'clamp against actual file duration as well');
  M.stopAudio();

  // A native seek can resolve slowly. Queue scrubs / same-file clip changes behind it.
  let finishInitial;
  M.playClip({ url: 'slow-audio', start_s: 0, end_s: 100 });
  const slow = globalThis.__audio;
  const seeks = [];
  slow.seekTo = (target) => {
    seeks.push(target);
    if (seeks.length === 1) return new Promise(resolve => { finishInitial = () => { slow.currentTime = target; resolve(); }; });
    slow.currentTime = target;
    return Promise.resolve();
  };
  await flush();
  M.seekAudio(25);
  M.playClip({ url: 'slow-audio', start_s: 200, end_s: 240 });
  assert.equal(slow.playing, false, 'do not play while a stale seek is in flight');
  finishInitial();
  await flush();
  assert.deepEqual(seeks, [0, 200], 'skip superseded seek requests');
  assert.equal(slow.currentTime, 200, 'latest clip wins after delayed initial seek');
  assert.equal(slow.playing, true);
  M.seekAudio(12);
  M.pauseAudio();
  await flush();
  assert.equal(slow.currentTime, 212);
  assert.equal(slow.playing, false, 'pause during seek must remain paused');
  M.stopAudio();

  M.playClip({ url: 'abandoned-file', start_s: 0, end_s: 100 });
  const abandoned = globalThis.__audio;
  abandoned.seekTo = () => new Promise(() => {});
  await flush();
  M.playClip({ url: 'replacement-file', start_s: 8, end_s: 15 });
  await flush();
  assert.equal(globalThis.__audio.currentTime, 8, 'new player must not wait for an abandoned native seek');
  assert.equal(globalThis.__audio.playing, true);
  tick();
  abandoned.emit({ currentTime: 90 });
  assert.equal(M.useNowPlaying().position, 8, 'old player events cannot update the replacement');
  M.stopAudio();

  // Played to the end, then scrubbed back and played again: that second listen counts too.
  const tagged = { url: 'heard-audio', start_s: 40, end_s: 60, heard: { recipe_id: 'test', cook_id: null } };
  M.playClip(tagged); await flush(); tick();
  const h = globalThis.__audio;
  h.emit({ currentTime: 50 });
  h.emit({ currentTime: 60 });
  assert.deepEqual(heard.at(-1), { recipe_id: 'test', cook_id: null, duration_s: 20, start_s: 40 });
  M.seekAudio(5);
  assert.equal(M.useNowPlaying().phase, 'paused');
  M.playClip(tagged); // resume from the scrub
  await flush(); tick();
  assert.equal(h.playing, true);
  h.emit({ currentTime: 50 });
  h.emit({ currentTime: 60 });
  assert.deepEqual(heard.at(-1), { recipe_id: 'test', cook_id: null, duration_s: 15, start_s: 45 }, 'listening after scrubbing back from the end is logged');
  M.stopAudio();

  // Scrubbed to the end: that listen is over and reported, like a natural end.
  M.playClip(tagged); await flush(); tick();
  h.emit({ currentTime: 45 });
  const before = heard.length;
  M.seekAudio(100);
  assert.equal(heard.length, before + 1);
  assert.equal(heard.at(-1).duration_s, 5);
  M.stopAudio();
  assert.equal(heard.length, before + 1, 'once per listen');

  // A scrub to just before the end stops at the end, not ~1 s later in the next step's words.
  M.playClip({ ...tagged, url: 'end-audio', start_s: 100, end_s: 130 }); await flush(); tick();
  const e = globalThis.__audio;
  e.emit({ currentTime: 105 });
  M.seekAudio(29.6);
  await flush();
  assert.equal(e.playing, true);
  e.emit({ currentTime: 130.35 }); // inside the seek grace
  assert.equal(M.useNowPlaying().phase, 'ended', 'audio range end applies inside the seek grace');
  assert.equal(e.playing, false);
  assert.equal(M.useNowPlaying().position, 130);
  assert.deepEqual(heard.at(-1), { recipe_id: 'test', cook_id: null, duration_s: 5, start_s: 100 });
  M.stopAudio();

  // A native seek that never settles, then Stop: the next play of the same file still plays.
  M.playClip({ url: 'wedged-audio', start_s: 0, end_s: 50 });
  const w = globalThis.__audio;
  let calls = 0;
  w.seekTo = (t) => { calls++; if (calls === 1) return new Promise(() => {}); w.currentTime = t; return Promise.resolve(); };
  await flush();
  assert.equal(w.playing, false);
  M.stopAudio();
  M.playClip({ url: 'wedged-audio', start_s: 0, end_s: 50 });
  await flush();
  assert.equal(calls, 2);
  assert.equal(w.playing, true, 'a stuck seek must not block the next play after stop');
  M.stopAudio();

  // Nor does it hold the clip forever: after 3 s the seek is let go and playback goes on.
  M.playClip({ url: 'hung-audio', start_s: 10, end_s: 50 });
  const hung = globalThis.__audio;
  hung.seekTo = () => new Promise(() => {});
  await flush();
  assert.equal(hung.playing, false);
  advance(3000);
  await flush();
  assert.equal(hung.playing, true, 'a native seek that never settles times out');
  M.stopAudio();

  // ---- video
  const a = mountVideo('test-video', 20, 40);
  let video = a.ready();
  assert.equal(video.duration, 20);
  video.seek(8);
  assert.equal(a.player.currentTime, 28);
  video.seek(-5);
  assert.equal(a.player.currentTime, 20);
  video.seek(25);
  assert.equal(a.player.currentTime, 40);
  video = a.render();
  assert.equal(video.phase, 'ended');
  video.seek(3);
  assert.equal(a.render().phase, 'paused');
  tick();
  a.events.timeUpdate({ currentTime: 4 });
  assert.equal(a.player.currentTime, 20, 'stray time updates cannot leave the step range');
  const snap = a.player.currentTime;
  a.player.currentTime = 0;
  a.events.timeUpdate({ currentTime: 4 }); // a slow seek still reporting the old time
  assert.equal(a.player.currentTime, 0, 'the snap back re-arms the grace, so a slow seek is not asked again');
  a.player.currentTime = snap;
  tick();
  a.events.timeUpdate({ currentTime: 45 });
  assert.equal(a.player.currentTime, 40);
  assert.equal(a.render().phase, 'ended');
  a.unmount();

  // A scrub to just before the end, while playing, stops at the end inside the seek grace.
  const b = mountVideo('end-video', 20, 40);
  video = b.ready();
  assert.equal(video.phase, 'playing');
  assert.equal(b.player.playing, true);
  tick();
  b.events.timeUpdate({ currentTime: 25 });
  video = b.render();
  video.seek(19.6);
  b.events.timeUpdate({ currentTime: 40.35 });
  assert.equal(b.render().phase, 'ended', 'video range end applies inside the seek grace');
  assert.equal(b.player.playing, false);
  assert.equal(b.player.currentTime, 40);
  b.unmount();

  // iOS: stopping to load more video is "not playing" + 'loading'. Still playing, with a spinner.
  const c = mountVideo('slow-video', 20, 40);
  c.ready();
  c.player.status = 'loading'; c.events.statusChange({ status: 'loading' });
  c.player.playing = false; c.events.playingChange({ isPlaying: false });
  video = c.render();
  assert.equal(video.phase, 'playing', 'loading more video is not a pause');
  assert.equal(video.buffering, true);
  c.player.status = 'readyToPlay'; c.events.statusChange({ status: 'readyToPlay' });
  c.player.playing = true; c.events.playingChange({ isPlaying: true });
  video = c.render();
  assert.equal(video.phase, 'playing');
  assert.equal(video.buffering, false);
  // Paused by the kid while it loads more: still paused once it has loaded.
  c.player.status = 'loading'; c.events.statusChange({ status: 'loading' });
  c.player.playing = false; c.events.playingChange({ isPlaying: false });
  assert.equal(c.render().phase, 'playing');
  c.render().toggle();
  c.player.status = 'readyToPlay'; c.events.statusChange({ status: 'readyToPlay' });
  video = c.render();
  assert.equal(video.phase, 'paused', 'a pause while loading more stays a pause');
  assert.equal(video.buffering, false);
  assert.equal(c.player.playing, false);
  c.unmount();

  // Caleb's iPhone, Oct 22: "videos keep auto-pausing". Loaded more, but AVPlayer still waiting
  // ('readyToPlay' and not moving): never a pause (PR #39 made it one after 1 s). A spinner, and
  // a second later it is asked to play again.
  const st = mountVideo('stall-paused-video', 20, 40);
  st.ready();
  st.still('loading');
  st.player.status = 'readyToPlay'; st.events.statusChange({ status: 'readyToPlay' });
  video = st.render();
  assert.equal(video.phase, 'playing');
  assert.equal(video.buffering, true, 'loaded but not moving yet: still the spinner');
  advance(999);
  assert.equal(st.player.playing, false);
  advance(1);
  video = st.render();
  assert.equal(video.phase, 'playing', 'a stall that has loaded is never turned into a pause');
  assert.equal(st.player.playing, true, 'it is asked to play again');
  video = st.moves();
  assert.equal(video.buffering, false);
  // Going on by itself inside that moment: no extra play needed, still playing.
  st.still('loading');
  st.moves();
  advance(1_000);
  assert.equal(st.render().phase, 'playing', 'AVPlayer resuming on its own is not a pause');
  // "Not playing" while loaded (weighing its buffer after a seek, or stopped by the system): not a
  // pause either; a moment later it plays again.
  video = st.still('readyToPlay');
  assert.equal(video.phase, 'playing', 'iOS saying "not playing" is not a tap on Pause');
  assert.equal(video.buffering, true);
  advance(1_000);
  assert.equal(st.player.playing, true, 'stopped by the system: it resumes on its own');
  assert.equal(st.moves().phase, 'playing');
  // A late "playing" from before a tap on Pause: the tap wins.
  st.render().toggle();
  assert.equal(st.render().phase, 'paused');
  st.player.playing = true; st.events.playingChange({ isPlaying: true });
  assert.equal(st.player.playing, false, 'a late play event after Pause is paused again');
  assert.equal(st.render().phase, 'paused');
  st.events.playingChange({ isPlaying: false });
  advance(2_000);
  assert.equal(st.player.playing, false, 'a paused clip is never nudged');
  st.render().play();
  st.moves();
  // To the background while loading more: expo-video pauses it, and so does the screen.
  st.player.status = 'loading'; st.events.statusChange({ status: 'loading' });
  st.player.playing = false; st.events.playingChange({ isPlaying: false });
  for (const fn of globalThis.__appState) fn('background');
  video = st.render();
  assert.equal(video.phase, 'paused', 'going to the background is a pause');
  assert.equal(video.buffering, false);
  advance(30_000);
  assert.equal(st.render().phase, 'paused', 'a paused clip never times out into an error');
  st.unmount();
  assert.equal(globalThis.__appState.size, 0, 'the background listener goes with the clip');

  // Scrubbed before the first play (a voice started while it loaded): Play goes on from there.
  const pre = mountVideo('pre-seek-video', 20, 80);
  pre.player.status = 'loading';
  pre.render();
  M.playClip({ url: 'voice-before', start_s: 0, end_s: 10 });
  await flush();
  pre.player.status = 'readyToPlay'; pre.events.statusChange({ status: 'readyToPlay' });
  video = pre.render();
  assert.equal(video.phase, 'idle');
  video.seek(10); video = pre.render(); video.seek(video.elapsed + 10);
  assert.equal(pre.player.currentTime, 40, 'two forward 10s land 0:20 into the step');
  video = pre.render();
  assert.equal(video.phase, 'paused');
  video.toggle();
  assert.equal(pre.player.currentTime, 40, 'Play keeps the scrubbed spot, not the step start');
  assert.equal(pre.render().elapsed, 20);
  assert.equal(pre.player.playing, true);
  M.stopAudio();
  pre.unmount();

  // Nothing for 30 s: an error the screen can offer to retry (first load, and stuck mid-play).
  const d = mountVideo('never-video', 20, 40);
  d.player.status = 'loading';
  d.render();
  advance(29_000);
  assert.equal(d.render().phase, 'loading');
  advance(1_000);
  assert.equal(d.render().phase, 'error', 'a video that never loads gives up after 30 s');
  d.unmount();
  const s = mountVideo('stall-video', 20, 40);
  s.ready();
  s.player.status = 'loading'; s.events.statusChange({ status: 'loading' });
  s.player.playing = false; s.events.playingChange({ isPlaying: false });
  s.render();
  advance(30_000);
  assert.equal(s.render().phase, 'error', 'a video stuck loading more gives up after 30 s');
  s.unmount();

  // One voice at a time: audio starting pauses a playing video, and so does another video.
  const f = mountVideo('first-video', 20, 40);
  f.ready();
  assert.equal(f.player.playing, true);
  M.playClip({ url: 'voice-over', start_s: 0, end_s: 10 });
  assert.equal(f.player.playing, false, 'a cook’s voice starting pauses the step clip');
  assert.equal(f.render().phase, 'paused');
  M.stopAudio();
  f.render().play();
  assert.equal(f.player.playing, true);
  const g = mountVideo('second-video', 0, 10);
  g.ready();
  assert.equal(g.player.playing, true);
  assert.equal(f.player.playing, false, 'a second video starting pauses the first');
  // Still loading when a voice starts: it waits for a tap instead of talking over it.
  const l = mountVideo('late-video', 0, 10);
  l.player.status = 'loading';
  l.render();
  M.playClip({ url: 'voice-first', start_s: 0, end_s: 10 });
  await flush();
  l.player.status = 'readyToPlay';
  l.events.statusChange({ status: 'readyToPlay' });
  assert.equal(l.render().phase, 'idle');
  assert.equal(l.player.playing, false);
  assert.equal(globalThis.__audio.playing, true, 'the voice keeps playing');
  M.stopAudio();
  f.unmount(); g.unmount(); l.unmount();

  // Full screen (cook mode): the full-screen player starts where the inline clip was, pauses it,
  // and a replay goes back to the step's start, never before it.
  const inline = mountVideo('step-video', 20, 80);
  inline.ready();
  tick();
  inline.events.timeUpdate({ currentTime: 33 });
  assert.equal(inline.render().now, 33);
  const full = mountVideo('step-video-full', 20, 80, { at: 33 });
  video = full.ready();
  assert.equal(full.player.currentTime, 33, 'the full-screen player picks up at the inline time');
  assert.equal(full.player.playing, true);
  assert.equal(inline.player.playing, false, 'one voice: the inline clip pauses under full screen');
  assert.equal(inline.render().phase, 'paused');
  video.replay();
  assert.equal(full.player.currentTime, 20, 'Watch again starts the step over');
  // Closed (or retried) before it is ready: it hands back where it was to start, not the step's start.
  const early = mountVideo('step-video-early', 20, 80, { at: 41 });
  early.player.status = 'loading';
  assert.equal(early.render().phase, 'loading');
  assert.equal(early.render().now, 41, 'not ready yet: `now` is where it will start');
  early.unmount();
  const outside = mountVideo('step-video-out', 20, 80, { at: 95 });
  outside.ready();
  assert.equal(outside.player.currentTime, 20, 'an `at` outside the step range starts at the step');
  outside.unmount(); full.unmount(); inline.unmount();

  // Leaving the screen (cook mode losing focus to the chat): stopAllMedia silences the voice and video.
  M.playClip({ url: 'blur-audio', start_s: 0, end_s: 10 });
  await flush();
  tick();
  assert.equal(globalThis.__audio.playing, true);
  M.stopAllMedia();
  assert.equal(globalThis.__audio.playing, false, 'leaving the screen stops the voice');
  const blur = mountVideo('blur-video', 0, 50);
  blur.ready();
  assert.equal(blur.player.playing, true);
  M.stopAllMedia();
  assert.equal(blur.player.playing, false, 'and pauses the video');
  blur.unmount();

  // Back from full screen into an inline clip still loading: the seek waits, then lands paused.
  const back = mountVideo('back-video', 20, 80);
  back.player.status = 'loading';
  video = back.render();
  assert.equal(video.phase, 'loading');
  video.seek(25);
  back.player.status = 'readyToPlay'; back.events.statusChange({ status: 'readyToPlay' });
  video = back.render();
  assert.equal(back.player.currentTime, 45, 'a seek asked for while loading lands once ready');
  assert.equal(video.phase, 'paused', 'and stays paused (no autoplay over it)');
  assert.equal(back.player.playing, false);
  video.toggle();
  assert.equal(back.player.currentTime, 45, 'Play goes on from there');
  assert.equal(back.player.playing, true);
  back.unmount();
  const atEnd = mountVideo('end-back-video', 20, 80);
  atEnd.player.status = 'loading';
  atEnd.render().seek(500);
  atEnd.player.status = 'readyToPlay'; atEnd.events.statusChange({ status: 'readyToPlay' });
  assert.equal(atEnd.player.currentTime, 80, 'a waiting seek past the end stops at the end');
  assert.equal(atEnd.render().phase, 'ended');
  atEnd.unmount();

  // ---- Oct 22 iPhone: "videos keep auto-pausing". The root cause: expo-audio's pause() ends the
  // app's audio session 100 ms later unless the player keeps it, and every video play stopped the
  // voice first, so iOS stopped the video that had just started.
  M.playClip({ url: 'session-audio', start_s: 0, end_s: 10 });
  await flush();
  const voice = globalThis.__audio;
  assert.equal(voice.options.keepAudioSessionActive, true, 'pausing the voice never ends the session a video plays in');
  M.stopAudio();
  const pausesBefore = voice.pauses;
  const kv = mountVideo('session-video', 20, 140);
  kv.ready();
  assert.equal(voice.pauses, pausesBefore, 'a video starting leaves an idle voice player alone');
  M.stopAudio(); M.stopAllMedia(); kv.render().play();
  // stopAllMedia paused it (leaving the screen); play again for the long run below.
  kv.moves();
  assert.equal(voice.pauses, pausesBefore, 'stopping nothing calls no native pause');
  // A minute of playback with everything iOS does on a slow connection: loading more, "not playing"
  // while it weighs its buffer, a ±10 seek, a time update a hair before the start. Only the range end
  // stops it.
  let t = 20;
  for (let i = 0; i < 260; i++) {
    t += 0.25;
    if (i === 40) { kv.still('loading'); advance(3_000); kv.moves(); }
    if (i === 80) { kv.still('readyToPlay'); advance(400); kv.moves(); }
    if (i === 120) { kv.render().seek(t - 20 + 10); t += 10; tick(); }
    if (i === 160) { kv.still('loading'); kv.player.status = 'readyToPlay'; kv.events.statusChange({ status: 'readyToPlay' }); advance(2_500); kv.moves(); }
    clock += 250;
    kv.events.timeUpdate({ currentTime: t });
    assert.equal(kv.render().phase, 'playing', `still playing at ${t.toFixed(2)} s`);
  }
  assert.ok(t - 20 >= 60, 'played 60+ s without a pause');
  kv.events.timeUpdate({ currentTime: 140 });
  assert.equal(kv.render().phase, 'ended', 'the range end still stops it');
  kv.unmount();
  const hair = mountVideo('hair-video', 63, 120);
  hair.ready();
  tick();
  hair.events.timeUpdate({ currentTime: 62.9999 });
  assert.equal(hair.player.currentTime, 63, 'a hair before the start is rounding: no re-seek');
  assert.equal(hair.render().phase, 'playing');
  hair.unmount();

  // The full video (native controls): their Pause is a pause.
  const whole = mountVideo('whole-video', 0, null, { whole: true });
  whole.ready();
  video = whole.still('readyToPlay');
  assert.equal(video.phase, 'paused', 'native controls pausing the full video is a pause');
  whole.moves();
  assert.equal(whole.render().phase, 'playing', 'and their Play plays');
  whole.still('loading');
  assert.equal(whole.render().phase, 'playing', 'loading more is still not a pause there');
  whole.unmount();

  // ---- Following along: chapter gaps on the bar, and where the voice / video is now.
  assert.deepEqual(M.chapterMarks([63, 101, 139, 177], 63, 253), [38 / 190, 76 / 190, 114 / 190]);
  assert.deepEqual(M.chapterMarks([63], 63, 253), [], 'one substep: no gaps');
  assert.deepEqual(M.chapterMarks([null, undefined], 63, 253), [], 'no starts: no gaps');
  assert.deepEqual(M.chapterMarks([63, 300], 63, 253), [], 'a start outside the range is no gap');
  assert.deepEqual(M.chapterMarks([63, 100], 63, 63), [], 'an empty range: no gaps');
  assert.equal(M.playheadAt('follow-video'), null, 'nothing playing: no playhead');
  M.playClip({ url: 'follow-audio', start_s: 63, end_s: 253 });
  await flush(); tick();
  globalThis.__audio.emit({ currentTime: 104 });
  assert.equal(M.playheadAt('follow-video'), null, 'a voice playing (a story) is not the step video');
  M.stopAudio();
  const fv = mountVideo('follow-video', 63, 253);
  fv.ready();
  tick();
  fv.events.timeUpdate({ currentTime: 150 });
  fv.render();
  assert.equal(M.playheadAt('follow-video'), 150, 'the step video playing: where it is');
  assert.equal(M.usePlayhead(() => M.playheadAt('follow-video')), 150);
  assert.equal(M.playheadAt('another-video'), null);
  assert.equal(M.playheadAt(null), null);
  fv.render().pause();
  fv.render();
  assert.equal(M.playheadAt('follow-video'), null, 'paused video: no playhead');
  fv.render().play();
  fv.render();
  assert.equal(M.playheadAt('follow-video'), 150);
  fv.unmount();
  assert.equal(M.playheadAt('follow-video'), null, 'gone: no playhead');

  // ---- Tapping a substep: playFrom(at) jumps there and plays, kept inside the step.
  const sub = mountVideo('substep-video', 63, 253);
  sub.ready();
  tick();
  sub.events.timeUpdate({ currentTime: 70 });
  sub.render().pause();
  assert.equal(sub.render().phase, 'paused');
  sub.render().playFrom(177);
  video = sub.render();
  assert.equal(sub.player.currentTime, 177, 'jumps to the substep start');
  assert.equal(video.phase, 'playing', 'and plays (from paused)');
  assert.equal(sub.player.playing, true);
  sub.events.timeUpdate({ currentTime: 150 });
  assert.equal(sub.render().now, 177, 'a stale update from before the jump is ignored');
  tick();
  sub.events.timeUpdate({ currentTime: 178 });
  sub.render().playFrom(101);
  assert.equal(sub.player.currentTime, 101, 'while playing: jumps back to an earlier substep');
  assert.equal(sub.render().phase, 'playing', 'and keeps playing');
  sub.render().playFrom(20);
  assert.equal(sub.player.currentTime, 63, 'never before the step');
  tick();
  sub.events.timeUpdate({ currentTime: 253 });
  assert.equal(sub.render().phase, 'ended');
  sub.render().playFrom(139);
  assert.equal(sub.player.currentTime, 139, 'after the end too');
  assert.equal(sub.render().phase, 'playing');
  sub.render().playFrom(NaN);
  assert.equal(sub.player.currentTime, 139, 'NaN is ignored');
  sub.unmount();
  // The photo still up: the clip mounts with `at` (ClipVideo's startAt) and starts there.
  const fresh = mountVideo('substep-fresh', 63, 253, { at: 139 });
  fresh.ready();
  assert.equal(fresh.player.currentTime, 139, 'the first play starts at the tapped substep');
  assert.equal(fresh.player.playing, true);
  fresh.render().replay();
  assert.equal(fresh.player.currentTime, 63, 'Watch again starts the step over');
  fresh.unmount();
  // Still loading when tapped: it starts there once ready.
  const slowSub = mountVideo('substep-slow', 63, 253);
  slowSub.player.status = 'loading';
  slowSub.render().playFrom(177);
  assert.equal(slowSub.player.playing, false, 'nothing plays before the source is ready');
  slowSub.player.status = 'readyToPlay'; slowSub.events.statusChange({ status: 'readyToPlay' });
  assert.equal(slowSub.player.currentTime, 177, 'once ready it starts at the substep');
  assert.equal(slowSub.player.playing, true);
  slowSub.unmount();
  // Paused under another voice before it started (no autoplay): a tap still plays it from there.
  const quiet = mountVideo('substep-quiet', 63, 253);
  quiet.player.status = 'loading';
  quiet.render();
  M.playClip({ url: 'other-voice', start_s: 0, end_s: 10 });
  await flush();
  quiet.player.status = 'readyToPlay'; quiet.events.statusChange({ status: 'readyToPlay' });
  assert.equal(quiet.render().phase, 'idle');
  quiet.render().playFrom(101);
  assert.equal(quiet.player.currentTime, 101);
  assert.equal(quiet.player.playing, true, 'the tap plays it');
  assert.equal(M.useNowPlaying().phase, 'idle', 'and stops the other voice');
  fadeBy();
  assert.equal(globalThis.__audio.playing, false, 'its sound gone once it has faded out');
  quiet.unmount();
  // Back from full screen, still loading: a waited seek lands paused, and Watch again is the step's start.
  const backAt = mountVideo('substep-back', 63, 253, { at: 139 });
  backAt.player.status = 'loading';
  backAt.render().seek(50);
  backAt.player.status = 'readyToPlay'; backAt.events.statusChange({ status: 'readyToPlay' });
  assert.equal(backAt.player.currentTime, 113, 'the full screen time wins over the old substep tap');
  assert.equal(backAt.render().phase, 'paused');
  tick();
  backAt.events.timeUpdate({ currentTime: 253 });
  backAt.render().replay();
  assert.equal(backAt.player.currentTime, 63, 'Watch again: the step start, not the old tap');
  backAt.unmount();

  // ---- Oct 25: homie and a video hand the sound to each other, smoothly (HANDOFF_FADE_MS).
  // The kid plays a video while homie talks: homie's line is over at once, its sound turns down, then stops.
  M.playClip({ url: 'say-fade', key: 'say:fade' });
  await flush();
  const said = globalThis.__audio;
  said.volume = 1;
  assert.equal(said.playing, true);
  const kidPlays = mountVideo('fade-video', 0, 60, { autoPlay: false });
  kidPlays.ready();
  kidPlays.render().play();
  assert.equal(kidPlays.player.playing, true, 'the video plays at once');
  assert.equal(M.useNowPlaying().phase, 'idle', 'homie’s line is over at once (the pot goes quiet with it)');
  assert.equal(M.videoPlaying(), true, 'and the video is in the room before that (no listening in between)');
  advance(50);
  assert.ok(said.playing && said.volume > 0 && said.volume < 1, `its sound turns down (${said.volume})`);
  fadeBy();
  assert.equal(said.playing, false, 'then stops');
  assert.equal(said.volume, 1, 'at full volume for the next line');
  // The next line during a fade: the fade ends, and it plays at full volume.
  M.playClip({ url: 'say-fade', key: 'say:fade' });
  await flush();
  kidPlays.render().play();
  advance(50);
  M.playClip({ url: 'say-fade', key: 'say:fade-2' });
  await flush();
  assert.equal(said.playing, true);
  fadeBy();
  assert.equal(said.playing, true, 'the old fade never stops the new line');
  assert.equal(said.volume, 1);
  M.stopAudio();
  kidPlays.unmount();
  // A tap on homie: a playing video turns down, still counts as playing (homie listens only after), then
  // pauses, at full volume for its next play.
  const watched = mountVideo('tap-video', 0, 60);
  watched.ready();
  watched.player.volume = 1;
  assert.equal(watched.player.playing, true);
  M.pauseAllVideos({ fadeMs: M.HANDOFF_FADE_MS });
  advance(50);
  assert.ok(watched.player.playing && watched.player.volume < 1, `turning down (${watched.player.volume})`);
  assert.equal(watched.render().phase, 'playing');
  assert.equal(M.videoPlaying(), true);
  fadeBy();
  assert.equal(watched.player.playing, false, 'paused');
  assert.equal(watched.render().phase, 'paused');
  assert.equal(M.videoPlaying(), false);
  assert.equal(watched.player.volume, 1, 'full volume for its next play');
  // A play during the fade (the kid changed their mind) wins, at full volume.
  watched.render().play();
  M.pauseAllVideos({ fadeMs: M.HANDOFF_FADE_MS });
  advance(50);
  watched.render().play();
  fadeBy();
  assert.equal(watched.player.playing, true, 'a play during the fade wins');
  assert.equal(watched.player.volume, 1);
  // A voice starting during the fade pauses it at once.
  M.pauseAllVideos({ fadeMs: M.HANDOFF_FADE_MS });
  advance(50);
  M.playClip({ url: 'voice-now', start_s: 0, end_s: 10 });
  assert.equal(watched.player.playing, false, 'paused at once');
  assert.equal(watched.player.volume, 1);
  M.stopAudio();
  watched.unmount();

  console.log('Media regressions passed: audio/video seeking, bounds, pause/end states, stale updates, range ends inside the seek grace, stuck seeks, loading more video, paused while loading more, iOS "not playing" never a pause (nudged instead), the audio session kept for video, 60 s of play through stalls, native-control pauses, background, scrubbing before the first play, load timeouts, one voice at a time, full screen hand-off, listening accounting, chapter gaps, playhead, play from a substep, the homie-video hand-off fades.');
} finally {
  M.stopAudio();
  M.setHeardListener(null);
  Date.now = actualNow;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

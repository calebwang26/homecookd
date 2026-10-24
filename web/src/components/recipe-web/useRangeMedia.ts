'use client';
// Plays one [start, end] range of a media file in an <audio>/<video> element and stops at `end`.
// Only one element plays at a time across the page (starting one pauses the other).
//
//   const m = useRangeMedia<HTMLVideoElement>();
//   <video ref={m.ref} playsInline preload="none" />
//   m.play(url, 42, 118, 'step-2');   m.toggle();   m.stop();
//   m.state -> { status, t, start, end, key }
import { useCallback, useEffect, useRef, useState } from 'react';

export type RangeStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type RangeState = { status: RangeStatus; t: number; start: number; end: number; key: string | null };

let current: HTMLMediaElement | null = null;
function claim(el: HTMLMediaElement) {
  if (current && current !== el && !current.paused) current.pause();
  current = el;
}

const IDLE: RangeState = { status: 'idle', t: 0, start: 0, end: 0, key: null };

export function useRangeMedia<T extends HTMLMediaElement>() {
  const ref = useRef<T>(null);
  const range = useRef({ start: 0, end: 0, key: null as string | null });
  const [state, setState] = useState<RangeState>(IDLE);
  const raf = useRef(0);
  const lastT = useRef(-1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Per-frame check: stop exactly at the range end, and report progress every 0.1 s.
    const tick = () => {
      const { end } = range.current;
      if (el.currentTime >= end - 0.05) {
        el.pause();
        setState((s) => ({ ...s, status: 'ended', t: end }));
        return;
      }
      if (Math.abs(el.currentTime - lastT.current) >= 0.1) {
        lastT.current = el.currentTime;
        setState((s) => ({ ...s, t: el.currentTime }));
      }
      raf.current = requestAnimationFrame(tick);
    };
    const onPlaying = () => {
      claim(el);
      setState((s) => (s.key ? { ...s, status: 'playing' } : s));
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      cancelAnimationFrame(raf.current);
      // Paused because another range started elsewhere: this one is done.
      if (current && current !== el) {
        setState(IDLE);
        return;
      }
      setState((s) => (s.status === 'ended' || !s.key ? s : { ...s, status: 'paused', t: el.currentTime }));
    };
    const onWaiting = () => setState((s) => (s.key && s.status !== 'paused' ? { ...s, status: 'loading' } : s));
    const onError = () => setState((s) => (s.key ? { ...s, status: 'error' } : s));
    const onEnded = () => setState((s) => (s.key ? { ...s, status: 'ended', t: range.current.end } : s));
    el.addEventListener('playing', onPlaying);
    el.addEventListener('pause', onPause);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('error', onError);
    el.addEventListener('ended', onEnded);
    return () => {
      cancelAnimationFrame(raf.current);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('error', onError);
      el.removeEventListener('ended', onEnded);
      if (!el.paused) el.pause();
    };
  }, []);

  const play = useCallback((url: string, start: number, end: number, key: string) => {
    const el = ref.current;
    if (!el) return;
    range.current = { start, end, key };
    lastT.current = -1;
    claim(el);
    setState({ status: 'loading', t: start, start, end, key });
    // A new file, or a retry after a failed load.
    if (el.dataset.base !== url || el.error) {
      el.dataset.base = url;
      // A start-only media fragment gets mobile Safari to the right spot on first load; the end is
      // enforced by tick() (an end fragment would keep pausing there after later seeks).
      el.src = `${url}#t=${start}`;
      el.load();
    }
    const seek = () => {
      if (Math.abs(el.currentTime - start) > 0.4) el.currentTime = start;
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
    el.play()?.catch((err: unknown) => {
      const name = (err as { name?: string })?.name;
      if (name === 'AbortError') return;
      // Autoplay blocked (a sheet that starts on open, outside the tap): show the play button.
      setState((s) => ({ ...s, status: name === 'NotAllowedError' ? 'paused' : 'error' }));
    });
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el || !range.current.key) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    const { start, end } = range.current;
    if (el.currentTime >= end - 0.1 || el.currentTime < start - 0.5) el.currentTime = start;
    claim(el);
    el.play()?.catch(() => setState((s) => ({ ...s, status: 'error' })));
  }, []);

  const stop = useCallback(() => {
    const el = ref.current;
    range.current = { start: 0, end: 0, key: null };
    if (el && !el.paused) el.pause();
    setState(IDLE);
  }, []);

  return { ref, state, play, toggle, stop };
}

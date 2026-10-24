'use client';
// The ▶ for a recording shown as a poster (reduced motion, Save-Data, the static rows). It sits
// OUTSIDE the phone, so nothing is ever drawn on a recording. AppClip still renders its own ▶ over
// the screen: PLAY_HOST (on any element around the clip) hides that one, and this button presses
// it, so AppClip's rules still hold (never plays offscreen, pauses with the page's pause, resumes
// when back in view). The parent positions it (className).
import { useEffect, useState, type RefObject } from 'react';
import { PauseIcon, PlayIcon } from '@/components/icons/Icons';
import styles from './OuterPlay.module.css';

export const PLAY_HOST = styles.host;

/** the recording on screen inside `scope`: a ClipStack's current slide, or the only clip */
function videoIn(scope: HTMLElement | null): HTMLVideoElement | null {
  return (
    scope?.querySelector<HTMLVideoElement>('[data-state="on"] video') ??
    scope?.querySelector<HTMLVideoElement>('video') ??
    null
  );
}

export interface OuterPlayProps {
  /** an element around the phone; the clip is found inside it */
  scope: RefObject<HTMLElement | null>;
  /** find the clip again when this changes (the tour's current slide) */
  watch?: unknown;
  /** cream on the green sections, green on the canvas */
  tone?: 'cream' | 'green';
  className?: string;
}

export function OuterPlay({ scope, watch, tone = 'cream', className }: OuterPlayProps) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const v = videoIn(scope.current);
    if (!v) return;
    const sync = () => setPlaying(!v.paused);
    const evs = ['play', 'pause', 'ended'] as const;
    evs.forEach((e) => v.addEventListener(e, sync));
    const raf = requestAnimationFrame(sync); // a new slide: read where it stands once
    return () => {
      cancelAnimationFrame(raf);
      evs.forEach((e) => v.removeEventListener(e, sync));
    };
  }, [scope, watch]);

  const toggle = () => {
    const v = videoIn(scope.current);
    if (!v) return;
    const inner = v.parentElement?.querySelector<HTMLButtonElement>(':scope > button');
    if (inner) inner.click();
    else if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <button
      type="button"
      className={[styles.btn, styles[tone], className].filter(Boolean).join(' ')}
      aria-label={playing ? 'Pause recording' : 'Play recording'}
      onClick={toggle}
    >
      {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
    </button>
  );
}

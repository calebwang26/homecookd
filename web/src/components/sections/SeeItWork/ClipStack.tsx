'use client';
// The real recordings, stacked inside the phone's screen. The incoming clip fades in ON TOP of the
// outgoing one (which holds its last frame underneath), so the screen never shows through mid-fade.
// Nothing downloads until the section is near (posters included); then only the active and the
// next clip preload. Every clip pauses offscreen (AppClip's own observer).
import { useEffect, useRef, useState } from 'react';
import { APP_CLIPS } from '@/content/media';
import { AppClip } from '@/components/primitives/AppClip';
import { startFrom } from './lazy';
import { SHARE_SLIDE, SHARE_TAP_AT, SLIDES, START_AT, posterOf } from './tour';
import styles from './SeeItWork.module.css';

export interface ClipStackProps {
  slide: number;
  /** should slide s loop? */
  loop: (s: number) => boolean;
  /** a non-looping slide reached its end */
  onEnded: (s: number) => void;
  /** the share recording passed its Share tap */
  onShareTap?: () => void;
  /** swap without the 450ms crossfade (reduced motion) */
  instant?: boolean;
  /** the section is within ~1.5 viewports: posters and preloading may start */
  near: boolean;
  /** reduced motion or Save-Data: preload nothing; the visitor taps ▶ */
  lean?: boolean;
}

const videoIn = (el: HTMLElement | null | undefined) => el?.querySelector('video') ?? null;

export function ClipStack({ slide, loop, onEnded, onShareTap, instant = false, near, lean = false }: ClipStackProps) {
  // "previous props" pattern: remember the outgoing slide for the length of the crossfade
  const [cur, setCur] = useState(slide);
  const [prev, setPrev] = useState<number | null>(null);
  if (slide !== cur) {
    setPrev(instant ? null : cur);
    setCur(slide);
  }
  useEffect(() => {
    if (prev === null) return;
    const t = setTimeout(() => setPrev(null), 520);
    return () => clearTimeout(t);
  }, [prev, cur]);

  const slideEls = useRef<(HTMLDivElement | null)[]>([]);

  // the share tap (time-based on the real recording)
  const tapRef = useRef(onShareTap);
  useEffect(() => {
    tapRef.current = onShareTap;
  }, [onShareTap]);
  useEffect(() => {
    if (slide !== SHARE_SLIDE) return;
    const v = videoIn(slideEls.current[SHARE_SLIDE]);
    if (!v) return;
    const check = () => {
      if (v.currentTime >= SHARE_TAP_AT) tapRef.current?.();
    };
    v.addEventListener('timeupdate', check);
    return () => v.removeEventListener('timeupdate', check);
  }, [slide]);

  // recordings whose payoff comes late start further in (START_AT)
  useEffect(() => {
    const offs = SLIDES.flatMap((name, s) => {
      const at = START_AT[name];
      const v = at ? videoIn(slideEls.current[s]) : null;
      return v && at ? [startFrom(v, at)] : [];
    });
    return () => offs.forEach((off) => off());
  }, []);

  return (
    <>
      {SLIDES.map((name, s) => (
        <div
          key={name}
          ref={(el) => {
            slideEls.current[s] = el;
          }}
          className={[styles.slide, instant ? styles.slideInstant : ''].filter(Boolean).join(' ')}
          data-state={s === slide ? 'on' : s === prev ? 'prev' : 'off'}
          inert={s !== slide}
        >
          <AppClip
            name={name}
            active={s === slide}
            loop={loop(s)}
            onEnded={() => onEnded(s)}
            label={APP_CLIPS[name].label}
            preload={near && !lean && (s === slide || s === slide + 1) ? 'auto' : 'none'}
            // an empty poster fetches nothing; it fills in once the section is near. Tap-to-play
            // (lean) shows the payoff still; autoplay shows the recording's first moment.
            poster={near ? posterOf(name, lean) : ''}
            tapToPlay={lean}
          />
        </div>
      ))}
    </>
  );
}

'use client';
// The web-answer recording (Mom answering his questions by voice) in its phone, with its poster held back until the phone is ~1.5
// viewports away (it would otherwise download at page load). Phones under 768px hide the phone
// (brief 8.11), and a hidden element never comes near, so nothing downloads there. Without JS the
// <noscript> shows it. Reduced motion: the poster, with a ▶ seated on the phone's lower-left
// corner (outside the screen; the caption sits at the lower right).
import { useRef } from 'react';
import { APP_CLIPS } from '@/content/media';
import { optSrc } from '@/lib/imageLoader';
import { AppClip } from '@/components/primitives/AppClip';
import { Handset } from '@/components/primitives/Handset';
import { useReducedMotionPref } from '@/components/providers/MotionProvider';
import { useNear } from '@/components/sections/SeeItWork/lazy';
import { OuterPlay, PLAY_HOST } from '@/components/sections/SeeItWork/OuterPlay';
import styles from './Questions.module.css';

const clip = APP_CLIPS['web-answer'];
const poster = optSrc(clip.poster, 640) ?? clip.poster;

export function PhoneClip() {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref);
  const reduced = useReducedMotionPref();
  return (
    <div ref={ref} className={`${styles.phone} ${PLAY_HOST}`}>
      <Handset width="var(--q-phone-w)">
        <AppClip name="web-answer" playWhenVisible label={clip.label} preload="none" poster={near ? poster : ''} />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element -- no-JS fallback only */}
          <img className={styles.noJsPoster} src={poster} alt="" />
        </noscript>
      </Handset>
      {reduced ? <OuterPlay scope={ref} tone="green" className={styles.posterPlay} /> : null}
    </div>
  );
}

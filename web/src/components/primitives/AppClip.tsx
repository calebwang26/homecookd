'use client';
// A real homecookd screen recording (brief 5 "AppClip"). Put it inside <PhoneFrame>.
//
//   <AppClip name="web-version" playWhenVisible label={APP_CLIPS['web-version'].label} />      // uncontrolled
//   <AppClip name={row.clip} active={i === active} preload={i === active || i === active + 1 ? 'auto' : 'none'}
//            loop={false} onEnded={next} label={APP_CLIPS[row.clip].label} />                   // controlled
//
// Controlled: when `active` turns true → currentTime = 0 and play(); false → pause().
// Uncontrolled (playWhenVisible): plays while ≥ 50% visible. Never plays offscreen; pauses with
// PauseProvider. Reduced motion / no autoplay: the poster plus a ▶ button that plays on tap.
// Memory and data (brief 11): the video file (HEVC where it plays, src/lib/video.ts) is attached only
// within ~2 viewports and released again beyond that, so a long scroll never keeps every decoder
// alive. On a slow connection (src/lib/perf.ts) clips are tap-to-play and download only on tap.
// The default poster is the optimized WebP.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppClipName } from '@/content/types';
import { APP_CLIPS } from '@/content/media';
import { PauseIcon, PlayIcon } from '@/components/icons/Icons';
import { usePause } from '@/components/providers/PauseProvider';
import { useReducedMotionPref } from '@/components/providers/MotionProvider';
import { optSrc } from '@/lib/imageLoader';
import { slowNet } from '@/lib/perf';
import { videoSrc } from '@/lib/video';
import styles from './AppClip.module.css';

export interface AppClipProps {
  name: AppClipName;
  active?: boolean;
  playWhenVisible?: boolean;
  loop?: boolean;
  onEnded?: () => void;
  /** what the recording shows (aria-label) */
  label: string;
  /** 'auto' only for the active and next clip */
  preload?: 'none' | 'metadata' | 'auto';
  /** override the poster (e.g. APP_STILLS.herVersion.src) */
  poster?: string;
  className?: string;
  style?: CSSProperties;
  /** show the tap-to-play button even with motion on (static rows) */
  tapToPlay?: boolean;
}

export function AppClip({
  name,
  active,
  playWhenVisible = false,
  loop = true,
  onEnded,
  label,
  preload = 'none',
  poster,
  className,
  style,
  tapToPlay = false,
}: AppClipProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const clip = APP_CLIPS[name];
  const { paused } = usePause();
  const reduced = useReducedMotionPref();
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [userStarted, setUserStarted] = useState(false);
  const [near, setNear] = useState(false);
  const [slow, setSlow] = useState(false);
  const [file, setFile] = useState(clip.src);
  const controlled = active !== undefined;
  const manual = reduced || tapToPlay || slow;
  // attach the file near the viewport (slow connection: only once tapped); release it when far
  const attached = slow ? userStarted : near || userStarted;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only network/codec choice
    setSlow(slowNet());
    setFile(videoSrc(clip.src));
  }, [clip.src]);

  // near = within ~2 viewports
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: '200% 0px' });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  // detached: drop the buffered media too (removing src alone keeps the decoder and its frames)
  useEffect(() => {
    const v = ref.current;
    if (v && !attached && v.networkState !== HTMLMediaElement.NETWORK_EMPTY) v.load();
  }, [attached]);

  // visibility (≥ 50%)
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting && e.intersectionRatio >= 0.5), {
      threshold: [0, 0.5, 1],
    });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  // restart when a controlled clip becomes active
  useEffect(() => {
    const v = ref.current;
    if (!v || !controlled || !active) return;
    try {
      v.currentTime = 0;
    } catch {
      /* not loaded yet */
    }
  }, [active, controlled]);

  // play / pause
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const want = manual
      ? userStarted && visible && !paused && (controlled ? !!active : true)
      : visible && !paused && (controlled ? !!active : playWhenVisible);
    const tryPlay = () => {
      if (want && v.paused && document.visibilityState === 'visible') v.play().catch(() => setPlaying(false));
    };
    if (want) tryPlay();
    else if (!v.paused) v.pause();
    document.addEventListener('visibilitychange', tryPlay);
    v.addEventListener('loadedmetadata', tryPlay);
    return () => {
      document.removeEventListener('visibilitychange', tryPlay);
      v.removeEventListener('loadedmetadata', tryPlay);
    };
  }, [manual, userStarted, visible, paused, controlled, active, playWhenVisible, attached]);

  const showButton = manual && !(userStarted && playing);

  return (
    <div className={[styles.clip, className].filter(Boolean).join(' ')} style={style}>
      <video
        ref={ref}
        className={styles.video}
        src={attached ? file : undefined}
        poster={poster ?? optSrc(clip.poster, 960) ?? clip.poster}
        muted
        playsInline
        disablePictureInPicture
        preload={preload}
        loop={loop}
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
      />
      {manual ? (
        <button
          type="button"
          className={[styles.play, showButton ? '' : styles.playHidden].join(' ')}
          aria-label={playing ? 'Pause recording' : 'Play recording'}
          onClick={() => {
            const v = ref.current;
            if (!v) return;
            if (playing) {
              setUserStarted(false);
              v.pause();
            } else {
              setUserStarted(true);
              v.play().catch(() => {});
            }
          }}
        >
          <span className={styles.playDisc}>{playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}</span>
        </button>
      ) : null}
    </div>
  );
}

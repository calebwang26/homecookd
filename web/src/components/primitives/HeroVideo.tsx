'use client';
// The real family-cooking hero video (brief 5 "HeroVideo").
//
//   const videoRef = useRef<HTMLVideoElement>(null);
//   <HeroVideo desktopSrc={HERO.desktop} mobileSrc={HERO.mobile} poster={HERO.poster} posterMobile={HERO.posterMobile}
//              focus={HERO.focus} videoRef={videoRef} suspended={deckScale < 0.3} className={s.video} />
//
// - The poster is the LCP image: an <img fetchpriority="high" data-hero-poster> (optimized WebP,
//   mobile/desktop via <picture>) under the video; it fades out when the video fires `playing`.
// - The source (size + codec for this screen, src/lib/video.ts) is attached only once the page has
//   loaded and gone idle, so the poster, fonts and first-screen JS never wait on video. muted
//   autoplay loop playsInline preload="metadata", object-fit cover, object-position var(--focus).
// - Pauses with PauseProvider, when offscreen, and while `suspended`.
// - Reduced motion, Save-Data or a slow connection (src/lib/perf.ts): never autoplays; the poster
//   shows with a ▶ "Play video" button. So does a refused autoplay (iPhone Low Power Mode).
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { optSrc } from '@/lib/imageLoader';
import { useCopy } from '@/components/providers/CopyProvider';
import { PlayIcon } from '@/components/icons/Icons';
import { usePause } from '@/components/providers/PauseProvider';
import { afterLoadIdle, slowNet } from '@/lib/perf';
import { heroSrc } from '@/lib/video';
import styles from './HeroVideo.module.css';

export interface HeroVideoProps {
  desktopSrc: string;
  mobileSrc: string;
  poster: string;
  posterMobile: string;
  focus?: string;
  focusMobile?: string;
  className?: string;
  style?: CSSProperties;
  videoRef?: RefObject<HTMLVideoElement | null>;
  /** pause without user intent (e.g. the deck shrank into the sentence) */
  suspended?: boolean;
  /** show the built-in ▶ button when the video can't autoplay (default true) */
  showPlayButton?: boolean;
  onPlayingChange?: (playing: boolean) => void;
}

export function HeroVideo({
  desktopSrc,
  mobileSrc,
  poster,
  posterMobile,
  focus = '52% 45%',
  focusMobile = '50% 35%',
  className,
  style,
  videoRef,
  suspended = false,
  showPlayButton = true,
  onPlayingChange,
}: HeroVideoProps) {
  const copy = useCopy();
  const innerRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { paused } = usePause();
  const [src, setSrc] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [playing, setPlaying] = useState(false);
  // the poster fades only once frames are really advancing (some browsers fire `playing` early)
  const [rendered, setRendered] = useState(false);
  const [visible, setVisible] = useState(true);
  const [userPlay, setUserPlay] = useState(false);

  // choose the source on mount, attach it once the page is loaded and idle
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const noAuto = reduce || slowNet();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only media choice (static export)
    setAuto(!noAuto);
    if (noAuto) return;
    return afterLoadIdle(() => setSrc((cur) => cur ?? heroSrc(desktopSrc, mobileSrc)));
  }, [desktopSrc, mobileSrc]);

  // offscreen → pause
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // play / pause
  useEffect(() => {
    const v = innerRef.current;
    if (!v || !src) return;
    const want = visible && !paused && !suspended && (auto || userPlay);
    const tryPlay = () => {
      if (want && v.paused && document.visibilityState === 'visible')
        v.play().catch((err: unknown) => {
          setPlaying(false);
          // autoplay refused (Low Power Mode, data saver): offer the ▶ button instead of a frozen poster
          if (!userPlay && err instanceof DOMException && err.name === 'NotAllowedError') setAuto(false);
        });
    };
    if (want) tryPlay();
    else if (!v.paused) v.pause();
    // Browsers defer autoplay in hidden tabs / before data arrives: retry when either changes.
    document.addEventListener('visibilitychange', tryPlay);
    v.addEventListener('canplay', tryPlay);
    return () => {
      document.removeEventListener('visibilitychange', tryPlay);
      v.removeEventListener('canplay', tryPlay);
    };
  }, [src, visible, paused, suspended, auto, userPlay]);

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  const startByUser = () => {
    setUserPlay(true);
    if (!src) setSrc(heroSrc(desktopSrc, mobileSrc));
    else innerRef.current?.play().catch(() => {});
  };

  const pDesk = optSrc(poster, 1920) ?? poster;
  const pDeskSet = [960, 1280, 1920].map((w) => `${optSrc(poster, w) ?? poster} ${w}w`).join(', ');
  const pMob = optSrc(posterMobile, 960) ?? posterMobile;

  return (
    <div
      ref={rootRef}
      className={[styles.hero, rendered ? styles.isPlaying : '', className].filter(Boolean).join(' ')}
      style={{ ['--focus' as string]: focus, ['--focus-m' as string]: focusMobile, ...style }}
    >
      <picture>
        <source media="(max-width: 767px)" srcSet={pMob} />
        <img
          className={styles.poster}
          src={pDesk}
          srcSet={pDeskSet}
          sizes="100vw"
          alt=""
          fetchPriority="high"
          decoding="async"
          data-hero-poster=""
        />
      </picture>
      <video
        ref={(el) => {
          innerRef.current = el;
          if (videoRef) videoRef.current = el;
        }}
        className={styles.video}
        src={src ?? undefined}
        muted
        loop
        playsInline
        autoPlay={auto}
        preload="metadata"
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          if (!rendered && e.currentTarget.currentTime > 0.2) setRendered(true);
        }}
      />
      {showPlayButton && !auto && !playing ? (
        <button type="button" className={styles.play} onClick={startByUser} aria-label={copy.hero.playVideo} data-theme="dark">
          <span className={styles.playDisc}>
            <PlayIcon size={26} />
          </span>
          <span className={styles.playLabel}>{copy.hero.playVideo}</span>
        </button>
      ) : null}
    </div>
  );
}

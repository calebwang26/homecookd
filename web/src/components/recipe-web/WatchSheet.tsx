'use client';
// Watch, the way the app does it (app/src/components/media/MediaSheet.tsx and ClipVideo.tsx):
//  Sheet       the app's BottomSheet: dimmed backdrop, cream sheet (top corners 32), grabber, round
//              close, an optional Fraunces 24 title with a muted line under it. Portalled to <body>
//              so it sits over the top bar and the pinned action wherever it is opened from.
//  RangeClip   the clip box: photo + 68 px glass play; tap plays [start, end] in place and stops at
//              the end; tap the video to pause / resume; a thin cream progress bar, a pause hint
//              while playing, "Watch again" at the end.
//  WatchSheet  "Watch": a step's range (starts on open, sized to the video, the cook's words under
//              it), or the whole video with native controls. No video: "Sample recipe, no video".
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { IconClose, IconPause, IconPlay } from './icons';
import { useRangeMedia } from './useRangeMedia';
import ui from './RecipeWeb.module.css';
import s from './WatchSheet.module.css';

export function Sheet({
  title,
  subtitle,
  label,
  onClose,
  reduced,
  children,
}: {
  title?: string;
  subtitle?: string;
  /** Dialog name when there is no title. */
  label?: string;
  onClose: () => void;
  reduced: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // Focus the dialog itself: a screen reader hears its name, and no focus ring lands on a button.
    dialog.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      html.style.overflow = was;
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return createPortal(
    <div className={s.layer}>
      <div className={s.frame}>
        <motion.div
          className={s.backdrop}
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.22 } }}
          transition={{ duration: 0.22 }}
          aria-hidden="true"
        />
        <motion.div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label={title ?? label}
          tabIndex={-1}
          className={s.sheet}
          initial={reduced ? { opacity: 0 } : { y: '100%' }}
          animate={reduced ? { opacity: 1 } : { y: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { y: '100%', transition: { duration: 0.24, ease: [0.55, 0.055, 0.675, 0.19] } }}
          transition={reduced ? { duration: 0.15 } : { type: 'spring', damping: 20, stiffness: 220, mass: 0.9 }}
        >
          <span className={s.grabber} aria-hidden="true" />
          <button type="button" className={`${ui.press} ${s.close}`} aria-label="Close" onClick={onClose}>
            <IconClose size={18} />
          </button>
          <div className={s.content}>
            {title && (
              <div className={s.head}>
                <h2 className={s.title}>{title}</h2>
                {subtitle && <p className={s.subtitle}>{subtitle}</p>}
              </div>
            )}
            {children}
          </div>
        </motion.div>
      </div>
    </div>,
    document.body,
  );
}

export function RangeClip({
  src,
  poster,
  start,
  end,
  height,
  fit,
  aspect,
  autoPlay,
  label,
}: {
  src: string;
  poster: string | null;
  start: number;
  end: number;
  /** Box height (the step screen's 260, or 220 beside a long how-to). */
  height?: number;
  /** Size the box to the video's own shape (sheets), at most 460 tall. */
  fit?: boolean;
  /** Width / height of the video, if known (recipe.media.width / height). */
  aspect?: number | null;
  autoPlay?: boolean;
  /** e.g. "Watch Dad: Brown the beef, 48 seconds". */
  label: string;
}) {
  const { ref, state, play, toggle } = useRangeMedia<HTMLVideoElement>();
  const [shape, setShape] = useState(aspect || 16 / 9);
  const { status, t, key } = state;
  const started = key !== null;
  const begin = () => play(src, start, end, `clip-${start}-${end}`);
  const p = end > start ? Math.min(1, Math.max(0, (t - start) / (end - start))) : 0;

  useEffect(() => {
    if (autoPlay) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const onTap = () => (!started || status === 'error' ? begin() : toggle());

  return (
    <div className={s.clip} data-fit={fit || undefined} style={fit ? { aspectRatio: String(shape) } : { height }}>
      <video
        ref={ref}
        className={s.video}
        data-show={started || undefined}
        playsInline
        preload="none"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) setShape(v.videoWidth / v.videoHeight);
        }}
      />
      {poster && (!started || status === 'loading') && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.poster} src={poster} alt="" />
      )}
      <button
        type="button"
        className={s.tap}
        aria-label={!started ? label : status === 'playing' ? 'Pause' : status === 'error' ? 'Try the video again' : 'Play'}
        onClick={onTap}
      />
      <div className={s.center} aria-hidden={status !== 'ended' || undefined}>
        {!started || status === 'paused' ? (
          <span className={s.play}>
            <IconPlay size={26} />
          </span>
        ) : status === 'loading' ? (
          <span className={s.play}>
            <span className={s.spinner} />
          </span>
        ) : status === 'error' ? (
          <span className={s.note}>Couldn’t load the video. Tap to try again.</span>
        ) : status === 'ended' ? (
          <button type="button" className={`${ui.press} ${s.again}`} onClick={toggle}>
            <IconPlay size={16} />
            Watch again
          </button>
        ) : null}
      </div>
      {status === 'playing' && (
        <span className={s.pauseHint} aria-hidden="true">
          <IconPause size={14} />
        </span>
      )}
      {started && (
        <span className={s.track} aria-hidden="true">
          <span style={{ transform: `scaleX(${p})` }} />
        </span>
      )}
    </div>
  );
}

export function WatchSheet({
  src,
  poster,
  title,
  subtitle,
  range,
  quote,
  aspect,
  sample,
  onClose,
  reduced,
}: {
  /** Null: the recipe has no video (a sample). */
  src: string | null;
  poster: string | null;
  title: string;
  /** "Step 2 · Dad"; for the whole video, the cook's name. */
  subtitle?: string;
  /** A step's range; without it the whole video plays with native controls. */
  range?: { start: number; end: number } | null;
  /** The cook's words, shown under the video. */
  quote?: string | null;
  aspect?: number | null;
  sample?: boolean;
  onClose: () => void;
  reduced: boolean;
}) {
  const words = quote?.trim();
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose} reduced={reduced}>
      {!src ? (
        <div className={s.noVideo}>{sample ? 'Sample recipe, no video' : 'No video for this one yet'}</div>
      ) : range ? (
        <RangeClip src={src} poster={poster} start={range.start} end={range.end} fit aspect={aspect} autoPlay label={`Watch ${title}`} />
      ) : (
        <WholeVideo src={src} poster={poster} aspect={aspect} />
      )}
      {words && <p className={s.quote}>“{words}”</p>}
    </Sheet>
  );
}

/** The whole recipe video, native controls, sized to the video. */
function WholeVideo({ src, poster, aspect }: { src: string; poster: string | null; aspect?: number | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [shape, setShape] = useState(aspect || 16 / 9);
  useEffect(() => {
    ref.current?.play().catch(() => {
      /* autoplay blocked: the native controls show a play button */
    });
  }, []);
  return (
    <video
      ref={ref}
      className={s.whole}
      style={{ aspectRatio: String(shape) }}
      src={src}
      poster={poster ?? undefined}
      controls
      playsInline
      preload="metadata"
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        if (v.videoWidth && v.videoHeight) setShape(v.videoWidth / v.videoHeight);
      }}
    />
  );
}

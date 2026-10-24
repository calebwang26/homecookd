'use client';
// Global "pause motion" (brief 4.3, WCAG 2.2.2).
//   const { paused, toggle, setPaused } = usePause();
//   <PauseButton />                                    // ink outline, "Pause motion"
//   <PauseButton variant="cream" labels={{ pause: copy.everyFamily.pause, play: copy.everyFamily.play }} />
//   <PauseButton variant="cream" kind="video" />        // the hero: "Pause video" / "Play video"
//
// While paused, html[data-paused] is set, which stops every CSS loop marked [data-loop]
// (marquees, sticker spin, chip wobble, mascot steam). JS loops read `paused` themselves.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { PauseIcon, PlayIcon } from '@/components/icons/Icons';
import styles from './PauseButton.module.css';

interface PauseCtx {
  paused: boolean;
  setPaused: (p: boolean) => void;
  toggle: () => void;
}

const Ctx = createContext<PauseCtx>({ paused: false, setPaused: () => {}, toggle: () => {} });

export function PauseProvider({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const toggle = useCallback(() => setPaused((p) => !p), []);

  useEffect(() => {
    const root = document.documentElement;
    if (paused) root.dataset.paused = '';
    else delete root.dataset.paused;
  }, [paused]);

  const value = useMemo(() => ({ paused, setPaused, toggle }), [paused, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePause(): PauseCtx {
  return useContext(Ctx);
}

export interface PauseButtonProps {
  /** cream outline (on photos / dark blocks) or ink outline (on light) */
  variant?: 'cream' | 'ink';
  /** 'motion' → "Pause motion"; 'video' → "Pause video" (the hero) */
  kind?: 'motion' | 'video';
  /** override the accessible labels (e.g. copy.everyFamily.pause / play) */
  labels?: { pause: string; play: string };
  /** 48 (default) or 40 for tight UI (still ≥ 44 with its hit area) */
  size?: 48 | 40;
  className?: string;
  /** called after toggling (e.g. to also stop a local auto-advance) */
  onToggle?: (paused: boolean) => void;
}

export function PauseButton({ variant = 'ink', kind = 'motion', labels, size = 48, className, onToggle }: PauseButtonProps) {
  const { paused, toggle } = usePause();
  const copy = useCopy();
  const l =
    labels ??
    (kind === 'video'
      ? { pause: copy.hero.pauseVideo, play: copy.hero.playVideo }
      : { pause: 'Pause motion', play: 'Play motion' });
  return (
    <button
      type="button"
      className={[styles.btn, styles[variant], className].filter(Boolean).join(' ')}
      style={{ ['--size' as string]: `${size}px` }}
      aria-pressed={paused}
      aria-label={l.pause}
      title={paused ? l.play : l.pause}
      data-theme={variant === 'cream' ? 'dark' : undefined}
      onClick={() => {
        toggle();
        onToggle?.(!paused);
      }}
    >
      {paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
    </button>
  );
}

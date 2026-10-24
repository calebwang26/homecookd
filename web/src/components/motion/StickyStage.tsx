'use client';
// A tall track with a CSS-sticky 100svh stage (brief 5 "StickyStage").
//
//   <StickyStage
//     trackVh={{ desktop: 230 }}
//     layout="split"                       // flow column | sticky stage column (StepsToBox)
//     split="minmax(0, 33vw) minmax(0, 1fr)"
//     stage={<div className={s.deck}>…</div>}
//     onReady={({ track, stage }) => setEls({ track, stage })}   // hand the nodes to your GSAP timeline
//   >
//     <TextBlock1 /> <TextBlock2 />        // normal-flow content
//   </StickyStage>
//
//   <StickyStage trackVh={{ desktop: 170 }} stage={<FarApartStage />} />   // overlay (default)
//
// Film mode (sticky + tall track) only applies on desktop ≥1024×600 with motion on; set
// stickyOnMobile to keep it below 1024. Everywhere else (mobile, reduced motion, no-JS fallback,
// short screens) the track is height:auto and the stage is a normal block: write the stage's
// static (final) layout as its default CSS and let GSAP take over only inside gsap.matchMedia(MQ.desktop).
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import styles from './StickyStage.module.css';

export interface StickyStageProps {
  trackVh: { desktop: number; mobile?: number };
  stickyOnMobile?: boolean;
  stage: ReactNode;
  children?: ReactNode;
  /** 'overlay' stacks the flow content over the stage; 'split' puts them in two columns */
  layout?: 'overlay' | 'split';
  /** grid-template-columns for layout="split" (flow column first unless stageSide="left") */
  split?: string;
  stageSide?: 'left' | 'right';
  className?: string;
  stageClassName?: string;
  flowClassName?: string;
  style?: CSSProperties;
  id?: string;
  onReady?: (els: { track: HTMLDivElement; stage: HTMLDivElement }) => void;
  [data: `data-${string}`]: unknown;
}

export function StickyStage({
  trackVh,
  stickyOnMobile = false,
  stage,
  children,
  layout = 'overlay',
  split,
  stageSide = 'right',
  className,
  stageClassName,
  flowClassName,
  style,
  id,
  onReady,
  ...rest
}: StickyStageProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  useEffect(() => {
    readyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (trackRef.current && stageRef.current) readyRef.current?.({ track: trackRef.current, stage: stageRef.current });
  }, []);

  return (
    <div
      ref={trackRef}
      id={id}
      className={[styles.track, styles[layout], stickyOnMobile ? styles.stickyMobile : '', stageSide === 'left' ? styles.stageLeft : '', className]
        .filter(Boolean)
        .join(' ')}
      style={{
        ['--track-d' as string]: `${trackVh.desktop}vh`,
        ['--track-m' as string]: `${trackVh.mobile ?? trackVh.desktop}vh`,
        ...(split ? { ['--split' as string]: split } : {}),
        ...style,
      }}
      data-sticky-track=""
      {...rest}
    >
      <div ref={stageRef} className={[styles.stage, stageClassName].filter(Boolean).join(' ')} data-sticky-stage="">
        {stage}
      </div>
      {children !== undefined ? <div className={[styles.flow, flowClassName].filter(Boolean).join(' ')}>{children}</div> : null}
    </div>
  );
}

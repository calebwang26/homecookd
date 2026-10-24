// The three "how it works" step cards (brief 8.4 "Step card faces"). Server-safe.
//
//   <StepCard index={0} />                       // decorative deck face (film), sized by its parent
//   <StepCard index={1} decorative={false} />    // real content (static stairs), with an <h3>
//   <StepCard index={2} layout="row" decorative={false} />   // mobile row: square media left, text right
//
// Card: a tinted panel (sage / butter / sun), media on top with a big numeral, the H3 below.
// Everything inside scales with the card (container queries), with 16px / 20px floors.
// Card 2 carries the REC pill ([data-rec-time] is updated by the film timeline) and the lavender
// moon chip; card 3 shows a real app frame ("Add a recipe") as a mini screen, plus the sticker.
// `plain` (the parent version, /teach): photo, numeral and title only (card 2 keeps its REC pill), and
// card 3's screen is the finished recipe ("We write the recipe. They cook it.").
import type { CSSProperties } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { APP_STILLS, PHOTOS } from '@/content/media';
import type { Tint } from '@/content/types';
import { Img } from '@/components/primitives/Img';
import { Pill } from '@/components/primitives/Pill';
import { Sticker } from '@/components/primitives/Sticker';
import { MoonIcon } from '@/components/icons/Icons';
import styles from './StepCard.module.css';

export interface StepCardProps {
  index: 0 | 1 | 2;
  layout?: 'card' | 'row';
  /** decorative cards are aria-hidden (the film deck); the steps are listed for screen readers elsewhere */
  decorative?: boolean;
  /** next/image sizes for the photo */
  sizes?: string;
  /** no pills, chips or sticker; card 3 shows the recipe screen (parent version) */
  plain?: boolean;
  className?: string;
  style?: CSSProperties;
}

const TINTS: Tint[] = ['sage', 'butter', 'sun'];

export function StepCard({ index, layout = 'card', decorative = true, sizes, plain = false, className, style }: StepCardProps) {
  const STEPS = useCopy().howItWorks.steps;
  /** "● REC 0:42" → "REC 0:42" (the Pill draws its own pulsing dot). */
  const REC_LABEL = STEPS[1].recPill.replace(/^●\s*/, '');
  const step = STEPS[index];
  const tint = TINTS[index];
  const Title = decorative ? 'p' : 'h3';
  const imgSizes = sizes ?? (layout === 'row' ? '30vw' : '(min-width: 1024px) 18vw, 40vw');

  return (
    <article
      className={[styles.root, layout === 'row' ? styles.row : styles.vertical, styles[`s${index}`], className].filter(Boolean).join(' ')}
      style={{ ['--tint-bg' as string]: `var(--tint-${tint}-bg)`, ['--tint-ink' as string]: `var(--tint-${tint}-ink)`, ...style }}
      data-step={index}
      aria-hidden={decorative ? true : undefined}
    >
      <div className={styles.panel}>
        <div className={styles.media}>
          {index === 0 ? (
            <Img src={PHOTOS.phoneTripod.src} alt={decorative ? '' : step.imageAlt} fill sizes={imgSizes} focus={PHOTOS.phoneTripod.focus} className={styles.photo} />
          ) : index === 1 ? (
            <Img src={PHOTOS.handsKneading.src} alt={decorative ? '' : step.imageAlt} fill sizes={imgSizes} focus="58% 55%" className={styles.photo} />
          ) : (
            <span className={styles.screen}>
              {/* app-record-add.jpg is the frame at 11.5s: "Sunday dumplings" typed, Grandma picked */}
              <Img
                src={plain ? APP_STILLS.shareEnd.src : APP_STILLS.recordAdd.src}
                alt={decorative ? '' : step.imageAlt}
                fill
                sizes={layout === 'row' ? '30vw' : '(min-width: 1024px) 14vw, 30vw'}
                focus={plain ? '50% 14%' : '50% 21%'}
                className={styles.photo}
              />
            </span>
          )}

          <span className={['t-numeral', styles.numeral].join(' ')} aria-hidden="true">
            {step.numeral}
          </span>

          {index === 0 && 'pill' in step && !plain ? (
            <Pill tone="white85" className={styles.photoPill}>
              {step.pill}
            </Pill>
          ) : null}

          {index === 1 ? (
            <Pill tone="rec" className={styles.recPill}>
              <span data-rec-time="">{REC_LABEL}</span>
            </Pill>
          ) : null}
        </div>

        <div className={styles.body}>
          <Title className={styles.title}>{step.title}</Title>
          {index === 1 && 'moonChip' in step && layout === 'row' && !plain ? (
            <Pill tone="lavender" icon={<MoonIcon size="1em" />} className={styles.moonInline}>
              {step.moonChip}
            </Pill>
          ) : null}
          {index === 0 && 'pill' in step && layout === 'row' && !plain ? (
            <Pill tone="white85" className={styles.rowPill}>
              {step.pill}
            </Pill>
          ) : null}
        </div>
      </div>

      {index === 1 && 'moonChip' in step && layout === 'card' && !plain ? (
        <Pill tone="lavender" icon={<MoonIcon size="1em" />} className={styles.moonChip}>
          {/* "Overnight rise?" / "Film it in pieces.": set lines, so the chip is only as wide as its text */}
          {step.moonChip.split(/(?<=\?)\s+/).map((line) => (
            <span key={line} className={styles.chipLine}>
              {line}
            </span>
          ))}
        </Pill>
      ) : null}

      {index === 2 && 'sticker' in step && !plain ? (
        <span className={styles.sticker}>
          <Sticker
            lines={step.sticker}
            tone="creamOnSun"
            size={120}
            rotate={10}
            decorative={decorative}
            style={{ ['--size' as string]: '100%', ['--st-min' as string]: '0.75rem' }}
          />
        </span>
      ) : null}
    </article>
  );
}

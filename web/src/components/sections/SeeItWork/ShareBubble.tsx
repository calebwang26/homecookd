'use client';
// The text the real app hands to the share sheet, shown truthfully as a message bubble BESIDE the
// phone (never on the screen). Pops when the recording's Share tap lands.
import { useCopy } from '@/components/providers/CopyProvider';
import { shareText } from './tour';
import styles from './SeeItWork.module.css';

export interface ShareBubbleProps {
  shown: boolean;
  /** 'stage': beside the sticky phone (desktop ≥ 1280); 'row': under the send row's words (desktop
   *  < 1280, where the gap beside the phone is too narrow); 'panel': the mobile tab panel;
   *  'static': the static rows */
  variant: 'stage' | 'row' | 'panel' | 'static';
  className?: string;
}

export function ShareBubble({ shown, variant, className }: ShareBubbleProps) {
  const copy = useCopy();
  return (
    <div
      className={[styles.bubbleWrap, styles[`bubble_${variant}`], className].filter(Boolean).join(' ')}
      data-shown={shown ? '' : undefined}
      aria-hidden="true"
    >
      <p className={`t-ui ${styles.bubbleLabel}`}>{shareText(copy).label}</p>
      <p className={styles.bubble}>{copy.seeItWork.sharePayload}</p>
    </div>
  );
}

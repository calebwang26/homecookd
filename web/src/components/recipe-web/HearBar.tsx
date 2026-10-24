'use client';
// "Hear the cook", the app's Hear sheet (app/src/components/media/MediaSheet.tsx + HearCard.tsx):
// the step's title, "Step 2 · Dad’s voice", then a peach card: a pulsing dot with "Listening to
// Dad…", a round ink play / pause, the sentence they are roughly saying (Fraunces italic 24), and
// "0:12 ━━── 0:48". Without a recording (samples) it shows their words with "Sample recipe, no
// recording".
//  HearBar    driven by the page's shared player (useRW().hear): opens with any hear() and closes
//             with stopHear().
//  HearSheet  the sheet itself, also used directly for a sample's step (nothing to play).
import { AnimatePresence } from 'motion/react';
import { useRW } from './context';
import { IconPause, IconPlay } from './icons';
import { subtitleAt } from './stepText';
import type { RangeStatus } from './useRangeMedia';
import { Sheet } from './WatchSheet';
import { mmss } from '@/lib/recipe-web/recipe';
import ui from './RecipeWeb.module.css';
import s from './HearBar.module.css';

/** The line under the title. hear() keys are `step-N` / `quote-N` (a step's range) or `story-<id>`. */
function hearSubtitle(key: string, cook: string): string {
  const step = /^(?:step|quote)-(\d+)$/.exec(key);
  if (step) return `Step ${step[1]} · ${cook}’s voice`;
  if (key.startsWith('story-')) return `A story · ${cook}`;
  return `${cook}’s voice`;
}

export function HearBar() {
  const { recipe: r, hearing, hearState, toggleHear, stopHear, reduced } = useRW();
  const show = !!hearing && hearState.status !== 'idle';
  const len = Math.max(0, hearState.end - hearState.start);
  const elapsed = Math.min(len, Math.max(0, hearState.t - hearState.start));

  return (
    <AnimatePresence>
      {show && hearing && (
        <HearSheet
          key="hear"
          title={hearing.label}
          subtitle={hearSubtitle(hearing.key, r.cook.name)}
          cook={r.cook.name}
          words={hearing.words}
          audio={{ status: hearState.status, elapsed, duration: len, onToggle: toggleHear }}
          onClose={stopHear}
          reduced={reduced}
        />
      )}
    </AnimatePresence>
  );
}

export function HearSheet({
  title,
  subtitle,
  cook,
  words,
  audio,
  sample,
  onClose,
  reduced,
}: {
  title: string;
  subtitle: string;
  cook: string;
  words: string | null;
  /** The playing range; null when there is no recording. */
  audio: { status: RangeStatus; elapsed: number; duration: number; onToggle: () => void } | null;
  sample?: boolean;
  onClose: () => void;
  reduced: boolean;
}) {
  const playing = audio?.status === 'playing';
  const p = audio && audio.duration > 0 ? audio.elapsed / audio.duration : 0;
  const line = subtitleAt(words, p);
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose} reduced={reduced}>
      <div className={s.card}>
        <div className={s.top}>
          <div className={s.listening} aria-live="polite">
            <span className={s.dot} data-on={playing || undefined} aria-hidden="true" />
            <span className={s.label}>
              {!audio ? (sample ? 'Sample recipe, no recording' : 'No recording for this one yet') : playing ? `Listening to ${cook}…` : `${cook}’s voice`}
            </span>
          </div>
          {audio && (
            <button type="button" className={`${ui.press} ${s.btn}`} onClick={audio.onToggle} aria-label={playing ? 'Pause' : `Hear ${cook}`}>
              {audio.status === 'loading' ? <span className={s.spin} /> : playing ? <IconPause size={22} /> : <IconPlay size={22} />}
            </button>
          )}
        </div>
        {line && <p className={s.line}>“{line}”</p>}
        {audio && audio.duration > 0 && (
          <div
            className={s.progress}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(p * 100)}
            aria-valuetext={`${mmss(audio.elapsed)} of ${mmss(audio.duration)}`}
          >
            <span className={s.time}>{mmss(audio.elapsed)}</span>
            <span className={s.track}>
              <span style={{ transform: `scaleX(${p})` }} />
            </span>
            <span className={s.time}>{mmss(audio.duration)}</span>
          </div>
        )}
        {audio?.status === 'error' && <p className={s.error}>Couldn’t load the recording. Try again.</p>}
      </div>
    </Sheet>
  );
}

'use client';
// In their words: the translator card (brief 8.8). Website UI, never a phone: no status bar, no app
// chrome. A radiogroup of six languages; the cook's original line sits on top (flips in like a
// split-flap card), the English line arrives under it word by word, out of a blur.
//
// Auto-advance: every 3.2s while the card is ≥ 50% visible, one full cycle (back to the starting
// language), then it stops. Any user interaction stops it for good; PauseProvider pauses it. The
// timer IS the progress bar's CSS animation on the active chip (animationend → next), so pausing,
// leaving the viewport and the global pause all freeze the bar and the timer together.
// No aria-live on auto changes; a user's pick announces the English line.
import { animate, inView } from 'motion';
import { Fragment, useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { copy } from '@/content/copy';
import { useCopy } from '@/components/providers/CopyProvider';
import { getRecipe } from '@/content/recipes';
import { loadTranslationFonts } from '@/lib/fonts';
import { EASE } from '@/lib/motion/tokens';
import { useMotionOK } from '@/components/providers/MotionProvider';
import { PauseButton, usePause } from '@/components/providers/PauseProvider';
import { WordReveal } from '@/components/motion/WordReveal';
import { Chip } from '@/components/primitives/Chip';
import { Img } from '@/components/primitives/Img';
import s from './TranslatorCard.module.css';

// The lines are data (same languages, cooks and dishes in both versions); the labels come from useCopy.
// TODO(native-check): every `original` line in copy.inTheirWords.lines needs a native speaker before launch.
const LINES = copy.inTheirWords.lines;
type LineId = (typeof LINES)[number]['id'];

/** Lines outside Latin script use the on-demand Noto serif subsets (src/lib/fonts.ts). */
const SCRIPT: Partial<Record<LineId, 'sc' | 'kr' | 'deva'>> = { zh: 'sc', ko: 'kr', hi: 'deva' };

/** navigator.language → starting line (the visitor's own family language first). */
const BROWSER_LANG: [RegExp, LineId][] = [
  [/^zh/, 'zh'],
  [/^es/, 'es'],
  [/^(tl|fil)/, 'tl'],
  [/^hi/, 'hi'],
  [/^ko/, 'ko'],
  [/^it/, 'it'],
];

const INTERVAL_S = 3.2;

/** "中文 Chinese" → { native: "中文", english: "Chinese" }; "Tagalog" → { native: "Tagalog", english: "" } */
function splitChip(chip: string) {
  const [native, ...rest] = chip.split(' ');
  return { native, english: rest.join(' ') };
}

const RECIPES = LINES.map((l) => getRecipe(l.recipeId));

/** Start on the language the section body names ("Grandma explains it best in Chinese"), so the
 *  copy and the card agree on first view; 中文 when the body names none. */
const defaultLine = (body: string) =>
  Math.max(
    0,
    LINES.findIndex((l) => {
      const { native, english } = splitChip(l.chip);
      return body.includes(english || native);
    }),
  );

export function TranslatorCard({ className }: { className?: string }) {
  const T = useCopy().inTheirWords;
  const [active, setActive] = useState(() => defaultLine(T.body));
  const [prev, setPrev] = useState<number | null>(null);
  /** true after the first change: later English lines reveal on mount instead of on enter */
  const [changed, setChanged] = useState(false);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  const [live, setLive] = useState('');
  const advances = useRef(0);
  const motionOK = useMotionOK();
  const { paused } = usePause();

  const cardRef = useRef<HTMLDivElement>(null);
  const origRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const ruleRef = useRef<HTMLSpanElement>(null);

  const uid = useId();
  const groupLabelId = `${uid}-label`;
  const radioName = `${uid}-lang`;

  // Start on the visitor's language when it's one of the six (client only; SSR shows defaultLine()).
  // (Setting the line already shown is a no-op.)
  useEffect(() => {
    let lang = '';
    try {
      lang = (navigator.language || '').toLowerCase();
    } catch {
      /* ignore */
    }
    const hit = BROWSER_LANG.find(([re]) => re.test(lang));
    const i = hit ? LINES.findIndex((l) => l.id === hit[1]) : -1;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only read after SSR (static export)
    if (i >= 0) setActive(i);
  }, []);

  // ≥ 50% visible → the auto-advance may run. Within a viewport → load the Noto subsets.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const stopVis = inView(
      el,
      () => {
        setVisible(true);
        setSeen(true);
        return () => setVisible(false);
      },
      { amount: 0.5 },
    );
    const stopFonts = inView(
      el,
      () => {
        loadTranslationFonts(LINES.map((l) => l.original));
        stopFonts();
      },
      { margin: '100% 0px 100% 0px' },
    );
    return () => {
      stopVis();
      stopFonts();
    };
  }, []);

  const select = useCallback(
    (i: number, by: 'user' | 'auto') => {
      if (by === 'user') setAuto(false);
      if (i === active) return;
      setPrev(active);
      setActive(i);
      setChanged(true);
      if (by === 'user') setLive(LINES[i].english);
    },
    [active],
  );

  // The bar on the active chip finished filling: advance (one full cycle, then stop).
  const onBarEnd = useCallback(() => {
    advances.current += 1;
    select((active + 1) % LINES.length, 'auto');
    if (advances.current >= LINES.length) setAuto(false);
  }, [active, select]);

  // Change animation: outgoing line flips away, incoming flips in (rotateX 90° → 0, perspective 600px),
  // the "You read" rule redraws left → right. Reduced motion: instant swap. Controls live in a ref so
  // clearing `prev` (when the outgoing flip ends) never cuts the incoming flip short.
  const anims = useRef<{ complete: () => void; stop: () => void }[]>([]);
  useEffect(() => {
    if (prev === null) return;
    for (const a of anims.current) a.complete();
    anims.current = [];
    const inEl = origRefs.current[active];
    const outEl = origRefs.current[prev];
    if (!motionOK || !inEl || !outEl) {
      setPrev(null);
      return;
    }
    const outA = animate(outEl, { rotateX: [0, -90], opacity: [1, 0] }, { duration: 0.24, ease: [0.5, 0, 0.75, 0] });
    const inA = animate(inEl, { rotateX: [90, 0], opacity: [0, 1] }, { duration: 0.44, delay: 0.17, ease: EASE.soft });
    anims.current = [outA, inA];
    const rule = ruleRef.current;
    if (rule) anims.current.push(animate(rule, { scaleX: [0, 1] }, { duration: 0.7, delay: 0.18, ease: EASE.expo }));
    outA.finished.then(() => {
      if (anims.current.includes(outA)) setPrev(null);
    });
  }, [active, prev, motionOK]);
  useEffect(() => () => anims.current.forEach((a) => a.stop()), []);

  const line = LINES[active];
  const recipe = RECIPES[active];
  const running = motionOK && auto && visible && !paused;
  const showBar = motionOK && auto;

  return (
    <div
      ref={cardRef}
      className={[s.card, className].filter(Boolean).join(' ')}
      data-seen={seen || undefined}
    >
      {/* 1. language picker */}
      <p id={groupLabelId} className={s.groupLabel}>
        {T.radioLabel}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={groupLabelId}
        className={s.chips}
        onKeyDown={() => setAuto(false)}
        onPointerDown={() => setAuto(false)}
      >
        {LINES.map((l, i) => {
          const { native, english } = splitChip(l.chip);
          const checked = i === active;
          return (
            <label key={l.id} className={s.chip} data-checked={checked || undefined}>
              <input
                type="radio"
                className={s.radio}
                name={radioName}
                value={l.id}
                checked={checked}
                onChange={() => select(i, 'user')}
                onClick={() => setAuto(false)}
              />
              <span className={s.chipText}>
                <span className={s.native} lang={l.lang} data-script={SCRIPT[l.id]}>
                  {native}
                </span>
                {english ? <span className={s.chipEn}>{english}</span> : null}
              </span>
              {checked && showBar ? (
                <span className={s.bar} aria-hidden="true">
                  <span
                    key={active}
                    className={s.barFill}
                    style={{ animationDuration: `${INTERVAL_S}s`, animationPlayState: running ? 'running' : 'paused' } as CSSProperties}
                    onAnimationEnd={onBarEnd}
                  />
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      {/* 2. who said it */}
      <div className={s.meta}>
        <Chip key={line.id} tone="forest" tail="bl" pop className={s.said}>
          {T.saidLabel.replace('{cook}', line.cook)}
        </Chip>
        <span key={`dish-${line.id}`} className={s.dish}>
          <span className={s.thumb} aria-hidden="true">
            <Img src={recipe.image} alt="" fill sizes="48px" focus="50% 50%" />
          </span>
          {/* wraps only between words, never after the hyphen in "Red-Braised" */}
          <span>
            {line.dish.split(' ').map((word, i) => (
              <Fragment key={i}>
                {i > 0 ? ' ' : null}
                <span className={s.dishWord}>{word}</span>
              </Fragment>
            ))}
          </span>
        </span>
      </div>

      {/* 3. the original, always on top */}
      <div className={s.originalRow}>
        <span key={`wave-${line.id}`} className={s.wave} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <div className={s.origStack}>
          {LINES.map((l, i) => (
            <p
              key={l.id}
              ref={(el) => {
                origRefs.current[i] = el;
              }}
              lang={l.lang}
              className={s.original}
              data-script={SCRIPT[l.id]}
              data-state={i === active ? 'in' : i === prev ? 'out' : 'off'}
              aria-hidden={i === active ? undefined : true}
            >
              {l.original}
            </p>
          ))}
        </div>
      </div>

      {/* 4. you read */}
      <div className={s.readRow}>
        <span className={s.readLabel}>{T.youRead}</span>
        <span ref={ruleRef} className={s.readRule} aria-hidden="true" />
      </div>

      {/* 5. the English line (sizers reserve the tallest line so the card never jumps) */}
      <div className={s.enStack}>
        {LINES.map((l) => (
          <p key={l.id} className={`${s.english} ${s.sizer}`} aria-hidden="true">
            {l.english}
          </p>
        ))}
        <WordReveal
          key={line.id}
          as="p"
          className={s.english}
          text={line.english}
          trigger={changed ? 'load' : 'enter'}
          stagger={0.04}
          amount={0.5}
        />
      </div>

      {/* 6. the rule + pause */}
      <div className={s.footer}>
        <p className={`t-ui ${s.rule}`}>
          <svg className={s.ruleIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
          </svg>
          {T.rule}
        </p>
        <PauseButton variant="ink" size={40} labels={{ pause: T.pause, play: T.play }} />
      </div>

      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </div>
  );
}

'use client';
// Cook mode, one step at a time, as the app draws it (app/src/app/cook/[id].tsx; bible Kid-Step /
// Kid-Step-Open): close + "Step 3 of 8 ⌄" (opens "All steps") over a segmented progress bar; the
// step's clip (plays its range in place); the title and its how-to (a long one shows four lines and
// "Read the rest"); Watch / Hear pills (each opens its sheet); and ONE "More from <cook>" dropdown
// with everything else: their words (tap to hear them), "In this step", "Look for", what made it
// special, stories, and "Ask the family". Opening it shrinks the clip to a 96 px thumbnail beside
// the title. Like everything that needs an account, "Ask the family" opens the Get the app popover.
// The family's saved answers ("From the family") need an account to read, so the web has none.
import { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from './Avatar';
import { Bold, Her, Was } from './DishBits';
import { FitLabel } from './FitLabel';
import { useRW } from './context';
import { HearSheet } from './HearBar';
import { IconBubble, IconCheck, IconChevronDown, IconClose, IconEye, IconPlay, IconSparkle, IconWave } from './icons';
import { bestStepQuote, cutSentence, lookFor, splitCue, stepIngredients, stepTime, watchLabel } from './stepText';
import { RangeClip, Sheet, WatchSheet } from './WatchSheet';
import { hasAudio, hearLabel, ingredientLines, mmss } from '@/lib/recipe-web/recipe';
import type { Recipe, Step, Story } from '@/lib/recipe-web/types';
import ui from './RecipeWeb.module.css';
import s from './StepScreen.module.css';

type Open = 'watch' | 'hear' | 'steps' | null;

export function StepScreen({ index }: { index: number }) {
  const { recipe: r, go, lock, hear, stopHear, reduced, dish } = useRW();
  const step: Step = r.steps[index];
  const total = r.steps.length;
  const n = index + 1;
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Open>(null);

  const name = r.cook.name;
  const video = r.media.video_url;
  const audio = hasAudio(r);
  const len = Math.max(0, step.end_s - step.start_s);
  const instruction = step.instruction?.trim() ?? '';
  const poster = step.image_url || r.media.poster_url;
  const special = r.special.some((x) => x.step === step.order);
  const clipH = instruction.length > 110 ? 220 : 260;
  const aspect = r.media.width && r.media.height ? r.media.width / r.media.height : null;

  const watch = () => {
    stopHear();
    setSheet('watch');
  };
  const hearStep = () =>
    audio ? hear({ key: `step-${step.order}`, start: step.start_s, end: step.end_s, label: step.title, words: step.quote }) : setSheet('hear');
  const pick = (i: number) => {
    setSheet(null);
    if (i !== index) go({ name: 'step', i });
  };

  return (
    <div className={s.wrap} data-open={open || undefined}>
      <div className={s.top}>
        <button type="button" className={`${ui.press} ${ui.roundBtn}`} aria-label={dish ? dish.t('common.close') : 'Close and go back to the recipe'} onClick={() => go({ name: 'recipe' })}>
          <IconClose />
        </button>
        <button type="button" className={s.progress} aria-haspopup="dialog" aria-label={dish ? dish.t('lock.stepOf', { n, m: total }) : `Step ${n} of ${total}. Shows all steps`} onClick={() => setSheet('steps')}>
          <span className={s.stepOf}>
            {dish ? dish.t('lock.stepOf', { n, m: total }) : `Step ${n} of ${total}`}
            <IconChevronDown size={16} className={s.chev} />
          </span>
          <span className={s.segments} aria-hidden="true">
            {r.steps.map((x, k) => (
              <span key={x.order} className={s.seg} data-on={k < n || undefined} />
            ))}
          </span>
        </button>
      </div>

      {dish ? (
        <DishStep index={index} />
      ) : open ? (
        <div className={s.compact}>
          <Thumb poster={poster} hasVideo={!!video} label={`Watch ${name}: ${step.title}`} onPress={watch} />
          <h1 className={s.h1Small}>{step.title}</h1>
        </div>
      ) : (
        <div className={s.full}>
          {video ? (
            <RangeClip src={video} poster={poster} start={step.start_s} end={step.end_s} height={clipH} label={`Watch ${name}: ${step.title}, ${len} seconds`} />
          ) : (
            <div className={s.sample} style={{ height: clipH }} role="img" aria-label="Sample recipe, no video">
              {poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={s.cover} src={poster} alt="" />
              )}
              <span className={s.sampleChip}>Sample recipe · no video</span>
            </div>
          )}
          <div className={s.words}>
            <h1 className={s.h1}>{step.title}</h1>
            {instruction && <Instruction text={instruction} />}
          </div>
          <div className={ui.pillPair}>
            <button type="button" className={`${ui.press} ${ui.pillBtn}`} onClick={watch} aria-label={video ? `Watch ${name}, ${len} seconds` : 'Watch. Sample recipe, no video'}>
              <IconPlay />
              <FitLabel full={watchLabel(video ? len : 0)} short="Watch" />
            </button>
            <button type="button" className={`${ui.press} ${ui.pillBtn}`} onClick={hearStep} aria-label={`Hear ${name}${audio ? `, ${len} seconds` : ''}, with the words on screen`}>
              <IconWave />
              <FitLabel full={hearLabel(name, audio ? len : 0)} short={audio && len > 0 ? `Hear · ${mmss(len)}` : 'Hear'} />
            </button>
          </div>
        </div>
      )}

      {/* Her words sit in the step itself on a dish card; there is no "More from" to open. */}
      {!dish && (
        <section className={s.drawer} data-open={open || undefined}>
          <button type="button" className={s.drawerHead} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span className={s.drawerTitle}>More from {name}</span>
            {special && !open && (
              <span className={s.specialChip}>
                <IconSparkle size={12} />
                Special
              </span>
            )}
            <motion.span className={s.chevron} animate={{ rotate: open ? 180 : 0 }} transition={{ duration: reduced ? 0 : 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
              <IconChevronDown />
            </motion.span>
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="more"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reduced ? 0.15 : 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <StepMore recipe={r} step={step} canHear={audio} onHearStep={hearStep} onAsk={(el) => lock('askStep', el)} />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      <AnimatePresence>
        {sheet === 'watch' && (
          <WatchSheet
            key="watch"
            src={video}
            poster={poster}
            title={step.title}
            subtitle={`Step ${step.order} · ${name}`}
            range={{ start: step.start_s, end: step.end_s }}
            quote={step.quote}
            aspect={aspect}
            sample={r.sample}
            onClose={() => setSheet(null)}
            reduced={reduced}
          />
        )}
        {sheet === 'hear' && (
          <HearSheet
            key="hear"
            title={step.title}
            subtitle={`Step ${step.order} · ${name}’s voice`}
            cook={name}
            words={step.quote}
            audio={null}
            sample={r.sample}
            onClose={() => setSheet(null)}
            reduced={reduced}
          />
        )}
        {sheet === 'steps' && <StepsSheet key="steps" steps={r.steps} current={n} onPick={pick} onClose={() => setSheet(null)} reduced={reduced} title={dish?.t('lock.allSteps')} />}
      </AnimatePresence>
    </div>
  );
}

/** The step's how-to (17/1.5). A long one shows four lines and "Read the rest"; tap to read it all. */
function Instruction({ text }: { text: string }) {
  const long = text.length > 180;
  const [all, setAll] = useState(false);
  if (!long) return <p className={s.body}>{text}</p>;
  return (
    // The whole block toggles, as in the app; the button inside is its keyboard / screen-reader handle.
    <div className={s.bodyWrap} onClick={() => setAll((v) => !v)}>
      <p className={s.body} data-clamped={!all || undefined}>
        {text}
      </p>
      <button type="button" className={s.readRest} aria-expanded={all}>
        {all ? 'Show less' : 'Read the rest'}
      </button>
    </div>
  );
}

/** Kid-Step-Open's 96 px clip thumbnail (radius 22, 40 px glass play): opens the Watch sheet. */
function Thumb({ poster, hasVideo, label, onPress }: { poster: string | null; hasVideo: boolean; label: string; onPress: () => void }) {
  const img = poster ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={s.cover} src={poster} alt="" />
  ) : null;
  // A sample has no video: just the photo, no play disc promising one.
  if (!hasVideo) {
    return (
      <div className={s.thumb} role="img" aria-label="Sample recipe, no video">
        {img}
      </div>
    );
  }
  return (
    <button type="button" className={`${ui.press} ${s.thumb}`} aria-label={label} onClick={onPress}>
      {img}
      <span className={s.thumbPlay}>
        <IconPlay size={16} />
      </span>
    </button>
  );
}

/** The inside of "More from <cook>" (the app's StepMore). */
function StepMore({
  recipe,
  step,
  canHear,
  onHearStep,
  onAsk,
}: {
  recipe: Recipe;
  step: Step;
  canHear: boolean;
  onHearStep: () => void;
  onAsk: (el: HTMLElement) => void;
}) {
  const { hear } = useRW();
  const name = recipe.cook.name;
  const quote = bestStepQuote(step, 110);
  const ings = stepIngredients(recipe, step);
  const look = lookFor(step.sensory_cue);
  const specials = recipe.special.filter((x) => x.step === step.order);
  const stories = recipe.stories.filter((x) => x.step === step.order || step.story_ids.includes(x.id));

  return (
    <div className={s.more}>
      {quote && (
        <div className={s.said}>
          <Avatar name={name} size={36} />
          <button type="button" className={s.bubble} onClick={onHearStep} aria-label={`${name} says: ${quote}. Tap to hear ${name} say it.`}>
            “{quote}”
          </button>
        </div>
      )}

      {ings.length > 0 && (
        <div className={s.inStep}>
          <span className={s.eyebrow}>In this step</span>
          {ings.map((i, k) => {
            const l = ingredientLines(i);
            return (
              <div key={`${i.name}-${k}`} className={s.ingRow}>
                <span className={s.ingWords}>{l.words}</span>
                <span className={s.ingAmt}>{l.amount}</span>
              </div>
            );
          })}
        </div>
      )}

      {look && (
        <div className={s.look}>
          <IconEye size={20} />
          <p className={s.lookText}>
            <span className={ui.srOnly}>Look for: </span>
            {look}
          </p>
        </div>
      )}

      {specials.map((x) => (
        <div key={x.id} className={s.special}>
          <span className={s.calloutHead}>
            <IconSparkle size={16} className={s.sun} />
            <span className={s.caps}>What made it special</span>
          </span>
          <p className={s.specialText}>{x.text}</p>
          {x.why && <p className={s.specialWhy}>{x.why}</p>}
        </div>
      ))}

      {stories.map((x) => (
        <StoryCallout
          key={x.id}
          story={x}
          cook={name}
          canHear={canHear}
          onHear={() => hear({ key: `story-${x.id}`, start: x.start_s, end: x.end_s, label: x.title, words: x.text })}
        />
      ))}

      <button type="button" className={`${ui.press} ${s.ask}`} onClick={(e) => onAsk(e.currentTarget)}>
        <IconBubble size={18} />
        Ask the family
      </button>
    </div>
  );
}

const STORY_CLAMP = 180;

/** "A story" (lavender): a long one shows its first ~150 chars with "Read the rest". */
function StoryCallout({ story: x, cook, canHear, onHear }: { story: Story; cook: string; canHear: boolean; onHear: () => void }) {
  const text = x.text.trim();
  const long = text.length > STORY_CLAMP;
  const [all, setAll] = useState(false);
  const len = x.end_s - x.start_s;
  return (
    <div className={s.story}>
      <span className={s.storyHead}>
        <span className={s.caps}>A story</span>
        <span className={s.storyTitle}>{x.title}</span>
      </span>
      <p className={s.storyText}>“{long && !all ? cutSentence(text, 150) : text}”</p>
      {long && (
        <button type="button" className={s.storyMore} aria-label={all ? 'Show less of the story' : `Read the rest of ${cook}’s story`} onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : 'Read the rest'}
        </button>
      )}
      {canHear && len > 0 && (
        <button type="button" className={`${ui.press} ${s.storyHear}`} aria-label={`Hear ${cook} tell it, ${mmss(len)}`} onClick={onHear}>
          <IconWave size={16} />
          Hear {cook} tell it · {mmss(len)}
        </button>
      )}
    </div>
  );
}

/** "All steps" (the app's StepsSheet): done steps show a check, the current one sits on sage. */
function StepsSheet({ steps, current, onPick, onClose, reduced, title = 'All steps' }: { steps: Step[]; current: number; onPick: (i: number) => void; onClose: () => void; reduced: boolean; title?: string }) {
  const list = useRef<HTMLDivElement>(null);
  const now = useRef<HTMLButtonElement>(null);
  // Long lists open near the current step.
  useLayoutEffect(() => {
    if (list.current && now.current) list.current.scrollTop = Math.max(0, now.current.offsetTop - 120);
  }, []);
  return (
    <Sheet title={title} onClose={onClose} reduced={reduced}>
      <div ref={list} className={s.stepsList}>
        {steps.map((x, i) => {
          const k = i + 1;
          const isNow = k === current;
          const done = k < current;
          return (
            <button
              key={`${x.order}-${i}`}
              ref={isNow ? now : undefined}
              type="button"
              className={`${ui.press} ${s.stepRow}`}
              data-now={isNow || undefined}
              data-done={done || undefined}
              aria-current={isNow ? 'step' : undefined}
              aria-label={`${k}. ${x.title}${isNow ? ', current step' : done ? ', done' : ''}`}
              onClick={() => onPick(i)}
            >
              <span className={s.stepCircle}>{done ? <IconCheck size={16} /> : k}</span>
              <span className={s.stepTitle}>{x.title}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/**
 * A dish card's step: its title, its lines (her amount over the guess she replaced), her own words with
 * the English under them, and her clip when she recorded one ("Hear Mom say it", the page's one Hear sheet).
 */
function DishStep({ index }: { index: number }) {
  const { dish, hear } = useRW();
  if (!dish) return null;
  const st = dish.recipe.steps[index];
  const hers = st.lines.filter((l) => l.status === 'mom');
  const clipId = hers.find((l) => l.clip)?.clip ?? st.tip?.clip ?? null;
  const clip = clipId ? dish.clips[clipId] : null;
  const url = clip?.audioUrl ?? null;
  const quote = hers.find((l) => l.quote)?.quote ?? st.tip;
  // The structure the video steps have (MoreFrom: "In this step", the Look for box), from the card's own data.
  const ings = st.uses.flatMap((k) => dish.recipe.ingredients[k] ?? []);
  const { actions, cue } = splitCue(st.lines);
  const time = stepTime(st.lines);
  return (
    <div className={s.full}>
      <div className={s.words}>
        <h1 className={s.h1}>{st.title}</h1>
        {time && <span className={s.time}>{time}</span>}
      </div>
      {ings.length > 0 && (
        <div className={s.inStep}>
          <span className={s.eyebrow}>{dish.t('lock.inStep')}</span>
          {ings.map((x, k) => (
            <div key={`${x.name}-${k}`} className={s.ingRow}>
              <span className={s.ingWords} dir="auto">
                {x.name}
              </span>
              <span className={s.ingAmt}>{x.amount}</span>
            </div>
          ))}
        </div>
      )}
      <ol className={s.actions}>
        {actions.map((l, i) => (
          <li key={i} className={s.action}>
            {actions.length > 1 && (
              <span className={s.actionNum} aria-hidden="true">
                {i + 1}
              </span>
            )}
            <span className={s.actionText} dir="auto">
              <Bold text={l.detail || l.text} />
              {l.status === 'mom' && l.was && <Was block text={l.was.replaceAll('**', '')} />}
            </span>
          </li>
        ))}
      </ol>
      {cue && (
        <div className={s.look}>
          <IconEye size={20} />
          <p className={s.lookText} dir="auto">
            <Bold text={cue.text} />
          </p>
        </div>
      )}
      {hers.map((l, i) => l.quote && <Her key={i} quote={l.quote} />)}
      {st.tip && <Her quote={st.tip} />}
      {url && (
        <div className={ui.pillPair} style={{ gridTemplateColumns: '1fr' }}>
          <button
            type="button"
            className={`${ui.press} ${ui.pillBtn}`}
            onClick={() => hear({ key: `clip-${clipId}`, start: 0, end: clip?.durationS ? clip.durationS + 1 : 3600, label: st.title, words: quote?.words ?? null, url })}
          >
            <IconWave />
            {dish.hear}
          </button>
        </div>
      )}
    </div>
  );
}

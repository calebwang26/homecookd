'use client';
// The app's recipe screen (app/src/app/recipe/[id]/index.tsx, bible Kid-Recipe): the dish photo
// with share + heart floating over it, a cream sheet rising over the photo with the title, "by Dad ·
// ~4 hrs · makes 8 generous bowls", one line of the cook's own words, and Watch (the whole video) +
// Hear (the clip behind that line). The pinned "Start cooking" lives in RecipeWebApp's dock.
// Web only: "<Sender> sent you this recipe" on the photo; share and heart open "Get the app". The
// app's "<N> family answers" row needs the family's sign-in, so the web has no data for it.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Logo } from '@/components/primitives/Logo';
import { Avatar } from './Avatar';
import { FitLabel } from './FitLabel';
import { HearSheet } from './HearBar';
import { Her } from './DishBits';
import { useRW } from './context';
import { IconHeart, IconPlay, IconWave } from './icons';
import { firstQuote } from '@/lib/recipe-web/fromDish';
import { bestQuote, hasAudio, hasVideo, hearLabel, metaLine, mmss, possessive } from '@/lib/recipe-web/recipe';
import ui from './RecipeWeb.module.css';
import s from './RecipeScreen.module.css';

const HERO = 380;
const HERO_MIN = 316;

/** The app's ShareIcon (Hearth bible stroke, 24 viewBox). */
function IconShare() {
  return (
    <svg width={21} height={21} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5v11M8 7.5l4-4 4 4" />
      <path d="M6 11.5H5.5A1.5 1.5 0 0 0 4 13v5.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V13a1.5 1.5 0 0 0-1.5-1.5H18" />
    </svg>
  );
}

export function RecipeScreen() {
  const { recipe: r, share, lock, hear, hearing, hearState, toggleHear, watchAll, reduced, dish } = useRW();
  const quote = useMemo(() => bestQuote(r), [r]);
  const her = useMemo(() => (dish ? firstQuote(dish.recipe) : null), [dish]);
  // Hear on a recipe with no recording (samples): the app's Hear sheet with the words and no player.
  const [silentHear, setSilentHear] = useState(false);
  const sender = share.sender;
  const cook = r.cook.name;
  const poster = r.media.poster_url;
  const video = hasVideo(r);
  const audio = hasAudio(r);
  const whole = r.media.duration_s || 0;
  const hearStep = quote?.step ?? r.steps[0] ?? null;
  const hearLen = hearStep ? Math.max(0, hearStep.end_s - hearStep.start_s) : 0;
  const hearKey = hearStep ? `quote-${hearStep.order}` : '';
  const hearOn = !!hearing && hearing.key === hearKey && hearState.status !== 'idle';
  const watchFull = video && whole ? `Watch · ${mmss(whole)}` : 'Watch';
  const hearFull = hearLabel(cook, audio ? hearLen : 0);

  // Bible hero is 380 tall. On a short phone, a recipe whose Watch/Hear pills would end right at
  // the pinned "Start cooking" gets a shorter hero (down to 316) so the pills sit 28 px clear of it.
  // When they land well below, the page simply scrolls under the bar's fade.
  const heroRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const [heroH, setHeroH] = useState(HERO);
  useLayoutEffect(() => {
    const fit = () => {
      const pills = pillsRef.current;
      const dock = document.querySelector<HTMLElement>('[data-rw-dock]');
      const cta = dock?.querySelector<HTMLElement>('[data-rw-cta]');
      if (!pills || !dock || !cta) return;
      // Layout positions (offsetTop ignores the entrance transforms), at the hero's full height.
      let bottom = pills.offsetHeight;
      for (let el: HTMLElement | null = pills; el; el = el.offsetParent as HTMLElement | null) bottom += el.offsetTop;
      bottom += HERO - (heroRef.current?.offsetHeight ?? HERO);
      const ctaTop = window.innerHeight - (dock.offsetHeight - cta.offsetTop);
      const over = bottom + 28 - ctaTop;
      setHeroH(over > 0 && over <= HERO - HERO_MIN ? HERO - Math.ceil(over) : HERO);
    };
    fit();
    window.addEventListener('resize', fit);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => window.removeEventListener('resize', fit);
  }, [r]);

  const rise = (i: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.15 } }
      : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.38, delay: 0.08 + i * 0.04, ease: [0.22, 1, 0.36, 1] as const } };

  const onWatch = () => watchAll(); // with no video the sheet says "Sample recipe, no video", as in the app
  const onHear = () => {
    if (!hearStep) return;
    if (!audio) return setSilentHear(true);
    if (hearOn) toggleHear();
    else hear({ key: hearKey, start: hearStep.start_s, end: hearStep.end_s, label: hearStep.title, words: hearStep.quote });
  };

  return (
    <div className={s.wrap}>
      <motion.div
        ref={heroRef}
        className={s.hero}
        style={{ height: heroH }}
        initial={reduced ? { opacity: 0 } : { opacity: 0.6, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={reduced ? { duration: 0.15 } : { type: 'spring', damping: 18, stiffness: 180 }}
      >
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={s.heroImg} src={poster} alt={dish ? r.title : `${r.title}, from ${possessive(cook)} kitchen`} />
        ) : (
          <div className={s.heroEmpty} aria-hidden="true">
            <span className={s.heroEmptyName}>{r.title}</span>
          </div>
        )}
        {sender && (
          <motion.div
            className={s.sent}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <Avatar name={sender.name} avatarKey={sender.avatar_key} size={32} />
            <span className={s.sentText}>
              <b>{sender.name}</b> sent you this recipe
            </span>
          </motion.div>
        )}
        <button type="button" className={`${ui.press} ${s.float} ${s.share}`} aria-label={dish ? dish.t('common.getApp') : `Share ${r.title}`} onClick={(e) => lock('share', e.currentTarget)}>
          <IconShare />
        </button>
        <button type="button" className={`${ui.press} ${s.float} ${s.heart}`} aria-label={dish ? dish.t('common.getApp') : `Add ${r.title} to your favorites`} onClick={(e) => lock('heart', e.currentTarget)}>
          <IconHeart />
        </button>
      </motion.div>

      <div className={s.sheet}>
        <motion.div className={s.titleBlock} {...rise(0)}>
          <h1 className={s.title}>{r.title}</h1>
          <div className={s.meta}>
            {dish ? (
              // The card's own mark, never a stock face matched to the name "Mom".
              <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', background: '#fcebd0', display: 'grid', placeItems: 'center', flex: 'none' }}>
                <Logo variant="mark" size={18} />
              </span>
            ) : (
              <Avatar name={cook} size={24} />
            )}
            <span>{dish ? dish.meta : metaLine(r)}</span>
          </div>
          {r.source && <p className={s.source}>Video: {r.source}</p>}
        </motion.div>

        {quote && (
          <motion.p className={s.quote} aria-label={`${cook} says: ${quote.text}`} {...rise(1)}>
            “{quote.text}”
          </motion.p>
        )}

        {her && (
          <motion.div className={s.hers} {...rise(1)}>
            <Her quote={her} />
          </motion.div>
        )}

        {/* A dish card has no video or recording, so no Watch or Hear here. */}
        {!dish && (
          <motion.div ref={pillsRef} className={ui.pillPair} {...rise(2)}>
            <button
              type="button"
              className={`${ui.press} ${ui.pillBtn}`}
              onClick={onWatch}
              aria-label={video ? `Watch ${cook} make it, ${mmss(whole)}` : `Watch ${cook}. ${r.sample ? 'Sample recipe, no video' : 'No video for this one yet'}`}
            >
              <IconPlay />
              <FitLabel full={watchFull} short="Watch" />
            </button>
            {hearStep && (
              <button
                type="button"
                className={`${ui.press} ${ui.pillBtn}`}
                aria-pressed={audio ? hearOn && hearState.status === 'playing' : undefined}
                aria-label={`Hear ${cook}${audio && hearLen ? `, ${mmss(hearLen)}` : ''}, with the words on screen`}
                onClick={onHear}
              >
                <IconWave />
                <FitLabel full={hearFull} short={hearFull.startsWith(`Hear ${cook}`) ? `Hear ${cook}` : 'Hear'} />
              </button>
            )}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {silentHear && hearStep && (
          <HearSheet
            key="hear"
            title={hearStep.title}
            subtitle={`Step ${hearStep.order} · ${cook}’s voice`}
            cook={cook}
            words={hearStep.quote}
            audio={null}
            sample={r.sample}
            onClose={() => setSilentHear(false)}
            reduced={reduced}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

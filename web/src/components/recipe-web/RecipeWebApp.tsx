'use client';
// The web recipe page (/r?s=<token>): a limited web version of the app's kid view, locked to the
// one shared recipe. Recipe -> Ingredients -> Steps work (Watch/Hear included); everything else
// opens the "Get the app" popover, which leads to the app hand-off sheet. See docs/build/SPEC.md
// section 6 and FEEDBACK-OCT16c section C. Like the app's recipe flow there is no tab bar here
// (the app hides it on a dish): only the screen's pinned action, under the web's own top bar.
// RecipeWebView is the same view with a `dish` (DishLock): the dish pages' locked look at the recipe
// Mom just wrote or the kid's card, read from the dish card instead of recipe.json (DishRecipeView).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PotMascot } from '@/components/primitives/PotMascot';
import { LANDER_LINK } from '@/lib/app-links';
import { getRecipe, getShare, isPlausibleToken, LoadError, type LoadErrorKind } from '@/lib/recipe-web/api';
import { BUCKET_URL, fixtureAllowed } from '@/lib/recipe-web/config';
import { clearProgress, readLastStep, writeLastStep } from '@/lib/recipe-web/progress';
import type { Recipe, Share } from '@/lib/recipe-web/types';
import { RWContext, type DishLock, type HearRequest, type LockKind, type RW, type Screen } from './context';
import { GetAppPopover, lockCopy, type LockCopy } from './GetAppPopover';
import { GetAppSheet } from './GetAppSheet';
import { HearBar } from './HearBar';
import { IconArrow, IconBack, IconCheck } from './icons';
import { IngredientsScreen } from './IngredientsScreen';
import { RecipeScreen } from './RecipeScreen';
import { ErrorScreen, LoadingScreen } from './StatusScreens';
import { StepScreen } from './StepScreen';
import { useRangeMedia } from './useRangeMedia';
import { WatchSheet } from './WatchSheet';
import ui from './RecipeWeb.module.css';

type Load =
  | { state: 'loading' }
  | { state: 'error'; kind: LoadErrorKind }
  | { state: 'ready'; share: Share; recipe: Recipe };

/**
 * Dev only: /r?fixture=<recipe-id>[&from=none|<name>] on localhost reads that recipe from the bucket.
 * The default sender is the demo family's Dad (his seeded photo); `from=<name>` is someone real, so
 * no avatar_key (their initial).
 */
function fixtureShare(id: string, from: string | null): Share {
  return {
    token: 'fixture',
    recipe_id: id,
    recipe_url: `${BUCKET_URL}/${id}/recipe.json`,
    sender: from === 'none' ? null : { name: from || 'Dad', relation: from || 'Dad', avatar_key: from ? null : 'dad' },
    family_name: null,
  };
}

function parseHash(steps: number): Screen {
  const h = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '');
  if (h === 'ingredients') return { name: 'ingredients' };
  const m = h.match(/^step-(\d+)$/);
  if (m && steps > 0) return { name: 'step', i: Math.min(Math.max(Number(m[1]) - 1, 0), steps - 1) };
  return { name: 'recipe' };
}

const hashOf = (s: Screen) => (s.name === 'recipe' ? '' : s.name === 'ingredients' ? '#ingredients' : `#step-${s.i + 1}`);

export function RecipeWebApp() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (window as unknown as { __homecookdHydrated?: boolean }).__homecookdHydrated = true;
    let alive = true;
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const fixture = q.get('fixture');
      try {
        let share: Share;
        if (fixture && fixtureAllowed() && /^[a-z0-9-]{1,80}$/.test(fixture)) {
          share = fixtureShare(fixture, q.get('from'));
        } else {
          const token = q.get('s');
          if (!isPlausibleToken(token)) throw new LoadError('missing');
          share = await getShare(token);
        }
        const recipe = await getRecipe(share.recipe_url);
        if (!alive) return;
        document.title = `${recipe.title}, from ${recipe.cook.name} · homecookd`;
        setLoad({ state: 'ready', share, recipe });
      } catch (e) {
        if (!alive) return;
        setLoad({ state: 'error', kind: e instanceof LoadError ? e.kind : 'network' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  return (
    <div className={ui.page}>
      <div className={ui.column}>
        {load.state === 'ready' ? (
          <RecipeWebView share={load.share} recipe={load.recipe} />
        ) : (
          <>
            <TopBar />
            <main className={ui.main}>
              {load.state === 'loading' ? (
                <LoadingScreen />
              ) : (
                <ErrorScreen
                  kind={load.kind}
                  onRetry={() => {
                    setLoad({ state: 'loading' });
                    setAttempt((a) => a + 1);
                  }}
                />
              )}
            </main>
          </>
        )}
      </div>
    </div>
  );
}

/** Spotify-web style bar. Without `onGetApp` (loading / error) the pill simply goes to the lander
 *  (the kid page: whoever opens a shared recipe is learning it).
 *  `overlay`: the recipe hero runs under the bar (bible Kid-Recipe proportions); `clear`: the bar is
 *  frosted and see-through while it still sits over the photo, solid once the page scrolls past.
 *  Lander links are plain <a>, never next/link: a soft navigation leaves the lander's lazily
 *  mounted sections blank (its deferred slots and head scripts only run on a full page load). */
function TopBar({ onGetApp, overlay, clear, dish }: { onGetApp?: (el: HTMLElement) => void; overlay?: boolean; clear?: boolean; dish?: DishLock | null }) {
  // On the dish pages the bar has a way back to the page the view opened from, and the wordmark stays put.
  const mark = (
    <>
      <PotMascot size={28} />
      <span className={ui.word}>homecookd</span>
    </>
  );
  return (
    <header className={ui.topbar} data-overlay={overlay || undefined} data-clear={(overlay && clear) || undefined}>
      {dish && (
        <button type="button" className={`${ui.press} ${ui.topBack}`} aria-label={dish.t('common.back')} onClick={dish.onClose}>
          <IconBack size={22} />
        </button>
      )}
      {dish ? (
        <span className={ui.brand}>{mark}</span>
      ) : (
        <a className={ui.brand} href={LANDER_LINK.learner} aria-label="What’s homecookd?">
          {mark}
        </a>
      )}
      {onGetApp ? (
        <button type="button" className={`${ui.press} ${ui.getApp}`} onClick={(e) => onGetApp(e.currentTarget)}>
          {dish ? dish.t('common.getApp') : 'Get the app'}
        </button>
      ) : (
        <a className={`${ui.press} ${ui.getApp} ${ui.getAppLink}`} href={LANDER_LINK.learner}>
          Get the app
        </a>
      )}
    </header>
  );
}

export function RecipeWebView({ share, recipe, dish = null }: { share: Share; recipe: Recipe; dish?: DishLock | null }) {
  const reduced = !!useReducedMotion();
  const steps = recipe.steps.length;
  // On the dish pages the screens live in state only: the page's own address and back button stay as they are.
  const [screen, setScreen] = useState<Screen>(() => (dish ? { name: 'recipe' } : parseHash(steps)));
  const [popover, setPopover] = useState<{ rect: DOMRect; copy: LockCopy; key: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const closeSheet = useCallback(() => setSheet(false), []);
  const [watching, setWatching] = useState(false);
  const [hearing, setHearing] = useState<HearRequest | null>(null);
  const { ref: audioRef, state: audioState, play, toggle: toggleAudio, stop } = useRangeMedia<HTMLAudioElement>();
  const audioUrl = recipe.media.audio_url || recipe.media.video_url;

  useEffect(() => {
    if (dish) return;
    const onPop = () => setScreen(parseHash(steps));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [steps, dish]);

  const go = useCallback(
    (s: Screen) => {
      setPopover(null);
      setScreen(s);
      if (!dish) window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${hashOf(s)}`);
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [dish],
  );

  const lock = useCallback(
    (kind: LockKind, anchor: HTMLElement | null) => {
      if (!anchor) return;
      setPopover({ rect: anchor.getBoundingClientRect(), copy: dish ? dish.popover : lockCopy(kind, recipe.cook.name, recipe.title), key: Date.now() });
    },
    [recipe, dish],
  );

  // The step this browser was last on, so the recipe offers "Back to step N" (as the app does).
  const [lastStep, setLastStep] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from storage
    setLastStep(readLastStep(recipe.id));
  }, [recipe.id]);
  const stepNo = screen.name === 'step' ? screen.i + 1 : 0;
  useEffect(() => {
    if (!stepNo) return;
    writeLastStep(recipe.id, stepNo);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors what was just stored
    setLastStep(stepNo);
  }, [recipe.id, stepNo]);
  const madeIt = useCallback(
    (anchor: HTMLElement) => {
      clearProgress(recipe.id);
      setLastStep(0);
      lock('madeIt', anchor);
    },
    [recipe.id, lock],
  );

  const hear = useCallback(
    (h: HearRequest) => {
      const url = h.url ?? audioUrl;
      if (!url) return;
      setHearing(h);
      play(url, h.start, h.end, h.key);
    },
    [play, audioUrl],
  );
  const stopHear = useCallback(() => {
    stop();
    setHearing(null);
  }, [stop]);

  const ctx: RW = useMemo(
    () => ({
      recipe,
      share,
      screen,
      go,
      lock,
      hear,
      hearState: audioState,
      hearing,
      toggleHear: toggleAudio,
      stopHear,
      watchAll: () => {
        stopHear();
        setWatching(true);
      },
      reduced,
      dish,
    }),
    [recipe, share, screen, go, lock, hear, audioState, toggleAudio, hearing, stopHear, reduced, dish],
  );

  // Close the popover when the page scrolls: it points at something that moved.
  useEffect(() => {
    if (!popover) return;
    const close = () => setPopover(null);
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [popover]);

  // The bar turns solid once the hero photo has scrolled up under it.
  const [clear, setClear] = useState(true);
  useEffect(() => {
    if (screen.name !== 'recipe') return;
    const onScroll = () => setClear(window.scrollY < 240);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [screen.name]);

  const screenKey = screen.name === 'step' ? `step-${screen.i}` : screen.name;
  const enter = reduced ? { opacity: 0 } : { opacity: 0, x: 18 };
  const leave = reduced ? { opacity: 0 } : { opacity: 0, x: -18 };

  return (
    <RWContext.Provider value={ctx}>
      <TopBar onGetApp={(el) => lock('getApp', el)} overlay={screen.name === 'recipe'} clear={clear} dish={dish} />
      <main className={ui.main}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screenKey}
            className={ui.screen}
            initial={enter}
            animate={{ opacity: 1, x: 0 }}
            exit={leave}
            transition={{ duration: reduced ? 0.12 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {screen.name === 'recipe' && <RecipeScreen />}
            {screen.name === 'ingredients' && <IngredientsScreen />}
            {screen.name === 'step' && <StepScreen index={screen.i} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <div className={ui.dock} data-rw-dock="">
        <HearBar />
        <Cta screen={screen} recipe={recipe} lastStep={dish ? 0 : lastStep} go={go} onMadeIt={madeIt} dish={dish} />
      </div>

      {/* hidden player for "Hear the cook" */}
      <audio ref={audioRef} preload="none" className={ui.srOnly} />

      <AnimatePresence>
        {popover && (
          <GetAppPopover
            key={popover.key}
            anchor={popover.rect}
            copy={popover.copy}
            reduced={reduced}
            labels={dish ? { notNow: dish.t('common.notNow'), getApp: dish.t('common.getApp') } : undefined}
            onClose={() => setPopover(null)}
            onGetApp={() => {
              setPopover(null);
              setSheet(true);
            }}
          />
        )}
      </AnimatePresence>
      {dish ? (
        dish.renderSheet({ open: sheet, onClose: closeSheet })
      ) : (
        <AnimatePresence>{sheet && <GetAppSheet key="get-app" onClose={closeSheet} share={share} reduced={reduced} />}</AnimatePresence>
      )}
      <AnimatePresence>
        {/* The recipe's Watch: the whole video (the app's media sheet: dish name, the cook under it). */}
        {watching && (
          <WatchSheet
            key="watch"
            src={recipe.media.video_url}
            poster={recipe.media.poster_url}
            title={recipe.title}
            subtitle={recipe.cook.name}
            aspect={recipe.media.width && recipe.media.height ? recipe.media.width / recipe.media.height : null}
            sample={recipe.sample}
            onClose={() => setWatching(false)}
            reduced={reduced}
          />
        )}
      </AnimatePresence>
    </RWContext.Provider>
  );
}

/**
 * The screen's one primary action, pinned to the bottom (the app's BottomBar). Recipe: "Start
 * cooking" -> ingredients, or "Back to step N" straight into the step; ingredients: "Start step 1"
 * or "Back to step N"; steps: back + "Next step" / "I made it".
 */
function Cta({
  screen,
  recipe: r,
  lastStep,
  go,
  onMadeIt,
  dish,
}: {
  screen: Screen;
  recipe: Recipe;
  lastStep: number;
  go: (s: Screen) => void;
  onMadeIt: (anchor: HTMLElement) => void;
  dish: DishLock | null;
}) {
  const steps = r.steps.length;
  const resume = lastStep > 1 && lastStep <= steps;
  if (screen.name === 'recipe' || screen.name === 'ingredients') {
    if (!steps) return null;
    const label = resume
      ? `Back to step ${lastStep}`
      : screen.name === 'recipe'
        ? (dish?.t('lock.start') ?? 'Start cooking')
        : (dish?.t('lock.step1') ?? 'Start step 1');
    const next: Screen = resume ? { name: 'step', i: lastStep - 1 } : screen.name === 'recipe' ? { name: 'ingredients' } : { name: 'step', i: 0 };
    return (
      <div className={ui.ctaRow} data-rw-cta="">
        <button type="button" className={`${ui.press} ${ui.cta}`} onClick={() => go(next)}>
          {label}
          <IconArrow />
        </button>
      </div>
    );
  }
  const last = screen.i >= steps - 1;
  return (
    <div className={ui.ctaRow}>
      <button
        type="button"
        className={`${ui.press} ${ui.ctaBack}`}
        aria-label={dish ? dish.t('common.back') : screen.i === 0 ? 'Back to the ingredients' : 'Previous step'}
        onClick={() => go(screen.i === 0 ? (r.ingredients.length ? { name: 'ingredients' } : { name: 'recipe' }) : { name: 'step', i: screen.i - 1 })}
      >
        <IconBack />
      </button>
      {last ? (
        <button type="button" className={`${ui.press} ${ui.cta}`} onClick={(e) => onMadeIt(e.currentTarget)}>
          <IconCheck size={20} />
          {dish ? dish.t('lock.made') : 'I made it'}
        </button>
      ) : (
        <button type="button" className={`${ui.press} ${ui.cta}`} onClick={() => go({ name: 'step', i: screen.i + 1 })}>
          {dish ? dish.t('lock.next') : 'Next step'}
          <IconArrow />
        </button>
      )}
    </div>
  );
}

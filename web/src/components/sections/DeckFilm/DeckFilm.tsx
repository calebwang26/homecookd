'use client';
// DeckFilm (brief 8.1–8.2, owner B1): hero → pass-down, one object travelling through.
//
// One DOM for both modes:
// - Static (SSR, reduced motion, no JS, short screens, no clip-path): two normal-flow blocks — the
//   hero (video, scrim, H1, CTA), then the pass-down sheet sliding over it with its 40px radius (a4)
//   and the 7-card fan.
// - Film (desktop ≥1024×600 or mobile, motion OK): `.film` turns the blocks into layers of one pinned
//   100svh stage and timeline.ts scrubs them: the sheet slides up while the hero video's window closes
//   onto the front recipe card's photo (the same <video> keeps playing inside the card), the deck
//   peeks out and fans (a7 M5/M6), closes back into its stack, then drops into StepsToBox.
// The call (#the-call: the "You miss Mom's cooking" sentence, the call card and its shuffling stack)
// used to sit between the fan and the drop; it's cut (Caleb, Oct 17).
// The parent version (/teach, FEEDBACK-OCT16 C2) shows only the hero, as one plain screen: no film,
// no fan, no call (HeroOnly below). How it works follows it as the second screen.
import { useCallback, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { copy } from '@/content/copy';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { HERO } from '@/content/media';
import { FAN, FAN_MOBILE, getRecipe } from '@/content/recipes';
import { HeroVideo } from '@/components/primitives/HeroVideo';
import { RecipeCard, possessive } from '@/components/primitives/RecipeCard';
import { Img } from '@/components/primitives/Img';
import { Button } from '@/components/primitives/Button';
import { Chip, type ChipProps } from '@/components/primitives/Chip';
import { ArrowDownIcon, PlayIcon } from '@/components/icons/Icons';
import { PauseButton, usePause } from '@/components/providers/PauseProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { DEFAULT_RELATION, fillPerson } from '@/lib/relation';
import { gsap, useGSAP } from '@/lib/motion/gsap';
import { MQ } from '@/lib/motion/media';
import { HeroOverlay } from './HeroOverlay';
import { Words } from './Words';
import { fanVars } from './static';
import { buildFilm, collect } from './timeline';
import { FilmStoreCtx, createFilmStore, useFilmFlag, type FilmFlags, type FilmStore } from './store';
import s from './DeckFilm.module.css';

const FRONT = getRecipe(copy.hero.frontCard.recipeId); // data: the same card in both versions
const COOK_FACE = new Set(['dad-chili', 'dziadek-pierogi']); // two men visibly cooking in the first deck
const strip = (t: string) => t.replace(/^[●▶]\s*/u, '');

function motionOn(): boolean {
  return document.documentElement.dataset.motion === 'on' && !window.matchMedia(MQ.reduce).matches;
}

/* ------------------------------------------------------------------ small flag-driven parts */

/**
 * A chip that pops on first view in static mode, and on its timeline flag in film mode. The gate span
 * also fades it whenever the flag is off (belt and braces on top of Chip's own pop-out).
 */
function FilmChip({ flag, children, ...props }: Omit<ChipProps, 'pop' | 'shown'> & { flag: keyof FilmFlags; children: ReactNode }) {
  const film = useFilmFlag('film');
  const on = useFilmFlag(flag) as boolean;
  return film ? (
    <span className={s.gate} data-on={on ? '' : undefined}>
      <Chip key="film" {...props} shown={on} aria-hidden>
        {children}
      </Chip>
    </span>
  ) : (
    <Chip key="static" {...props} pop aria-hidden>
      {children}
    </Chip>
  );
}

const noSubscribe = () => () => {};
/** HeroVideo's own rule: reduced motion or Save-Data never autoplays (it shows its ▶ "Play video"). */
function canAutoplay(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !window.matchMedia(MQ.reduce).matches && !c?.saveData;
}

/**
 * The hero's pause control. One control at a time: it shows only while the video really plays (or
 * after the user paused an autoplaying video, to resume it), never beside HeroVideo's own ▶ button,
 * and it leaves with the video once the stack has dropped out of sight (B90), back on reverse scroll.
 */
function PauseSlot() {
  const ink = useFilmFlag('pauseInk');
  const suspended = useFilmFlag('suspended');
  const playing = useFilmFlag('videoPlaying');
  const { paused } = usePause();
  const canAuto = useSyncExternalStore(noSubscribe, canAutoplay, () => false);
  const on = !suspended && (playing || (paused && canAuto));
  return (
    <div className={s.pauseWrap} data-off={on ? undefined : ''}>
      <PauseButton variant={ink ? 'ink' : 'cream'} kind="video" />
    </div>
  );
}

/** The hero media rig: the clip-path window, the scaled video and the front card's photo garnish. */
function HeroMedia() {
  const copy = useCopy();
  const suspended = useFilmFlag('suspended');
  const store = useContext(FilmStoreCtx);
  const onPlaying = useCallback((p: boolean) => store?.set({ videoPlaying: p }), [store]);
  return (
    <div className={s.rig} data-f="rig">
      <div className={s.clip} data-f="clip">
        <div className={s.inner} data-f="inner">
          <div className={s.settle} data-f="settle">
            <HeroVideo
              desktopSrc={HERO.desktop}
              mobileSrc={HERO.mobile}
              poster={HERO.poster}
              posterMobile={HERO.posterMobile}
              focus={HERO.focus}
              focusMobile={HERO.focusMobile}
              suspended={suspended}
              onPlayingChange={onPlaying}
              className={s.video}
            />
          </div>
        </div>
        <span className={s.scrim} data-f="scrim" aria-hidden="true" />
      </div>
      <div className={s.garnish} data-f="garnish" aria-hidden="true">
        <span className={s.gTopLeft}>
          <span className={`${s.gPill} ${s.gRec}`} data-f="rec">
            <span className={s.gRecDot} data-loop="" />
            {strip(copy.hero.frontCard.recPill)}
          </span>
          <span className={`${s.gPill} ${s.gWatch}`} data-f="watch">
            <PlayIcon size="0.95em" /> {strip(copy.hero.frontCard.watchPill)}
          </span>
        </span>
        <span className={s.gFeel}>“{FRONT.feelQuote}”</span>
        <span className={s.gTag}>{FRONT.cook}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ the hero alone (parent) */

/** The load settle: the video eases from 1.12 → 1 (VERO 4.3), on its own wrapper. */
function settleIn(root: HTMLElement) {
  const settle = root.querySelector<HTMLElement>('[data-f="settle"]');
  if (settle && motionOn()) gsap.fromTo(settle, { scale: 1.12 }, { scale: 1, duration: 1.6, ease: 'power2.out', clearProps: 'transform' });
}

/** /teach: the static hero only (one screen; the next section's sheet overlaps its last 40px). */
function HeroOnly() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [store] = useState<FilmStore>(createFilmStore);
  useGSAP(
    () => {
      if (rootRef.current) settleIn(rootRef.current);
    },
    { scope: rootRef },
  );
  return (
    <FilmStoreCtx.Provider value={store}>
      <div ref={rootRef} className={s.root}>
        <section id="top" className={s.hero} data-nav-tone="hero" data-f="hero" aria-labelledby="hero-h1">
          <HeroMedia />
          <div className={s.alt} role="img" aria-label={HERO.alt} />
          <HeroOverlay />
          <PauseSlot />
        </section>
      </div>
    </FilmStoreCtx.Provider>
  );
}

/* ------------------------------------------------------------------ the film */

export function DeckFilm() {
  return useAudience() === 'parent' ? <HeroOnly /> : <DeckFilmKid />;
}

function DeckFilmKid() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [store] = useState<FilmStore>(createFilmStore);
  const copy = useCopy();
  const { relation, explicit } = useRelation();
  const passH2 = fillPerson(copy.passDown.h2, explicit ? relation : DEFAULT_RELATION);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;

      // load: the video settles from 1.12 → 1 (VERO 4.3); a separate wrapper from the scrubbed one
      settleIn(root);

      const clipOK = typeof CSS !== 'undefined' && CSS.supports('clip-path', 'inset(0px round 1px)');
      const mm = gsap.matchMedia();
      const setup = (mobile: boolean) => () => {
        if (!clipOK || document.documentElement.dataset.motion !== 'on') return;
        root.classList.add(s.film);
        if (mobile) root.classList.add(s.filmMobile);
        store.set({ film: true, mobile });
        const els = collect(root, mobile);
        const kill = els ? buildFilm(els, { mobile, store }) : null;
        return () => {
          kill?.();
          root.classList.remove(s.film, s.filmMobile);
          store.set({ film: false, mobile: false, navHero: true, pauseInk: false, passChips: false, suspended: false });
        };
      };
      mm.add(MQ.desktop, setup(false));
      mm.add(MQ.mobile, setup(true));
      return () => mm.revert();
    },
    { scope: rootRef },
  );

  return (
    <FilmStoreCtx.Provider value={store}>
      {/* .root is also the stage's pin spacer (timeline.ts pinSpacer), so the stage never moves */}
      <div ref={rootRef} className={s.root}>
        <div className={s.stage} data-f="stage">
          <span className={s.stageBg} aria-hidden="true" />

          {/* ============ 8.1 hero ============ */}
          <section id="top" className={s.hero} data-nav-tone="hero" data-f="hero" aria-labelledby="hero-h1">
            <HeroMedia />
            <div className={s.alt} role="img" aria-label={HERO.alt} />
            <HeroOverlay />
            <PauseSlot />
          </section>

          {/* ============ 8.2 pass-down ============ */}
          <section id="pass-down" className={s.passDown} aria-labelledby="pass-down-h2">
            <span className={s.sheet} data-f="sheet" aria-hidden="true" />
            <div className={s.brandPos}>
              {/* what homecookd does, in the kid's words (Caleb, Oct 17: it moved here from the hero sub
                  and replaced the brand line); the cook is the picked relation, Mom by default */}
              <h2 id="pass-down-h2" className={`t-statement ${s.brand}`} data-f="brand" aria-label={passH2}>
                <Words text={passH2} accent={copy.passDown.accent} breakAfter={4} />
              </h2>
            </div>

            <div className={s.deck} aria-hidden="true">
              <span className={s.floor} data-f="floor" />
              {FAN.map((id, i) => {
                const r = getRecipe(id);
                const mi = FAN_MOBILE.indexOf(id);
                const front = id === FRONT.id;
                return (
                  <div
                    key={id}
                    className={s.card}
                    data-f="card"
                    data-card={id}
                    data-desktop=""
                    data-mobile={mi >= 0 ? '' : undefined}
                    data-front={front ? '' : undefined}
                    style={{ ...fanVars(i, FAN.length, mi, FAN_MOBILE.length), ['--i' as string]: i }}
                  >
                    {front ? (
                      <RecipeCard
                        recipe={r}
                        garnish={{ watch: true }}
                        preload
                        media={<Img src={r.image} alt="" fill sizes="(min-width: 1024px) 16vw, 34vw" preload />}
                      />
                    ) : (
                      <RecipeCard recipe={r} face={COOK_FACE.has(id) ? 'cook' : 'dish'} preload />
                    )}
                  </div>
                );
              })}
              <span className={`${s.passChip} ${s.passChipA}`} data-f="passChip">
                <span className={s.anchorBL}>
                  <FilmChip flag="passChips" tone="forest" tail="bl" rotate={-6} typing wobble>
                    {copy.passDown.chips[0]}
                  </FilmChip>
                </span>
              </span>
              <span className={`${s.passChip} ${s.passChipB}`} data-f="passChip">
                <span className={s.anchorBR}>
                  <FilmChip flag="passChips" tone="sun" tail="br" rotate={5} typing wobble delay={0.1}>
                    {copy.passDown.chips[1]}
                  </FilmChip>
                </span>
              </span>
            </div>

            <div className={s.footPos}>
              <div className={s.passFoot} data-f="passFoot">
                <p className={`t-lead ${s.passSub}`}>{copy.passDown.sub}</p>
                <div className={s.ctaRow}>
                  <Button href="#early-access" variant="primary" size="md" arrow>
                    {copy.passDown.cta}
                  </Button>
                  <a className={s.textLink} href="#how-it-works">
                    {copy.passDown.link}
                    <ArrowDownIcon size={18} />
                  </a>
                </div>
              </div>
            </div>

            <div className="sr-only">
              <p>{copy.passDown.deckListLabel}</p>
              <ul>
                {FAN.map((id) => (
                  <li key={id}>{possessive(getRecipe(id))}</li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </FilmStoreCtx.Provider>
  );
}

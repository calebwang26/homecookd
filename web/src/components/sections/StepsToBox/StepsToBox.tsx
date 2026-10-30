'use client';
// How it works → the family recipe box (brief 8.4–8.5). Ids: #how-it-works, #recipe-box.
//
// One DOM, three layouts (CSS decides; the DOM order is the reading order):
//   film     desktop ≥1024×600 with motion on: a 230vh track, text in the left column scrolling past a
//            sticky right stage. GSAP (timeline.ts) catches the stack dropped by DeckFilm, deals it into
//            stairs (three step cards + three photo-only cards), folds it into the folder grid and raises
//            the phone beside it; at 80% the decorative deck hands over to the interactive FolderGrid.
//   static   desktop with reduced motion / short screens / no JS: [text | step stairs] then [text | folder].
//   mobile   <1024: text, three step rows, text with the icon cluster, tabs + folder grid (2 columns on
//            phones so every dish name stays readable, 3 on tablets). No phone.
// The parent version (/teach) renders StepsPlain instead: no deck, no stairs, no fold (FEEDBACK-OCT16 C2).
import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { APP_CLIPS } from '@/content/media';
import { CardFan } from '@/components/motion/CardFan';
import { Reveal } from '@/components/motion/Reveal';
import { SplitWords } from '@/components/motion/SplitWords';
import { WordReveal } from '@/components/motion/WordReveal';
import { AppClip } from '@/components/primitives/AppClip';
import { Button } from '@/components/primitives/Button';
import { HandNote } from '@/components/primitives/HandNote';
import { KitchenClock } from '@/components/primitives/KitchenClock';
import { Handset } from '@/components/primitives/Handset';
import { Img } from '@/components/primitives/Img';
import { PotMascot } from '@/components/primitives/PotMascot';
import { Steam } from '@/components/primitives/Steam';
import { useLenis } from '@/components/providers/LenisProvider';
import { gsap, ScrollTrigger, useGSAP } from '@/lib/motion/gsap';
import { MQ } from '@/lib/motion/media';
import { BOX_CARD_SIZES, BOX_RECIPES, BoxCard, FolderGrid, FolderShell } from './FolderGrid';
import { IconCluster } from './IconCluster';
import { StepCard } from './StepCard';
import { StepsPlain } from './StepsPlain';
import { STAIRS_TL, STEP_CARD, TRAIL_W, buildFilm, queryFilmEls } from './timeline';
import s from './StepsToBox.module.css';

/** "three cooks so far. who's next?" → one line per sentence */
function NoteText({ text }: { text: string }) {
  return text.split(/(?<=[.?!])\s+/).map((line) => (
    <span key={line} className={s.noteLine}>
      {line}
    </span>
  ));
}

/** "How it works" → "How it <em>works</em>" (the eyebrow's last word takes the accent). */
function Eyebrow({ text }: { text: string }) {
  const i = text.lastIndexOf(' ');
  return (
    <p className="t-eyebrow">
      {text.slice(0, i + 1)}
      <em>{text.slice(i + 1)}</em>
    </p>
  );
}

/** CSS default pose of deck card i (the stairs), so the stage reads before GSAP takes over. */
function stairVars(i: number): CSSProperties {
  const [x, y] = STAIRS_TL[i];
  const step = i < 3;
  const w = step ? STEP_CARD.w : TRAIL_W;
  const halfH = step ? `${STEP_CARD.h / 2}vw` : `${(TRAIL_W / 0.9 / 2).toFixed(3)}vw`;
  return {
    ['--sx' as string]: `calc(${x + w / 2}vw + var(--stair-dx, 0px))`,
    ['--sy' as string]: `calc(${y}vh + ${halfH})`,
    ['--ss' as string]: step ? 1 : 0.96,
    zIndex: i + 1,
  };
}

export function StepsToBox() {
  return useAudience() === 'parent' ? <StepsPlain /> : <StepsToBoxKid />;
}

function StepsToBoxKid() {
  const copy = useCopy();
  const HOW = copy.howItWorks;
  const BOXC = copy.recipeBox;
  const H2_TEXT = HOW.h2Lines.join('\n');
  const rootRef = useRef<HTMLDivElement>(null);
  const stRef = useRef<ScrollTrigger | null>(null);
  const [boxOn, setBoxOn] = useState(false);
  const lenis = useLenis();

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const mm = gsap.matchMedia();

      mm.add(MQ.desktop, () => {
        if (document.documentElement.dataset.motion !== 'on') return;
        const els = queryFilmEls(root);
        if (!els) return;
        root.dataset.film = '';
        const { st, cleanup } = buildFilm(els, { onLive: setBoxOn });
        stRef.current = st;
        return () => {
          cleanup();
          stRef.current = null;
          delete root.dataset.film;
          setBoxOn(false);
        };
      });

      // Mobile: the H2 builds per word on enter (a7 M2). Everything else uses Reveal / WordReveal.
      mm.add(MQ.mobile, () => {
        if (document.documentElement.dataset.motion !== 'on') return;
        const words = root.querySelectorAll<HTMLElement>('[data-steps-h2] .w');
        gsap.fromTo(
          words,
          { autoAlpha: 0, y: '0.3em', color: '#D8CEBD' },
          {
            autoAlpha: 1,
            y: 0,
            color: (_i: number, el: HTMLElement) => (el.hasAttribute('data-accent') ? '#A3580C' : '#1F2430'),
            duration: 0.6,
            ease: 'power4.out',
            stagger: 0.09,
            clearProps: 'filter,color,visibility,opacity,transform',
            scrollTrigger: { trigger: root.querySelector('[data-steps-h2]'), start: 'top 80%', once: true },
          },
        );
      });
    },
    { scope: rootRef },
  );

  // A keyboard user tabbing into the folder while the deck still covers it: jump straight to the
  // hand-over (no smooth scroll: an animated scroll would fight the browser's own focus scroll and
  // leave the next focus stop off-screen) and finish the scrub, so the focused control is visible now.
  const jumpToBox = useCallback(() => {
    const st = stRef.current;
    if (!st) return;
    const y = st.start + (st.end - st.start) * 0.84;
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo(0, y);
    ScrollTrigger.update();
    st.getTween()?.progress(1);
  }, [lenis]);

  return (
    <div ref={rootRef} className={s.root} data-box={boxOn ? 'on' : undefined}>
      {/* ---------- 1. How it works (text) ---------- */}
      <div id="how-it-works" className={[s.block, s.block1].join(' ')}>
        <div className={s.blockInner}>
          <Reveal className={s.eyebrowRow} y={16}>
            <Eyebrow text={HOW.eyebrow} />
            <KitchenClock time={HOW.clock} className={s.clock} />
          </Reveal>
          <SplitWords
            as="h2"
            id="how-it-works-h2"
            className={['t-h2', s.h2, s.stepsH2].join(' ')}
            text={H2_TEXT}
            accent={HOW.h2Lines[1].split(' ')}
            accentStyle="color"
            rootProps={{ 'data-steps-h2': '' }}
          />
          <Reveal y={20} delay={0.1}>
            <p className={['t-body', s.body].join(' ')}>{HOW.body}</p>
          </Reveal>
          <Reveal y={16} delay={0.18} className={s.cta}>
            <Button href="#see-it-work" variant="soft" size="md">
              {HOW.pill}
            </Button>
          </Reveal>

          {/* film mode: the deck is decorative, so the steps live here for screen readers */}
          <ol className={['sr-only', s.srSteps].join(' ')}>
            {HOW.steps.map((st) => (
              <li key={st.numeral}>
                <h3>
                  {st.numeral}. {st.title}
                </h3>
                <p>
                  {'pill' in st ? st.pill : null}
                  {'moonChip' in st ? st.moonChip : null}
                  {'sticker' in st ? st.sticker.join(' ') : null}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* ---------- static desktop: the three step cards as stairs ---------- */}
      <div className={s.stairsStatic}>
        <CardFan
          recipes={BOX_RECIPES.slice(0, 3)}
          layout="stairs"
          floor={false}
          renderCard={(_r, i) => <StepCard index={i as 0 | 1 | 2} decorative={false} sizes="18vw" />}
        />
      </div>

      {/* ---------- mobile: three step rows ---------- */}
      <Reveal as="ol" className={s.rows} stagger={0.1} y={28}>
        {([0, 1, 2] as const).map((i) => (
          <li key={i} data-reveal-item="" className={s.rowItem}>
            <StepCard index={i} layout="row" decorative={false} />
            {i === 2 ? (
              <span className={s.rowMascot} aria-hidden="true">
                <PotMascot size={48} mood="happy" />
              </span>
            ) : null}
          </li>
        ))}
      </Reveal>

      {/* ---------- 2. The recipe box (text) ---------- */}
      <div id="recipe-box" className={[s.block, s.block2].join(' ')}>
        <div className={s.blockInner}>
          <Reveal className={s.eyebrowRow} y={16}>
            <Eyebrow text={BOXC.eyebrow} />
            <KitchenClock time={BOXC.clock} className={s.clock} />
          </Reveal>
          <IconCluster className={s.clusterPos} />
          <WordReveal as="h2" id="recipe-box-h2" className={['t-h2', s.h2].join(' ')} text={BOXC.h2} accent={BOXC.accent} />
          <Reveal y={20} delay={0.1}>
            <p className={['t-body', s.body].join(' ')}>{BOXC.body}</p>
          </Reveal>
          <Reveal y={12} delay={0.25} className={s.noteWrap}>
            <HandNote arrow="right" tone="green" rotate={-3} className={s.noteRight}>
              <NoteText text={BOXC.note} />
            </HandNote>
            <HandNote arrow="down" tone="green" rotate={-3} className={s.noteDown}>
              <NoteText text={BOXC.note} />
            </HandNote>
          </Reveal>
        </div>
      </div>

      {/* ---------- the stage (film: sticky; otherwise its children join the flow) ---------- */}
      <div className={s.stage} data-stage="">
        <div className={s.deck} data-film-deck="" aria-hidden="true">
          <FolderShell className={[s.folder, s.shell].join(' ')} />
          <div className={s.drift} data-drift="">
            {BOX_RECIPES.map((r, i) => (
              <div key={r.id} className={s.deckCard} data-film-card={r.id} style={stairVars(i)}>
                {i < 3 ? (
                  <>
                    <div className={[s.face, s.front].join(' ')} data-face="front">
                      <StepCard index={i as 0 | 1 | 2} sizes="18vw" />
                    </div>
                    <div className={[s.face, s.backFace].join(' ')} data-face="back">
                      <BoxCard recipe={r} />
                    </div>
                  </>
                ) : (
                  <>
                    <div className={s.face}>
                      <BoxCard recipe={r} />
                    </div>
                    {/* photo-only while on the stairs (a7 M13); the timeline fades it in and out */}
                    <div
                      className={[s.face, s.photoFace].join(' ')}
                      data-photo-face=""
                      style={{ ['--tint-bg' as string]: `var(--tint-${r.tint}-bg)` }}
                    >
                      <span className={s.photoBox}>
                        <Img src={r.image} alt="" fill sizes={BOX_CARD_SIZES} className={s.photoImg} />
                      </span>
                    </div>
                  </>
                )}
              </div>
            ))}
            <span className={s.mascot} data-mascot="">
              <PotMascot size={64} mood="happy" />
            </span>
            <span className={s.puff} data-puff="">
              <Steam size={44} color="cocoa" still />
            </span>
          </div>
        </div>

        <FolderGrid labelledBy="recipe-box-h2" live={boxOn} onHiddenFocus={jumpToBox} className={[s.folder, s.liveFolder].join(' ')} />

        <div className={s.phone} data-phone="">
          <Handset width="100%">
            <AppClip name="app-library" playWhenVisible label={APP_CLIPS['app-library'].label} />
          </Handset>
        </div>
      </div>
    </div>
  );
}

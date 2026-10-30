'use client';
// Far apart: send it home, get one back (brief 8.9). Canvas breather between the sun block and the
// chartreuse band.
//
// Desktop film (≥1024×600, motion on): StickyStage, 170vh track = 70vh of held stage. The two photo
// cards rise in with the scroll (top 80% → top top). Then, scrubbed: Grandma's recipe card lifts off
// her card and arcs over to the kid's kitchen ("Delivered ✓"), a first-try photo pops up and arcs
// back, it lands ("Delivered · Grandma ♥"), and she answers in her own words.
// Mobile / tablet / short desktop: the same story, time-based, once, at ≥ 50% visible.
// Phones (< 768): the photos stay clean (only the recipe lands on his counter); "Delivered ✓", his
// photo reply and her answer become a short chat thread under the captions (his side left, hers right).
// SSR, reduced motion, no JS: the finished scene (CSS default positions are the final ones).
// Parent version (/teach, FEEDBACK-OCT16 C2): no flight and no hold. The finished scene from the
// start (beat 3), one screen on desktop (a 100vh track: nothing pins), and the H2 and the photo row
// fade up once as they enter.
//
// Engines: GSAP moves the travelers' outer wrappers and the cards; motion pops the chips (inside
// Chip). Never both on one element.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { animate, inView } from 'motion';
import { copy } from '@/content/copy';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { getRecipe, cardTitle } from '@/content/recipes';
import { PHOTOS } from '@/content/media';
import { gsap, ScrollTrigger, useGSAP } from '@/lib/motion/gsap';
import { MQ, MQ_PHONE, MQ_SHORT_DESKTOP } from '@/lib/motion/media';
import { SCRUB } from '@/lib/motion/tokens';
import { useFill } from '@/components/providers/RelationProvider';
import { StickyStage } from '@/components/motion/StickyStage';
import { WordReveal } from '@/components/motion/WordReveal';
import { PlainHeading } from '@/components/sections/SeeItWork/PlainHeading';
import { Chip } from '@/components/primitives/Chip';
import { Img } from '@/components/primitives/Img';
import { KitchenClock } from '@/components/primitives/KitchenClock';
import { Pill } from '@/components/primitives/Pill';
import { EggMascot } from '@/components/primitives/EggMascot';
import { RecipeCard } from '@/components/primitives/RecipeCard';
import { CameraIcon } from '@/components/icons/Icons';
import { along, beatAt, FILM, FINAL_BEAT, inOut, lerp, measureFlight, span, type Beat, type Flight } from './scene';
import s from './FarApart.module.css';

// the card that flies is data (the same recipe in both versions); its words come from useCopy
const ARC = getRecipe(copy.farApart.arcRecipeId);

/** Split a trailing "♥" off so it can be colored on its own. */
function withHeart(str: string) {
  const m = /^(.*?)\s*♥\s*$/.exec(str);
  return m ? { text: m[1], heart: true } : { text: str, heart: false };
}


const isPhone = () => window.matchMedia(MQ_PHONE).matches;
const subscribePhone = (cb: () => void) => {
  const m = window.matchMedia(MQ_PHONE);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
/** Phone layout (chat thread); false on the server and during hydration. */
const usePhone = () => useSyncExternalStore(subscribePhone, isPhone, () => false);

const STILL: Flight = { from: { x: 0, y: 0 }, ctrl: { x: 0, y: 0 } };

export function FarApart() {
  const t = useCopy().farApart;
  const parent = useAudience() === 'parent';
  const ANSWER: string = (t.answer as Record<string, string>)[ARC.id] ?? Object.values(t.answer)[0];
  /** Body copy as sentences, so desktop can break the line between them. */
  const BODY = t.body.split(/(?<=\.)\s+/);
  /** The landed status names the card's own cook (never {R}: the photo is always the arc recipe's cook). */
  const DELIVERED_TO = t.deliveredTo.replace('{R}', ARC.cook);
  const f = useFill();
  const phone = usePhone();
  const [beat, setBeatState] = useState<Beat>(0);
  const beatRef = useRef<Beat>(0);
  const setBeat = useCallback((b: Beat) => {
    if (beatRef.current === b) return;
    beatRef.current = b;
    setBeatState(b);
  }, []);

  const rootRef = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const q = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
      const qa = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
      const overlay = q('[data-overlay]');
      const arcOuter = q('[data-arc]');
      const arcInner = q('[data-arc-inner]');
      const arcFrom = q('[data-arc-from]');
      const reply = q('[data-reply]');
      const replyFrom = q('[data-reply-from]');
      if (!overlay || !arcOuter || !arcInner || !arcFrom || !reply || !replyFrom) return;

      const motionOn = document.documentElement.dataset.motion === 'on';

      if (parent) {
        // the finished scene, no flight; the photo row fades up once (reduced motion: just there)
        setBeat(FINAL_BEAT);
        const row = q('[data-row]');
        if (!motionOn || window.matchMedia(MQ.reduce).matches || !row) return;
        gsap.from(row, {
          y: 24,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: { trigger: row, start: 'top 85%', once: true },
        });
        return;
      }

      const mm = gsap.matchMedia();

      // ---------- shared flight state ----------
      let arcFlight: Flight = STILL;
      let replyFlight: Flight = STILL;
      // phones: the reply sits in the chat thread under the captions and simply pops (no flight)
      let replyStill = false;
      const measure = (arcLift: number, replyLift: number) => {
        arcFlight = measureFlight(arcOuter, arcFrom, arcLift);
        replyStill = isPhone();
        replyFlight = replyStill ? STILL : measureFlight(reply, replyFrom, replyLift);
      };
      // quickSetter has no 'scale' shorthand: it falls through to setAttribute('scaleX,scaleY'),
      // which Safari rejects and the error takes down the whole page. Set the two axes instead.
      const scX = gsap.quickSetter(arcInner, 'scaleX');
      const scY = gsap.quickSetter(arcInner, 'scaleY');
      const arcSet = {
        x: gsap.quickSetter(arcInner, 'x', 'px'),
        y: gsap.quickSetter(arcInner, 'y', 'px'),
        r: gsap.quickSetter(arcInner, 'rotation', 'deg'),
        sc: (v: number) => {
          scX(v);
          scY(v);
        },
      };
      const replySet = {
        x: gsap.quickSetter(reply, 'x', 'px'),
        y: gsap.quickSetter(reply, 'y', 'px'),
        r: gsap.quickSetter(reply, 'rotation', 'deg'),
      };
      let flyingNow = false;
      /** k: 0 = resting on the cook's card, 1 = landed far from home */
      const poseArc = (k: number) => {
        const e = inOut(k);
        const p = along(arcFlight, e);
        arcSet.x(p.x);
        arcSet.y(p.y);
        arcSet.r(lerp(-6, 5, e));
        // lifts a touch above its resting size mid-flight, then settles
        arcSet.sc(lerp(0.9, 1, e) + 0.06 * Math.sin(Math.PI * e));
        const flying = k > 0.02 && k < 0.98;
        if (flying !== flyingNow) {
          flyingNow = flying;
          if (flying) arcOuter.dataset.flying = '';
          else delete arcOuter.dataset.flying;
        }
      };
      const poseReply = (k: number) => {
        const e = inOut(k);
        const p = along(replyFlight, e);
        replySet.x(p.x);
        replySet.y(p.y);
        replySet.r(replyStill ? 0 : -5 * Math.sin(Math.PI * e));
      };
      const reset = () => {
        gsap.set([arcInner, reply], { clearProps: 'transform' });
        delete arcOuter.dataset.flying;
        flyingNow = false;
      };

      if (!motionOn) {
        setBeat(FINAL_BEAT);
        return;
      }

      // ---------- desktop film ----------
      mm.add(MQ.desktop, () => {
        const track = q<HTMLDivElement>('[data-sticky-track]');
        const vh = () => window.innerHeight / 100;
        let progress = 0;
        const render = () => {
          poseArc(span(progress, FILM.arc));
          poseReply(span(progress, FILM.reply));
          setBeat(beatAt(progress));
        };
        const remeasure = () => {
          gsap.set([arcInner, reply], { x: 0, y: 0 });
          // the reply arcs up over the cards' top edge, clear of both faces
          measure(24 * vh(), 24 * vh());
          render();
        };
        remeasure();

        // the photo cards rise in with the page (a7 M23); the recipe rests on the cook's card, so it rides with it
        const left = qa('[data-side="left"]');
        const right = [...qa('[data-side="right"]'), arcOuter];
        const rise = gsap.timeline({
          defaults: { ease: 'power1.out' },
          scrollTrigger: { trigger: track, start: 'top 80%', end: 'top top', scrub: SCRUB, invalidateOnRefresh: true },
        });
        rise.fromTo(left, { y: () => 10 * vh() }, { y: 0 }, 0).fromTo(right, { y: () => 17 * vh() }, { y: 0 }, 0);

        const film = gsap.timeline({
          scrollTrigger: {
            trigger: track,
            start: 'top top',
            end: 'bottom bottom',
            scrub: SCRUB,
            invalidateOnRefresh: true,
            onRefresh: remeasure,
            // will-change only while the scene is on screen (brief 11)
            onToggle: (self) => root.toggleAttribute('data-active', self.isActive),
          },
          onUpdate() {
            progress = this.progress();
            render();
          },
        });
        film.to({}, { duration: 1, ease: 'none' });

        return () => {
          reset();
          setBeat(0);
        };
      });

      // ---------- mobile, tablet, short desktop: time-based, once ----------
      mm.add(`${MQ.mobile}, ${MQ_SHORT_DESKTOP}`, () => {
        const vw = () => window.innerWidth / 100;
        const k = { arc: 0, reply: 0 };
        const remeasure = () => {
          gsap.set([arcInner, reply], { x: 0, y: 0 });
          measure(16 * vw(), 12 * vw());
          poseArc(k.arc);
          poseReply(k.reply);
        };
        remeasure();
        const onResize = () => remeasure();
        ScrollTrigger.addEventListener('refresh', onResize);

        const media = qa('[data-media]');
        gsap.from(media, {
          y: 32,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
          stagger: 0.08,
          // (the overlay has no box on phones: display: contents)
          scrollTrigger: { trigger: media[0], start: 'top 88%', once: true },
        });

        const tl = gsap.timeline({ paused: true });
        tl.to(k, { arc: 1, duration: 1.2, ease: 'none', onUpdate: () => poseArc(k.arc) }, 0.15)
          .call(() => setBeat(1))
          .call(() => setBeat(2), [], '+=0.3')
          .to(k, { reply: 1, duration: 1.0, ease: 'none', onUpdate: () => poseReply(k.reply) }, '<+0.3')
          .call(() => setBeat(3));

        // phones: start once the thread is half in view, so the photos (above it) and the thread are both on screen
        const stop = inView(
          isPhone() ? reply : overlay,
          () => {
            stop();
            tl.play();
          },
          { amount: 0.5 },
        );

        return () => {
          stop();
          tl.kill();
          ScrollTrigger.removeEventListener('refresh', onResize);
          reset();
          setBeat(0);
        };
      });

      // ---------- reduced motion (live switch): the finished scene ----------
      mm.add(MQ.reduce, () => {
        reset();
        setBeat(FINAL_BEAT);
      });
    },
    { scope: rootRef },
  );

  // the pot on the cook's card does a small happy hop when the photo lands (motion, its own element)
  useEffect(() => {
    if (beat < 3 || parent) return;
    const el = rootRef.current?.querySelector<HTMLElement>('[data-mascot]');
    if (!el || document.documentElement.dataset.motion !== 'on' || window.matchMedia(MQ.reduce).matches) return;
    const a = animate(el, { y: [0, -12, 0], rotate: [0, -6, 0] }, { duration: 0.6, ease: [0.34, 1.4, 0.64, 1], delay: 0.2 });
    return () => a.stop();
  }, [beat, parent]);

  const answer = withHeart(ANSWER);
  // screen readers get the story the decorative layer tells
  const srStory = t.srStory
    .replace('{title}', cardTitle(ARC))
    .replaceAll('{cook}', ARC.cook)
    .replace('{reply}', t.reply.text)
    .replace('{answer}', answer.text);

  return (
    <section ref={rootRef} id="far-apart" className={s.section} aria-labelledby="far-apart-h2" data-beat={beat}>
      <StickyStage
        // parent: the track is the stage's own height, so nothing holds
        trackVh={{ desktop: parent ? 100 : 170 }}
        stage={
          <div className={s.inner}>
            <header className={s.head}>
              {parent ? (
                <PlainHeading id="far-apart-h2" className={`t-statement ${s.h2}`} text={t.h2} accent={t.accent} />
              ) : (
                <WordReveal as="h2" id="far-apart-h2" className={`t-statement ${s.h2}`} text={t.h2} accent={t.accent} />
              )}
              {t.body ? (
                <p className={`t-lead ${s.body}`}>
                  {BODY.map((line, i) => (
                    <span key={i} className={s.bodyLine}>
                      {line}
                      {i < BODY.length - 1 ? ' ' : null}
                    </span>
                  ))}
                </p>
              ) : null}
            </header>

            <div className={s.row} data-row="">
              {/* ---- left: far from home ---- */}
              <div className={s.card}>
                <div className={s.media} data-media="" data-side="left">
                  <div className={s.photo}>
                    <Img
                      src={PHOTOS.youngAdultNight.src}
                      alt={t.left.imageAlt}
                      fill
                      sizes="(min-width: 1024px) 41vw, 44vw"
                      focus={PHOTOS.youngAdultNight.focus}
                      className={s.img}
                    />
                    <span className={s.scrim} aria-hidden="true" />
                  </div>
                </div>
                <div className={s.caption} data-side="left">
                  <KitchenClock time={t.left.clock} tone="cream" className={s.clock} />
                  <h3 className={`t-h3 ${s.h3}`}>{t.left.title}</h3>
                  <Pill tone="outlineCream" className={s.capPill}>
                    {t.left.pill}
                  </Pill>
                </div>
              </div>

              {/* ---- right: a quieter kitchen ---- */}
              <div className={s.card}>
                <div className={`${s.media} ${s.mediaRight}`} data-media="" data-side="right">
                  <div className={s.photo}>
                    <Img
                      src={PHOTOS.parentPhoneCall.src}
                      alt={t.right.imageAlt}
                      fill
                      sizes="(min-width: 1024px) 41vw, 44vw"
                      className={`${s.img} ${s.imgRight}`}
                    />
                    <span className={s.scrim} aria-hidden="true" />
                  </div>
                  <span className={s.mascot} aria-hidden="true" data-mascot="">
                    <EggMascot size={88} mood={beat >= 3 ? 'made-it' : 'hello'} className={s.mascotSvg} />
                  </span>
                </div>
                <div className={`${s.caption} ${s.captionRight}`} data-side="right">
                  <h3 className={`t-h3 ${s.h3}`}>{t.right.title}</h3>
                  <Pill tone="outlineCream" className={s.capPill}>
                    {t.right.pill}
                  </Pill>
                </div>
              </div>

              {/* ---- the travelers and chips (decorative; srStory tells the same story). Each child is
                   aria-hidden too: on phones the overlay is display: contents. ---- */}
              <div className={s.overlay} data-overlay="" aria-hidden="true">
                <span className={s.arcFrom} data-arc-from="" />
                <span className={s.replyFrom} data-reply-from="" />

                <div className={s.arc} data-arc="" aria-hidden="true">
                  <div className={s.arcInner} data-arc-inner="">
                    <RecipeCard recipe={ARC} imageSizes="(min-width: 1024px) 14vw, 24vw" className={s.arcCard} />
                    <span className={s.arcCaption}>
                      <Pill tone="white85">
                        {f(t.arcCaption, { cook: ARC.cook })}
                      </Pill>
                    </span>
                  </div>
                </div>

                <div className={s.delivered} data-chip="delivered" aria-hidden="true">
                  <Chip tone="green" tail="br" shown={beat >= 1} rotate={-4}>
                    {t.delivered}
                  </Chip>
                </div>

                <div className={s.reply} data-reply="" aria-hidden="true">
                  <Chip tone="cream" tail="bl" shown={beat >= 2} className={s.replyChip} phaseKey="reply">
                    <span className={s.thumb}>
                      <Img src={ARC.image} alt="" fill sizes="64px" className={s.img} />
                      <span className={s.cam}>
                        <CameraIcon size={14} stroke={2} />
                      </span>
                    </span>
                    <span className={s.replyText}>
                      <span>{t.reply.text}</span>
                      <span className={s.replyTime}>{t.reply.time}</span>
                    </span>
                  </Chip>
                  {/* status under the photo, like a message app's "Delivered" */}
                  <div className={s.deliveredTo} data-chip="delivered-to">
                    <Chip tone="tomato" tail={null} shown={beat >= 3} rotate={3} delay={0.05}>
                      {DELIVERED_TO}
                    </Chip>
                  </div>
                </div>

                <div className={s.answer} data-chip="answer" aria-hidden="true">
                  <Chip tone="cream" tail={phone ? 'br' : 'bl'} shown={beat >= 3} typing delay={0.35} rotate={-2} className={s.answerChip} phaseKey="answer">
                    <span className={`t-cook ${s.answerText}`}>
                      {answer.text}
                      {answer.heart ? <span className={s.heart}> ♥</span> : null}
                    </span>
                  </Chip>
                </div>
              </div>
            </div>

            <p className="sr-only">{srStory}</p>
          </div>
        }
      />
    </section>
  );
}

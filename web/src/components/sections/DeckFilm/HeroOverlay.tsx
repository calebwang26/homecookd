'use client';
// Hero copy (brief 8.1): the huge H1 "Cook it like {Grandma} does." anchored bottom-left (a2 Savor),
// a right column with the chartreuse CTA and the switch to the other version. No sub, no beats, no
// "See it work" link and no chips (Caleb, Oct 17 and 18: too much in the hero).
//
// Load (VERO 4.3), CSS only (DeckFilm.module.css `.rise`, `[data-hero-item]`): each H1 line grows up
// from its baseline, the relation word's highlighter draws in, and the CTA, switch and link fade
// up from y 16 (80ms stagger). Nothing waits for hydration, so the H1 and the lead paint on the first
// frame (LCP) and no later, larger text element replaces them. The word rotates every 3s through
// copy.hero.rotation (kid version: Mom → Dad → Grandma → Grandpa; parent version: who they cook for),
// looping while the hero is on screen; never while the user pauses or motion is reduced. A picked
// relation (picker, ?for=, storage) puts its word (copy.hero.explicitWord) on screen and the loop
// stops there for good (QA B22: after picking Dad, the page never rotates back to Grandma). The h1's
// aria-label follows the word on screen only when it's picked. The highlighter width and the last
// word FLIP between words with transforms only.
//
// Parent version: a fixed H1 instead (copy.hero.h1Fixed, "Record it once. / They'll cook it /
// forever."), one rising line each, the accent on the same highlighter drawn in once; no rotation.
// Both versions carry a second button under the CTA to the other version (switchHref: a plain link,
// so it works before hydration; the pick rides in the URL).
//
// Kid version (QA B18): the main button is "Send this to {R}" (the page's one job is getting a parent
// to film), and "Get early access" is the text link under the switch. Sending opens the share sheet,
// else shows "Copied." with the link (useSend, StickySend/SendPanel). No motion imports here: this is
// a first-screen file (FEEDBACK-OCT16 E).
import { motionNow } from '@/lib/motion/lazy';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { LetterArc } from '@/components/motion/LetterArc';
import { Button } from '@/components/primitives/Button';
import { ShareGlyph } from '@/components/icons/Icons';
import { useSend } from '@/components/chrome/StickySend/SendPanel';
import { useRelation } from '@/components/providers/RelationProvider';
import { fill } from '@/lib/relation';
import { logTap, switchHref } from '@/lib/audience-route';
import { usePause } from '@/components/providers/PauseProvider';
import { useMotionOK } from '@/components/providers/MotionProvider';
import { EASE } from '@/lib/motion/tokens';
import s from './DeckFilm.module.css';

const SWAP_MS = 3000;
// The word change itself is slow and soft: letters unfurl over ~1.4s, the highlighter and "does."
// glide over 1s, and the outgoing word fades over 0.6s (.rotPrev).
const ARC_SLOW = 2;
const ARC_STAGGER = 0.06;
const FLIP_S = 1;
const PREV_MS = 650;

function motionOn(): boolean {
  return document.documentElement.dataset.motion === 'on' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface WordState {
  word: string;
  n: number;
  prev: string | null;
  variant: 'grow' | 'arc';
}

function RotatingWord({ doesRef }: { doesRef: RefObject<HTMLSpanElement | null> }) {
  const copy = useCopy();
  const { relation, explicit } = useRelation();
  const rotation = copy.hero.rotation;
  const pickedWord = fill(copy.hero.explicitWord, relation);
  const { paused } = usePause();
  const motionOK = useMotionOK();
  const [st, setSt] = useState<WordState>({ word: copy.hero.relationDefault, n: 0, prev: null, variant: 'grow' });
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bgRef = useRef<HTMLSpanElement>(null);
  const before = useRef<{ w: number; x: number } | null>(null);
  // the rotation word the loop shows next (the first one is already on screen)
  const next = useRef(1);
  const bornAt = useRef(0);
  const current = useRef(st.word);

  const swap = (next: string) => {
    if (current.current === next) return;
    const wrap = wrapRef.current;
    const does = doesRef.current;
    if (wrap && does) before.current = { w: wrap.getBoundingClientRect().width, x: does.getBoundingClientRect().left };
    // a swap right after load (e.g. ?for=dad) keeps the load "grow" instead of an arc
    const early = performance.now() - bornAt.current < 900;
    const prevWord = current.current;
    current.current = next;
    setSt((cur) => ({ word: next, n: cur.n + 1, prev: early ? null : prevWord, variant: early ? 'grow' : 'arc' }));
  };
  const swapRef = useRef(swap);
  useEffect(() => {
    swapRef.current = swap;
  });

  // (the highlighter's load draw-in is CSS)
  useEffect(() => {
    bornAt.current = performance.now();
  }, []);

  // a picked relation (picker, ?for=, storage) shows its word and holds it (no more rotation)
  useEffect(() => {
    if (explicit) swapRef.current(pickedWord);
  }, [explicit, pickedWord]);

  // rotate every 3s, looping, while the hero is on screen and nothing is picked (the pause button
  // stops it: WCAG 2.2.2)
  useEffect(() => {
    if (paused || !motionOK || explicit) return;
    const id = window.setInterval(() => {
      if (window.scrollY > window.innerHeight * 0.6) return; // scrolled past the hero: hold the word
      swapRef.current(rotation[next.current % rotation.length]);
      next.current += 1;
    }, SWAP_MS);
    return () => window.clearInterval(id);
  }, [paused, motionOK, rotation, explicit]);

  // FLIP the highlighter width and "does." between words (transform only)
  useLayoutEffect(() => {
    const b = before.current;
    before.current = null;
    const wrap = wrapRef.current;
    const does = doesRef.current;
    const bg = bgRef.current;
    const animate = motionNow()?.animate; // loaded long before the first swap (3s); else no FLIP
    if (!b || !wrap || !does || !bg || !motionOn() || !animate) return;
    const w = wrap.getBoundingClientRect().width;
    const x = does.getBoundingClientRect().left;
    if (w > 0) animate(bg, { scaleX: [b.w / w, 1] }, { duration: FLIP_S, ease: EASE.soft });
    if (Math.abs(b.x - x) > 0.5) animate(does, { x: [b.x - x, 0] }, { duration: FLIP_S, ease: EASE.soft });
  }, [st.n, doesRef]);

  // clear the fading outgoing word
  useEffect(() => {
    if (!st.prev) return;
    const id = window.setTimeout(() => setSt((cur) => (cur.prev ? { ...cur, prev: null } : cur)), PREV_MS);
    return () => window.clearTimeout(id);
  }, [st.prev, st.n]);

  return (
    <span ref={wrapRef} className={s.rot} aria-hidden="true">
      <span ref={bgRef} className={s.rotBg} />
      <em className={s.rotWord}>
        {st.n === 0 ? (
          // the server-rendered word rises with its line (CSS); later words unfurl (LetterArc)
          <span className={s.rise} style={rise(60)}>
            {st.word}
          </span>
        ) : (
          <LetterArc
            key={st.n}
            as="span"
            variant={st.variant}
            trigger="load"
            stagger={st.variant === 'arc' ? ARC_STAGGER : undefined}
            slow={st.variant === 'arc' ? ARC_SLOW : 1}
            text={st.word}
            decorative
          />
        )}
      </em>
      {st.prev ? (
        <em key={`p${st.n}`} className={s.rotPrev}>
          {st.prev}
        </em>
      ) : null}
    </span>
  );
}

/** CSS entrance delay for a `.rise` line (ms) */
const rise = (ms: number) => ({ ['--rise-d' as string]: `${ms}ms` }) as CSSProperties;

/** The fixed H1's lines (split on \n); `accent` sits on the highlighter where it appears. */
function FixedLines({ text, accent }: { text: string; accent: string }) {
  return text.split('\n').map((line, i) => {
    const at = accent ? line.indexOf(accent) : -1;
    const word = (t: string) => (
      <span className={s.rise} style={rise(i * 60)}>
        {t}
      </span>
    );
    return (
      <span key={i} className={s.h1Line} aria-hidden="true">
        {at < 0 ? (
          word(line)
        ) : (
          <>
            {at > 0 ? word(line.slice(0, at)) : null}
            <span className={s.rot}>
              <span className={s.rotBg} />
              <em className={s.rotWord}>{word(accent)}</em>
            </span>
            {at + accent.length < line.length ? word(line.slice(at + accent.length)) : null}
          </>
        )}{' '}
      </span>
    );
  });
}

export function HeroOverlay() {
  const copy = useCopy();
  const audience = useAudience();
  const fixed = copy.hero.h1Fixed;
  const { relation, explicit } = useRelation();
  const doesRef = useRef<HTMLSpanElement>(null);
  const h1Word = explicit ? fill(copy.hero.explicitWord, relation) : copy.hero.relationDefault;
  const h1Label = fixed ? fixed.split('\n').join(' ') : `${copy.hero.h1Before} ${h1Word} ${copy.hero.h1After}`;
  const kid = audience === 'kid';
  const { send, panel } = useSend('send');

  return (
    <div className={s.overlay} data-f="overlay" data-theme="dark">
      <h1 id="hero-h1" className={`t-hero ${s.h1}${fixed ? ` ${s.h1Fixed}` : ''}`} aria-label={h1Label}>
        {fixed ? (
          <FixedLines text={fixed} accent={copy.hero.h1Accent} />
        ) : (
          <>
            <span className={s.h1Line} aria-hidden="true">
              <span className={s.rise}>{copy.hero.h1Before}</span>
            </span>{' '}
            <span className={s.h1Line} aria-hidden="true">
              <RotatingWord doesRef={doesRef} />{' '}
              <span ref={doesRef} className={s.does}>
                <span className={s.rise} style={rise(120)}>
                  {copy.hero.h1After}
                </span>
              </span>
            </span>
          </>
        )}
      </h1>

      <div className={s.side}>
        {/* no sub, no beats (Caleb, Oct 17: the hero said too much): the headline, the CTA and the
            switch; the kid page's "what it does" line is the pass-down heading right below */}
        <div className={s.ctaWrap} data-hero-item="">
          {kid ? (
            <Button variant="hero" size="lg" className={s.heroCta} onClick={send} icon={<ShareGlyph name="message" size={22} />}>
              {fill(copy.finalCta.shareButton, relation)}
            </Button>
          ) : (
            <Button href="#early-access" variant="hero" size="lg" arrow className={s.heroCta} onClick={() => logTap(audience, 'cta')}>
              {copy.hero.cta}
            </Button>
          )}
        </div>
        <div className={s.switchWrap} data-hero-item="">
          <Button
            href={switchHref(audience === 'parent' ? 'kid' : 'parent', 'hero')}
            variant="outlineCream"
            size="md"
            arrow
            className={s.switchBtn}
          >
            {copy.hero.switchLabel}
            <span className="sr-only"> {copy.hero.switchSr}</span>
          </Button>
        </div>
        {kid ? (
          <a className={`${s.seeLink} ${s.ctaLink}`} href="#early-access" data-hero-item="" onClick={() => logTap(audience, 'cta')}>
            <span className={s.seeLabel}>{copy.hero.cta}</span>
          </a>
        ) : null}
      </div>
      {kid ? panel : null}
    </div>
  );
}

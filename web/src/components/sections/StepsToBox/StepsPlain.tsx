'use client';
// How it works, parent version (/ and /teach, FEEDBACK-OCT16 C2). Id: #how-it-works.
//
//   screen 2  one bold H2 that says what homecookd does, the three steps beside it (stacked below it
//             on phones and tablets): photo, numeral, a few words each, set as a staircase
//
// The H2 is the home page's explainer, so it reads right for a cook and a kid alike (Caleb, Oct 17):
// "{Mom} / films themselves cooking. We turn it into a recipe the whole family can follow, 900 miles
// away." The cook sits alone on line 1 and rotates Mom → Dad → Grandma → Grandpa (a slow cross-fade:
// the old name fades up and out while the new one rises in) until a role is picked in "Cooking as".
// Only that line changes, so the rest of the heading never moves. Once a role is picked, it holds and
// reads "Dad films himself cooking." ({herself}; "themselves" only while it rotates, QA B22).
//
// Motion: the H2's words fill ghost → ink as it scrolls up the screen (the kid page's scrubbed word
// fill, src/lib/motion/wordFill.ts); the steps fade up once (Reveal). Reduced motion or no JS: the
// final colors, no rotation. No card motion here (no deck, stairs film, fan or fold).
// The family table that used to follow it is its own section now, after the app demo
// (FamilyTable.tsx, FEEDBACK-OCT16b 3).
import { useEffect, useRef, useState } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { usePause } from '@/components/providers/PauseProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { Reveal } from '@/components/motion/Reveal';
import { splitText } from '@/components/motion/SplitWords';
import { gsap, useGSAP } from '@/lib/motion/gsap';
import { MQ } from '@/lib/motion/media';
import { SCRUB } from '@/lib/motion/tokens';
import { addWordFill } from '@/lib/motion/wordFill';
import { fillPerson, type Relation } from '@/lib/relation';
import { StepCard } from './StepCard';
import s from './StepsPlain.module.css';

/** who films it, in turn, until a role is picked */
const CYCLE: readonly Relation[] = ['mom', 'dad', 'grandma', 'grandpa'];
const HOLD_MS = 2400;

const motionOn = () =>
  document.documentElement.dataset.motion === 'on' && !window.matchMedia(MQ.reduce).matches;

export function StepsPlain() {
  const copy = useCopy();
  const HOW = copy.howItWorks;
  const { relation, explicit } = useRelation();
  const { paused } = usePause();
  const headRef = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [visible, setVisible] = useState(false);

  const rel = explicit ? relation : CYCLE[i];
  const name = fillPerson(HOW.h2Lines[0], rel); // "Mom"
  // "themselves" while the cook rotates, "himself" / "herself" once a role is picked
  const line2 = explicit ? HOW.h2Lines[1] : HOW.h2Lines[1].split('{herself}').join(HOW.themselves);
  const rest = fillPerson(`${line2} ${HOW.h2Lines[2]}`, rel);
  const words = splitText(rest, HOW.h2Lines[2].split(' '))[0];
  // the name on screen, and the one leaving (it cross-fades out over the new one); adjusted during
  // render when the name changes, per the React docs
  const [cur, setCur] = useState({ name, key: 0 });
  const [prev, setPrev] = useState<{ name: string; key: number } | null>(null);
  if (cur.name !== name) {
    setPrev(cur);
    setCur({ name, key: cur.key + 1 });
  }

  // rotate only while on screen, unpaused, with motion, and no role picked
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (explicit || paused || !visible || !motionOn()) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % CYCLE.length), HOLD_MS);
    return () => window.clearInterval(t);
  }, [explicit, paused, visible]);

  // scrubbed word fill as the heading rises from the bottom of the screen to its upper third
  useGSAP(
    () => {
      const head = headRef.current;
      if (!head || !motionOn()) return;
      const mm = gsap.matchMedia();
      mm.add(`${MQ.desktop}, ${MQ.mobile}`, () => {
        const h2 = head.querySelector('h2');
        if (!h2) return;
        const tl = gsap.timeline({
          defaults: { ease: 'none' },
          scrollTrigger: { trigger: h2, start: 'top 85%', end: 'top 35%', scrub: SCRUB, invalidateOnRefresh: true },
        });
        addWordFill(tl, h2, { at: 0, span: 100 });
      });
      return () => mm.revert();
    },
    { scope: headRef },
  );

  return (
    <div className={s.root}>
      <section id="how-it-works" className={s.how} aria-labelledby="how-it-works-h2">
        <div ref={headRef} className={s.howHead}>
          <h2 id="how-it-works-h2" className={['t-h2', s.h2, s.howH2].join(' ')} aria-label={`${name} ${rest}`}>
            <span className={s.nameLine} aria-hidden="true">
              <span className={`w ${s.word} ${s.name}`}>
                {prev ? (
                  <span key={`out${prev.key}`} className={s.nameOut} onAnimationEnd={() => setPrev(null)}>
                    {prev.name}
                  </span>
                ) : null}
                <span key={`in${cur.key}`} className={cur.key ? s.nameIn : undefined}>
                  {cur.name}
                </span>
              </span>
            </span>{' '}
            {words.map((t, k) => (
              <span key={t.index} aria-hidden="true">
                <span className={`w ${s.word}`} data-accent={t.accent || undefined}>
                  {t.accent ? <em className={s.accent}>{t.word}</em> : t.word}
                </span>
                {k < words.length - 1 ? ' ' : null}
              </span>
            ))}
          </h2>
        </div>
        <Reveal as="ol" className={s.steps} stagger={0.1} y={20} zoomImages={false}>
          {([0, 1, 2] as const).map((n) => (
            <li key={n} data-reveal-item="" className={s.step}>
              <StepCard index={n} layout="row" plain decorative={false} />
            </li>
          ))}
        </Reveal>
      </section>
    </div>
  );
}

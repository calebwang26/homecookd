// 8.12 Final CTA · #early-access · B5
// Full-bleed forest block with the VERO swirl ("Hungry? We're Ready." composition): two star
// cut-outs bleeding off the edges, a centered column with the kitchen clock, the LetterArc H2,
// the early-access form, "Send this to {R}", the reassurance pills and the parent's own line
// ("The one who cooks? Send this to your kids."). The abuela star answers the H2 with a little
// speech bubble; it is the only garnish on a star (the FREE seal stays off the photos).
// Static (SSR, no JS, reduced motion): everything visible, stars at their final rotation.
// Parent version (/teach, FEEDBACK-OCT16 C2): the H2, the form, the pills and the link; no clock,
// body, hand note or star reply, and the stars and the H2 fade up once (no spin, no letter unfurl).
import type { CSSProperties } from 'react';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { PHOTOS, SWIRLS } from '@/content/media';
import { Reveal } from '@/components/motion/Reveal';
import { KitchenClock } from '@/components/primitives/KitchenClock';
import { Pill } from '@/components/primitives/Pill';
import { StarClip } from '@/components/primitives/StarClip';
import { CheckIcon } from '@/components/icons/Icons';
import { CtaHeading } from './CtaHeading';
import { EarlyAccessForm } from './EarlyAccessForm';
import { OtherSide } from './OtherSide';
import { ReplyChip } from './ReplyChip';
import s from './FinalCta.module.css';

// Grandpa and grandson sit ±18° off the horizontal from the photo's center, which is where the
// standard star has its notches. Turning the outline (not the photo) by −18° puts a point behind
// each face; an 8-point star looks the same at any turn. (StarClip's own starClip() lives in a client
// module, so this server component builds the same polygon itself.)
const LEFT_STAR_CLIP = { ['--clip' as string]: starPolygon(-18) } as CSSProperties;

/** StarClip's 8-point star (inner radius .62), with the outline turned by `rot` degrees. */
function starPolygon(rot: number, n = 8, inner = 0.62): string {
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? 50 * inner : 50;
    const a = (Math.PI * i) / n - Math.PI / 2 + (rot * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)}% ${(50 + r * Math.sin(a)).toFixed(2)}%`;
  });
  return `polygon(${pts.join(',')})`;
}

export function FinalCta() {
  const T = useCopy().finalCta;
  const parent = useAudience() === 'parent';
  const enter = parent ? 'fade' : 'spin';
  return (
    <section
      id="early-access"
      className={[s.section, parent ? s.lean : ''].filter(Boolean).join(' ')}
      data-theme="dark"
      aria-labelledby="early-access-h2"
      style={{ ['--swirl' as string]: `url(${SWIRLS.forest})` } as CSSProperties}
    >
      <div className={`${s.starSlot} ${s.starLeft}`}>
        <StarClip
          image={PHOTOS.grandpaGrandson.src}
          alt={T.starLeftAlt}
          size="var(--star)"
          sizes="(min-width: 1024px) 38vw, (min-width: 768px) 45vw, 54vw"
          rotate={-8}
          // grandpa's face clears the 2vw bleed; the grandson sits in the right point
          focus="55% 40%"
          style={LEFT_STAR_CLIP}
          delay={0.35}
          enter={enter}
        />
      </div>
      <div className={`${s.starSlot} ${s.starRight}`}>
        <StarClip
          image={PHOTOS.abuelaTortillas.src}
          alt={T.starRightAlt}
          size="var(--star)"
          sizes="(min-width: 1024px) 38vw, (min-width: 768px) 45vw, 54vw"
          rotate={12}
          ring="sun"
          focus="40% 30%"
          delay={0.5}
          enter={enter}
        />
        {/* the abuela star answering the H2 (a speech bubble on an illustration, decorative) */}
        {T.reply ? <ReplyChip text={T.reply} className={s.reply} /> : null}
      </div>

      <div className={s.col}>
        {T.clock ? (
          <Reveal y={10} amount={0.8}>
            <KitchenClock time={T.clock} tone="chartreuse" className={s.clock} />
          </Reveal>
        ) : null}
        <CtaHeading id="early-access-h2" className={`t-block ${s.h2}`} />
        {T.body ? (
          <Reveal as="p" className={`t-lead ${s.body}`} delay={0.3} y={16}>
            {T.body}
          </Reveal>
        ) : null}

        <Reveal className={s.formWrap} delay={0.45} y={24} amount={0.2}>
          <EarlyAccessForm />
        </Reveal>

        <Reveal stagger={0.08} delay={0.7} y={12} amount={0.5}>
          <ul role="list" className={s.pills}>
            {T.pills.map((p) => (
              <li key={p} data-reveal-item>
                <Pill tone="outlineCream" icon={<CheckIcon size={16} stroke={2.4} />}>
                  {p}
                </Pill>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.15} y={12} amount={0.5} className={s.parentWrap}>
          <OtherSide />
        </Reveal>
      </div>
    </section>
  );
}

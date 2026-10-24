'use client';
// The other side of the family, under the reassurance pills (brief 8.12 + round-1 QA): one quiet
// line that links to the other version of the lander: "Curious what your kids will see? Take a
// look." (/ → /learn) and "Curious what Mom will see? Take a look." (/learn → /teach, the parent
// page that is never routed: / would send a kid with a saved pick straight back). It's only a peek,
// not a switch: no aud/via, so nothing is saved as their pick. The relation (?for=) travels along,
// so the page that opens knows who it's about.
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { AUDIENCE_PATH } from '@/content/audience';
import { fill } from '@/lib/relation';
import s from './OtherSide.module.css';

export function OtherSide() {
  const { otherSide } = useCopy().finalCta;
  const audience = useAudience();
  const { relation, explicit } = useRelation();
  const href = `${audience === 'kid' ? '/teach' : AUDIENCE_PATH.kid}${explicit ? `?for=${relation}` : ''}`;
  return (
    <div className={s.root}>
      <p className={s.line}>
        <span>{fill(otherSide.lead, relation)}</span>{' '}
        {/* the period stays glued to the link when the line wraps */}
        <span className={s.nowrap}>
          <a className={s.link} href={href}>
            {otherSide.link}
          </a>
          .
        </span>
      </p>
    </div>
  );
}

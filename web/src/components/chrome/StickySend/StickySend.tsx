'use client';
// The kid page's sticky "Send this to {R}" (QA B18), phones only (CSS hides it from 768px up).
// The one thing /learn asks for is getting a parent to film, so the button follows the scroll:
// it rises in once the hero's own send button is gone, steps aside while the pass-down's own buttons are
// live (they sit at the same spot), and leaves for good at the final section, which has its own.
// Mounted by the Lander on /learn only. Sending works like the hero's (useSend: share sheet, else
// "Copied." with the link shown).
import { useEffect, useState } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { Button } from '@/components/primitives/Button';
import { ShareGlyph } from '@/components/icons/Icons';
import { fill } from '@/lib/relation';
import { useSend } from './SendPanel';
import s from './StickySend.module.css';

/** visible somewhere in the viewport, and not switched off by the film (data-off) */
function showing(el: Element | null): boolean {
  if (!el || el.hasAttribute('data-off')) return false;
  const r = el.getBoundingClientRect();
  return r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

export function StickySend() {
  const copy = useCopy();
  const { relation } = useRelation();
  const { send, panel } = useSend('sticky');
  const [on, setOn] = useState(false);

  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      // the hero's own send button is gone: the film switched its overlay off (a9), or the static
      // hero scrolled away. (A fixed scroll depth landed just before the pass-down's buttons, so the
      // button flashed in and straight back out.)
      const hero = document.querySelector('[data-f="overlay"]');
      const pastHero = hero ? !showing(hero) : window.scrollY > window.innerHeight * 0.5;
      const passFoot = showing(document.querySelector('[data-f="passFoot"]'));
      const end = document.getElementById('early-access');
      const atEnd = !!end && end.getBoundingClientRect().top < window.innerHeight;
      setOn(pastHero && !passFoot && !atEnd);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  return (
    <>
      <div className={s.sticky} data-on={on ? '' : undefined}>
        <Button variant="hero" size="md" block onClick={send} icon={<ShareGlyph name="message" size={20} />}>
          {fill(copy.finalCta.shareButton, relation)}
        </Button>
      </div>
      {panel}
    </>
  );
}

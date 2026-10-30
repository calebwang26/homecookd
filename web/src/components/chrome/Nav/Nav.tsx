'use client';
// Site nav (brief 8.0, tone contract 4.5). Owner: B7.
//
// Fixed, 72px, never hides (a7 M24). Two tones:
//   hero  — while any [data-nav-tone="hero"] element covers the top 72px of the viewport (DeckFilm's
//           hero stage): transparent, cream text, the picker in a cream outline.
//   float — everywhere else: canvas pills (80% + 12px backdrop blur, solid canvas fallback, hairline)
//           with ink text. Server HTML renders float, which is readable on any background.
// The tone is written straight to data-tone on <header> (no React re-render on scroll).
//
// Desktop (≥768): two pills that hug their content, so the page shows through the gap between them
// (a7's nav is transparent): pot mascot + "homecookd" · links (hidden below 1200px) + RelationPicker +
// green "Get early access". Mobile (<768): one bar · logo · "with Grandma ▾" (the label stays at every
// width, QA B22) · "Early access"; no hamburger. Below 375px the mascot alone carries the brand.
// Intro (a7 M1): logo first, then the items blur in left → right, 50ms apart, once.
import { useEffect, useRef, type CSSProperties } from 'react';
import { useCopy } from '@/components/providers/CopyProvider';
import { Logo } from '@/components/primitives/Logo';
import { Button } from '@/components/primitives/Button';
import { RelationPicker } from '@/components/chrome/RelationPicker/RelationPicker';
import s from './Nav.module.css';

const NAV_H = 72;

function heroCoversTop(): boolean {
  const els = document.querySelectorAll<HTMLElement>('[data-nav-tone="hero"]');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.bottom >= NAV_H && r.width > 0) return true;
  }
  return false;
}

export function Nav() {
  const ref = useRef<HTMLElement>(null);

  // Tone: scroll / resize / the attribute being added or removed (DeckFilm toggles it mid-scrub).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const tone = heroCoversTop() ? 'hero' : 'float';
      if (el.dataset.tone !== tone) el.dataset.tone = tone;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-nav-tone'] });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mo.disconnect();
    };
  }, []);

  // Intro: the hidden state only exists under html[data-motion="on"] until data-revealed is set.
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.setAttribute('data-revealed', ''));
    return () => cancelAnimationFrame(id);
  }, []);

  const copy = useCopy();
  const n = copy.nav;
  // Stagger index for the intro (logo 0, links 1–4, picker, CTA).
  const item = (i: number) => ({ 'data-nav-item': '', style: { '--i': i } as CSSProperties });
  const last = n.links.length + 1;

  return (
    <header ref={ref} className={s.nav}>
      <div className={s.bar}>
        <span className={`${s.bg} ${s.barBg}`} aria-hidden="true" />
        <div className={`${s.pill} ${s.brand}`}>
          <span className={`${s.bg} ${s.pillBg}`} aria-hidden="true" />
          <span className={s.item} {...item(0)}>
            <a className={s.logo} href="#top" aria-label={`${copy.meta.siteName}, back to top`}>
              <Logo height={30} className={s.lockupNormal} />
              <Logo height={30} reversed className={s.lockupHero} />
            </a>
          </span>
        </div>
        <div className={`${s.pill} ${s.group}`}>
          <span className={`${s.bg} ${s.pillBg}`} aria-hidden="true" />
          <nav className={s.links} aria-label="Main">
            <ul role="list">
              {n.links.map((l, k) => (
                <li key={l.href} {...item(k + 1)}>
                  <a className={s.link} href={l.href}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className={s.actions}>
            <div className={s.pickerSlot} {...item(last)}>
              <RelationPicker className={s.picker} />
            </div>
            <div className={s.ctaSlot} {...item(last + 1)}>
              <Button href="#early-access" variant="primary" size="sm" arrow className={s.ctaWide}>
                {n.cta}
              </Button>
              <Button href="#early-access" variant="primary" size="sm" className={s.ctaNarrow}>
                {n.ctaMobile}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

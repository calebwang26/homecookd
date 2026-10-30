// Footer (brief 8.13, a3 Savor). Owner: B7.
// Top row: two link columns + the prompt and the "Get early access" pill with its arrow (from col 8).
// Then the giant "homecookd" wordmark in ink, pushed to the bottom and fit edge to edge, which grows out of
// its thickest strokes once (FooterWordmark); no logo, no tagline above it (Oct 16 feedback C2.6, C3; Caleb Oct 30).
// Legal row underneath, and a 14px chartreuse strip at the very bottom.
// Privacy opens /privacy; Contact (a mailto:) and the "Made by …" line show only once Caleb fills
// CONTACT_EMAIL and MADE_BY in src/content/site.ts (QA B19).
// Server component; only the wordmark and the credits disclosure hydrate.
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { otherAudience } from '@/content/audience';
import { switchHref } from '@/lib/audience-route';
import { Button } from '@/components/primitives/Button';
import { FooterWordmark } from '@/components/primitives/FooterWordmark';
import { CONTACT_EMAIL, MADE_BY } from '@/content/site';
import { Credits } from './Credits';
import s from './Footer.module.css';

export function Footer() {
  const copy = useCopy();
  const audience = useAudience();
  const f = copy.footer;
  const secondary = f.linksSecondary.filter((l) => !l.href.startsWith('mailto:') || CONTACT_EMAIL);

  return (
    <footer id="footer" className={s.footer}>
      <div className={s.top}>
        <nav className={s.links} aria-label="Footer">
          <ul role="list" className={s.col}>
            {f.linksPrimary.map((l) => (
              <li key={l.href}>
                <a className={s.link} href={l.href}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <ul role="list" className={s.col}>
            {secondary.map((l) => (
              <li key={l.label}>
                <a className={s.link} href={l.href.startsWith('mailto:') ? `mailto:${CONTACT_EMAIL}` : l.href}>
                  {l.label}
                </a>
              </li>
            ))}
            {/* the other version of the page (/learn ↔ /), remembered as their pick */}
            <li>
              <a className={s.link} href={switchHref(otherAudience(audience), 'footer')}>
                {f.switchLink}
              </a>
            </li>
          </ul>
        </nav>

        <div className={s.ask}>
          <p className={s.prompt}>{f.prompt}</p>
          <Button
            href="#early-access"
            variant="primary"
            size="lg"
            arrow
            aria-label={f.buttonA11yLabel}
            className={s.cta}
          >
            {f.button.before} {f.button.after}
          </Button>
        </div>
      </div>

      <FooterWordmark className={s.wordmark} label={copy.meta.siteName} ink="var(--ink)" />

      <div className={s.legal}>
        <Credits />
        <p className={s.disclaimer}>{f.disclaimer}</p>
        {MADE_BY ? <p className={s.disclaimer}>{MADE_BY}</p> : null}
        <p className={s.copyright}>{f.copyright}</p>
      </div>

      <span className={s.strip} aria-hidden="true" />
    </footer>
  );
}

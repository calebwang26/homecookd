'use client';
// /d?t=<token>: the page a dinner's invite link opens (the app's "Invite friends"; Caleb's final canvas
// B). Opening it counts this browser once in the dinner's "X going" (lib/dinner-invite.ts), with no
// sign-up, and it says only what the server sends back: "You’re going to Jollof Rice Night", "Hosted
// by Mom" and "Friday · 7 pm". The place and the address stay with the host and the guests they
// accept. Same look as the /i invite page, in the dinner page's lavender.
//
// Dev only: /d?fixture=going|past|gone|offline on localhost shows each state without the server.
import { useEffect, useState } from 'react';
import { EggMascot } from '@/components/primitives/EggMascot';
import { Logo } from '@/components/primitives/Logo';
import { LANDER_LINK } from '@/lib/app-links';
import { isInviteToken, nightTitle, openInvite, whenLabel, type Opened } from '@/lib/dinner-invite';
import { fixtureAllowed } from '@/lib/recipe-web/config';
import s from './DinnerInvitePage.module.css';

const DAY = 86_400_000;
const FIXTURES: Record<string, () => Opened> = {
  going: () => ({ ok: true, dinner: { dish: 'Jollof Rice', hostName: 'Mom', startsAt: nextFriday7pm() } }),
  past: () => ({ ok: true, dinner: { dish: 'Jollof Rice', hostName: 'Mom', startsAt: Date.now() - DAY } }),
  gone: () => ({ ok: false, why: 'gone' }),
  offline: () => ({ ok: false, why: 'offline' }),
};

function nextFriday7pm(): number {
  const d = new Date();
  d.setDate(d.getDate() + (((5 - d.getDay() + 7) % 7) || 7));
  d.setHours(19, 0, 0, 0);
  return d.getTime();
}

/** What the server said, and the clock when it said it (the words say "already happened" past it). */
type Load = { state: 'loading' } | (Opened & { now: number });

async function opened(): Promise<Opened> {
  const q = new URLSearchParams(window.location.search);
  const fixture = q.get('fixture');
  if (fixture && fixtureAllowed() && FIXTURES[fixture]) return FIXTURES[fixture]();
  const token = q.get('t');
  return isInviteToken(token) ? await openInvite(token) : { ok: false, why: 'gone' };
}

export function DinnerInvitePage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (window as unknown as { __homecookdHydrated?: boolean }).__homecookdHydrated = true;
    let alive = true;
    void opened().then((r) => {
      if (!alive) return;
      if (r.ok) document.title = `${nightTitle(r.dinner.dish)} · homecookd`;
      setLoad({ ...r, now: Date.now() });
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const loading = 'state' in load;
  const retry = () => {
    setLoad({ state: 'loading' });
    setAttempt((a) => a + 1);
  };

  return (
    <div className={s.page}>
      <div className={s.column}>
        <header className={s.brand}>
          <Logo height={30} />
        </header>
        <main className={s.main} aria-busy={loading || undefined}>
          {loading ? <Skeleton /> : load.ok ? <Going {...load.dinner} now={load.now} /> : <NotOpened why={load.why} retry={retry} />}
        </main>
        {/* A plain <a>, never next/link: the lander only renders fully on a real page load. */}
        {loading ? null : (
          <a className={s.about} href={LANDER_LINK.family} target="_blank" rel="noopener">
            What’s homecookd?<span className={s.srOnly}> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </div>
  );
}

function Going({ dish, hostName, startsAt, now }: { dish: string; hostName: string; startsAt: number; now: number }) {
  const ahead = startsAt > now;
  const host = hostName.trim();
  return (
    <section className={s.hero} aria-labelledby="dinner-title">
      <div className={s.glow}>
        <EggMascot size={92} mood="hello" />
      </div>
      <h1 id="dinner-title" className={s.title}>
        {ahead ? `You’re going to ${nightTitle(dish)}` : `${nightTitle(dish)} already happened`}
      </h1>
      {host && (
        <p className={s.host}>
          <span className={s.initial} aria-hidden="true">
            {Array.from(host)[0]?.toUpperCase()}
          </span>
          <span className={s.hostText}>
            <span className={s.hostLabel}>Hosted by</span>
            <span className={s.hostName}>{host}</span>
          </span>
        </p>
      )}
      {ahead && (
        <p className={s.when}>
          <CalendarIcon />
          <span>{whenLabel(startsAt, now)}</span>
        </p>
      )}
    </section>
  );
}

function NotOpened({ why, retry }: { why: 'gone' | 'offline'; retry: () => void }) {
  return (
    <section className={s.hero} aria-labelledby="dinner-title">
      <div className={s.face}>
        <EggMascot size={88} mood="oops" />
      </div>
      <h1 id="dinner-title" className={s.title}>
        {why === 'gone' ? 'This invite doesn’t work anymore.' : 'We couldn’t reach homecookd.'}
      </h1>
      <p className={s.line}>{why === 'gone' ? 'Ask whoever sent it for a new link.' : 'Check your connection, then try again.'}</p>
      {why === 'offline' && (
        <button type="button" className={s.retry} onClick={retry}>
          Try again
        </button>
      )}
    </section>
  );
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="#244A39" strokeWidth="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" stroke="#244A39" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Skeleton() {
  return (
    <div className={s.skeleton} aria-label="Opening the invite">
      <span className={s.skFace} />
      <span className={s.skLine} style={{ width: '82%', height: 34 }} />
      <span className={s.skLine} style={{ width: '58%', height: 34 }} />
      <span className={s.skPill} />
    </div>
  );
}

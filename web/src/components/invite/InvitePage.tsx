'use client';
// /i?t=<token>: the page an invite link opens when the app can't (FEEDBACK-OCT16c section C). It is
// the second person's landing page: the face of whoever sent it, "Join Test family on homecookd" (the
// family's own name, never the inviter's, so one family reads the same whoever sends it: QA B28), one
// line naming the sender ("Mom invited you as Dad.", or "Mom invited you." for a family invite, whose
// opener picks their own name in the app), and one big "Get the app". Joining only ever happens in
// the app: this page peeks at the invite (no side effects) and never accepts it.
// A used, expired or turned-off invite offers the next step (QA B25): "Ask Mom for a new link", a
// text message ready to send ("Can you send me a new homecookd invite?"). "What's homecookd?" opens in
// a new tab, so the invite stays open behind it.
//
// Dev only: /i?fixture=pending|family|used|expired|revoked|notfound|offline[&role=learner]
// [&from=Dad|none][&for=family] on localhost shows each state without the API.
import { useEffect, useState, type ReactNode } from 'react';
import { PotMascot } from '@/components/primitives/PotMascot';
import { Avatar } from '@/components/recipe-web/Avatar';
import { appSchemeUrl, isPhoneOrTablet, LANDER_LINK, WEB_ORIGIN } from '@/lib/app-links';
import { cleanInviteCode, InviteError, isPlausibleInviteToken, peekInvite } from '@/lib/recipe-web/api';
import { fixtureAllowed } from '@/lib/recipe-web/config';
import { joinFamilyTitle } from '@/lib/recipe-web/recipe';
import type { InvitePeek } from '@/lib/recipe-web/types';
import { Handoff } from './Handoff';
import s from './InvitePage.module.css';

type Gone = 'used' | 'expired' | 'revoked' | 'not-found';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; invite: InvitePeek; token: string | null; code: string | null; phone: boolean }
  | { state: 'gone'; why: Gone; invite: InvitePeek | null }
  | { state: 'error'; kind: 'network' | 'rate' };

// The API's own sentences (POST /invites/accept, /invites/peek), so the web and the app agree.
const GONE_TITLE: Record<Gone, string> = {
  used: 'This invite was already used.',
  expired: 'This invite expired.',
  revoked: 'This invite was turned off.',
  'not-found': 'That invite link doesn’t work.',
};

const FIXTURES = ['pending', 'family', 'used', 'expired', 'revoked', 'notfound', 'offline'] as const;

function fixtureLoad(kind: (typeof FIXTURES)[number], q: URLSearchParams): Load {
  if (kind === 'offline') return { state: 'error', kind: 'network' };
  const from = q.get('from');
  // family = a pending family invite; &for=family makes the ended states family invites too.
  const forAnyone = kind === 'family' || q.get('for') === 'family';
  const invite: InvitePeek = {
    status: kind === 'notfound' || kind === 'family' ? 'pending' : kind,
    // A real family's invite: nobody but the seeded demo family has an avatar_key (initials, no photos).
    family_name: 'Mom’s family',
    inviter: from === 'none' ? null : { name: from || 'Mom', relation: from || 'Mom', avatar_key: null },
    invitee: forAnyone
      ? null
      : q.get('role') === 'learner'
        ? { name: 'Leo', role: 'learner', avatar_key: null }
        : { name: 'Dad', role: 'cook', avatar_key: null },
    expires_at: null,
    code: 'K7QM2X',
  };
  if (kind === 'pending' || kind === 'family') {
    return { state: 'ready', invite, token: 'fixture', code: invite.code ?? null, phone: isPhoneOrTablet() };
  }
  return { state: 'gone', why: kind === 'notfound' ? 'not-found' : kind, invite: kind === 'notfound' ? null : invite };
}

const headline = (invite: InvitePeek): string => joinFamilyTitle(invite.family_name);

/** The line under the headline: who sent it (next to their face), and who it's for. */
function inviteLine(invite: InvitePeek): ReactNode {
  const from = invite.inviter?.name.trim();
  const as = invite.invitee?.name.trim();
  if (from && as) {
    return (
      <>
        {from} invited you as <b>{as}</b>.
      </>
    );
  }
  if (from) return `${from} invited you.`;
  if (as) {
    return (
      <>
        You’re joining as <b>{as}</b>.
      </>
    );
  }
  return null; // a family invite with no sender: they add themselves in the app
}

const expired = (iso: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && t <= Date.now();
};

export function InvitePage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (window as unknown as { __homecookdHydrated?: boolean }).__homecookdHydrated = true;
    let alive = true;
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const fixture = q.get('fixture') as (typeof FIXTURES)[number] | null;
      if (fixture && fixtureAllowed() && FIXTURES.includes(fixture)) {
        setLoad(fixtureLoad(fixture, q));
        return;
      }
      const t = q.get('t');
      const token = isPlausibleInviteToken(t) ? t : null;
      const linkCode = cleanInviteCode(q.get('c'));
      if (!token && !linkCode) {
        setLoad({ state: 'gone', why: 'not-found', invite: null });
        return;
      }
      try {
        const invite = await peekInvite(token ? { token } : { code: linkCode! });
        if (!alive) return;
        const status = invite.status === 'pending' && expired(invite.expires_at) ? 'expired' : invite.status;
        if (status === 'pending') {
          document.title = `${headline(invite).replace(/\.$/, '')} · homecookd`;
          setLoad({ state: 'ready', invite, token, code: invite.code ?? linkCode, phone: isPhoneOrTablet() });
        } else {
          setLoad({ state: 'gone', why: status, invite });
        }
      } catch (e) {
        if (!alive) return;
        if (e instanceof InviteError && (e.kind === 'not-found' || e.kind === 'gone')) {
          const why: Gone = e.kind === 'not-found' ? 'not-found' : e.status && e.status !== 'pending' ? e.status : 'used';
          setLoad({ state: 'gone', why, invite: null });
        } else {
          setLoad({ state: 'error', kind: e instanceof InviteError && e.kind === 'rate' ? 'rate' : 'network' });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = () => {
    setLoad({ state: 'loading' });
    setAttempt((a) => a + 1);
  };

  // The lander for whoever this invite is for (cooks: the parent page; a family invite, which is for
  // anyone: the lander's default page).
  const invite = load.state === 'ready' || load.state === 'gone' ? load.invite : null;
  const about = !invite
    ? LANDER_LINK.cook
    : !invite.invitee
      ? LANDER_LINK.family
      : invite.invitee.role === 'learner'
        ? LANDER_LINK.learner
        : LANDER_LINK.cook;

  return (
    <div className={s.page}>
      <div className={s.column}>
        <header className={s.brand}>
          <PotMascot size={30} />
          <span className={s.word}>homecookd</span>
        </header>
        <main className={s.main} aria-busy={load.state === 'loading' || undefined}>
          {load.state === 'loading' && <Skeleton />}
          {load.state === 'ready' && <Pending {...load} />}
          {load.state === 'gone' && <Ended {...load} />}
          {load.state === 'error' && (
            <Hero
              face={<PotMascot size={88} mood="talk" />}
              title={load.kind === 'rate' ? 'Too many tries for now.' : 'We couldn’t reach homecookd.'}
              line={load.kind === 'rate' ? 'Wait a few minutes, then try again.' : 'Check your connection, then try again.'}
            >
              <div className={s.actions}>
                <button type="button" className={`${s.press} ${s.retry}`} onClick={retry}>
                  Try again
                </button>
              </div>
            </Hero>
          )}
        </main>
        {/* A plain <a>, never next/link: the lander only renders fully on a real page load. A new tab,
            so the invite stays put. */}
        {load.state !== 'loading' && (
          <a className={s.about} href={about} target="_blank" rel="noopener">
            What’s homecookd?<span className={s.srOnly}> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </div>
  );
}

function Pending({ invite, token, code, phone }: Extract<Load, { state: 'ready' }>) {
  const inviter = invite.inviter;
  // The app's Paste invite reads the homecookd.app link (or, with only a code, the code itself).
  const link = token ? `${WEB_ORIGIN}/i?t=${encodeURIComponent(token)}` : code!;
  const openUrl = token ? appSchemeUrl('i', { t: token }) : appSchemeUrl('i', { c: code! });
  return (
    <Hero
      face={inviter ? <Face name={inviter.name} avatarKey={inviter.avatar_key} /> : <PotMascot size={96} mood="happy" />}
      title={headline(invite)}
      line={inviteLine(invite)}
    >
      <div className={s.actions}>
        <Handoff link={link} openUrl={openUrl} askName={inviter?.name ?? null} phone={phone} />
      </div>
      {code && (
        <p className={s.code}>
          <span className={s.codeLabel}>Or type this code in the app</span>
          <span className={s.codeValue} aria-hidden="true">
            {code}
          </span>
          <span className={s.srOnly}>{code.split('').join(' ')}</span>
        </p>
      )}
    </Hero>
  );
}

/** A text message to whoever sent the invite (no number: they pick the person in Messages). */
const ASK_AGAIN = `sms:?&body=${encodeURIComponent('Can you send me a new homecookd invite?')}`;

function Ended({ why, invite }: Extract<Load, { state: 'gone' }>) {
  const inviter = invite?.inviter ?? null;
  return (
    <Hero
      face={inviter ? <Face name={inviter.name} avatarKey={inviter.avatar_key} /> : <PotMascot size={88} mood="talk" />}
      title={GONE_TITLE[why]}
      line={`Ask ${inviter?.name ?? 'whoever sent it'} for a new one.`}
    >
      <div className={s.actions}>
        <a className={`${s.press} ${s.retry}`} href={ASK_AGAIN}>
          {inviter ? `Ask ${inviter.name} for a new link` : 'Ask for a new link'}
        </a>
      </div>
    </Hero>
  );
}

function Hero({ face, title, line, children }: { face: ReactNode; title: string; line: ReactNode; children?: ReactNode }) {
  return (
    <>
      <section className={s.hero} aria-labelledby="invite-title">
        <div className={s.face}>{face}</div>
        <h1 id="invite-title" className={s.title}>
          {title}
        </h1>
        {line != null && <p className={s.line}>{line}</p>}
      </section>
      {children}
    </>
  );
}

function Face({ name, avatarKey }: { name: string; avatarKey: string | null }) {
  return (
    <span className={s.ring}>
      <Avatar name={name} avatarKey={avatarKey} size={104} />
    </span>
  );
}

function Skeleton() {
  return (
    <div className={s.skeleton} aria-label="Opening your invite">
      <span className={s.skFace} />
      <span className={s.skLine} style={{ width: '82%', height: 34 }} />
      <span className={s.skLine} style={{ width: '58%', height: 34 }} />
      <span className={s.skLine} style={{ width: '50%', height: 20, marginTop: 6 }} />
      <span className={s.skPill} style={{ marginTop: 28 }} />
      <span className={s.skPill} style={{ height: 56 }} />
    </div>
  );
}

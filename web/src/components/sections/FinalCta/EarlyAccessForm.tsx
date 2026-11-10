'use client';
// Final CTA form + "Send this to {R}" (brief 8.12).
//
// Form: visible label, 60px pill input, hero button. If NEXT_PUBLIC_EARLY_ACCESS_URL is set, POST the
// email (form-urlencoded), and the thank-you replaces the form in place (role="status") once it went. A
// production build without it shows no form at all (lib/early-access.ts: Bug hunt, Nov 10, found the
// live form thanking people for addresses it sent nowhere); a dev build keeps the thank-you without a
// request, for demos (brief 8.12 accept 4). Nothing is stored locally. Errors are text (cream, with an
// icon), never color only. Arriving through any #early-access link focuses the email field (fine
// pointers only, so a phone's keyboard never jumps up mid-scroll).
//
// Parent version (QA B21): one quiet line under the button says what happens next ("We'll email you
// when your spot opens. No card, no spam."), and "Or just cook, and send the videos to your kids to
// add." sits under the sign-up for a cook who'd rather not download anything (copy "" = not shown).
//
// The kid version's button opens /miss (MISS_HREF), where the real "Ask Mom" lives. The parent version shares:
// navigator.share({ title, text, url: origin/learn?for=<r> }); when there's no share sheet, it fails
// or it doesn't answer in 3 s, the message is copied and the link shows as selectable text with
// sms: / mailto: links (QA B18: every send ends in something visible).
import { animate } from 'motion';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { fill } from '@/lib/relation';
import { inviteUrl, mailtoHref, shareInvite, smsHref, type ShareResult } from '@/lib/share';
import { MISS_HREF } from '@/lib/audience-route';
import { earlyAccessMode } from '@/lib/early-access';
import { EASE } from '@/lib/motion/tokens';
import { MQ_FINE_POINTER } from '@/lib/motion/media';
import { ANCHOR_EVENT } from '@/components/providers/LenisProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { useMotionOK } from '@/components/providers/MotionProvider';
import { Button } from '@/components/primitives/Button';
import { HandNote } from '@/components/primitives/HandNote';
import { EggMascot } from '@/components/primitives/EggMascot';
import { Sticker } from '@/components/primitives/Sticker';
import { ShareGlyph } from '@/components/icons/Icons';
import { PopIn } from '../InTheirWords/PopIn';
import s from './EarlyAccessForm.module.css';

type Status = 'idle' | 'sending' | 'done';

// Read literally, so the build inlines both.
const ENDPOINT = process.env.NEXT_PUBLIC_EARLY_ACCESS_URL;
const MODE = earlyAccessMode(ENDPOINT, process.env.NODE_ENV);

export function EarlyAccessForm() {
  const copy = useCopy();
  const audience = useAudience();
  const T = copy.finalCta;
  const { relation } = useRelation();
  const motionOK = useMotionOK();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<ShareResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  const inputId = `${uid}-email`;
  const errorId = `${uid}-error`;

  // #early-access links (hero, nav, footer) land here: focus the email field.
  useEffect(() => {
    const onAnchor = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id !== 'early-access') return;
      if (!window.matchMedia(MQ_FINE_POINTER).matches) return;
      inputRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener(ANCHOR_EVENT, onAnchor);
    return () => window.removeEventListener(ANCHOR_EVENT, onAnchor);
  }, []);

  // Thank-you arrives: settle it in, then hand focus to it (the form it replaced is gone).
  useEffect(() => {
    if (status !== 'done') return;
    const el = successRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (!motionOK) return;
    animate(el, { opacity: [0, 1], y: [14, 0], scale: [0.97, 1] }, { duration: 0.7, ease: EASE.expo });
    const pot = el.querySelector<SVGElement>('[data-pot]');
    if (pot) animate(pot, { y: [0, -14, 0], rotate: [0, -8, 0] }, { duration: 0.7, delay: 0.25, ease: EASE.soft });
    // nudge the share button: this is the moment to ask
    const btn = shareRef.current?.querySelector<HTMLElement>('button');
    if (btn) animate(btn, { scale: [1, 1.05, 1] }, { duration: 0.6, delay: 0.9, ease: EASE.soft });
  }, [status, motionOK]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === 'sending') return;
    const input = inputRef.current;
    if (!input) return;
    const email = input.value.trim();
    if (!email || !input.validity.valid) {
      setError(T.error);
      input.focus();
      return;
    }
    if (MODE === 'off') return; // no form is drawn then; never thank anyone for an address that goes nowhere
    setError(null);
    setStatus('sending');
    if (MODE === 'post' && ENDPOINT) {
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          // audience: which version they signed up from (kid = /learn, parent = /teach)
          body: new URLSearchParams({ email, audience }).toString(),
        });
        if (!res.ok && res.type !== 'opaque') throw new Error(String(res.status));
      } catch {
        setStatus('idle');
        // shown only when NEXT_PUBLIC_EARLY_ACCESS_URL is set and the request fails
        setError(T.networkError);
        return;
      }
    }
    setStatus('done');
  };

  const onShare = async () => {
    setShare(null);
    // a share sheet that answers after the link came up (sent or cancelled) puts the link away
    const res = await shareInvite(relation, copy, audience, () => setShare(null));
    setShare(res === 'cancelled' ? null : res);
  };

  const success = fill(T.success, relation);
  // "You're on the list." / "Now go call Grandma."
  const [successA, successB] = splitFirstSentence(success);

  return (
    <div className={s.root}>
      <div className={s.formZone}>
        {/* decorative: the "Free in early access" pill below says the same thing (so the parent
            version, which keeps only the essentials, leaves it out) */}
        {audience === 'parent' ? null : (
          <PopIn className={s.seal} delay={0.9} from={-60}>
            <Sticker lines={T.sticker} tone="chartreuseOnForest" size={160} rotate={12} className={s.sticker} decorative />
          </PopIn>
        )}

        {MODE !== 'off' && status !== 'done' ? (
          <form className={s.form} noValidate onSubmit={onSubmit} aria-busy={status === 'sending' || undefined}>
            <label htmlFor={inputId} className={s.label}>
              {T.emailLabel}
            </label>
            <div className={s.row}>
              <input
                ref={inputRef}
                id={inputId}
                className={s.input}
                type="email"
                name="email"
                required
                autoComplete="email"
                inputMode="email"
                enterKeyHint="send"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={T.emailPlaceholder}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onInput={() => {
                  if (error && inputRef.current?.validity.valid) setError(null);
                }}
              />
              <Button
                type="submit"
                variant="hero"
                size="lg"
                arrow
                className={s.submit}
                aria-disabled={status === 'sending' || undefined}
              >
                {status === 'sending' ? T.submitting : T.submit}
              </Button>
            </div>
            {T.afterNote ? <p className={s.afterNote}>{T.afterNote}</p> : null}
            {error ? (
              <p id={errorId} className={s.error} role="alert">
                <svg className={s.errorIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <circle cx="12" cy="12" r="9.2" />
                  <path d="M12 7.6v5.6M12 16.4v.1" />
                </svg>
                {error}
              </p>
            ) : null}
          </form>
        ) : null}

        <div role="status" className={s.statusSlot}>
          {status === 'done' ? (
            <div ref={successRef} className={s.success} tabIndex={-1}>
              <span data-pot="" className={s.pot}>
                <EggMascot size={64} mood="made-it" />
              </span>
              <p className={s.successText}>
                {successA} <em>{successB}</em>
              </p>
            </div>
          ) : null}
        </div>
        {T.orJustCook ? <p className={s.orJustCook}>{fill(T.orJustCook, relation)}</p> : null}
      </div>

      <div ref={shareRef} className={s.shareRow}>
        {audience === 'kid' ? (
          <Button href={MISS_HREF} variant="outlineCream" size="md" arrow>
            {fill(T.shareButton, relation)}
          </Button>
        ) : (
          <Button variant="outlineCream" size="md" onClick={onShare} icon={<ShareGlyph name="message" size={20} />}>
            {fill(T.shareButton, relation)}
          </Button>
        )}
        {T.note ? (
          <HandNote arrow="left" tone="chartreuse" rotate={-5} className={s.note}>
            {T.note}
          </HandNote>
        ) : null}
      </div>

      <div role="status" className={s.shareStatus}>
        {share === 'copied' || share === 'failed' ? (
          <div className={s.shareMsg}>
            <p>{fill(share === 'copied' ? T.copied : T.sendLink, relation)}</p>
            <p className={s.shareUrl}>{inviteUrl(relation, audience)}</p>
            <p>
              <a className={s.shareLink} href={smsHref(relation, copy, audience)}>
                {T.smsLabel}
              </a>
              <a className={s.shareLink} href={mailtoHref(relation, copy, audience)}>
                {T.emailLinkLabel}
              </a>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function splitFirstSentence(str: string): [string, string] {
  const i = str.indexOf('. ');
  return i < 0 ? [str, ''] : [str.slice(0, i + 1), str.slice(i + 2)];
}

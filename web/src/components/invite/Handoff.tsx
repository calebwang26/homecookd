'use client';
// The web's two ways into the app (FEEDBACK-OCT16c section C), shared by the /i invite page and the
// /r "Get the app" sheet:
//   Get the app    -> puts the link on the clipboard inside the tap (Safari only allows it there).
//                     Copied: `copied` (by default "Copied. Once homecookd is installed, come back and
//                     tap Open homecookd.") stays up long enough to read, then the App Store opens.
//                     Not copied: they stay here and are told to come back and tap Open homecookd.
//                     Either way the button is a real App Store link, so a second tap goes straight there.
//   Open homecookd -> `openUrl` (lib/app-links openAppUrl): first the same page on the site's other
//                     host, which iPhone hands to the app when it is installed. Without the app that
//                     page loads, says homecookd didn't open, and its Open homecookd is the app's scheme.
//                     It copies the link too, inside the tap: the app picks up a copied /i, /miss or /a
//                     link by itself on its first screen (app/src/components/signin/useLinkPickup.ts).
// On a computer neither works, so it says "Open this link on your phone." On Android there is no app
// yet, so it says that instead of showing two buttons that go nowhere.
//
// TODO(caleb): check both on a real iPhone, which no test here can: that the App Store opens by itself
// after "Copied" (it is opened from a timer; the second tap is a plain link either way), and that Open
// homecookd opens the installed app in one tap (if not, the page it lands on has the scheme link).
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { APP_STORE_URL, arrivedFromOpen, copyText, IPHONE_ONLY, isAndroid } from '@/lib/app-links';
import s from './Handoff.module.css';

type Note = 'copied' | 'not-copied' | null;

/** How long the "Copied." note shows before the store opens. */
const READ_MS = 1600;

export function Handoff({
  link,
  openUrl,
  phone,
  hint,
  copied = 'Copied. Once homecookd is installed, come back and tap Open homecookd.',
}: {
  /** What "Get the app" copies (the invite or share link). */
  link: string;
  /** Where "Open homecookd" goes (openAppUrl). */
  openUrl: string;
  /** false on a computer. */
  phone: boolean;
  /** A short line under the buttons until one is tapped. */
  hint?: string;
  /** The note after a copy that worked. 1.1 join links: the app picks the link up by itself. */
  copied?: string;
}) {
  const [note, setNote] = useState<Note>(null);
  // "Open homecookd" on the site's other host brought them here: the app didn't take the link.
  const [arrived] = useState(arrivedFromOpen);
  const copying = useRef(false);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const noteRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      // The sheet closed or the page went away: never open the store after that.
      alive.current = false;
      if (leave.current) clearTimeout(leave.current);
    };
  }, []);

  // On a small phone the note sits below the fold: bring it up so "what next" is never missed.
  useEffect(() => {
    if (!note && !arrived) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    noteRef.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [note, arrived]);

  if (!phone) {
    return (
      <p className={s.desk}>
        <IconPhone />
        Open this link on your phone.
      </p>
    );
  }

  if (isAndroid()) {
    return (
      <p className={s.desk}>
        <IconPhone />
        {IPHONE_ONLY}
      </p>
    );
  }

  const getApp = (e: MouseEvent<HTMLAnchorElement>) => {
    // The note is up: this tap is a plain link to the App Store.
    if (note) {
      if (leave.current) clearTimeout(leave.current);
      return;
    }
    e.preventDefault();
    if (copying.current) return;
    copying.current = true;
    // The copy starts here, inside the tap. Only a copy that worked sends them on to the App Store.
    copyText(link).then((ok) => {
      copying.current = false;
      if (!alive.current) return;
      setNote(ok ? 'copied' : 'not-copied');
      if (ok) leave.current = setTimeout(() => alive.current && window.location.assign(APP_STORE_URL), READ_MS);
    });
  };

  const line =
    note === 'copied'
      ? copied
      : note === 'not-copied'
        ? 'Couldn’t copy the link. Get the app, then come back and tap Open homecookd.'
        : arrived
          ? 'homecookd didn’t open. If it isn’t on this phone yet, tap Get the app.'
          : hint;

  return (
    <div className={s.wrap}>
      <a className={`${s.press} ${s.primary}`} href={APP_STORE_URL} onClick={getApp} aria-describedby="handoff-note">
        Get the app
      </a>
      <a className={`${s.press} ${s.secondary}`} href={openUrl} onClick={() => void copyText(link)}>
        Open homecookd
      </a>
      <p ref={noteRef} id="handoff-note" className={s.note} role="status" aria-live="polite" data-strong={note || arrived ? '' : undefined}>
        {line ?? ''}
      </p>
    </div>
  );
}

function IconPhone() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="6.5" y="2.5" width="11" height="19" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

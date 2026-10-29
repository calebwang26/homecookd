'use client';
// The web's two ways into the app (FEEDBACK-OCT16c section C), shared by the /i invite page and the
// /r "Get the app" sheet:
//   Get the app    -> puts the link on the clipboard inside the tap (Safari only allows it there).
//                     Copied: "Copied. In the app, tap Paste invite." stays up long enough to read,
//                     then the store opens. Not copied: they stay here and are told to come back
//                     and tap Open homecookd. Either way the button is a real store link, so a
//                     second tap goes straight there.
//                     No store link for this phone yet -> says plainly that homecookd is in early
//                     testing and who to message. No link is ever made up.
//   Open homecookd -> the app's scheme (a universal link never opens the app from its own domain).
//                     It copies the link too, inside the tap: where the app doesn't answer the
//                     scheme, opening homecookd by hand and tapping Paste invite still works.
// On a computer neither works, so it says "Open this link on your phone." instead.
//
// TODO(caleb): once NEXT_PUBLIC_APP_STORE_URL is set, check on a real iPhone that the store opens
// by itself after "Copied" (it is opened from a timer, after the tap). If it doesn't, the second
// tap on Get the app still opens it.
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { copyText, storeUrlForThisDevice } from '@/lib/app-links';
import s from './Handoff.module.css';

type Note = 'copied' | 'not-copied' | 'testing' | null;

/** How long "Copied. In the app, tap Paste invite." shows before the store opens. */
const READ_MS = 1600;

export function Handoff({
  link,
  openUrl,
  askName,
  phone,
  hint,
  copied = 'Copied. In the app, tap Paste invite.',
}: {
  /** What "Get the app" copies (the invite or share link; the app's Paste invite reads it). */
  link: string;
  /** homecookd://… for "Open homecookd". */
  openUrl: string;
  /** Who to message while there is no store link ("Mom"); null = whoever sent it. */
  askName: string | null;
  /** false on a computer. */
  phone: boolean;
  /** A short line under the buttons until one is tapped. */
  hint?: string;
  /** The note after a copy that worked. 1.1 join links: the app picks the link up by itself. */
  copied?: string;
}) {
  const [note, setNote] = useState<Note>(null);
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
    if (!note) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    noteRef.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [note]);

  if (!phone) {
    return (
      <p className={s.desk}>
        <IconPhone />
        Open this link on your phone.
      </p>
    );
  }

  const store = storeUrlForThisDevice();

  const getApp = (e: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (!store) {
      e.preventDefault();
      setNote('testing');
      return;
    }
    // The note is up: this tap is a plain link to the store.
    if (note === 'copied' || note === 'not-copied') {
      if (leave.current) clearTimeout(leave.current);
      return;
    }
    e.preventDefault();
    if (copying.current) return;
    copying.current = true;
    // The copy starts here, inside the tap. Only a copy that worked sends them on to the store.
    copyText(link).then((ok) => {
      copying.current = false;
      if (!alive.current) return;
      setNote(ok ? 'copied' : 'not-copied');
      if (ok) leave.current = setTimeout(() => alive.current && window.location.assign(store), READ_MS);
    });
  };

  const ask = askName ? `Message ${askName} to get it.` : 'Message whoever sent this to get it.';
  const line =
    note === 'testing'
      ? `homecookd is in early testing. ${ask}`
      : note === 'copied'
        ? copied
        : note === 'not-copied'
          ? 'Couldn’t copy the link. Get the app, then come back and tap Open homecookd.'
          : hint;

  return (
    <div className={s.wrap}>
      {store ? (
        <a className={`${s.press} ${s.primary}`} href={store} onClick={getApp} aria-describedby="handoff-note">
          Get the app
        </a>
      ) : (
        <button type="button" className={`${s.press} ${s.primary}`} onClick={getApp} aria-describedby="handoff-note">
          Get the app
        </button>
      )}
      <a className={`${s.press} ${s.secondary}`} href={openUrl} onClick={() => void copyText(link)}>
        Open homecookd
      </a>
      <p ref={noteRef} id="handoff-note" className={s.note} role="status" aria-live="polite" data-strong={note ? '' : undefined}>
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

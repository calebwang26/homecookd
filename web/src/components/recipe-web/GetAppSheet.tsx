'use client';
// Get App -> this bottom sheet (motion spec 4): the hand-off to the app (FEEDBACK-OCT16c section C).
// Joining happens in the app (it has no email sign-in), so the sheet only gets them there: "Get the
// app" copies this recipe's link for the app's "Paste invite", then opens the store; "Open
// homecookd" copies it too and opens the app on this link. A share link joins them as a learner.
import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Handoff } from '@/components/invite/Handoff';
import { EggMascot } from '@/components/primitives/EggMascot';
import { appSchemeUrl, isPhoneOrTablet, WEB_ORIGIN } from '@/lib/app-links';
import { midSentence, possessive } from '@/lib/recipe-web/recipe';
import type { Share } from '@/lib/recipe-web/types';
import { Avatar } from './Avatar';
import { IconClose } from './icons';
import ui from './RecipeWeb.module.css';
import s from './Overlays.module.css';

/** "Join our family on homecookd" ("Our family" reads mid-sentence), else the sender's family. */
function joinTitle(family: string | null, sender: string | null): string {
  if (family) return `Join ${midSentence(family)} on homecookd`;
  if (sender) return `Join ${possessive(sender)} family on homecookd`;
  return 'Join your family on homecookd';
}

export function GetAppSheet({ onClose, share, reduced }: { onClose: () => void; share: Share; reduced: boolean }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const sender = share.sender;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // Focus the title so a screen reader hears what the sheet is for.
    const t = setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 260);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      html.style.overflow = was;
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const token = share.token;
  return (
    <div className={s.layer}>
      <div className={s.frame}>
        <motion.div
          className={s.backdrop}
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.24 } }}
          transition={{ duration: 0.22 }}
          aria-hidden="true"
        />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rw-sheet-title"
          className={s.sheet}
          initial={reduced ? { opacity: 0 } : { y: '100%' }}
          animate={reduced ? { opacity: 1 } : { y: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.15 } } : { y: '100%', transition: { duration: 0.24, ease: [0.55, 0.055, 0.675, 0.19] } }}
          transition={reduced ? { duration: 0.15 } : { type: 'spring', damping: 20, stiffness: 220, mass: 1 }}
        >
          <span className={s.grabber} aria-hidden="true" />
          <button type="button" className={`${ui.press} ${s.close}`} aria-label="Close" onClick={onClose}>
            <IconClose size={18} />
          </button>
          <div className={s.handoff}>
            {sender ? <Avatar name={sender.name} avatarKey={sender.avatar_key} size={64} /> : <EggMascot size={56} mood="hello" />}
            <h2 ref={titleRef} id="rw-sheet-title" className={s.sheetTitle} tabIndex={-1}>
              {joinTitle(share.family_name, sender?.name ?? null)}
            </h2>
            <Handoff
              link={`${WEB_ORIGIN}/r?s=${encodeURIComponent(token)}`}
              openUrl={appSchemeUrl('r', { s: token })}
              askName={sender?.name ?? null}
              phone={isPhoneOrTablet()}
              // Both buttons copy the link, so Paste invite has it even when the app doesn't open.
              // No-break spaces keep the button names whole when the line wraps.
              hint={'Already have it? Open\u00A0homecookd and tap Paste\u00A0invite.'}
            />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

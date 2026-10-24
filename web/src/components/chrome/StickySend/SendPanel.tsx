'use client';
// "Send this to {R}" with a result you can always see (QA B18). Used by the kid hero and StickySend.
//
//   const { send, panel } = useSend('send');
//   <Button onClick={send}>Send this to Dad</Button>
//   {panel}
//
// send() opens the share sheet (src/lib/share.ts). When there's no sheet (desktop browsers), it fails,
// or it doesn't answer in 3 s, the message is copied and a card rises at the bottom of the screen:
// "Copied. Paste it to Dad.", the link as plain selectable text, and Text it / Email it. It stays until
// it's closed (×, Escape), so the link can be selected by hand. The card is portaled to <body>: the
// hero overlay is transformed and clipped during the film, which would trap a fixed child.
// The live region is mounted from the first client render, so screen readers announce the card.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAudience, useCopy } from '@/components/providers/CopyProvider';
import { useRelation } from '@/components/providers/RelationProvider';
import { CloseIcon } from '@/components/icons/Icons';
import { logTap, type TapUi } from '@/lib/audience-route';
import { fill } from '@/lib/relation';
import { inviteUrl, mailtoHref, shareInvite, smsHref } from '@/lib/share';
import s from './StickySend.module.css';

type Shown = 'copied' | 'failed';

const noSubscribe = () => () => {};

export function useSend(ui: TapUi) {
  const copy = useCopy();
  const audience = useAudience();
  const { relation } = useRelation();
  const [shown, setShown] = useState<Shown | null>(null);
  const busy = useRef(false);

  const send = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    logTap(audience, ui);
    setShown(null);
    // a share sheet that answers after the card came up (sent or cancelled) puts the card away
    const res = await shareInvite(relation, copy, audience, () => setShown(null));
    busy.current = false;
    setShown(res === 'copied' || res === 'failed' ? res : null);
  }, [audience, copy, relation, ui]);

  const close = useCallback(() => setShown(null), []);
  return { send, panel: <SendPanel shown={shown} onClose={close} /> };
}

function SendPanel({ shown, onClose }: { shown: Shown | null; onClose: () => void }) {
  const copy = useCopy();
  const audience = useAudience();
  const { relation } = useRelation();
  const T = copy.finalCta;
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown, onClose]);

  if (!client) return null;
  return createPortal(
    <div role="status" className={s.live}>
      {shown ? (
        <div className={s.panel}>
          <p className={s.msg}>{fill(shown === 'copied' ? T.copied : T.sendLink, relation)}</p>
          <p className={s.url}>{inviteUrl(relation, audience)}</p>
          <p className={s.links}>
            <a className={s.link} href={smsHref(relation, copy, audience)}>
              {T.smsLabel}
            </a>
            <a className={s.link} href={mailtoHref(relation, copy, audience)}>
              {T.emailLinkLabel}
            </a>
          </p>
          <button type="button" className={s.close} onClick={onClose} aria-label={T.close}>
            <CloseIcon size={20} />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

'use client';
// K3, Ask Mom (the v2 "K3-AskMom" mockup): the message in the kid's voice (editable) and the share row
// (Caleb, Oct 31: no voice note here). A share asks her the questions (POST /dish/cards/ask) and marks the
// card sent (POST /dish/cards/sent), both inside the tap so they finish if the page is left.
import { useEffect, useId, useState } from 'react';
import { Sheet } from '@/components/dish/parts';
import { useLang, useRel } from '@/components/dish/lang';
import { later, openInstagram, SHARE_WAIT_MS, shareSheet, smsHref, whatsAppHref } from '@/components/dish/shareOut';
import { InstagramIcon, LinkIcon, MessageIcon, MoreIcon, WhatsAppIcon } from '@/components/dish/shareIcons';
import { copyText } from '@/lib/app-links';
import { askQuestions, DishError, getCard, markSent, updateCard } from '@/lib/dish/api';
import { saveName, savedName } from '@/lib/dish/saved';
import { openQuestions, pronounOf } from '@/lib/dish/text';
import type { AskItem, Card, SendVia } from '@/lib/dish/types';
import ui from '@/components/dish/ui.module.css';
import s from './ask.module.css';

type Props = { open: boolean; onClose: () => void; token: string; card: Card; onCard: (c: Card) => void; toast: (m: string, tone?: 'success' | 'error') => void; /** what the kid chose to ask (shape.askItems), sent with the share */ items: AskItem[] };

export function AskSheet({ open, onClose, token, card, onCard, toast, items }: Props) {
  const { t } = useLang();
  const rel = useRel();
  const id = useId();
  const R = rel(card.relation);
  const [name, setName] = useState(card.kidName ?? '');
  const [message, setMessage] = useState(card.message);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved name is only readable on the client
    if (!card.kidName) setName(savedName() ?? '');
  }, [card.kidName]);

  const open3 = openQuestions(card);
  const n = items.length || open3.length;
  const pronoun = pronounOf(card.relation);
  const sees = pronoun === 'she' ? t('ask.seesShe', { n }) : pronoun === 'he' ? t('ask.seesHe', { n }) : t('ask.seesName', { R, n });

  /** What changed in the sheet, saved before the link goes out (kept alive with the share). */
  const saveEdits = () => {
    const patch: { kidName?: string; message?: string } = {};
    const nm = name.trim().slice(0, 40);
    if (nm && nm !== card.kidName) {
      patch.kidName = nm;
      saveName(nm);
    }
    const msg = message.trim();
    if (msg && msg !== card.message && msg.length <= 500) patch.message = msg;
    if (Object.keys(patch).length) updateCard(token, patch).then(onCard, () => {});
  };

  const share = (via: SendVia) => {
    const url = card.askUrl; // null while the card has no one to ask (WhoSheet picks first)
    if (busy || !url) return;
    const text = `${message.trim() || card.message} ${url}`;
    saveEdits();
    // The chosen questions go first, then the send is marked; once both are in, the card is read again (they race).
    // His own words can be refused (the word filter): say so, and the rest still go.
    const asked = items.length
      ? askQuestions(token, items).then(onCard, (err: unknown) => {
          if (!(err instanceof DishError && err.kind === 'words')) return;
          toast(t('k1.words'), 'error');
          return askQuestions(token, items.filter((q) => q.id || q.about)).then(onCard, () => {});
        })
      : Promise.resolve();
    void Promise.all([asked, markSent(token, via).then(onCard, () => {})]).then(() => getCard(token).then(onCard, () => {}));
    if (via === 'copy') {
      void copyText(url).then((ok) => toast(ok ? t('share.copied') : t('share.noCopy'), ok ? 'success' : 'error'));
    } else if (via === 'sms') {
      window.location.href = smsHref(text);
    } else if (via === 'whatsapp') {
      window.open(whatsAppHref(text), '_blank', 'noopener');
    } else if (via === 'instagram') {
      void copyText(url).then((ok) => ok && toast(t('share.igCopied')));
      openInstagram();
    } else {
      const sheet = shareSheet(card.dish, text);
      if (!sheet) {
        void copyText(url).then((ok) => toast(ok ? t('share.copied') : t('share.noCopy'), ok ? 'success' : 'error'));
        return;
      }
      setBusy(true);
      void Promise.race([sheet, later(SHARE_WAIT_MS)]).then((out) => {
        setBusy(false);
        if (out === 'failed') toast(t('share.failed'), 'error');
      });
    }
  };

  const nameId = `${id}-name`;
  const msgId = `${id}-msg`;
  return (
    <Sheet open={open} onClose={onClose} labelledBy={id}>
      <h2 id={id} className={s.title}>
        {t('ask.title', { R })}
      </h2>
      {!card.kidName && (
        <>
          <label htmlFor={nameId} className={s.label}>
            {t('ask.name')}
          </label>
          <input id={nameId} className={s.name} value={name} maxLength={40} autoComplete="given-name" placeholder={t('ask.namePlaceholder', { R })} onChange={(e) => setName(e.target.value)} onBlur={saveEdits} />
        </>
      )}
      <label htmlFor={msgId} className={s.label}>
        {t('ask.message')}
      </label>
      <textarea id={msgId} className={s.message} value={message} maxLength={500} onChange={(e) => setMessage(e.target.value)} onBlur={saveEdits} dir="auto" />
      <p className={s.sees}>{sees}</p>
      <div className={s.rule} aria-hidden="true" />
      <div className={s.shareRow}>
        <ShareButton label={t('share.copy')} tone="ink" onClick={() => share('copy')} icon={<LinkIcon size={22} />} />
        <ShareButton label={t('share.sms')} tone="green" onClick={() => share('sms')} icon={<MessageIcon size={22} />} />
        <ShareButton label={t('share.instagram')} tone="peach" onClick={() => share('instagram')} icon={<InstagramIcon size={22} />} />
        <ShareButton label={t('share.whatsapp')} tone="forest" onClick={() => share('whatsapp')} icon={<WhatsAppIcon size={22} />} />
        <ShareButton label={t('share.more')} tone="grey" onClick={() => share('more')} icon={<MoreIcon size={22} />} />
      </div>
    </Sheet>
  );
}

function ShareButton({ label, tone, icon, onClick }: { label: string; tone: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={`${ui.press} ${s.share}`} onClick={onClick}>
      <span className={s.shareDisc} data-tone={tone}>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

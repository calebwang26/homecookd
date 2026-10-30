'use client';
// K3, Ask Mom (the v2 "K3-AskMom" and "K3b-VoiceEmpty" mockups): the message in the kid's voice
// (editable), a voice note for her (empty: hold to record; recorded: play and record again), and the
// share row. A share asks her the card's 3 suggested questions (POST /dish/cards/ask) and marks the
// card sent (POST /dish/cards/sent), both inside the tap so they finish if the page is left.
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Sheet, useAudio, Wave } from '@/components/dish/parts';
import { useLang, useRel } from '@/components/dish/lang';
import { later, openInstagram, SHARE_WAIT_MS, shareSheet, smsHref, whatsAppHref } from '@/components/dish/shareOut';
import { InstagramIcon, LinkIcon, MessageIcon, MoreIcon, WhatsAppIcon } from '@/components/dish/shareIcons';
import { useRecorder, canRecord } from '@/components/dish/useRecorder';
import { IconPause, IconPlay } from '@/components/recipe-web/icons';
import { copyText } from '@/lib/app-links';
import { askQuestions, getCard, markSent, updateCard, uploadFile } from '@/lib/dish/api';
import { saveName, savedName } from '@/lib/dish/saved';
import { clock, openQuestions, pronounOf } from '@/lib/dish/text';
import type { AskItem, Card, SendVia } from '@/lib/dish/types';
import { MicIcon } from './AskScreen';
import ui from '@/components/dish/ui.module.css';
import s from './ask.module.css';

const VOICE_MAX_MS = 60_000; // DISH-ASK-SPEC §4 /cards/update: a voice note for Mom is at most 60 s
const HOLD_MS = 300;

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
    const asked = items.length ? askQuestions(token, items).then(onCard, () => {}) : Promise.resolve();
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
      <VoiceNote token={token} card={card} onCard={onCard} />
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

type VoicePhase = 'idle' | 'arming' | 'recording' | 'saving' | 'short' | 'failed' | 'blocked';

/** The kid's voice note to Mom: hold to record (a quick tap switches to tap to stop), then it uploads. */
function VoiceNote({ token, card, onCard }: { token: string; card: Card; onCard: (c: Card) => void }) {
  const { t } = useLang();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [tap, setTap] = useState(false);
  const press = useRef<{ t0: number; up: boolean } | null>(null);
  const audio = useAudio();
  const rec = useRecorder(() => void stop(), VOICE_MAX_MS);

  const duration = card.kidVoiceS;

  const start = async () => {
    setPhase('arming');
    if (!(await rec.open())) return setPhase('blocked');
    if (!rec.begin()) return setPhase('blocked');
    setPhase('recording');
    setTap(!press.current || press.current.up);
  };

  async function stop() {
    setPhase('saving');
    const clip = await rec.stop();
    if (!clip || clip.durationS < 0.8) return setPhase('short');
    try {
      const fileId = await uploadFile('voice', clip.blob, clip.contentType);
      // Its length as measured here: Chrome's webm often carries none (spec: over 0, at most 60 s).
      const voiceNoteS = Math.min(60, Math.max(0.1, Math.round(clip.durationS * 10) / 10));
      onCard(await updateCard(token, { voiceNote: fileId, voiceNoteS }));
      setPhase('idle');
    } catch {
      setPhase('failed');
    }
  }

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    if (phase === 'recording') return void stop();
    if (phase === 'saving' || phase === 'arming') return;
    press.current = { t0: performance.now(), up: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the up event still arrives */
    }
    void start();
  };
  const onUp = () => {
    const p = press.current;
    if (!p) return;
    p.up = true;
    press.current = null;
    if (phase !== 'recording' || tap) return;
    if (performance.now() - p.t0 >= HOLD_MS) void stop();
    else setTap(true);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (phase === 'recording') void stop();
    else if (phase !== 'saving' && phase !== 'arming') {
      press.current = null;
      void start();
    }
  };

  const url = card.kidVoiceUrl;
  if (url && phase === 'idle') {
    const playing = audio.playing === url;
    return (
      <div className={s.voice}>
        <button type="button" className={`${ui.press} ${s.voicePlay}`} aria-label={playing ? t('ask.voicePause') : t('ask.voicePlay')} onClick={() => audio.play(url)}>
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>
        <span className={s.voiceWave}>
          <Wave progress={playing ? audio.progress : 1} bars={20} />
        </span>
        {duration != null && <span className={s.voiceTime}>{clock(duration)}</span>}
        <button type="button" className={`${ui.press} ${s.voiceRedo}`} aria-label={t('ask.voiceRedo')} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
            <path d="M4 4v4.5h4.5" />
          </svg>
        </button>
      </div>
    );
  }

  const recording = phase === 'recording';
  const line =
    phase === 'recording'
      ? tap
        ? `${clock(rec.elapsedMs / 1000)} · ${t('m3.tapStop')}`
        : `${clock(rec.elapsedMs / 1000)} · ${t('ask.voiceRecording')}`
      : phase === 'saving'
        ? t('ask.voiceSaving')
        : phase === 'short'
          ? t('ask.voiceShort')
          : phase === 'failed'
            ? t('ask.voiceFailed')
            : phase === 'blocked'
              ? t('attach.mic')
              : t('ask.voiceHint');
  return (
    <button
      type="button"
      className={`${ui.press} ${s.voiceEmpty}`}
      data-rec={recording || undefined}
      disabled={!canRecord()}
      aria-pressed={recording}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className={s.voiceMic}>
        <MicIcon size={20} />
      </span>
      <span>
        <span className={s.voiceTitle}>{t('ask.voiceAdd')}</span>
        <span className={s.voiceHint} aria-live="polite">
          {line}
        </span>
      </span>
    </button>
  );
}

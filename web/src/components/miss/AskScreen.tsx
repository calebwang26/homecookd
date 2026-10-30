'use client';
// K1, the dish box (the v2 "Main" mockup): what the kid misses, who makes it, and something from home
// (photos, a voice note). "Make my recipe" goes to MissApp. K5 is the same screen when today's
// budget is spent: the line, and the button off.
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { TopBar } from '@/components/dish/parts';
import { Rich, useLang, useRel } from '@/components/dish/lang';
import { canRecord, useRecorder } from '@/components/dish/useRecorder';
import { PotMascot } from '@/components/primitives/PotMascot';
import { IconClose } from '@/components/recipe-web/icons';
import { clock, relationFromWord } from '@/lib/dish/text';
import type { Relation } from '@/lib/dish/types';
import type { WordKey } from '@/lib/dish/words';
import ui from '@/components/dish/ui.module.css';
import s from './miss.module.css';

/** Pexels-licensed (public/media/stock/credits.json): stand-ins for "what you miss", never for their dish. */
const POLAROIDS = [
  { src: '/media/_opt/stock/dish-dal-320.webp', caption: 'grandma’s dal' },
  { src: '/media/_opt/stock/dish-pho-320.webp', caption: 'mom’s pho' },
  { src: '/media/_opt/stock/dish-dumplings-320.webp', caption: 'dad’s dumplings' },
];
const CHIPS: Relation[] = ['mom', 'dad', 'grandma'];
const MAX_PHOTOS = 3;
const VOICE_MAX_MS = 60_000;

export type Picked = { photos: File[]; voice: { blob: Blob; type: string; durationS: number } | null };

export type AskDraft = { dish: string; relation: Relation; other: string | null; picked: Picked };

type Props = {
  draft: AskDraft;
  onDraft: (d: AskDraft) => void;
  error: WordKey | null;
  limited: boolean;
  lastToken: string | null;
  onOpenLast: (e: MouseEvent) => void;
  onSubmit: () => void;
};

type SpeechRec = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };

function speechRecognition(): (new () => SpeechRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function AskScreen({ draft, onDraft, error, limited, lastToken, onOpenLast, onSubmit }: Props) {
  const { t } = useLang();
  const rel = useRel();
  const photoInput = useRef<HTMLInputElement>(null);
  const voiceInput = useRef<HTMLInputElement>(null);
  const otherId = useId();
  const [note, setNote] = useState<WordKey | null>(null);
  const [listening, setListening] = useState(false);
  const speech = useRef<SpeechRec | null>(null);
  const rec = useRecorder(() => void stopVoice(), VOICE_MAX_MS);
  const [thumbs, setThumbs] = useState<string[]>([]);

  useEffect(() => {
    const urls = draft.picked.photos.map((f) => URL.createObjectURL(f));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URLs for the picked files, freed below
    setThumbs(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [draft.picked.photos]);

  const set = (patch: Partial<AskDraft>) => onDraft({ ...draft, ...patch });
  const pick = (patch: Partial<Picked>) => set({ picked: { ...draft.picked, ...patch } });

  const otherRel = draft.other !== null ? relationFromWord(draft.other) : null;
  const otherUnknown = draft.other !== null && draft.other.trim().length > 1 && !otherRel;

  const startVoice = async () => {
    setNote(null);
    if (!canRecord()) return voiceInput.current?.click();
    if (!(await rec.open())) return setNote('attach.mic');
    rec.begin();
  };
  async function stopVoice() {
    const clip = await rec.stop();
    if (!clip || clip.durationS < 0.8) return;
    pick({ voice: { blob: clip.blob, type: clip.contentType, durationS: clip.durationS } });
  }

  const onMic = () => {
    const Rec = speechRecognition();
    if (!Rec) return rec.recording ? void stopVoice() : void startVoice();
    if (listening) return speech.current?.stop();
    const r = new Rec();
    r.lang = 'en-US';
    r.interimResults = true;
    r.onresult = (e) => {
      const said = Array.from(e.results, (res) => res[0]?.transcript ?? '').join('');
      onDraft({ ...draft, dish: said.slice(0, 200) });
    };
    r.onend = () => setListening(false);
    speech.current = r;
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  };

  const onPhotos = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));
    if (list.length) pick({ photos: [...draft.picked.photos, ...list].slice(0, MAX_PHOTOS) });
  };

  const shown = error ?? note;
  const recording = rec.recording;

  return (
    <main className={s.ask}>
      <TopBar />
      {/* "Your last dish" sits under the bar, so the bar stays the pot, homecookd and the language. */}
      {lastToken && (
        <a className={`${ui.press} ${s.lastDish}`} href={`/miss?k=${lastToken}`} onClick={onOpenLast}>
          {t('k1.lastDish')}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </a>
      )}
      <div className={s.polaroids} aria-hidden="true">
        {POLAROIDS.map((p) => (
          <div key={p.src} className={s.polaroid}>
            {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized WebP from scripts/media.mjs */}
            <img src={p.src} alt="" width={104} height={128} />
            <span className={s.caption}>{p.caption}</span>
          </div>
        ))}
      </div>
      <h1 className={s.h1}>
        <Rich text={t('k1.title')} />
      </h1>

      <div className={s.field}>
        <label htmlFor="dish" className={ui.srOnly}>
          {t('k1.dishLabel')}
        </label>
        <input
          id="dish"
          type="text"
          autoComplete="off"
          enterKeyHint="go"
          maxLength={200}
          placeholder={t('k1.dishPlaceholder')}
          value={draft.dish}
          onChange={(e) => set({ dish: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && !limited && onSubmit()}
          dir="auto"
        />
        <button
          type="button"
          className={`${ui.press} ${s.roundIcon}`}
          aria-label={listening ? t('k1.micStop') : t('k1.mic')}
          aria-pressed={listening || recording}
          onClick={onMic}
        >
          <MicIcon />
        </button>
      </div>

      {limited && (
        <div className={s.limit} role="status">
          <PotMascot size={40} />
          <div>
            <p className={s.limitTitle}>{t('k5.title')}</p>
            <p className={s.limitLine}>{t('k5.line')}</p>
          </div>
        </div>
      )}

      <div className={s.group} role="group" aria-labelledby="who">
        <p id="who" className={s.label}>
          {t('k1.who')}
        </p>
        <div className={s.chips}>
          {CHIPS.map((r) => (
            <button key={r} type="button" className={`${ui.press} ${s.chip}`} aria-pressed={draft.other === null && draft.relation === r} onClick={() => set({ relation: r, other: null })}>
              {rel(r)}
            </button>
          ))}
          <button type="button" className={`${ui.press} ${s.chip}`} aria-pressed={draft.other === null && draft.relation === 'none'} onClick={() => set({ relation: 'none', other: null })}>
            {t('rel.none')}
          </button>
          <button type="button" className={`${ui.press} ${s.chip}`} aria-pressed={draft.other !== null} aria-expanded={draft.other !== null} onClick={() => set({ other: draft.other ?? '' })}>
            {draft.other !== null && otherRel ? rel(otherRel) : t('rel.other')}
          </button>
        </div>
        {draft.other !== null && (
          <div className={s.other}>
            <label htmlFor={otherId} className={ui.srOnly}>
              {t('k1.otherLabel')}
            </label>
            <input
              id={otherId}
               
              autoFocus
              autoComplete="off"
              maxLength={20}
              placeholder={t('k1.otherPlaceholder')}
              value={draft.other}
              onChange={(e) => {
                const r = relationFromWord(e.target.value);
                onDraft({ ...draft, other: e.target.value, relation: r ?? draft.relation });
              }}
            />
            {otherUnknown && <p className={s.hint}>{t('k1.otherUnknown')}</p>}
          </div>
        )}
      </div>

      {!limited && (
        <div className={s.group}>
          <p className={s.label}>{t('k1.add')}</p>
          <p className={s.addLine}>{t('k1.addLine')}</p>
          <div className={s.addGrid}>
            <button type="button" className={`${ui.press} ${s.addButton}`} onClick={() => photoInput.current?.click()} disabled={draft.picked.photos.length >= MAX_PHOTOS}>
              <span className={s.addIcon}>
                <PhotoIcon />
              </span>
              {t('k1.photos')}
            </button>
            <button type="button" className={`${ui.press} ${s.addButton}`} aria-pressed={recording} onClick={() => (recording ? void stopVoice() : void startVoice())}>
              <span className={s.addIcon} data-tone={recording ? 'rec' : 'lavender'}>
                <MicIcon />
              </span>
              <span aria-live="polite">{recording ? t('k1.recording', { time: clock(rec.elapsedMs / 1000) }) : t('k1.voice')}</span>
            </button>
          </div>
          <input ref={photoInput} className={s.fileInput} type="file" accept="image/*" multiple tabIndex={-1} aria-hidden="true" onChange={(e) => (onPhotos(e.target.files), (e.target.value = ''))} />
          <input
            ref={voiceInput}
            className={s.fileInput}
            type="file"
            accept="audio/*"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick({ voice: { blob: f, type: f.type, durationS: 0 } });
              e.target.value = '';
            }}
          />
          {(thumbs.length > 0 || draft.picked.voice) && (
            <div className={s.picked}>
              {thumbs.map((u, i) => (
                <span key={u} className={s.thumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
                  <img src={u} alt="" />
                  <button type="button" className={s.remove} aria-label={t('k1.removePhoto', { n: i + 1 })} onClick={() => pick({ photos: draft.picked.photos.filter((_, j) => j !== i) })}>
                    <IconClose size={14} />
                  </button>
                </span>
              ))}
              {draft.picked.voice && (
                <span className={s.voiceChip}>
                  {t('k1.voiceAdded', { time: clock(draft.picked.voice.durationS) })}
                  <button type="button" aria-label={t('k1.removeVoice')} onClick={() => pick({ voice: null })}>
                    <IconClose size={14} />
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className={s.cta}>
        {shown && !limited && (
          <p className={s.error} role="alert">
            {t(shown)}
          </p>
        )}
        <button type="button" className={`${ui.press} ${ui.primary}`} disabled={limited || recording} onClick={onSubmit}>
          {t('k1.make')}
        </button>
        {!limited && <p className={s.free}>{t('k1.free')}</p>}
      </div>
    </main>
  );
}

export function MicIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-8 8" />
    </svg>
  );
}

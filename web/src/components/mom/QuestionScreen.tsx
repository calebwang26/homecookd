'use client';
// M3, one question at a time (the v2 "M3-HoldToTalk" mockup): Back, "1 of 3" and dots, "<Kid> asks",
// the question, what the kid guessed, and one big mic. Press and hold to talk, let go to send. A quick
// tap switches to tap to start, tap to stop; Enter or Space does the same, for anyone who can't hold.
// Each answer is sent the moment it stops (MomApp's onSave). Ported from the MVP's QuestionScreen.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useLang } from '@/components/dish/lang';
import { inAppBrowser, useRecorder, type Clip } from '@/components/dish/useRecorder';
import { IconBack } from '@/components/recipe-web/icons';
import { clock } from '@/lib/dish/text';
import type { QuestionId } from '@/lib/dish/types';
import type { WordKey } from '@/lib/dish/words';
import ui from '@/components/dish/ui.module.css';
import m from './mom.module.css';
import s from './QuestionScreen.module.css';

export type Pending = { qid: QuestionId; clip: Clip };
/** retry: keep the clip, offer Try again · redo: refused, record again · gone: MomApp shows another screen */
export type SaveOutcome = 'saved' | 'retry' | 'redo' | 'gone';
export type ShownQuestion = { id: QuestionId; text: string; guess: string | null };

const HOLD_MS = 300;
const MIN_S = 0.8;
const SAVED_MS = 700;
const NO_PROMPT_MS = 500;

type Phase =
  | { k: 'idle'; note: 'short' | 'quiet' | 'failed' | null }
  | { k: 'arming' }
  | { k: 'recording'; tap: boolean }
  | { k: 'saving' }
  | { k: 'saved' }
  | { k: 'retry'; pending: Pending }
  | { k: 'blocked' }
  | { k: 'elsewhere' }
  | { k: 'finishing' };
type Press = { id: number; t0: number; up: boolean; cancelled: boolean; stops: boolean };

function labelKey(p: Phase): WordKey {
  switch (p.k) {
    case 'idle':
      return p.note === 'short' ? 'm3.short' : p.note === 'quiet' ? 'm3.quiet' : p.note === 'failed' ? 'm3.failed' : 'm3.hold';
    case 'arming':
      return 'm3.hold';
    case 'recording':
      return p.tap ? 'm3.tapStop' : 'm3.letGo';
    case 'saving':
    case 'finishing':
      return 'm3.saving';
    case 'saved':
      return 'm3.saved';
    case 'retry':
      return 'm3.failed';
    case 'blocked':
      return 'm3.blocked';
    case 'elsewhere':
      return 'm3.elsewhere';
  }
}

type Props = {
  kid: string;
  questions: ShownQuestion[];
  answered: QuestionId[];
  canRecord: boolean;
  onSave: (pending: Pending) => Promise<SaveOutcome>;
  onFinish: () => Promise<void>;
  onBack: () => void;
};

export function QuestionScreen({ kid, questions, answered, canRecord, onSave, onFinish, onBack }: Props) {
  const { t } = useLang();
  const [index, setIndex] = useState(() => Math.max(0, questions.findIndex((q) => !answered.includes(q.id))));
  const [phase, setPhase] = useState<Phase>({ k: 'idle', note: null });
  const now = useRef({ phase, index });
  const press = useRef<Press | null>(null);
  const handled = useRef(false);
  const lastUp = useRef(-Infinity);
  const nextTimer = useRef<number | undefined>(undefined);
  const latest = useRef({ stopAndSend: async () => {} });
  const rec = useRecorder(() => void latest.current.stopAndSend());
  const labelId = useId();

  const go = (p: Phase) => {
    now.current.phase = p;
    setPhase(p);
  };
  const moveTo = (i: number) => {
    now.current.index = i;
    setIndex(i);
    go({ k: 'idle', note: null });
    if (window.scrollY > 0) window.scrollTo(0, 0);
  };

  const start = async (p: Press | null) => {
    const prompted = !rec.hasStream();
    go({ k: 'arming' });
    const ok = await rec.open();
    if (now.current.phase.k !== 'arming') return;
    if (!ok) return go({ k: inAppBrowser() ? 'elsewhere' : 'blocked' });
    // She let go while the browser asked for the microphone: don't record behind her back.
    if (p?.up && prompted && (p.cancelled || performance.now() - p.t0 > NO_PROMPT_MS)) return go({ k: 'idle', note: null });
    if (!rec.begin()) return go({ k: 'blocked' });
    go({ k: 'recording', tap: !p || p.up });
  };

  const stopAndSend = async () => {
    if (now.current.phase.k !== 'recording') return;
    const qid = questions[now.current.index].id;
    go({ k: 'saving' });
    const clip = await rec.stop();
    if (!clip || clip.durationS < MIN_S) return go({ k: 'idle', note: 'short' });
    if (clip.silent) return go({ k: 'idle', note: 'quiet' }); // never sent: a model would invent an answer
    await send({ qid, clip });
  };

  const send = async (pending: Pending) => {
    go({ k: 'saving' });
    const out = await onSave(pending);
    if (out === 'saved') {
      go({ k: 'saved' });
      nextTimer.current = window.setTimeout(next, SAVED_MS);
    } else if (out === 'retry') go({ k: 'retry', pending });
    else if (out === 'redo') go({ k: 'idle', note: 'failed' });
  };

  const next = () => {
    const i = now.current.index;
    if (i < questions.length - 1) moveTo(i + 1);
    else {
      go({ k: 'finishing' });
      void onFinish();
    }
  };

  const retryMic = async () => {
    if (await rec.open()) go({ k: 'idle', note: null });
    else window.location.reload(); // Safari keeps a "Don't Allow" until the page loads again
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    const ph = now.current.phase;
    const p: Press = { id: e.pointerId, t0: performance.now(), up: false, cancelled: false, stops: ph.k === 'recording' };
    if (ph.k === 'recording') {
      if (!ph.tap) return;
      press.current = p;
      handled.current = true;
      void stopAndSend();
      return;
    }
    if (ph.k !== 'idle') {
      handled.current = false;
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the up event still arrives */
    }
    press.current = p;
    handled.current = true;
    void start(p);
  };

  const onPointerEnd = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    press.current = null;
    p.up = true;
    p.cancelled = e.type === 'pointercancel';
    lastUp.current = performance.now();
    const ph = now.current.phase;
    if (p.stops || ph.k !== 'recording' || ph.tap) return;
    if (performance.now() - p.t0 >= HOLD_MS) void stopAndSend();
    else go({ k: 'recording', tap: true });
  };

  const onClick = () => {
    const repeat = handled.current && performance.now() - lastUp.current < 1000;
    handled.current = false;
    if (press.current || repeat) return;
    const ph = now.current.phase;
    if (ph.k === 'retry') void send(ph.pending);
    else if (ph.k === 'blocked') void retryMic();
    else if (ph.k === 'recording') void stopAndSend();
    else if (ph.k === 'idle') void start(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
  };

  useEffect(() => {
    latest.current.stopAndSend = stopAndSend;
  });

  useEffect(() => {
    // Switching apps mid-answer: send what she said rather than lose it.
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      press.current = null;
      void latest.current.stopAndSend();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.clearTimeout(nextTimer.current);
    };
  }, []);

  const q = questions[index];
  const isAnswered = answered.includes(q.id);
  const saving = phase.k === 'saving' || phase.k === 'finishing';
  const busy = saving || phase.k === 'arming' || phase.k === 'recording' || phase.k === 'saved';
  const retrying = phase.k === 'retry' || phase.k === 'blocked';
  const recordable = canRecord && phase.k !== 'elsewhere';
  const micState = phase.k === 'recording' ? 'rec' : phase.k === 'saved' ? 'saved' : saving ? 'saving' : retrying ? 'retry' : 'idle';
  const last = index === questions.length - 1;

  return (
    <div className={`${m.body} ${s.screen}`}>
      <div className={s.progress}>
        <button type="button" className={`${ui.press} ${ui.textLink} ${s.back}`} disabled={busy} onClick={() => (index > 0 ? moveTo(index - 1) : onBack())}>
          <IconBack size={18} />
          {t('common.back')}
        </button>
        <span className={s.spacer} />
        <span className={s.count}>{t('m3.of', { i: index + 1, n: questions.length })}</span>
        <span className={s.dots} aria-hidden="true">
          {questions.map((x, i) => (
            <span key={x.id} data-on={i === index || answered.includes(x.id) || undefined} />
          ))}
        </span>
      </div>
      <span className={`${m.pill} ${m.asks}`}>{t('m3.asks', { kid })}</span>
      <div className={s.ask} aria-live="polite">
        <h1 key={q.id} className={s.question} dir="auto">
          {q.text}
        </h1>
        {q.guess && <p className={m.guessChip}>{t('m3.guessed', { kid, guess: q.guess })}</p>}
        {isAnswered && phase.k !== 'saved' && <p className={s.saved}>{t('m3.saved')}</p>}
      </div>
      <div className={s.dock}>
        <div className={s.micWrap}>
          {recordable ? (
            <button
              type="button"
              className={`${ui.press} ${s.mic}`}
              data-state={micState}
              aria-label={retrying ? undefined : t('m3.record')}
              aria-pressed={retrying ? undefined : phase.k === 'recording'}
              aria-disabled={saving || phase.k === 'saved' || undefined}
              aria-describedby={labelId}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onClick={onClick}
              onKeyDown={onKeyDown}
              onContextMenu={(e) => e.preventDefault()}
            >
              {phase.k === 'recording' ? (
                <span className={s.recInner}>
                  <MicGlyph small />
                  <span className={s.time}>{clock(Math.floor(rec.elapsedMs / 1000))}</span>
                </span>
              ) : phase.k === 'saved' ? (
                <svg className={s.check} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={20} />
                </svg>
              ) : retrying ? (
                t('common.tryAgain')
              ) : (
                <MicGlyph />
              )}
            </button>
          ) : (
            <span className={`${s.mic} ${s.micOff}`} aria-hidden="true">
              <MicGlyph />
            </span>
          )}
          {saving && (
            <svg className={s.spinner} viewBox="0 0 140 140" aria-hidden="true" focusable="false">
              <circle cx="70" cy="70" r="66" />
            </svg>
          )}
        </div>
        <p id={labelId} className={s.label} role="status">
          {canRecord ? t(labelKey(phase)) : t('m3.elsewhere')}
        </p>
        {recordable && (
          <button type="button" className={`${ui.press} ${ui.textLink} ${s.skip}`} data-hidden={busy || undefined} disabled={busy} onClick={next}>
            {isAnswered ? (last ? t('m3.done') : t('m3.next')) : t('m3.skip')}
          </button>
        )}
        <p className={s.footer}>{t('m3.hear', { kid })}</p>
      </div>
    </div>
  );
}

function MicGlyph({ small }: { small?: boolean }) {
  return (
    <svg className={small ? s.glyphSmall : s.glyph} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x={9} y={3} width={6} height={11} rx={3} />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

'use client';
// Spotify-web "Get the app" popover: a coloured card anchored to what was tapped, with a small
// pointer, a specific title, one line, "Not now" and a white "Get App" pill.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { LockKind } from './context';
import ui from './RecipeWeb.module.css';
import s from './Overlays.module.css';

export type LockCopy = { title: string; line: string };

export function lockCopy(kind: LockKind, cook: string, dish: string): LockCopy {
  switch (kind) {
    case 'askFamily':
      return { title: 'Ask the family in the app', line: `Your question goes to the family, and ${cook} can answer with a voice note.` };
    case 'askStep':
      return { title: 'Ask the family about this step', line: 'In the app, your question arrives with this step attached, so they know just what you mean.' };
    case 'heart':
      return { title: 'Save it in the app', line: `Keep ${dish} with the rest of your family’s recipes.` };
    case 'share':
      return { title: 'Share it from the app', line: `Send ${dish} to anyone in your family, straight from homecookd.` };
    case 'madeIt':
      return { title: `Tell ${cook} you made it`, line: 'Send them a photo of yours from the app. It might make their week.' };
    case 'getApp':
    default:
      return { title: 'Cook with your family on homecookd', line: 'Their recipes, their voices, and your questions answered, all in the app.' };
  }
}

export function GetAppPopover({
  anchor,
  copy,
  onClose,
  onGetApp,
  reduced,
  labels = { notNow: 'Not now', getApp: 'Get App' },
}: {
  anchor: DOMRect;
  copy: LockCopy;
  /** the two buttons, in the page language on the dish pages */
  labels?: { notNow: string; getApp: string };
  onClose: () => void;
  onGetApp: () => void;
  reduced: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const getBtn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ above: boolean; top?: number; bottom?: number; px: number } | null>(null);

  useLayoutEffect(() => {
    const f = frame.current?.getBoundingClientRect();
    if (!f) return;
    const cx = anchor.left + anchor.width / 2 - f.left;
    const above = anchor.top + anchor.height / 2 > f.height * 0.5;
    const px = Math.min(Math.max(cx - 8, 28), f.width - 16 - 28);
    setPos(above ? { above, bottom: f.height - anchor.top + 12, px } : { above, top: anchor.bottom - f.top + 12, px });
  }, [anchor]);

  useEffect(() => {
    getBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={s.layer}>
      <div ref={frame} className={s.frame}>
        <div className={s.catcher} onClick={onClose} aria-hidden="true" />
        {pos && (
          <motion.div
            role="dialog"
            aria-modal="false"
            aria-labelledby="rw-pop-title"
            className={s.pop}
            style={{
              top: pos.top,
              bottom: pos.bottom,
              transformOrigin: `${pos.px + 8}px ${pos.above ? '100%' : '0%'}`,
            }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: pos.above ? 8 : -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
            transition={reduced ? { duration: 0.15 } : { type: 'spring', damping: 20, stiffness: 320, mass: 0.8 }}
          >
            <span className={s.pointer} data-above={pos.above || undefined} style={{ left: pos.px }} aria-hidden="true" />
            <h2 id="rw-pop-title" className={s.popTitle}>
              {copy.title}
            </h2>
            <p className={s.popLine}>{copy.line}</p>
            <div className={s.popActions}>
              <button type="button" className={`${ui.press} ${s.notNow}`} onClick={onClose}>
                {labels.notNow}
              </button>
              <button ref={getBtn} type="button" className={`${ui.press} ${s.getAppPill}`} onClick={onGetApp}>
                {labels.getApp}
              </button>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

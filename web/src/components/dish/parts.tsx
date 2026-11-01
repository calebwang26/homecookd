'use client';
// Pieces both dish pages share: the top bar, the dish hero (the kid's photo or the designed peach card,
// never a stock photo of some other dish), the bottom sheet, the toast, an audio player and the
// "Get the app" sheet (K4 for the kid, M6 for Mom).
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Logo } from '@/components/primitives/Logo';
import { IconClose } from '@/components/recipe-web/icons';
import { APP_STORE_URL, copyText, WEB_ORIGIN } from '@/lib/app-links';
import { CheckIcon } from './shareIcons';
import { LangSwitch, useLang } from './lang';
import ui from './ui.module.css';
import s from './dish.module.css';

/** The App Store page; NEXT_PUBLIC_APP_STORE_URL wins, so no Vercel change is needed. */
export const STORE_URL = APP_STORE_URL ?? 'https://apps.apple.com/app/id6825621614';

/** Straight to the store (Caleb, Oct 31: no sheet in between). A page with its own link copies it first, so the app can pick up the same dish. */
export function goToStore() {
  const open = () => {
    window.location.href = STORE_URL;
  };
  const { pathname, search } = window.location;
  if (search) void copyText(`${WEB_ORIGIN}${pathname}${search}`).finally(open);
  else open();
}

/** The bar on every page: the logo and "Get the app", then a row under it with `row` on the left and the language on the right. */
export function TopBar({ row, lang = true }: { row?: ReactNode; lang?: boolean }) {
  const { t } = useLang();
  return (
    <>
      <header className={s.topBar}>
        <span className={s.brand}>
          <Logo height={28} reversed />
        </span>
        <a
          className={`${ui.press} ${s.topGetApp}`}
          href={STORE_URL}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            goToStore();
          }}
        >
          {t('common.getApp')}
        </a>
      </header>
      {(row || lang) && (
        <div className={s.subBar}>
          <span className={s.subLeft}>{row}</span>
          {lang && <LangSwitch />}
        </div>
      )}
    </>
  );
}

/** The kid's own first photo, else the designed dish card: white, with the dish name in big Fraunces (never the egg). */
export function DishHero({ photoUrl, alt, height = 270, title, children }: { photoUrl: string | null; alt: string; height?: number; title?: string; children?: ReactNode }) {
  return (
    <div className={s.hero} style={{ height }} data-designed={photoUrl ? undefined : ''}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a Convex storage URL, outside the static loader
        <img src={photoUrl} alt={alt} className={s.heroImg} />
      ) : (
        <span className={s.heroName} style={{ fontSize: Math.max(18, Math.min(40, Math.round(height * 0.15))) }} aria-hidden="true">
          {height < 100 ? Array.from(title ?? '')[0]?.toUpperCase() : title}
        </span>
      )}
      {children}
    </div>
  );
}

/** A bottom sheet over a blurred page: Escape and the close button close it; focus goes in and comes back. */
export function Sheet({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const { t } = useLang();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className={s.sheetLayer}>
          <motion.div className={s.backdrop} aria-hidden="true" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.15 : 0.24 }} />
          <motion.section
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            className={s.sheet}
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0 } : { y: '100%' }}
            transition={reduced ? { duration: 0.15 } : { type: 'spring', damping: 30, stiffness: 300 }}
          >
            <span className={s.grabber} aria-hidden="true" />
            <button type="button" className={`${ui.press} ${s.sheetClose}`} aria-label={t('common.close')} onClick={onClose}>
              <IconClose size={18} />
            </button>
            {children}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}

type ToastItem = { id: number; message: string; tone: 'success' | 'error' };

export function useToast() {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef(0);
  const seq = useRef(0);
  const show = useCallback((message: string, tone: ToastItem['tone'] = 'success') => {
    window.clearTimeout(timer.current);
    seq.current += 1;
    setToast({ id: seq.current, message, tone });
    timer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, show };
}

/** The app's toast: an ink pill at the top with a green check disc (red with an x for an error). */
export function Toast({ toast }: { toast: ToastItem | null }) {
  const reduced = useReducedMotion();
  return (
    <div role="status" className={s.toastRegion}>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={s.toast}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ duration: reduced ? 0.15 : 0.22, ease: 'easeOut' }}
          >
            <span className={s.toastDisc} data-tone={toast.tone}>
              {toast.tone === 'error' ? <IconClose size={14} /> : <CheckIcon size={16} strokeWidth={3} />}
            </span>
            <span>{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * One audio element for the page: play(url) toggles; `playing` is the url playing now. With NEXT_PUBLIC_DISH_UPLOADS=links
 * read links expire, so a page open for over an hour can hold a dead one: `onStale` reloads the card for a fresh link, and
 * the next tap plays it. Convex's links never expire, so unset it does nothing, and a clip that won't play reloads nothing.
 */
export function useAudio(onStale?: () => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(null);
    setProgress(0);
  }, []);
  const play = useCallback(
    (url: string) => {
      if (playing === url) return stop();
      audio.current?.pause();
      const a = new Audio(url);
      audio.current = a;
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => {
        setPlaying(null);
        setProgress(0);
      };
      setPlaying(url);
      setProgress(0);
      a.play().catch((e: unknown) => {
        setPlaying(null);
        // Only a source that won't load: not a pause mid-start (AbortError), or a browser refusing to autoplay.
        if (process.env.NEXT_PUBLIC_DISH_UPLOADS === 'links' && (e as { name?: string }).name === 'NotSupportedError') onStale?.();
      });
    },
    [playing, stop, onStale],
  );
  useEffect(() => () => audio.current?.pause(), []);
  return { playing, progress, play, stop };
}

/** The voice-note bars, filled up to `progress`. */
export function Wave({ progress = 1, bars = 22 }: { progress?: number; bars?: number }) {
  const heights = [4, 10, 16, 8, 12, 6, 14, 10, 4, 12, 8, 16, 10, 6, 12, 4, 8, 14, 6, 4, 10, 8];
  return (
    <svg width={bars * 6} height="18" viewBox={`0 0 ${bars * 6} 18`} aria-hidden="true" className={s.wave}>
      {Array.from({ length: bars }, (_, i) => {
        const h = heights[i % heights.length];
        return <rect key={i} x={i * 6} y={(18 - h) / 2} width="3" height={h} rx="1.5" opacity={i / bars < progress ? 1 : 0.35} />;
      })}
    </svg>
  );
}

type Reason = { icon: 'bookmark' | 'bell' | 'heart'; tone: 'sage' | 'butter' | 'peach'; title?: string; text: string };

/**
 * "Get the app" (K4 and M6). The tap copies the page's own link first (on an iPhone as text/uri-list,
 * which the app's Paste button finds), then opens the App Store. "Open homecookd" uses the app's scheme:
 * a universal link never opens the app from a page on its own domain.
 */
export function AppSheet({
  open,
  onClose,
  visual,
  title,
  sub,
  reasons,
  extra,
  copyLink,
  schemeLink,
}: {
  open: boolean;
  onClose: () => void;
  visual: ReactNode;
  title: string;
  sub?: string;
  reasons: Reason[];
  /** under the reasons, above the button: Mom's recipe card, which opens the recipe */
  extra?: ReactNode;
  copyLink: string;
  schemeLink: string;
}) {
  const { t } = useLang();
  const id = useId();
  const getApp = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    void copyText(copyLink).finally(() => {
      window.location.href = STORE_URL;
    });
  };
  return (
    <Sheet open={open} onClose={onClose} labelledBy={id}>
      <div className={s.appVisual}>{visual}</div>
      <h2 id={id} className={s.appTitle}>
        {title}
      </h2>
      {sub && <p className={s.appSub}>{sub}</p>}
      <ul className={s.reasons}>
        {reasons.map((r) => (
          <li key={r.text}>
            <span className={s.reasonIcon} data-tone={r.tone}>
              <ReasonIcon icon={r.icon} />
            </span>
            <span>
              {r.title && <span className={s.reasonTitle}>{r.title}</span>}
              <span className={r.title ? s.reasonLine : s.reasonOnly}>{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
      {extra}
      <a className={`${ui.press} ${ui.primary} ${s.appButton}`} href={STORE_URL} onClick={getApp} data-testid="get-app">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
          <path d="M11 18.5h2" />
        </svg>
        {t('common.getApp')}
      </a>
      <div className={s.appLinks}>
        <button type="button" className={`${ui.press} ${ui.textLink}`} onClick={onClose}>
          {t('common.notNow')}
        </button>
        <a className={`${ui.press} ${ui.textLink} ${s.openApp}`} href={schemeLink}>
          Open homecookd
        </a>
      </div>
    </Sheet>
  );
}

function ReasonIcon({ icon }: { icon: Reason['icon'] }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon === 'bookmark' && <path d="M6 4h12v17l-6-4-6 4z" />}
      {icon === 'bell' && (
        <>
          <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z" />
          <path d="M10 21h4" />
        </>
      )}
      {icon === 'heart' && <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />}
    </svg>
  );
}

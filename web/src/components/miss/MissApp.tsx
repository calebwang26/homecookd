'use client';
// /miss, the kid's side of v2 (docs/PRD-V2.md §4 Phase 2): the dish box, then Making it, then tonight's
// version. The screen comes from the address, read on the client (static export):
//   /miss                  the dish box (K1)
//   /miss?k=<kid token>    that card (K2; Mom's version once she answered)
// A made card replaces /miss with /miss?k=…, and is remembered for "Your last dish". Ported from the
// MVP's MissApp (calebwang26/homecookd PR #40) onto the Convex /dish/* routes (DISH-ASK-SPEC).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { DishLangProvider, useLang } from '@/components/dish/lang';
import { PotMascot } from '@/components/primitives/PotMascot';
import { createCard, DishError, getCard, isPlausibleToken, uploadFile } from '@/lib/dish/api';
import { AttachError, photoToJpeg, voiceType } from '@/lib/dish/attach';
import { lastKidToken, saveLastKidToken, savedName } from '@/lib/dish/saved';
import { relationFromText } from '@/lib/dish/text';
import type { Card } from '@/lib/dish/types';
import type { WordKey } from '@/lib/dish/words';
import { AskScreen, type AskDraft } from './AskScreen';
import { CardScreen } from './CardScreen';
import ui from '@/components/dish/ui.module.css';
import s from './miss.module.css';

type Failure = 'not-found' | 'offline' | 'rate';

type View =
  | { name: 'boot' }
  | { name: 'ask' }
  | { name: 'making' }
  | { name: 'loading' }
  | { name: 'card'; token: string; card: Card }
  | { name: 'error'; failure: Failure; token: string | null };

const EMPTY: AskDraft = { dish: '', relation: 'mom', other: null, picked: { photos: [], voice: null } };

export function MissApp() {
  return (
    <DishLangProvider>
      <div className={s.page}>
        <div className={s.column}>
          <Miss />
        </div>
      </div>
    </DishLangProvider>
  );
}

function Miss() {
  const [view, setView] = useState<View>({ name: 'boot' });
  const [draft, setDraft] = useState<AskDraft>(EMPTY);
  const [error, setError] = useState<WordKey | null>(null);
  const [limited, setLimited] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const nav = useRef(0);
  const screen = useRef<HTMLDivElement>(null);

  const show = useCallback((next: View) => setView(next), []);

  const open = useCallback(
    (k: string) => {
      const id = ++nav.current;
      show({ name: 'loading' });
      getCard(k).then(
        (card) => {
          if (id !== nav.current) return;
          saveLastKidToken(k);
          show({ name: 'card', token: k, card });
        },
        (e: unknown) => {
          if (id !== nav.current) return;
          const kind = e instanceof DishError ? e.kind : 'network';
          if (kind === 'not-found' && lastKidToken() === k) saveLastKidToken(null);
          show({ name: 'error', failure: kind === 'rate' ? 'rate' : kind === 'network' || kind === 'busy' ? 'offline' : 'not-found', token: k });
        },
      );
    },
    [show],
  );

  const route = useCallback(() => {
    const k = new URLSearchParams(window.location.search).get('k');
    setLast(lastKidToken());
    if (k !== null && isPlausibleToken(k)) return open(k);
    nav.current++;
    show(k === null ? { name: 'ask' } : { name: 'error', failure: 'not-found', token: null });
  }, [open, show]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is only readable on the client (static export)
    route();
    window.addEventListener('popstate', route);
    return () => window.removeEventListener('popstate', route);
  }, [route]);

  const key = view.name === 'card' ? `card-${view.token}` : view.name === 'boot' ? 'ask' : view.name;
  // After an in-page move (not the first load), the new screen's heading takes focus.
  const moved = useRef(false);
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    const h = screen.current?.querySelector('h1');
    const first = !moved.current;
    if (view.name !== 'boot' && view.name !== 'loading') moved.current = true;
    if (!first && h && document.activeElement === document.body) {
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- once per screen

  const submit = useCallback(async () => {
    const dish = draft.dish.trim();
    const { photos, voice } = draft.picked;
    if (dish.length < 2 && !photos.length && !voice) return setError('k1.empty');
    const id = ++nav.current;
    const relation = draft.other === null && relationFromText(dish) ? relationFromText(dish)! : draft.relation;
    setError(null);
    show({ name: 'making' });
    try {
      const [photoIds, voiceId] = await Promise.all([
        Promise.all(photos.map(async (f) => uploadFile('photo', await photoToJpeg(f), 'image/jpeg'))),
        voice ? uploadFile('voice', voice.blob, voiceType(voice.blob)) : Promise.resolve(undefined),
      ]);
      const kidName = savedName();
      const { kidToken, card } = await createCard({
        dish,
        relation,
        ...(kidName ? { kidName } : {}),
        ...(photoIds.length ? { photos: photoIds } : {}),
        ...(voiceId ? { voiceNote: voiceId } : {}),
      });
      saveLastKidToken(kidToken);
      if (id !== nav.current) return;
      window.history.replaceState(null, '', `${window.location.pathname}?k=${kidToken}`);
      setDraft(EMPTY);
      show({ name: 'card', token: kidToken, card });
    } catch (e) {
      if (id !== nav.current) return;
      if (e instanceof DishError && e.kind === 'budget') setLimited(true);
      setError(
        e instanceof AttachError
          ? `attach.${e.key}`
          : e instanceof DishError && e.kind === 'not-a-dish'
            ? 'k1.notADish'
            : e instanceof DishError && e.kind === 'rate'
              ? 'k1.rate'
              : e instanceof DishError && e.kind === 'words'
              ? 'k1.words'
              : 'k1.failed',
      );
      show({ name: 'ask' });
    }
  }, [draft, show]);

  const goTo = (href: string, e?: MouseEvent) => {
    if (e && (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
    e?.preventDefault();
    window.history.pushState(null, '', href);
    route();
  };

  return (
    <div key={key} ref={screen} className={s.screen} data-boot={view.name === 'boot' || undefined}>
      {view.name === 'boot' || view.name === 'ask' ? (
        <AskScreen
          draft={draft}
          onDraft={(d) => (setDraft(d), setError(null))}
          error={error}
          limited={limited}
          lastToken={last}
          onOpenLast={(e) => last && goTo(`/miss?k=${last}`, e)}
          onSubmit={() => void submit()}
        />
      ) : view.name === 'making' ? (
        <Making />
      ) : view.name === 'loading' ? (
        <Skeleton />
      ) : view.name === 'card' ? (
        <CardScreen token={view.token} initial={view.card} onNewDish={(e) => goTo('/miss', e)} />
      ) : (
        <FailureScreen failure={view.failure} onRetry={() => (view.token ? open(view.token) : route())} onNewDish={(e) => goTo('/miss', e)} />
      )}
    </div>
  );
}

function Making() {
  const { t } = useLang();
  return (
    <main className={s.center} aria-busy="true">
      <PotMascot size={120} mood="happy" steam />
      <h1 className={s.centerTitle}>{t('making.title')}</h1>
    </main>
  );
}

function Skeleton() {
  const { t } = useLang();
  return (
    <main aria-busy="true" aria-label={t('card.opening')}>
      <div className={s.skHero}>
        <PotMascot size={112} />
      </div>
      <div className={s.skSheet}>
        <span className={s.skLine} style={{ width: '40%', height: 30 }} />
        <span className={s.skLine} style={{ width: '72%', height: 34 }} />
        <span className={s.skLine} style={{ width: '100%', height: 72 }} />
        <span className={s.skLine} style={{ width: '100%', height: 220 }} />
      </div>
    </main>
  );
}

function FailureScreen({ failure, onRetry, onNewDish }: { failure: Failure; onRetry: () => void; onNewDish: (e?: MouseEvent) => void }) {
  const { t } = useLang();
  const title: Record<Failure, WordKey> = { 'not-found': 'err.notFound', offline: 'common.offline', rate: 'err.rate' };
  return (
    <main className={s.center}>
      <PotMascot size={88} mood="talk" />
      <h1 className={s.centerTitle}>{t(title[failure])}</h1>
      {failure === 'not-found' ? (
        <a className={`${ui.press} ${ui.primary}`} href="/miss" onClick={(e) => onNewDish(e)}>
          {t('err.newOne')}
        </a>
      ) : (
        <button type="button" className={`${ui.press} ${ui.primary}`} onClick={onRetry}>
          {t('common.tryAgain')}
        </button>
      )}
    </main>
  );
}

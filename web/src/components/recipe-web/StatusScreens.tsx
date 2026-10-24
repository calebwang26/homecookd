'use client';
// While the recipe loads (a skeleton in the Kid-Recipe shape) and when a link can't open one.
// "Visit homecookd" is a plain <a>, never next/link: the lander only renders fully on a page load.
import { PotMascot } from '@/components/primitives/PotMascot';
import { LANDER_LINK } from '@/lib/app-links';
import type { LoadErrorKind } from '@/lib/recipe-web/api';
import ui from './RecipeWeb.module.css';
import s from './StatusScreens.module.css';

export function LoadingScreen() {
  return (
    <div className={s.skeleton} aria-busy="true" aria-label="Opening the recipe">
      <div className={s.skHero} />
      <div className={s.skSheet}>
        <span className={s.skLine} style={{ width: '78%', height: 30 }} />
        <span className={s.skLine} style={{ width: '56%', height: 18 }} />
        <span className={s.skBlock} style={{ height: 76 }} />
        <span className={s.skBlock} style={{ height: 72 }} />
      </div>
    </div>
  );
}

const COPY: Record<LoadErrorKind, { title: string; line: string }> = {
  missing: {
    title: 'This link lost its recipe',
    line: 'It looks like part of the link went missing. Ask whoever sent it to share it again.',
  },
  'not-found': {
    title: 'We couldn’t find this recipe',
    line: 'The link may have been mistyped, or it was taken back. Ask whoever sent it for a fresh one.',
  },
  network: {
    title: 'We couldn’t reach the kitchen',
    line: 'Check your connection, then try again. The recipe will be right here.',
  },
};

export function ErrorScreen({ kind, onRetry }: { kind: LoadErrorKind; onRetry?: () => void }) {
  const c = COPY[kind];
  return (
    <div className={s.error}>
      <PotMascot size={88} mood="talk" />
      <h1 className={s.title}>{c.title}</h1>
      <p className={s.line}>{c.line}</p>
      <div className={s.actions}>
        {kind === 'network' && onRetry && (
          <button type="button" className={`${ui.press} ${s.primary}`} onClick={onRetry}>
            Try again
          </button>
        )}
        <a className={`${ui.press} ${kind === 'network' ? s.secondary : s.primary}`} href={LANDER_LINK.learner}>
          Visit homecookd
        </a>
      </div>
    </div>
  );
}

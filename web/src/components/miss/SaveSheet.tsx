'use client';
// K4, "Get it on your phone.": the sheet the Save button opens, and the one the locked recipe view's
// "Get the app" opens (KidRecipe). "Get the app" copies /miss?k=<kid token> first, then opens the store.
import { AppSheet, DishHero } from '@/components/dish/parts';
import { useLang } from '@/components/dish/lang';
import { appSchemeUrl, WEB_ORIGIN } from '@/lib/app-links';
import { pronounOf } from '@/lib/dish/text';
import type { Relation } from '@/lib/dish/types';
import s from './miss.module.css';

export function SaveSheet({ open, onClose, photo, relation, token }: { open: boolean; onClose: () => void; photo: string | null; relation: Relation; token: string }) {
  const { t } = useLang();
  const R = t(`rel.${relation}`);
  const pronoun = pronounOf(relation);
  return (
    <AppSheet
      open={open}
      onClose={onClose}
      visual={<SavedFan photo={photo} />}
      title={t('get.title')}
      reasons={[
        { icon: 'bookmark', tone: 'sage', title: t('get.keep'), text: t('get.keepLine') },
        { icon: 'bell', tone: 'butter', title: t('get.know', { R }), text: t(pronoun === 'he' ? 'get.knowLineHe' : 'get.knowLineShe') },
      ]}
      copyLink={`${WEB_ORIGIN}/miss?k=${token}`}
      schemeLink={appSchemeUrl('miss', { k: token })}
    />
  );
}

function SavedFan({ photo }: { photo: string | null }) {
  return (
    <div className={s.fan} aria-hidden="true">
      <span className={s.fanCard} />
      <span className={s.fanCard} />
      <div className={s.fanWrap}>
        <div className={s.fanFront}>
          <DishHero photoUrl={photo} alt="" height={134} />
        </div>
        <span className={s.badge}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 4h12v17l-6-4-6 4z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

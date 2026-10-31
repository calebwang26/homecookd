'use client';
// The kid's card (tonight's version, or Mom's once she answered) as the locked recipe view: its ingredients and
// its steps open, with no cover page (Caleb, Oct 31: it only repeated the card); every other tap says "Get it on your phone.", and Get the app goes to the store.
import { useMemo } from 'react';
import { useLang, useRel } from '@/components/dish/lang';
import { DishRecipeView } from '@/components/recipe-web/DishRecipeView';
import { cardTitle } from '@/lib/dish/text';
import type { Card, Recipe } from '@/lib/dish/types';

export function KidRecipe({ card, token, version, onClose }: { card: Card; token: string; version: Recipe; onClose: () => void }) {
  const { t } = useLang();
  const R = useRel()(card.relation);
  const clips = useMemo(() => Object.fromEntries(card.answers.map((a) => [a.id, { audioUrl: a.audioUrl, durationS: a.durationS }])), [card.answers]);
  const photo = card.photoUrls[0] ?? null;
  const title = cardTitle(card.relation, version.dish || card.dish);
  const meta = [card.version ? t('card.fromKitchen', { R }) : t('card.guessMeta'), version.time, version.servings && t('card.serves', { n: version.servings })].filter(Boolean).join(' · ');
  return (
    <DishRecipeView
      id={token}
      start="ingredients"
      coverless
      title={title}
      photo={photo}
      version={version}
      R={R}
      hear={t('card.hear', { R })}
      meta={meta}
      clips={clips}
      popover={{ title: t('get.title'), line: t('get.keepLine') }}
      onClose={onClose}
    />
  );
}

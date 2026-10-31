'use client';
// The kid's card (tonight's version, or Mom's once she answered) as the locked recipe view: the recipe, its
// ingredients and its steps open; every other tap says "Get it on your phone." and opens K4's sheet.
import { useCallback, useMemo } from 'react';
import { useLang, useRel } from '@/components/dish/lang';
import { DishRecipeView } from '@/components/recipe-web/DishRecipeView';
import { cardTitle } from '@/lib/dish/text';
import type { Card, Recipe } from '@/lib/dish/types';
import { SaveSheet } from './SaveSheet';

export function KidRecipe({ card, token, version, start, onClose }: { card: Card; token: string; version: Recipe; start: 'recipe' | 'ingredients'; onClose: () => void }) {
  const { t } = useLang();
  const R = useRel()(card.relation);
  const clips = useMemo(() => Object.fromEntries(card.answers.map((a) => [a.id, { audioUrl: a.audioUrl, durationS: a.durationS }])), [card.answers]);
  const photo = card.photoUrls[0] ?? null;
  const title = cardTitle(card.relation, version.dish || card.dish);
  const meta = [card.version ? t('card.fromKitchen', { R }) : t('card.guessMeta'), version.time, version.servings && t('card.serves', { n: version.servings })].filter(Boolean).join(' · ');
  const sheet = useCallback(
    ({ open, onClose: close }: { open: boolean; onClose: () => void }) => <SaveSheet open={open} onClose={close} photo={photo} relation={card.relation} token={token} title={title} />,
    [photo, card.relation, title, token],
  );
  return (
    <DishRecipeView
      id={token}
      start={start}
      title={title}
      photo={photo}
      version={version}
      R={R}
      hear={t('card.hear', { R })}
      meta={meta}
      clips={clips}
      popover={{ title: t('get.title'), line: t('get.keepLine') }}
      sheet={sheet}
      onClose={onClose}
    />
  );
}

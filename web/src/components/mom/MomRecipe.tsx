'use client';
// Mom's recipe from the Sent screen (M5) or the film ask (M6): her version as the locked recipe view. The
// recipe, its ingredients and its steps open; every other tap says what the app is for, in her words.
import { useMemo } from 'react';
import { useLang, useRel } from '@/components/dish/lang';
import { DishRecipeView } from '@/components/recipe-web/DishRecipeView';
import { cardTitle } from '@/lib/dish/text';
import type { Ask, Recipe } from '@/lib/dish/types';

export function MomRecipe({ ask, kid, token, version, onClose }: { ask: Ask; kid: string; token: string; version: Recipe; onClose: () => void }) {
  const { t } = useLang();
  const R = useRel()(ask.relation);
  const clips = useMemo(() => Object.fromEntries(ask.clips.map((c) => [c.id, { audioUrl: c.audioUrl, durationS: c.durationS }])), [ask.clips]);
  const meta = [t('m4.fromKitchen', { R }), version.time, version.servings && t('card.serves', { n: version.servings })].filter(Boolean).join(' · ');
  return (
    <DishRecipeView
      id={token}
      title={cardTitle(ask.relation, version.dish || ask.guess.dish || ask.dish)}
      photo={ask.photoUrls[0] ?? null}
      version={version}
      R={R}
      hear={t('m4.hear')}
      meta={meta}
      clips={clips}
      popover={{ title: t('m6.title', { kid }), line: t('m6.save') }}
      onClose={onClose}
    />
  );
}

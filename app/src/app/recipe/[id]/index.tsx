// The recipe overview (mockup direction A, kid QA round 2 notes 2, 3 and 5), for kids and parents:
// the dish photo (with a recording, the photo is the full video: "▶ Full video · 51:43" on it, tap
// to play), then a cream sheet with the title, "by Dad", "~45 min  Serves 4" big, "N steps" (number +
// title per step) and "Ingredients" (amount + name, tap to tick off; ticks saved per profile + dish).
// Share and heart sit on the photo and scroll away with it; only Back stays pinned, on a solid disc, so
// nothing see-through lands on the words. homie sits centred between Back and the heart when that's the
// whole row (even); with Share there too it joins Share and the heart at the right, 12 pt apart like them.
// Once the photo has scrolled away it glides to the top-right corner, off the words. No Share on a family dish whose stories and tips are kept
// from this person (useStoriesWithheld): the web page a link opens would show them all. The photo is
// ~42% of the screen (a small phone still shows the first steps above the button). One pinned green
// "Start cooking" goes straight to step 1, or "Back to step 4" when this profile left off there.
// Family never sees the word "sample".
// Once I've tapped "I made it" on this dish, "by Dad" reads "by Dad · You made this".
// Logs a `viewed` event once per visit, only once the recipe has loaded.
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { useMediaSheet } from '@/components/media';
import { BottomBar, CookAvatar, IngredientChecklist, RecipeFacts, StepList, useBottomClearance, useScreenTop } from '@/components/recipe/parts';
import { useLastStep } from '@/components/recipe/progress';
import { fullVideoLabel } from '@/components/recipe/text';
import { HeartButton } from '@/components/recipes/HeartButton';
import { useRecipeStats } from '@/components/recipes/stats';
import {
  ActionButton,
  ArrowRightIcon,
  BackIcon,
  detailContentEnter,
  EmptyState,
  heroEnter,
  IconButton,
  PlayIcon,
  PotMark,
  PressableScale,
  ShareIcon,
  Skeleton,
  Txt,
} from '@/components/ui';
import { mmss } from '@/lib/format';
import { HOMIE_SIZE, useHomieRoute, useHomieScreen } from '@/lib/homie';
import { logViewed } from '@/lib/messaging';
import { useRecipe, useStoriesWithheld } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useShare } from '@/lib/share';
import type { Recipe } from '@/lib/types';
import { alpha, colors, radii } from '@/theme/tokens';

/** The cream sheet's rounded top laps over the photo by this much. */
const OVERLAP = 44;
const PILL_H = 56;

/** The photo: ~42% of the screen, 240 to 380 tall (the mockup's 380 on the biggest phones). */
function useHeroHeight(): number {
  const { height } = useWindowDimensions();
  return Math.round(Math.min(380, Math.max(240, height * 0.42)));
}

export default function RecipeRoute() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  return <RecipeScreen id={rawId ? String(rawId) : ''} />;
}

/** The recipe page itself; also the dish inside the kid's Recipes tab (/kid/recipes/<id>). */
export function RecipeScreen({ id }: { id: string }) {
  const { recipe, entry, loading, missing } = useRecipe(id);
  const { me } = useSession();
  const media = useMediaSheet();
  const share = useShare();
  const storiesKept = useStoriesWithheld(id);
  const top = useScreenTop();
  const clearance = useBottomClearance();
  const heroH = useHeroHeight();
  const sheetTop = heroH - OVERLAP;
  const { step: lastStep } = useLastStep(id);
  const stats = useRecipeStats();
  const madeIt = (stats.byId[id]?.cooked ?? 0) > 0;

  // One `viewed` per visit, once the recipe really exists and we know who is looking.
  const meId = me?.id;
  const loadedId = recipe?.id;
  useEffect(() => {
    if (loadedId && meId) logViewed(loadedId);
  }, [loadedId, meId]);

  // Past the photo (Share and the heart gone with it), homie moves to the corner instead of the words.
  const { width: winW } = useWindowDimensions();
  const { frame: homieRest } = useHomieRoute();
  const [pastPhoto, setPastPhoto] = useState(false);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPastPhoto(e.nativeEvent.contentOffset.y > heroH - top - HOMIE_SIZE.header - 12);
  const size = HOMIE_SIZE.header;
  const corner = { x: winW - 24 - size, y: homieRest.y, size };
  // Share (48) and the heart (48) sit 24 and 84 pt from the right edge; homie 12 pt left of Share.
  const withShare = { x: winW - 24 - 48 - 12 - 48 - 12 - size, y: homieRest.y, size };
  useHomieScreen({ dock: pastPhoto ? corner : storiesKept ? null : withShare });

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const poster = recipe?.media.poster_url ?? entry?.poster_url ?? null;
  const title = recipe?.title ?? entry?.title ?? '';

  const backButton = (
    <IconButton tone="cream" icon={<BackIcon size={22} color={colors.ink} />} accessibilityLabel="Back" onPress={back} style={[styles.float, { top, left: 24 }]} />
  );

  if (!recipe) {
    return (
      <View style={styles.page}>
        <View style={[styles.hero, { height: heroH }]}>
          {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Skeleton width="100%" height={heroH} radius={0} />}
        </View>
        <View style={[styles.sheet, { top: sheetTop, position: 'absolute', left: 0, right: 0, bottom: 0 }]}>
          {missing || (!loading && !recipe) ? (
            <EmptyState title="We couldn’t find this recipe" actionLabel="Back" onAction={back} />
          ) : (
            <View style={{ gap: 12 }}>
              {title ? (
                <Txt variant="display" size={30} leading={1.1}>
                  {title}
                </Txt>
              ) : (
                <Skeleton width="80%" height={34} />
              )}
              <Skeleton width="40%" height={18} />
              <Skeleton width="60%" height={26} />
            </View>
          )}
        </View>
        {backButton}
      </View>
    );
  }

  const cook = recipe.cook.name;
  const resume = lastStep > 1 && lastStep <= recipe.steps.length;
  const start = resume ? lastStep : 1;

  return (
    <View style={styles.page}>
      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ paddingBottom: clearance }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        bounces={false}>
        <Hero recipe={recipe} poster={poster} height={heroH} below={top + 48 + 12} onWatch={() => media.watch({ recipe, whole: true })} />
        {storiesKept ? null : (
          <IconButton
            tone="glass"
            icon={<ShareIcon size={21} color={colors.ink} />}
            accessibilityLabel={`Share ${title}`}
            onPress={() => share.open({ recipeId: id })}
            style={[styles.float, { top, right: 24 + 48 + 12 }]}
          />
        )}
        <HeartButton tone="glass" recipeId={id} title={title} style={[styles.float, { top, right: 24 }]} />

        <Animated.View entering={detailContentEnter} style={[styles.sheet, { marginTop: -OVERLAP }]}>
          <View style={styles.titleBlock}>
            <Txt variant="display" size={30} leading={1.1} accessibilityRole="header">
              {title}
            </Txt>
            <View style={styles.byRow}>
              <CookAvatar recipe={recipe} size={24} />
              <Txt variant="body" size={15} color={colors.muted} style={styles.flex}>
                by {cook}
                {madeIt ? <Txt variant="body" size={15} weight={600} color={colors.greenDeep}>{' · You made this'}</Txt> : null}
              </Txt>
            </View>
            {recipe.source ? (
              <Txt variant="caption" size={13}>
                Video: {recipe.source}
              </Txt>
            ) : null}
          </View>

          <RecipeFacts recipe={recipe} />
          <StepList steps={recipe.steps} />
          <IngredientChecklist recipe={recipe} />
        </Animated.View>
      </ScrollView>

      {backButton}

      {recipe.steps.length ? (
        <BottomBar>
          <ActionButton
            label={resume ? `Back to step ${start}` : 'Start cooking'}
            iconRight={<ArrowRightIcon size={22} color={colors.card} />}
            onPress={() => router.push({ pathname: '/cook/[id]', params: { id, step: String(start) } })}
            style={styles.flex}
          />
        </BottomBar>
      ) : null}
    </View>
  );
}

/**
 * The dish photo. With a recording it is the full video: tap anywhere on it (or its pill) to play. The
 * pill sits in the middle of what the sheet leaves showing, never higher than `below` (the buttons).
 */
function Hero({ recipe, poster, height, below, onWatch }: { recipe: Recipe; poster: string | null; height: number; below: number; onWatch: () => void }) {
  const hasVideo = !!recipe.media.video_url;
  const whole = recipe.media.duration_s || 0;
  const label = `Play the full video of ${recipe.cook.name} making it${whole ? `, ${mmss(whole)}` : ''}`;
  const photo = poster ? (
    <Image
      source={{ uri: poster }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      transition={200}
      accessibilityLabel={hasVideo ? undefined : `${recipe.title}, from ${recipe.cook.name}’s kitchen`}
    />
  ) : (
    <View style={[StyleSheet.absoluteFill, styles.noPoster]}>
      <PotMark size={72} />
    </View>
  );
  return (
    <Animated.View entering={heroEnter} style={[styles.hero, { height }]}>
      {hasVideo ? (
        // No scale on a full-width photo: pressing just dims it a little.
        <PressableScale onPress={onWatch} scaleTo={1} accessibilityRole="button" accessibilityLabel={label} style={StyleSheet.absoluteFill}>
          {photo}
          <View pointerEvents="none" style={[styles.playWrap, { top: Math.max(below, Math.round((height - OVERLAP - PILL_H) / 2) + 10) }]}>
            <View style={styles.playPill}>
              <PlayIcon size={18} color={colors.ink} />
              <Txt variant="label" size={17} weight={700} numberOfLines={1}>
                {fullVideoLabel(whole)}
              </Txt>
            </View>
          </View>
        </PressableScale>
      ) : (
        photo
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page, overflow: 'hidden' },
  hero: { width: '100%', backgroundColor: colors.well, overflow: 'hidden' },
  noPoster: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.peach },
  // Centred in the photo above the sheet's overlap, a little low for the buttons (A-Overview-Steak).
  playWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  playPill: {
    height: PILL_H,
    paddingLeft: 18,
    paddingRight: 22,
    borderRadius: 999,
    backgroundColor: alpha.glassButton,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  float: { position: 'absolute' },
  sheet: {
    backgroundColor: colors.page,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: 28,
    paddingHorizontal: 24,
    gap: 20,
  },
  titleBlock: { gap: 10 },
  byRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
});

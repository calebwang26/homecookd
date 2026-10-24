// The cook's own recipe page (bible: Parent-Recipe).
//  hero photo: Back pill, Share (opens the share sheet), "Watch yourself · N min" (the whole video)
//  sheet: title, "Sent Sunday, Sep 28" (from activity), a real quote card, "♥ 4 · Leo, Maya, Dad"
//         (who in the family hearted it, from GET /dish-stats; hidden at 0; RETENTION-HANDOFF 3.5),
//         "Who cooked it" (learners: cooked with their note, or "Not yet" + "Send to Maya" via /send-recipe)
//  docked: "Leo asked you" for an open question about this recipe -> the chat
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DishStatsLine, useDishStats } from '@/components/hearts';
import { useMediaSheet } from '@/components/media';
import { HearQuestion, isSpoken } from '@/components/messages/HearQuestion';
import { AskedCard } from '@/components/parent/cards';
import { questionText, useKitchen } from '@/components/parent/kitchen';
import { WhoCooked } from '@/components/parent/WhoCooked';
import {
  BackIcon,
  BackPill,
  ChevronRightIcon,
  detailContentEnter,
  EmptyState,
  heroEnter,
  IconButton,
  PlayIcon,
  PressableScale,
  ShareIcon,
  Skeleton,
  StickyHeader,
  Txt,
  useScrollY,
} from '@/components/ui';
import { minutesLabel, shortDate } from '@/lib/format';
import { firstQuote, hasVideo, shortestQuote, useRecipe } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useShare } from '@/lib/share';
import { useRecipeActivity } from '@/lib/messaging';
import { alpha, colors, radii, space } from '@/theme/tokens';

const HERO_H = 290;
const SHEET_TOP = 252;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/recipes');
}

export default function MyRecipe() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '';
  const insets = useSafeAreaInsets();
  const { recipe, entry, missing } = useRecipe(id);
  const { activity, error: activityError, refresh: refreshActivity } = useRecipeActivity(id);
  const { me, learners, profiles } = useSession();
  const k = useKitchen();
  const media = useMediaSheet();
  const share = useShare();
  const { scrollY, onScroll } = useScrollY();
  const [dockH, setDockH] = useState(0);
  const [whoBottom, setWhoBottom] = useState(0);
  const { height: windowH } = useWindowDimensions();
  // Who in the family hearted this dish (the server answers only its cook).
  const statIds = useMemo(() => (id ? [id] : []), [id]);
  const { stats } = useDishStats(statIds);

  // This page is the cook's own view ("Watch yourself", Send). Anyone else's recipe opens the
  // family recipe page instead (a deep link, or a dish someone forwarded).
  const mine = !!entry && !!me && entry.cook_name.trim().toLowerCase() === me.name.trim().toLowerCase();
  useEffect(() => {
    if (entry && me && !mine) router.replace({ pathname: '/recipe/[id]', params: { id } });
  }, [entry, me, mine, id]);

  const top = Math.max(space.topDetail, insets.top + 9);
  const title = recipe?.title ?? entry?.title ?? '';
  const poster = recipe?.media.poster_url ?? entry?.poster_url ?? null;

  if (missing && !recipe) {
    return (
      <View style={[styles.screen, { paddingTop: top, paddingHorizontal: space.gutter }]}>
        <BackPill onPress={goBack} />
        <EmptyState
          title="We couldn't find this recipe"
          actionLabel="Back to your recipes"
          onAction={() => router.replace('/parent/recipes')}
        />
      </View>
    );
  }

  // Someone else's dish: the redirect above is on its way.
  if (entry && me && !mine) return <View style={styles.screen} />;

  // Two lines in the peach card, as in the bible (about 40 italic characters a line).
  const q = firstQuote(recipe);
  const quote = q && q.full.length <= 78 ? q.full : (shortestQuote(recipe, 78)?.full ?? null);
  const video = hasVideo(recipe);
  const watchLabel =
    recipe && video && recipe.media.duration_s > 0 ? `Watch yourself · ${minutesLabel(recipe.media.duration_s)}` : 'Watch yourself';
  // Only my own sends (activity.last_sent_at counts anyone forwarding the dish). undefined = still
  // loading (skeleton), null = not sent yet or couldn't load (nothing; "Who cooked it" has Send).
  const mySent = k.sent.find((s) => s.message.recipe_id === id)?.message.created_at ?? null;
  const sentLine: string | null | undefined = mySent ? `Sent ${shortDate(mySent)}` : k.ready || activityError || k.error ? null : undefined;
  const family = learners.filter((l) => l.id !== me?.id);
  const asked = k.waiting.find((w) => w.message.recipe_id === id) ?? null;
  const dockBottom = Math.max(24, insets.bottom + 8);
  // Docked over empty space below the list (bible); when the content reaches the dock it joins the
  // flow after "Who cooked it" instead, so it never covers a row.
  const inline = !!asked && dockH > 0 && whoBottom > windowH - dockBottom - dockH - 24;
  const dockSpace = asked && !inline ? dockH + dockBottom + 24 : Math.max(32, insets.bottom + 24);
  const askedCard = asked ? (
    <AskedCard
      docked
      who={asked.other}
      question={questionText(asked.message)}
      voice={asked.message.kind === 'question' && isSpoken(asked.message) ? <HearQuestion from={asked.other} question={asked.message} style={styles.hearOnLavender} /> : undefined}
      onAnswer={() => router.push({ pathname: '/chat/[id]', params: { id: asked.threadId, q: asked.message.id } })}
    />
  ) : null;

  return (
    <View style={styles.screen}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}>
        {/* Hero */}
        <Animated.View entering={heroEnter} style={styles.hero}>
          {poster ? (
            <Image
              source={{ uri: poster }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={200}
              accessibilityLabel={title}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.peach }]} />
          )}
          <BackPill overPhoto onPress={goBack} style={[styles.back, { top }]} />
          {recipe ? (
            <IconButton
              tone="glass"
              size={48}
              accessibilityLabel="Share this recipe"
              icon={<ShareIcon size={22} color={colors.ink} />}
              onPress={() => share.open({ recipeId: id })}
              style={[styles.share, { top }]}
            />
          ) : null}
          {recipe && video ? (
            <PressableScale
              onPress={() => media.watch({ recipe, whole: true })}
              accessibilityLabel={watchLabel}
              style={[styles.watch, { top: HERO_H - 102 }]}>
              <View style={styles.watchDisc}>
                <PlayIcon size={12} color={colors.card} />
              </View>
              <Txt variant="label" size={15} weight={700}>
                {watchLabel}
              </Txt>
            </PressableScale>
          ) : null}
        </Animated.View>

        {/* Sheet */}
        <Animated.View entering={detailContentEnter} style={[styles.sheet, { paddingBottom: dockSpace }]}>
          <View style={{ gap: 6 }}>
            {title ? (
              <Txt variant="display" size={30} accessibilityRole="header">
                {title}
              </Txt>
            ) : (
              <Skeleton width="70%" height={30} />
            )}
            {sentLine ? (
              <Txt variant="body" size={15}>
                {sentLine}
              </Txt>
            ) : sentLine === undefined ? (
              <Skeleton width="40%" height={14} style={{ marginTop: 4 }} />
            ) : null}
          </View>

          {quote ? (
            <View style={styles.quote}>
              <Txt variant="quote" size={17} leading={1.4}>
                “{quote}”
              </Txt>
            </View>
          ) : null}

          {recipe ? (
            <View
              // Where "Who cooked it" ends on screen when the page opens, to decide if the dock fits.
              onLayout={(e) => setWhoBottom(SHEET_TOP + e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
              <DishStatsLine variant="page" stat={stats?.[id]} profiles={profiles} style={styles.hearts} />
              <WhoCooked
                recipeId={id}
                tags={recipe.tags}
                title={recipe.title}
                learners={family}
                activity={activity}
                ready={!!activity && k.ready}
                failed={!!activityError || !!k.error}
                sentAt={(pid) => k.sentAt(id, pid)}
                onSent={() => setTimeout(refreshActivity, 400)}
              />
            </View>
          ) : null}

          {inline ? <View style={{ marginTop: 4 }}>{askedCard}</View> : null}

          {recipe && recipe.steps.length ? (
            <PressableScale
              onPress={() => router.push({ pathname: '/recipe/[id]', params: { id } })}
              accessibilityLabel={`See all ${recipe.steps.length} steps`}
              style={styles.steps}>
              <Txt variant="title" size={16} style={{ flex: 1 }}>
                See all {recipe.steps.length} steps
              </Txt>
              <ChevronRightIcon size={20} strokeWidth={2.2} color={colors.muted} />
            </PressableScale>
          ) : null}
        </Animated.View>
      </Animated.ScrollView>

      <StickyHeader
        title={title}
        scrollY={scrollY}
        start={SHEET_TOP - 80}
        left={
          <IconButton tone="clear" size={40} accessibilityLabel="Back" icon={<BackIcon size={22} color={colors.ink} />} onPress={goBack} />
        }
      />

      {asked && !inline ? (
        <Animated.View
          entering={detailContentEnter}
          onLayout={(e) => setDockH(e.nativeEvent.layout.height)}
          style={[styles.dock, { bottom: Math.max(24, insets.bottom + 8) }]}>
          {askedCard}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hearOnLavender: { backgroundColor: colors.card, height: 52 },
  screen: { flex: 1, backgroundColor: colors.page },
  hero: { height: HERO_H, backgroundColor: colors.peach },
  back: { position: 'absolute', left: space.gutter },
  share: { position: 'absolute', right: space.gutter },
  watch: {
    position: 'absolute',
    left: space.gutter,
    height: 44,
    paddingLeft: 6,
    paddingRight: 16,
    borderRadius: 999,
    backgroundColor: alpha.glassPill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  watchDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    flexGrow: 1,
    marginTop: SHEET_TOP - HERO_H,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    backgroundColor: colors.page,
    paddingTop: 28,
    paddingHorizontal: space.gutter,
    gap: 20,
  },
  quote: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: radii.quote,
    backgroundColor: colors.peach,
  },
  steps: {
    height: 56,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: alpha.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dock: { position: 'absolute', left: 16, right: 16 },
  hearts: { marginBottom: 12 },
});

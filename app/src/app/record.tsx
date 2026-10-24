// Record (bible: Parent-Record), a screen pushed from parent Home: Back, "What will you teach
// today?", a gentle suggestion when a learner asked for a dish ("Leo asked for Sunday eggs"), the
// 3-step guide with the tripod photo, then the two ways in: "Start recording" (camera) and the
// full-width "Use videos I already took" (camera roll), and a quiet "From my glasses" (the camera roll
// too: smart glasses save there; the job is tagged `source: "glasses"`). All continue to Send. On the
// web, they explain that recording happens in the app on a phone.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dishName, requestDish, useKitchen, type KitchenItem } from '@/components/parent/kitchen';
import { useDraft } from '@/components/record/draft';
import { PhoneOnlySheet } from '@/components/record/sheets';
import { usePickVideos, type PickContext } from '@/components/record/usePickVideos';
import { ActionButton, ArrowRightIcon, Avatar, BackPill, listEnter, PressableScale, ScreenWash, Txt, VideoIcon } from '@/components/ui';
import { getCachedEntry } from '@/lib/recipes';
import { colors, radii, shadows, space } from '@/theme/tokens';

const tripod = require('@/components/record/tripod.jpg');

const STEPS = ['Prop up your phone', 'Say the dish’s name', 'Cook like always, and explain out loud'];

/** The dish a learner asked for: from the request's words, else the recipe it names. */
function askedDish(item: KitchenItem | null): string | null {
  if (!item) return null;
  const fromWords = requestDish(item.message.body);
  if (fromWords) return fromWords;
  const e = item.message.recipe_id ? getCachedEntry(item.message.recipe_id) : null;
  return e ? dishName(e.title, e.cook_name) : null;
}

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}

export default function RecordScreen() {
  const insets = useSafeAreaInsets();
  const k = useKitchen();
  const draft = useDraft();
  const pick = usePickVideos();

  const request = k.requests[0] ?? null;
  const dish = askedDish(request);
  const ctx: PickContext = request ? { dish, requestFrom: request.other.id } : {};

  const go = async (kind: 'camera' | 'library' | 'glasses') => {
    const ok = kind === 'camera' ? await pick.record(ctx) : await pick.library({ ...ctx, glasses: kind === 'glasses' });
    if (ok) router.push('/send');
  };

  const waiting = draft.clips.length;

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.col,
          { paddingTop: Math.max(space.topDetail, insets.top + 9), paddingBottom: insets.bottom + space.xxxl },
        ]}>
        <ScreenWash tone="parent" height={300} style={styles.wash} />

        <BackPill onPress={goBack} />

        <Txt variant="display" size={34} accessibilityRole="header">
          What will you teach today?
        </Txt>

        {request ? (
          <Animated.View entering={listEnter(0)} style={styles.suggest} accessible accessibilityLabel={`${request.other.name} asked for ${dish ?? 'a recipe'}`}>
            <Avatar profile={request.other} size={40} />
            <Txt variant="label" size={16} weight={600} color={colors.lavenderInk} style={styles.flex} numberOfLines={2}>
              {request.other.name} asked for{' '}
              <Txt variant="label" size={16} weight={700} color={colors.ink}>
                {dish ?? 'a recipe'}
              </Txt>
            </Txt>
          </Animated.View>
        ) : null}

        <Animated.View entering={listEnter(1)} style={styles.how} accessible accessibilityLabel={`How it works. ${STEPS.join('. ')}.`}>
          <Image source={tripod} style={styles.photo} contentFit="cover" accessibilityLabel="A phone propped up on a kitchen counter" />
          <View style={styles.steps}>
            {STEPS.map((s, i) => (
              <View key={s} style={styles.step}>
                <View style={styles.num}>
                  <Txt variant="label" size={14} weight={700} color={colors.sageInk}>
                    {i + 1}
                  </Txt>
                </View>
                <Txt variant="label" size={16} weight={600} leading={1.3} color={colors.ink} style={styles.flex}>
                  {s}
                </Txt>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={listEnter(2)} style={styles.ctaCol}>
          <PressableScale
            onPress={() => go('camera')}
            haptic
            disabled={!!pick.busy}
            accessibilityLabel="Start recording"
            accessibilityHint="Opens the camera. Record yourself cooking, then send it to the family."
            style={styles.start}>
            <View style={styles.startDot}>
              {pick.busy === 'camera' ? <ActivityIndicator color={colors.danger} /> : <View style={styles.redDot} />}
            </View>
            <Txt variant="button" size={20} weight={700} color={colors.card} style={styles.flex} numberOfLines={1}>
              Start recording
            </Txt>
          </PressableScale>

          <ActionButton
            label="Use videos I already took"
            variant="outline"
            size="lg"
            labelWeight={700}
            icon={<VideoIcon size={22} color={colors.ink} />}
            state={pick.busy === 'library' ? 'loading' : 'idle'}
            disabled={pick.busy === 'camera'}
            haptics
            onPress={() => void go('library')}
            accessibilityHint="Opens your videos. Pick them in the order you filmed them."
          />

          <PressableScale
            onPress={() => void go('glasses')}
            disabled={!!pick.busy}
            accessibilityRole="button"
            accessibilityLabel="From my glasses"
            accessibilityHint="Opens your videos. Pick the ones your smart glasses filmed."
            style={styles.glasses}>
            <Txt variant="label" size={16} weight={700} color={colors.greenDeep}>
              From my glasses
            </Txt>
          </PressableScale>

          {waiting > 0 ? (
            <PressableScale onPress={() => router.push('/send')} accessibilityLabel="Continue to send" style={styles.resume}>
              <Txt variant="label" size={15} weight={700} color={colors.ink}>
                {waiting === 1 ? '1 video ready to send' : `${waiting} videos ready to send`}
              </Txt>
              <ArrowRightIcon size={18} color={colors.ink} />
            </PressableScale>
          ) : null}
        </Animated.View>
      </ScrollView>

      <PhoneOnlySheet visible={pick.phoneSheet} onClose={pick.closePhoneSheet} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  wash: { top: 0 },
  col: { paddingHorizontal: space.gutter, gap: 24 },
  flex: { flex: 1 },
  suggest: {
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: radii.quote,
    backgroundColor: colors.lavender,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  how: {
    borderRadius: radii.panel,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  // Sized so "Cook like always, and explain out loud" breaks into two clean lines on a 375 pt phone.
  photo: { width: 84, height: 136, borderRadius: radii.quote },
  steps: { flex: 1, gap: 14 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCol: { gap: 16, alignItems: 'stretch' },
  start: {
    height: 68,
    paddingLeft: 10,
    paddingRight: 24,
    borderRadius: 999,
    backgroundColor: colors.green,
    boxShadow: shadows.cta,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  startDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The bible's dot: a r=8 circle in an 18 px, 24-unit viewBox = 12 px.
  redDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger },
  glasses: { alignSelf: 'center', minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  resume: {
    alignSelf: 'center',
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: colors.card,
    boxShadow: shadows.chip,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});

// Record (bible: Parent-Record), a screen pushed from parent Home: Back, "What will you teach
// today?", a gentle suggestion when a learner asked for a dish ("Leo asked for Sunday eggs"), the
// 3-step guide with the tripod photo, then "Start recording": the pre-record sheet (the dish, who it's
// for, her language, and how she films):
//   From my glasses  live.startRecording (source glasses) -> /recording: homie listens on the phone by
//                    the stove; the glasses' video reaches the job from the VM.
//   Phone camera     live.startRecording (source phone) -> /recording: homie's hello, then the phone's
//                    camera, then homie's last questions there, and the video sends itself.
//   Videos I took    the camera roll, then Send (as before).
// If homie can't start (no connection within 10 s, or live.* isn't on the server), glasses say so and
// the phone camera opens without homie, then Send.
// A quiet "Record from my glasses" under it starts that glasses recording in one tap, without the
// sheet (the dish and learner from a request, her saved language). On the web, the camera and camera
// roll explain that they work in the app on a phone.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dishName, requestDish, useKitchen, type KitchenItem } from '@/components/parent/kitchen';
import { setDraftMeta, useDraft } from '@/components/record/draft';
import { phoneOnly } from '@/components/record/pick';
import { PreRecordSheet, type CaptureSource, type PreRecordChoice } from '@/components/record/PreRecordSheet';
import { PhoneOnlySheet } from '@/components/record/sheets';
import { usePickVideos, type PickContext } from '@/components/record/usePickVideos';
import { ArrowRightIcon, Avatar, BackPill, listEnter, PressableScale, ScreenWash, Txt, useToast } from '@/components/ui';
import { convexPersonIdByName, startRecording } from '@/lib/live/convex';
import { getCachedEntry } from '@/lib/recipes';
import { colors, radii, shadows, space } from '@/theme/tokens';

/** The sheet's native Modal has to be gone before the next screen, camera or picker presents (iOS). */
const SHEET_GONE_MS = 600;
/** Convex waits for a connection with no limit; offline, homie's start gives up after this. */
const START_TIMEOUT_MS = 10_000;
const after = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `work`, or a throw after `ms` (into the caller's catch). */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const late = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([work, late]).finally(() => t && clearTimeout(t));
}

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
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<CaptureSource | null>(null);

  const request = k.requests[0] ?? null;
  const dish = askedDish(request);


  const start = async ({ source, dish: typed, kid, everyone, language }: PreRecordChoice) => {
    setDraftMeta({ dish: typed || null, requestFrom: kid?.id ?? null, everyone, language, recordingId: null });
    const picked: PickContext = { dish: typed || null, requestFrom: kid?.id ?? null };
    if (source === 'library' || (source === 'camera' && phoneOnly)) {
      setSheet(false);
      await after(SHEET_GONE_MS);
      if (await (source === 'library' ? pick.library(picked) : pick.record(picked))) router.push('/send');
      return;
    }
    setBusy(source);
    try {
      const { recordingId } = await withTimeout(
        (async () => {
          const forKidId = (await convexPersonIdByName(kid?.name)) ?? undefined;
          return startRecording({ dish: typed || undefined, forKidId, language: language ?? undefined, source: source === 'glasses' ? 'glasses' : 'phone' });
        })(),
        START_TIMEOUT_MS,
      );
      if (source === 'camera') setDraftMeta({ recordingId });
      setSheet(false);
      await after(SHEET_GONE_MS);
      router.push({ pathname: '/recording', params: { id: recordingId, source: source === 'glasses' ? 'glasses' : 'phone', kid: kid?.name ?? '', lang: language ?? '' } });
    } catch (e) {
      console.warn('[record] startRecording', String(e).slice(0, 160));
      if (source === 'glasses') {
        toast.show('homie couldn’t start. Check the connection and try again.', { tone: 'error', durationMs: 3200 });
      } else {
        // No homie today: the phone's camera still works, straight to Send.
        setSheet(false);
        await after(SHEET_GONE_MS);
        if (await pick.record(picked)) router.push('/send');
      }
    } finally {
      setBusy(null);
    }
  };

  /** One tap: a live glasses recording, with the dish and learner a request named (no sheet). */
  const startGlasses = () =>
    void start({ source: 'glasses', dish: dish ?? '', kid: request?.other ?? null, everyone: !request, language: null });

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
            onPress={() => setSheet(true)}
            haptic
            disabled={!!pick.busy}
            accessibilityLabel="Start recording"
            accessibilityHint="Asks the dish, who it's for and how you film, then starts."
            style={styles.start}>
            <View style={styles.startDot}>
              <View style={styles.redDot} />
            </View>
            <Txt variant="button" size={20} weight={700} color={colors.card} style={styles.flex} numberOfLines={1}>
              Start recording
            </Txt>
          </PressableScale>

          <PressableScale
            onPress={startGlasses}
            disabled={!!busy || !!pick.busy}
            accessibilityRole="button"
            accessibilityLabel="Record from my glasses"
            accessibilityHint="Starts filming from your glasses right away. Keep the phone near the stove: homie listens."
            style={styles.glasses}>
            <Txt variant="label" size={16} weight={700} color={colors.greenDeep}>
              {busy === 'glasses' ? 'Starting…' : 'Record from my glasses'}
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

      <PreRecordSheet
        visible={sheet}
        onClose={() => !busy && setSheet(false)}
        initialDish={dish}
        requestFrom={request?.other.id ?? null}
        busy={busy ?? (pick.busy === 'library' ? 'library' : pick.busy === 'camera' ? 'camera' : null)}
        onStart={(c) => void start(c)}
      />
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

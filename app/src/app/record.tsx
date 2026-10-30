// Record (bible: Parent-Record), a screen pushed from parent Home: Back, "What will you teach
// today?", a gentle suggestion when a learner asked for a dish ("Leo asked for Sunday eggs"; a kid's ask
// from its reminder, /record?dish=&from=&ask=, comes first and fills the dish in), the
// 3-step guide with the tripod photo, then "Start recording": the pre-record sheet (the dish, who it's
// for, her language, and how she films):
//   From my glasses  live.startRecording (source glasses) -> /recording: homie listens on the phone by
//                    the stove; the glasses' video reaches the job from the VM.
//   Phone camera     live.startRecording (source phone) -> /recording: homie's hello, then the phone's
//                    camera, then homie's last questions there, and the video sends itself.
//   Videos I took    the camera roll, then Send (as before).
// If homie can't start (no connection within 10 s, or live.* isn't on the server), glasses say so and
// the phone camera opens without homie, then Send.
// The first time, "Start recording" asks first (lib/aiConsent: the videos and her voice go to the AI
// companies); "Not now" leaves her here with nothing open.
// "Start recording" is the only way in: the sheet holds every way to film. Above the guide, the newest glasses
// video the laptop saved (components/record/GlassesVideoCard): "Save to Photos", then send it from Videos I took. On the web, the camera and
// camera roll explain that they work in the app on a phone.
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dishName, requestDish, useKitchen, type KitchenItem } from '@/components/parent/kitchen';
import { setDraftMeta, useDraft } from '@/components/record/draft';
import { GlassesVideoCard } from '@/components/record/GlassesVideoCard';
import { phoneOnly } from '@/components/record/pick';
import { PreRecordSheet, type CaptureSource, type PreRecordChoice } from '@/components/record/PreRecordSheet';
import { PhoneOnlySheet } from '@/components/record/sheets';
import { usePickVideos, type PickContext } from '@/components/record/usePickVideos';
import { ArrowRightIcon, Avatar, BackPill, listEnter, PressableScale, ScreenWash, Txt, useToast } from '@/components/ui';
import { ensureAiConsent } from '@/lib/aiConsent';
import { noteFilmingAsk } from '@/lib/askReminders';
import { useCravingAsk } from '@/lib/cravings';
import { HOMIE_ON } from '@/lib/homie/switch';
import { convexKidIds, startRecording } from '@/lib/live/convex';
import { getCachedEntry } from '@/lib/recipes';
import { useWords } from '@/lib/words/useWords';
import type { T as Words, WordKey } from '@/lib/words/words';
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

const STEPS: WordKey[] = ['parent.record.step1', 'parent.record.step2', 'parent.record.step3'];

/** The dish a learner asked for: from the request's words, else the recipe it names. */
function askedDish(item: KitchenItem | null, t: Words): string | null {
  if (!item) return null;
  const fromWords = requestDish(item.message.body);
  if (fromWords) return fromWords;
  const e = item.message.recipe_id ? getCachedEntry(item.message.recipe_id) : null;
  return e ? dishName(e.title, e.cook_name, t) : null;
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
  const { t } = useWords();
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<CaptureSource | null>(null);

  // A kid's ask (Phase 5: its weekly reminder, or "I'm making it now") comes first: /record?dish=&from=&ask=.
  const params = useLocalSearchParams<{ dish?: string; from?: string; ask?: string }>();
  const askId = params.ask?.trim() || null;
  const ask = useCravingAsk(askId);
  const askFrom = params.from?.trim() || ask?.kidName.trim() || null;
  const askDish = params.dish?.trim() || ask?.dish.trim() || null;
  const fromAsk = !!askId && !!askFrom;

  const request = fromAsk ? null : (k.requests[0] ?? null);
  const dish = fromAsk ? askDish : askedDish(request, t);
  const asker = fromAsk ? askFrom : (request?.other.name ?? null);
  // "Leo asked for Sunday eggs" with the dish in bold: the sentence split where the dish goes.
  const askedFor = asker ? t('parent.record.askedFor', { name: asker, dish: '{dish}' }).split('{dish}') : [];
  const askedWhat = dish ?? t('parent.record.aRecipe');
  const steps = STEPS.map((key) => t(key));


  const open = async () => {
    if (await ensureAiConsent()) setSheet(true);
  };

  const start = async ({ source, dish: typed, kids, everyone, label, who, language }: PreRecordChoice) => {
    if (!(await ensureAiConsent())) return setSheet(false);
    // Filming a kid's ask: once it's sent, the ask is filmed and its reminder stops (sendKept: askFilmed).
    noteFilmingAsk(fromAsk ? askId : null);
    const first = kids[0]?.id ?? null;
    setDraftMeta({ dish: typed || null, requestFrom: first, forKids: who, everyone, language, recordingId: null });
    const picked: PickContext = { dish: typed || null, requestFrom: first };
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
          const forKidIds = await convexKidIds(kids);
          return startRecording({ dish: typed || undefined, forKidIds, language: language ?? undefined, source: source === 'glasses' ? 'glasses' : 'phone' });
        })(),
        START_TIMEOUT_MS,
      );
      if (source === 'camera') setDraftMeta({ recordingId });
      setSheet(false);
      await after(SHEET_GONE_MS);
      router.push({ pathname: '/recording', params: { id: recordingId, source: source === 'glasses' ? 'glasses' : 'phone', kid: everyone ? '' : (label ?? ''), lang: language ?? '' } });
    } catch (e) {
      console.warn('[record] startRecording', String(e).slice(0, 160));
      if (source === 'glasses') {
        toast.show(t(HOMIE_ON ? 'parent.record.homieFailed' : 'parent.record.couldntStart'), { tone: 'error', durationMs: 3200 });
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
          {t('parent.record.title')}
        </Txt>

        {asker ? (
          <Animated.View entering={listEnter(0)} style={styles.suggest} accessible accessibilityLabel={askedFor.join(askedWhat)}>
            {request ? <Avatar profile={request.other} size={40} /> : <Avatar name={asker} avatarKey={null} size={40} />}
            <Txt variant="label" size={16} weight={600} color={colors.ink} style={styles.flex} numberOfLines={2}>
              {askedFor[0]}
              <Txt variant="label" size={16} weight={700} color={colors.ink}>
                {askedWhat}
              </Txt>
              {askedFor.slice(1).join(askedWhat)}
            </Txt>
          </Animated.View>
        ) : null}

        <GlassesVideoCard />

        <Animated.View entering={listEnter(1)} style={styles.how} accessible accessibilityLabel={`${t('parent.record.howItWorks')}. ${steps.join('. ')}.`}>
          <Image source={tripod} style={styles.photo} contentFit="cover" accessibilityLabel={t('parent.record.photo')} />
          <View style={styles.steps}>
            {steps.map((s, i) => (
              <View key={s} style={styles.step}>
                <View style={styles.num}>
                  <Txt variant="label" size={14} weight={700} color={colors.green}>
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
            onPress={() => void open()}
            haptic
            disabled={!!pick.busy}
            accessibilityLabel={t('parent.record.start')}
            accessibilityHint={t('parent.record.startHint')}
            style={styles.start}>
            <View style={styles.startDot}>
              <View style={styles.redDot} />
            </View>
            <Txt variant="button" size={20} weight={700} color={colors.ink} style={styles.flex} numberOfLines={1}>
              {t('parent.record.start')}
            </Txt>
          </PressableScale>

          {waiting > 0 ? (
            <PressableScale onPress={() => router.push('/send')} accessibilityLabel={t('parent.record.continue')} style={styles.resume}>
              <Txt variant="label" size={15} weight={700} color={colors.ink}>
                {waiting === 1 ? t('parent.record.readyOne') : t('parent.record.readyMany', { n: waiting })}
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
    backgroundColor: colors.yolkTint,
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
    backgroundColor: colors.greenTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaCol: { gap: 16, alignItems: 'stretch' },
  start: {
    height: 68,
    paddingLeft: 10,
    paddingRight: 24,
    borderRadius: 999,
    backgroundColor: colors.yolk,
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

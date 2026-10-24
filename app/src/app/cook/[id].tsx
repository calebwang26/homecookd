// Cook mode, one step at a time (direction A + Caleb's round-2 notes, docs/build/qa/
// kid-feedback-round2-oct22.md; declutter first). Top to bottom:
//   1. the title
//   2. the step's video (ClipVideo: tap to play only this step, ±10 and a bar to drag, split at each
//      substep like YouTube chapters), with Full screen (StepPlayerFull, still only this step). It
//      carries the cook's voice, so there is no separate Hear (iPhone test, Oct 22). No video: the
//      step's own photo beside the title, when it has one (never the dish's poster: the same photo on
//      every step reads as the step).
//   3. short lines (Substeps: 2 lines each, tap for more; the last is "Ready when …"); while the video
//      plays, the line being said is lit, and tapping a timed line plays the video from it
//   4. "Ingredients" this step needs (StepIngredients)  5. "Dad’s tip ⌄", closed (TipPill), and
//      "Story from Dad ›" (StepStory: a sheet), only on a step that has them
//   6. "Ask Dad" (my 1:1 with the dish's cook, the dish and step in the box; "Ask the family" when
//      the cook isn't in the family), with one line under it while a question about this step waits
//      ("You asked · waiting for Dad" / "Leo asked this 2 days ago · waiting").
// One voice at a time: the video, the full screen and a story's voice stop each other (lib/media),
// and leaving the screen (Ask pushes the chat) silences them. Family never sees the word "sample".
// Header: close, "Step 3 of 8", "All steps" (the sheet: tap a step to jump; "You're here"; the steps
// before the furthest one reached are checked) and one small pot per step, filled up to the step on
// screen (retention PR 7, components/recipe/PotDots). Bottom: Back, then "Next step"; looking back at
// an earlier step it is "Continue at step 6" (back to the furthest); on the last step "I made it".
// The furthest step is what's saved as the last step, so the recipe and the next visit come back to it.
// Param `step` is 1-based; without it the screen resumes the last step this profile was on.
// Last step: "I made it" -> `cooked` event + message to the cook -> SuccessBurst ("You made it" /
// "We told Dad.": a fact, never words for Dad) -> when Dad is someone else in the family, the postcard
// (retention PR 3: a photo, an optional "How close to Dad’s?", on that same `cooked` card; "Share with
// someone else" and "Not now" stay quiet), else "Want to share the love?" (share sheet or "Not now")
// -> back to the recipe. On a lent phone the button names who cooked
// ("Grandma made it"), so nobody sends it under the wrong name. For a learner, a milestone changes
// the burst's title (RETENTION-HANDOFF 3.6): the 1st, 5th or 10th distinct family dish ("Your first
// family dish") or the last of a cook's dishes ("Keeper of Grandma’s kitchen"), from my stats before
// this cook counts, and only once the server saved the `cooked` event (offline: the usual title).
// The screen stays awake while cooking (expo-keep-awake), without a word about it (declutter).
// "Leo is cooking your chili" (RETENTION-HANDOFF 3.1): on another family cook's dish, cook mode tells
// the server at once and then 2 s after each step change (lib/useCookingSession), so that cook gets
// one push a day and a live row on their Home; "I made it" and leaving end it. The first time, one
// sheet asks "Let Mom see when you cook their dishes?" (Yes / Not now; Not now shares nothing; Android
// back closes it for this visit only and saves nothing). A
// heart the cook sends from that row pops up here (HeartBurst + "Mom sent you a heart"); no push.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInLeft, FadeInRight } from 'react-native-reanimated';

import { ConsentSheet } from '@/components/cooking/ConsentSheet';
import { HeartBurst } from '@/components/cooking/HeartBurst';
import { ClipVideo, type ClipVideoHandle } from '@/components/media';
import { askForPushSoon } from '@/components/push/PushAskSheet';
import { AskStepPill, BottomBar, useAskTarget, useBottomClearance, useOtherCook, useScreenTop } from '@/components/recipe/parts';
import { MadeItOverlay } from '@/components/recipe/MadeIt';
import { PotDots } from '@/components/recipe/PotDots';
import { refreshRecipeStats, useRecipeStats } from '@/components/recipes/stats';
import { useChecklist, useLastStep } from '@/components/recipe/progress';
import { StepIngredients } from '@/components/recipe/StepIngredients';
import { lineStarts, stepSubsteps } from '@/components/recipe/steps';
import { StepStory } from '@/components/recipe/StepStory';
import { StepsSheet } from '@/components/recipe/StepsSheet';
import { Substeps } from '@/components/recipe/Substeps';
import { TipPill } from '@/components/recipe/TipPill';
import {
  ActionButton,
  ArrowRightIcon,
  BackIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  EmptyState,
  IconButton,
  PressableScale,
  ScrollHold,
  Skeleton,
  Txt,
  useScrollHold,
  useToast,
} from '@/components/ui';
import type { RecipeQuestion } from '@/lib/api';
import { daysAgo, mmss } from '@/lib/format';
import { madeItMilestone, madeItTitle } from '@/lib/kitchenCounts';
import { stopAllMedia } from '@/lib/media';
import { cooked, useRecipeQuestions, type CookedRef } from '@/lib/messaging';
import { madeItWords } from '@/lib/postcardLogic';
import { backToRecipe } from '@/lib/navigation';
import { useLibrary, useRecipe } from '@/lib/recipes';
import { useSession, usingDevAid } from '@/lib/session';
import { useCookingSession } from '@/lib/useCookingSession';
import type { Step } from '@/lib/types';
import { alpha, colors, radii } from '@/theme/tokens';

const AWAKE_TAG = 'cook-mode';

/**
 * Hands in the dough: the screen never sleeps mid-step (its own tag, so leaving releases only it).
 * A browser can refuse (page hidden, permissions policy): nothing to do then.
 */
function useCookAwake() {
  useEffect(() => {
    let alive = true;
    activateKeepAwakeAsync(AWAKE_TAG).then(
      () => {
        if (!alive) deactivateKeepAwake(AWAKE_TAG).catch(() => {}); // left before the lock arrived
      },
      () => {},
    );
    return () => {
      alive = false;
      deactivateKeepAwake(AWAKE_TAG).catch(() => {});
    };
  }, []);
}

export default function CookScreen() {
  useCookAwake();
  const params = useLocalSearchParams<{ id: string; step?: string }>();
  const id = params.id ? String(params.id) : '';
  const asked = Number.parseInt(String(params.step ?? ''), 10);
  const { recipe, entry, loading, missing } = useRecipe(id);
  const top = useScreenTop();
  const clearance = useBottomClearance();
  const last = useLastStep(id);
  const checklist = useChecklist(id);
  const askTarget = useAskTarget(recipe);
  const otherCook = useOtherCook(recipe);
  const { me, owner, profiles } = useSession();
  // My dish history and the library, for the "I made it" milestones (read before the cook counts).
  const myStats = useRecipeStats();
  const { entries } = useLibrary();
  // The phone is lent (Mom handed it to Grandma): "Grandma made it", not "I made it".
  const lentTo = me && owner && me.id !== owner.id ? me : null;
  const openQs = useRecipeQuestions(id || null);
  const toast = useToast();
  const scroll = useRef<ScrollView>(null);
  // Tapping a substep plays the step video from it.
  const clip = useRef<ClipVideoHandle>(null);
  // Dragging the step clip's bar holds the page still (ui/ScrollHold).
  const hold = useScrollHold();
  // The bible's 260 pt clip, a little shorter on a small phone so the step's words start sooner.
  const { height: winH } = useWindowDimensions();
  const clipH = Math.round(Math.min(260, Math.max(200, winH * 0.31)));

  const [chosen, setChosen] = useState<number | null>(Number.isFinite(asked) && asked > 0 ? asked : null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [done, setDone] = useState<{ title: string; subtitle?: string; told?: boolean; card: CookedRef | null } | null>(null);

  const total = recipe?.steps.length ?? 0;
  const fallback = last.loaded ? last.step || 1 : 1;
  const n = total ? Math.min(Math.max(1, chosen ?? fallback), total) : 1;
  const step: Step | null = recipe?.steps[n - 1] ?? null;
  // The furthest step reached (saved below as the last step): looking back never lowers it.
  const furthest = total ? Math.min(total, Math.max(n, last.loaded ? last.step : 0)) : 0;
  const reviewing = n < furthest;

  // Leo is cooking (PR 2): only another family cook's dish (cookProfile matches any name, so check
  // the role). A family cook's sample dishes count (every family dish is a sample today; see PR 2
  // departures in RETENTION-WIRING.md). On a lent phone it follows `me`, like every call. Never while
  // the web `?as=` dev aid borrows the build's code (a screenshot writes nothing).
  // A memorial cook (GET /family's `memorial`, carried on the profile) turns the hook off: no call at
  // all. Against a server without the flag, its 'no' + memorial answer does the same: nothing is
  // written and the question is never asked about them.
  const liveCook = otherCook?.role === 'cook' ? otherCook : null;
  const [heartKey, setHeartKey] = useState(0);
  const liveOn = !!liveCook && !usingDevAid();
  const live = useCookingSession({
    recipeId: recipe?.id,
    cook: liveCook,
    step: n,
    total,
    enabled: liveOn,
    onHeart: () => setHeartKey((k) => k + 1),
  });

  // One voice at a time across screens too: Ask pushes the chat over this screen, and the step's
  // video (or a story's voice) must not keep playing under it.
  useFocusEffect(useCallback(() => () => stopAllMedia(), []));

  // Remember the furthest step, so the recipe can offer "Back to step N" (only once the saved one
  // has loaded: an earlier write would replace it).
  const setLast = last.setStep;
  const lastLoaded = last.loaded;
  useEffect(() => {
    if (total && !done && lastLoaded) setLast(furthest);
  }, [furthest, total, done, lastLoaded, setLast]);

  const toRecipe = () => {
    if (!id) return router.replace('/');
    backToRecipe(router, id); // a kid's dish lives in the Recipes tab
  };

  const goTo = (k: number) => {
    setStepsOpen(false);
    if (k === n) return;
    setDir(k > n ? 1 : -1);
    setChosen(k);
    router.setParams({ step: String(k) });
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const goBack = () => {
    if (n > 1) return goTo(n - 1);
    if (router.canGoBack()) router.back();
    else toRecipe();
  };

  const finish = async () => {
    if (!recipe) return;
    // Before anything counts this cook. Learners only (the "4 of 7" counts are theirs), and only once
    // the server has answered my stats (offline, every dish would look like a first).
    const milestone = me?.role === 'learner' && myStats.loaded
      ? madeItMilestone({ entries, profiles, meId: me?.id, before: myStats.byId, recipeId: recipe.id })
      : null;
    // The cook's live row goes before the made-it message lands (waits 2 s at most, never throws).
    await live.finish();
    const name = recipe.cook.name;
    // A message that fails to send never blocks finishing (cooked() never throws). "Still saved"
    // only when the server really saved the `cooked` event.
    const res = await cooked(recipe.id);
    if (res.sendFailed) {
      toast.show(res.eventSaved ? `Couldn’t tell ${name} yet. Your cook is still saved.` : `Couldn’t tell ${name} yet.`, { tone: 'error' });
    }
    // The recipe page reads "You made this" from these on the way back.
    void refreshRecipeStats(me?.id);
    // Facts only: what I did, and that the note went (guardrail 1: never what the cook will feel).
    const words = madeItWords(!!res.message, name);
    const card = res.message && res.threadId ? { threadId: res.threadId, messageId: res.message.id } : null;
    // A milestone only when this cook was counted (offline it wasn't: no "Keeper of …" then).
    setDone({ ...words, told: !!res.message, card, title: madeItTitle(milestone, res.eventSaved, words.title) });
  };

  // The "I made it" flow is over: back to the dish, and (once, when the cook was told) "Want a note
  // when Dad answers?" over it. Not on a lent phone: its notes go to the phone's own person.
  const leaveMadeIt = () => {
    toRecipe();
    // Never about a memorial cook (guardrail 2: no answer will come).
    if (done?.told && otherCook && !otherCook.memorial && me && !lentTo) {
      askForPushSoon({ kind: 'kid-first-made', profileId: me.id, name: otherCook.name, profile: otherCook });
    }
  };

  const header = (
    <View style={styles.topRow}>
      <IconButton tone="cream" icon={<CloseIcon size={20} color={colors.ink} />} accessibilityLabel="Close and go back to the recipe" onPress={toRecipe} />
      <View style={styles.progressCol}>
        <View style={styles.stepRow}>
          <Txt variant="label" size={16} weight={700} color={colors.ink} style={styles.stepLabel} accessibilityRole="header">
            {total ? `Step ${n} of ${total}` : ' '}
          </Txt>
          {total ? (
            <PressableScale onPress={() => setStepsOpen(true)} haptic scaleTo={0.96} hitSlop={4} accessibilityRole="button" accessibilityLabel="All steps" style={styles.allSteps}>
              <Txt variant="label" size={15} weight={600} color={colors.ink}>
                All steps
              </Txt>
            </PressableScale>
          ) : null}
        </View>
        <PotDots total={total} reached={n} />
      </View>
    </View>
  );

  if (!recipe || !step) {
    const gone = missing || (!loading && !recipe) || (recipe && !recipe.steps.length);
    return (
      <View style={styles.page}>
        <View style={[styles.content, { paddingTop: top }]}>
          {header}
          {gone ? (
            <EmptyState
              title={recipe ? 'The steps are still being written' : 'We couldn’t find this recipe'}
              actionLabel="Back"
              onAction={toRecipe}
            />
          ) : (
            <View style={{ gap: 24 }}>
              <Skeleton height={260} radius={radii.panel} />
              <Skeleton width="85%" height={34} />
              <Skeleton width="60%" height={34} />
            </View>
          )}
        </View>
      </View>
    );
  }

  const name = recipe.cook.name;
  const hasVideo = !!recipe.media.video_url;
  const len = Math.max(0, step.end_s - step.start_s);
  const isLast = n === total;
  const waiting = waitingLine(
    openQs.questions.filter((q) => q.step_order === step.order),
    askTarget?.kind === 'cook' ? askTarget.cook.name : 'the family',
  );
  const poster = step.image_url || recipe.media.poster_url;
  const enter = (dir > 0 ? FadeInRight : FadeInLeft).duration(260);

  return (
    <View style={styles.page}>
      <ScrollHold value={hold.set}>
        <ScrollView ref={scroll} scrollEnabled={!hold.held} contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: clearance }]} showsVerticalScrollIndicator={false}>
          {header}

          <Animated.View key={`step-${n}`} entering={enter} style={styles.body}>
            {hasVideo ? (
              <>
                <Txt variant="display" size={30} leading={1.15} accessibilityRole="header">
                  {step.title}
                </Txt>
                <ClipVideo
                  ref={clip}
                  url={recipe.media.video_url}
                  poster={poster}
                  start_s={step.start_s}
                  end_s={step.end_s}
                  height={clipH}
                  radius={radii.panel}
                  aspectHint={recipe.media.width && recipe.media.height ? recipe.media.width / recipe.media.height : null}
                  accessibilityLabel={`Watch this step: ${step.title}, ${mmss(len)}`}
                  full={{ label: `Step ${n} · ${mmss(len)}`, quote: step.quote }}
                  chapters={lineStarts(stepSubsteps(step))}
                />
              </>
            ) : (
              // No video: the step's own photo is a thumbnail beside the title, so the words come first.
              <View style={styles.compact}>
                {step.image_url ? <StepThumb uri={step.image_url} title={step.title} /> : null}
                <Txt variant="display" size={26} leading={1.18} style={styles.compactTitle} accessibilityRole="header">
                  {step.title}
                </Txt>
              </View>
            )}

            <Substeps step={step} video={recipe.media.video_url} onSeek={hasVideo ? (at) => clip.current?.playFrom(at) : undefined} />
            <StepIngredients recipe={recipe} step={step} />
            <TipPill cookName={name} tip={step.tip} />
            <StepStory recipe={recipe} step={step} />

            {askTarget || waiting ? (
              <View style={styles.ask}>
                {askTarget ? <AskStepPill recipe={recipe} step={step.order} target={askTarget} /> : null}
                {waiting ? (
                  <Animated.View entering={FadeIn.duration(220)} style={styles.waiting} accessibilityLiveRegion="polite">
                    <ClockIcon size={16} color={colors.muted} />
                    <Txt variant="meta" size={14} color={colors.muted} style={styles.waitingText}>
                      {waiting}
                    </Txt>
                  </Animated.View>
                ) : null}
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>
      </ScrollHold>

      <BottomBar>
        <ActionButton
          variant="outline"
          label="Back"
          icon={<BackIcon size={20} color={colors.ink} />}
          padH={18}
          labelWeight={700}
          accessibilityLabel={n > 1 ? `Back to step ${n - 1}` : 'Back to the recipe'}
          onPress={goBack}
          style={styles.back}
        />
        {isLast ? (
          <ActionButton
            label={lentTo ? `${lentTo.name} made it` : 'I made it'}
            icon={<CheckIcon size={20} strokeWidth={3} color={colors.card} />}
            successLabel="Made it"
            onPress={finish}
            style={{ flex: 1 }}
          />
        ) : (
          <ActionButton
            label={reviewing ? `Continue at step ${furthest}` : 'Next step'}
            iconRight={reviewing ? undefined : <ArrowRightIcon size={22} color={colors.card} />}
            onPress={() => goTo(reviewing ? furthest : n + 1)}
            style={{ flex: 1 }}
          />
        )}
      </BottomBar>

      <StepsSheet visible={stepsOpen} onClose={() => setStepsOpen(false)} steps={recipe.steps} current={n} furthest={furthest} onPick={goTo} />

      <ConsentSheet
        visible={live.askConsent && !done}
        cookName={liveCook?.name}
        profile={liveCook}
        onYes={() => live.answerConsent(true)}
        onNotNow={() => void live.answerConsent(false)}
        onDismiss={live.dismissConsent}
      />
      <HeartBurst trigger={heartKey} fromName={liveCook?.name} />

      {done ? (
        <MadeItOverlay
          recipe={recipe}
          poster={recipe.media.poster_url ?? entry?.poster_url ?? null}
          title={done.title}
          subtitle={done.subtitle}
          cook={otherCook}
          meId={me?.id}
          cooked={done.card}
          onFinished={() => {
            setLast(0);
            checklist.clear();
          }}
          onLeave={leaveMadeIt}
        />
      ) : null}
    </View>
  );
}

/**
 * The one "waiting" line under Ask for this step's open questions: mine first ("You asked · waiting
 * for Dad"; a 1:1 names who I asked, the circle the dish's cook), else the newest someone else
 * asked in the circle ("Leo asked this 2 days ago · waiting").
 */
function waitingLine(qs: RecipeQuestion[], cookName: string): string | null {
  const mine = qs.find((q) => q.mine);
  if (mine) return `You asked · waiting for ${mine.waiting_for?.name ?? cookName}`;
  const other = qs[0];
  if (!other) return null;
  const d = daysAgo(other.created_at);
  const when = d <= 0 ? 'today' : d === 1 ? 'yesterday' : Number.isFinite(d) ? `${d} days ago` : '';
  return `${other.asker.name} asked this${when ? ` ${when}` : ''} · waiting`;
}

/** The step's own photo with no video to play: a 96 px thumbnail beside the title (radius 22). */
function StepThumb({ uri, title }: { uri: string; title: string }) {
  return (
    <View style={styles.thumb} accessible accessibilityLabel={`Photo: ${title}`}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 24, gap: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  progressCol: { flex: 1, minHeight: 48, justifyContent: 'center', gap: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepLabel: { flex: 1 },
  allSteps: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: alpha.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { gap: 20 },
  ask: { gap: 10 },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  waitingText: { flexShrink: 1 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  compactTitle: { flex: 1, letterSpacing: -0.24 },
  thumb: { width: 96, height: 96, borderRadius: radii.segment, overflow: 'hidden', backgroundColor: colors.well, flexShrink: 0 },
  back: { flexShrink: 0 },
});

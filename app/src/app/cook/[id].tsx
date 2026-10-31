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
//   6. one line while a question about this step waits ("You asked · waiting for Dad" / "Leo asked
//      this 2 days ago · waiting"). Cook mode asks by voice ("ask Grandma …" with homie on: homie
//      sends it to her), or with a long press on homie: "Ask Grandma anything", and the kid's next
//      words go straight to her; without a voice line (or with the mic refused) the long press opens
//      my chat with her instead. A tap on homie never opens a chat.
// One voice at a time: the video, the full screen and a story's voice stop each other (lib/media),
// and leaving the screen silences them. Family never sees the word "sample".
// Header (it stays put while the step scrolls under it): close, "Step 3 of 8", "All steps" (the sheet:
// tap a step to jump; "You're here"; the steps before the furthest one reached are checked) and one
// little yolk per step, filled up to the step on screen (retention PR 7, components/recipe/PotDots).
// Bottom (Caleb, Oct 24: like Siri, centred): Back · homie · Next step, the two buttons the same width
// and the same gap either side of homie, who docks there (the overlay draws the egg; this screen holds
// its place). A tap on homie turns it on, the next tap off (it never opens a chat); a long press asks. No
// chips: saying "back" or "repeat" does those, and the video replays
// itself. The right button is always "Next step" (Caleb, Oct 30: back to step 1, then Next, is step 2,
// never a jump to the furthest); on the last step "I made it".
// The step on screen when she leaves is saved as the last step, so the recipe and the next visit come back to it.
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
// Voice cooking (docs/build/STACK.md "kid cooking additions"; lib/live/voice): in a build with the
// native mic module (not Expo Go or web), with the voice service set and a dish Convex knows, the line
// to homie opens by itself (once the "Let Mom see" sheet has its answer, and the first time once the
// kid said "OK, continue" to "homecookd uses AI for this": lib/aiConsent), with homie off: the mic
// streams only while homie is on (a tap; the next tap turns it off) and for 8 s after homie says a
// step's short line or a nudge (Caleb, Oct 24). The screen follows it: go_to_step moves the step,
// play_clip plays that moment of the cook's video in the step's own player (moving to the step that
// holds it, unread: no step line over her; her words under it), homie's replies are only spoken (the egg lights up, labelled "AI
// voice"), a timer counts down beside the step title, and a question the video can't answer shows "I
// asked Grandma" above the egg. When the cook answers one of my questions by voice note, homie offers to play it
// (CookAnswers). While that moment is up, the service is told (an app-only moment: its own offer
// never takes that yes or no). Without a voice line (Expo Go, web, no service, or the line gave up),
// a tap on the egg reads the step in homie's voice and a tap while it talks stops it, and a kid who
// said yes to reading before hears each step (useReadSteps). homie never talks over a video
// (VoiceHold, lib/live/speak): a tap on homie takes the sound from it (the video fades out and pauses),
// and a video the kid plays takes it back (homie fades out and turns off; lib/live/voice). "I made it"
// hangs up.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInLeft, FadeInRight } from 'react-native-reanimated';

import { ConsentSheet } from '@/components/cooking/ConsentSheet';
import { CookAnswers, useAskByNote, useCookMoments, useReadSteps } from '@/components/cooking/CookMoments';
import { ClipCaption, TimerPill, VoiceHold, VoiceLine } from '@/components/cooking/VoiceCooking';
import { HeartBurst } from '@/components/cooking/HeartBurst';
import { ClipVideo, type ClipVideoHandle } from '@/components/media';
import { askForPushSoon } from '@/components/push/PushAskSheet';
import { BottomBar, useAskTarget, useBottomClearance, useOtherCook, useScreenBottom, useScreenTop } from '@/components/recipe/parts';
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
import { ensureAiConsent, useAiConsent } from '@/lib/aiConsent';
import { errorMessage, type RecipeQuestion } from '@/lib/api';
import { daysAgo, mmss } from '@/lib/format';
import { barFrame, closeMoment, getHomie, HOMIE_ON, HOMIE_SIZE, useHomieScreen, useHomieSelect } from '@/lib/homie';
import { madeItMilestone, madeItTitle } from '@/lib/kitchenCounts';
import { micStreamingSupported } from '@/lib/live/mic';
import { speak, stopSpeaking } from '@/lib/live/speak';
import { useVoiceCooking, VOICE_CONFIGURED, type VoiceClip } from '@/lib/live/voice';
import { appMomentKind, askCloseIn, consentSettled, cookingSessionOn, cookTap, phoneReads } from '@/lib/live/voiceLogic';
import { HANDOFF_FADE_MS, pauseAllVideos, stopAllMedia } from '@/lib/media';
import { cooked, openChatWith, openCircle, sendVoiceQuestion, useRecipeQuestions, type CookedRef } from '@/lib/messaging';
import { madeItWords } from '@/lib/postcardLogic';
import { backToRecipe } from '@/lib/navigation';
import { useLibrary, useRecipe } from '@/lib/recipes';
import { useSession, usingDevAid } from '@/lib/session';
import { useCookingSession } from '@/lib/useCookingSession';
import { recordingSupported } from '@/lib/voice';
import type { Step } from '@/lib/types';
import { alpha, colors, radii } from '@/theme/tokens';

const AWAKE_TAG = 'cook-mode';
const CONTENT_SIDE = 24;
/** homie docked in the bottom bar: exactly as tall as Back and Next beside it (60 pt). */
const DOCK = HOMIE_SIZE.bar;

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
  const { width: winW, height: winH } = useWindowDimensions();
  const clipH = Math.round(Math.min(260, Math.max(200, winH * 0.31)));
  // The header's height, once laid out (the page scrolls under it).
  const [headH, setHeadH] = useState(top + 76);
  const onHeadLayout = (e: LayoutChangeEvent) => setHeadH(Math.round(e.nativeEvent.layout.height));
  // Where homie docks (window pt): the bar's row is symmetric, so its middle is the screen's middle,
  // level with the 60 pt buttons above the bar's bottom padding. Worked out, not measured: a screen
  // still sliding in would measure off to the side.
  const barBottom = useScreenBottom();
  const dock = barFrame({ width: winW, height: winH }, barBottom);

  const [chosen, setChosen] = useState<number | null>(Number.isFinite(asked) && asked > 0 ? asked : null);
  const [dir, setDir] = useState<1 | -1>(1);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [done, setDone] = useState<{ title: string; subtitle?: string; told?: boolean; card: CookedRef | null } | null>(null);
  // A moment of the cook's video the voice service asked for (play_clip), playing in the step's player.
  const [moment, setMoment] = useState<(VoiceClip & { key: number }) | null>(null);

  const total = recipe?.steps.length ?? 0;
  const fallback = last.loaded ? last.step || 1 : 1;
  const n = total ? Math.min(Math.max(1, chosen ?? fallback), total) : 1;
  const step: Step | null = recipe?.steps[n - 1] ?? null;
  // The furthest step reached, for the steps sheet's checks only.
  const furthest = total ? Math.min(total, Math.max(n, last.loaded ? last.step : 0)) : 0;

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

  // One voice at a time across screens too: when a screen is pushed over this one, the step's video
  // (or a story's voice) must not keep playing under it.
  useFocusEffect(useCallback(() => () => stopAllMedia(), []));

  // Save the step on screen once she leaves, so the recipe can offer "Back to step N" (only once the
  // saved one has loaded: an earlier write would replace it; not after "I made it").
  const setLast = last.setStep;
  const leaving = useRef({ n, save: false, setLast });
  useEffect(() => {
    leaving.current = { n, save: !!total && !done && last.loaded, setLast };
  });
  useEffect(
    () => () => {
      const at = leaving.current;
      if (at.save) at.setLast(at.n);
    },
    [],
  );

  const toRecipe = () => {
    if (!id) return router.replace('/');
    backToRecipe(router, id); // a kid's dish lives in the Recipes tab
  };

  const goTo = (k: number) => {
    setStepsOpen(false);
    setMoment(null);
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

  // The cook this dish's questions go to, by their profile name ("Ask Grandma").
  const cookName = askTarget?.kind === 'cook' ? askTarget.cook.name : (recipe?.cook.name ?? '');

  const homie = useCookMoments({ cookName });
  // One thing asks at a time: voice (and homie's questions) wait for the "Let Mom see" sheet's answer,
  // when there is one to wait for (not for a memorial cook: the session is off then).
  const sessionOn = cookingSessionOn({ enabled: liveOn, cookId: liveCook?.id, memorial: liveCook?.memorial, recipeId: recipe?.id, total });
  const settled = consentSettled({ askConsent: live.askConsent, liveOn: sessionOn, consent: live.consent, startFailed: live.startFailed });
  // Voice can start on its own here (a dev build with the mic module and the voice service), once this
  // phone said yes to the AI companies: asked the first time, after "Let Mom see" has its answer. Not
  // now: no line this visit (the phone reads instead).
  const consent = useAiConsent();
  const [noAi, setNoAi] = useState(false);
  // homie switched off (lib/homie/switch): no voice line, no AI ask for it, no mic; Back and Next by touch.
  const voiceHere = HOMIE_ON && micStreamingSupported() && VOICE_CONFIGURED && !noAi;
  const aiAsked = useRef(false);
  useEffect(() => {
    if (!voiceHere || !settled || done || consent !== 'needed' || aiAsked.current) return;
    aiAsked.current = true;
    void ensureAiConsent().then((ok) => {
      if (!ok) setNoAi(true);
    });
  }, [voiceHere, settled, done, consent]);
  const voice = useVoiceCooking({
    libraryId: recipe?.id ?? null,
    step: n,
    cookName,
    auto: voiceHere && settled && consent === 'given',
    onGoTo: (k) => total && goTo(Math.min(Math.max(1, k), total)),
    onClip: (c) => {
      homie.onHeard();
      const at = recipe?.steps.findIndex((s) => c.startS >= s.start_s && c.startS < s.end_s) ?? -1;
      if (at >= 0) goTo(at + 1);
      setMoment((was) => ({ ...c, key: (was?.key ?? 0) + 1 }));
      // The step it shows: one it moved to goes to the service unread (no step line over her clip).
      return at >= 0 ? at + 1 : n;
    },
    onOffer: homie.onOffer,
    onOfferClosed: homie.onOfferClosed,
    onSay: homie.onSay,
    onHeard: homie.onHeard,
  });
  // No voice line that reads (Expo Go, web, a dish the voice service doesn't have, or it failed): this
  // phone asks "read it out loud?" and reads the steps.
  const phoneReading = HOMIE_ON && phoneReads({ voiceHere, live: voice.live, unavailable: voice.unavailable });
  // A tap on homie never navigates (Caleb, Oct 24; voiceLogic cookTap): with a voice line it turns homie
  // on or off; with none it reads this step, and a tap while homie talks stops it. One gesture only.
  // "I made it" takes the screen: no egg over the celebration.
  const potTap = () => {
    const h = getHomie().state;
    const tap = cookTap({ voiceHere, status: voice.status, unavailable: voice.unavailable, talking: h === 'lit' || h === 'speaking' });
    if (tap === 'toggle' && consent !== 'given') return void ensureAiConsent().then((ok) => (ok ? voice.toggle() : setNoAi(true)));
    if (tap === 'toggle') return voice.toggle();
    if (tap === 'stop') return stopSpeaking();
    if (!step) return;
    // homie takes the sound: the video fades out first (with a voice line, voice.toggle does this).
    pauseAllVideos({ fadeMs: HANDOFF_FADE_MS });
    void speak(`Step ${n}. ${step.instruction}`, { profileId: me?.id, answer: true });
  };

  // A long press asks the cook (Caleb, Oct 25; never the tap's toggle). It takes the sound, as a tap does
  // (the video fades out). With nobody else to ask (the cook on her own dish) it reads this step like a
  // tap; else "Ask Grandma anything" while homie can hear (the kid's next words go straight to her), or my
  // chat with her, the dish and step in the box (no voice line, or the mic refused).
  const asking = useRef(false);
  const askInChat = async () => {
    if (!recipe || !askTarget || asking.current) return;
    asking.current = true;
    try {
      const thread = askTarget.kind === 'cook' ? await openChatWith(askTarget.cook.id) : await openCircle();
      router.push({ pathname: '/chat/[id]', params: { id: thread, recipe: recipe.id, step: String(n), ask: '1' } });
    } catch (e) {
      toast.show(errorMessage(e, `Couldn’t reach ${askTarget.kind === 'cook' ? cookName : 'the family'} right now.`), { tone: 'error' });
    } finally {
      asking.current = false;
    }
  };
  const askByNote = useAskByNote({
    cookName,
    send: async (rec) => {
      if (!recipe || !askTarget) return;
      const thread = askTarget.kind === 'cook' ? await openChatWith(askTarget.cook.id) : await openCircle();
      await sendVoiceQuestion(thread, rec, recipe.id, n);
    },
    onFail: () => void askInChat(),
  });
  const potHold = () => {
    pauseAllVideos({ fadeMs: HANDOFF_FADE_MS });
    if (!askTarget) {
      if (step) void speak(`Step ${n}. ${step.instruction}`, { profileId: me?.id, answer: true });
      return;
    }
    if (voice.live && !voice.muted) return homie.ask();
    // No live line for this dish (one Convex doesn't know) or the mic refused it: the same "Ask <cook>
    // anything", sent as a voice note to the cook's chat with the dish (never opening the chat).
    if (recordingSupported()) return void askByNote.ask();
    void askInChat();
  };
  useHomieScreen({ hidden: !!done, dock, onPress: potTap, onLongPress: potHold, longPressLabel: cookName ? `Ask ${cookName}` : undefined });
  useReadSteps({ on: phoneReading && homie.readAloud && !done, step: n, text: step?.instruction ?? '' });
  // An app-only moment (her answer, "Ask Grandma anything") up on the phone: the service is told.
  const momentId = useHomieSelect((h) => h.moment?.id ?? null);
  const tellMoment = voice.setMoment;
  useEffect(() => tellMoment(appMomentKind(momentId)), [momentId, tellMoment]);
  // "Ask Grandma anything" lives only while homie can hear it: the mic refused, the chat with her instead;
  // the line or homie's mic gone (the app in the background, the line lost, homie off for a video the kid
  // played), it closes after a short grace; and 25 s after the kid last talked, never mid-sentence
  // (voiceLogic askCloseIn).
  const askUp = appMomentKind(momentId) === 'ask';
  const micRefused = voice.muted;
  const askHears = voice.live && voice.active;
  const kidTalking = voice.kidTalking;
  const chat = useRef(askInChat);
  useEffect(() => {
    chat.current = askInChat;
  });
  useEffect(() => {
    if (!askUp || !momentId) return;
    if (micRefused) {
      closeMoment(momentId);
      void chat.current();
      return;
    }
    const ms = askCloseIn({ hears: askHears, kidTalking });
    if (ms == null) return;
    const t = setTimeout(() => closeMoment(momentId), ms);
    return () => clearTimeout(t);
  }, [askUp, momentId, micRefused, askHears, kidTalking]);
  const voiceError = voice.error;
  const showToast = toast.show;
  useEffect(() => {
    if (voiceError) showToast(voiceError.text, { tone: 'error' });
  }, [voiceError, showToast]);

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
    // Cooking is over: homie hangs up (no nudge, timer line or answer over the celebration).
    voice.stop();
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
    <View style={[styles.head, { paddingTop: top }]} pointerEvents="box-none" onLayout={onHeadLayout}>
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
      <LinearGradient pointerEvents="none" colors={[colors.page, 'rgba(238,243,240,0)']} style={styles.headFade} />
    </View>
  );

  if (!recipe || !step) {
    const gone = missing || (!loading && !recipe) || (recipe && !recipe.steps.length);
    return (
      <View style={styles.page}>
        {header}
        <View style={[styles.content, { paddingTop: headH + 4 }]}>
          {gone ? (
            <EmptyState
              mood={recipe ? 'sleepy' : 'oops'}
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

  // The kid can answer homie out loud while a moment is up (homie on by a tap).
  const hearing = voice.hearing;

  return (
    <View style={styles.page}>
      {header}
      <ScrollHold value={hold.set}>
        <ScrollView ref={scroll} scrollEnabled={!hold.held} contentContainerStyle={[styles.content, { paddingTop: headH + 4, paddingBottom: clearance }]} showsVerticalScrollIndicator={false}>
          <Animated.View key={`step-${n}`} entering={enter} style={styles.body}>
            {hasVideo ? (
              <>
                <View style={styles.titleRow}>
                  <Txt variant="display" size={30} leading={1.15} accessibilityRole="header" style={styles.flex}>
                    {step.title}
                  </Txt>
                  <TimerPill timers={voice.timers} />
                </View>
                <ClipVideo
                  key={moment ? `moment-${moment.key}` : 'step'}
                  ref={clip}
                  url={recipe.media.video_url}
                  poster={poster}
                  start_s={moment?.startS ?? step.start_s}
                  end_s={moment?.endS ?? step.end_s}
                  autoPlay={!!moment}
                  appPlays={!!moment}
                  onEnded={moment ? () => setMoment(null) : undefined}
                  height={clipH}
                  radius={radii.panel}
                  aspectHint={recipe.media.width && recipe.media.height ? recipe.media.width / recipe.media.height : null}
                  accessibilityLabel={`Watch this step: ${step.title}, ${mmss(len)}`}
                  full={{ label: `Step ${n} · ${mmss(len)}`, quote: step.quote }}
                  chapters={moment ? null : lineStarts(stepSubsteps(step))}
                />
                {moment?.quote ? <ClipCaption quote={moment.quote} quoteEn={moment.quoteEn} /> : null}
              </>
            ) : (
              // No video: the step's own photo is a thumbnail beside the title, so the words come first.
              <View style={styles.compact}>
                {step.image_url ? <StepThumb uri={step.image_url} title={step.title} /> : null}
                <Txt variant="display" size={26} leading={1.18} style={styles.compactTitle} accessibilityRole="header">
                  {step.title}
                </Txt>
                <TimerPill timers={voice.timers} />
              </View>
            )}

            <Substeps step={step} video={recipe.media.video_url} onSeek={hasVideo ? (at) => clip.current?.playFrom(at) : undefined} />
            <StepIngredients recipe={recipe} step={step} />
            <TipPill cookName={name} tip={step.tip} />
            <StepStory recipe={recipe} step={step} />

            {waiting ? (
              <Animated.View entering={FadeIn.duration(220)} style={styles.waiting} accessibilityLiveRegion="polite">
                <ClockIcon size={16} color={colors.muted} />
                <Txt variant="meta" size={14} color={colors.muted} style={styles.waitingText}>
                  {waiting}
                </Txt>
              </Animated.View>
            ) : null}
          </Animated.View>
        </ScrollView>
      </ScrollHold>

      {HOMIE_ON ? <VoiceHold voice={voice} videoUrl={recipe.media.video_url} herClip={!!moment} /> : null}
      {HOMIE_ON ? <VoiceLine voice={voice} cookName={cookName} slot={dock} /> : null}
      {done || !HOMIE_ON ? null : (
        <CookAnswers libraryId={recipe.id} cookName={cookName} asked={voice.askedIds} top={headH + 8} hearing={hearing} listenFor={homie.listenFor} />
      )}
      <BottomBar>
        <ActionButton
          variant="outline"
          label="Back"
          padH={12}
          labelWeight={700}
          accessibilityLabel={n > 1 ? `Back to step ${n - 1}` : 'Back to the recipe'}
          onPress={goBack}
          style={styles.barButton}
        />
        {/* homie's place: the overlay draws the egg here (useHomieScreen dock). Switched off: Back and Next meet. */}
        {HOMIE_ON ? <View style={styles.dockSlot} pointerEvents="none" /> : null}
        {isLast ? (
          <ActionButton
            label={lentTo ? `${lentTo.name} made it` : 'I made it'}
            successLabel="Made it"
            padH={12}
            onPress={finish}
            style={styles.barButton}
          />
        ) : (
          <ActionButton
            label="Next step"
            padH={12}
            accessibilityLabel={`Next step, step ${n + 1}`}
            onPress={() => goTo(n + 1)}
            style={styles.barButton}
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
 * The one "waiting" line for this step's open questions: mine first ("You asked · waiting
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
  content: { paddingHorizontal: CONTENT_SIDE, gap: 24 },
  head: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1, paddingHorizontal: CONTENT_SIDE, backgroundColor: colors.page },
  headFade: { position: 'absolute', left: 0, right: 0, bottom: -16, height: 16 },
  // Top-aligned: the close button and "All steps" share homie's 48 pt row (lib/homie restFrame).
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
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
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  flex: { flex: 1 },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  waitingText: { flexShrink: 1 },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  compactTitle: { flex: 1, letterSpacing: -0.24 },
  thumb: { width: 96, height: 96, borderRadius: radii.segment, overflow: 'hidden', backgroundColor: colors.well, flexShrink: 0 },
  // Back and Next the same width either side of homie (BottomBar's row keeps one 12 pt gap); words
  // only, so "Next step" fits half a small phone.
  barButton: { flex: 1, flexBasis: 0, alignSelf: 'center' },
  dockSlot: { width: DOCK, height: DOCK, alignSelf: 'center' },
});

// Send (bible: Parent-Send). After Record: "Send your <dish>" (a name field when we don't know the
// dish yet), the videos (tap to leave one out, "Add more" for another part), "Who is it for?"
// (learners + Everyone), an optional hello voice note, and the big "Send to Leo". The dish and the kid
// come filled in from Record's pre-record sheet (the draft), and so do her language and homie's
// recording, which go to jobs.create. (A phone recording made with homie skips this screen: its done
// screen sends it by itself. It lands here only when that send fails.)
//
// Send = upload the hello (if any) -> sendDraft (components/record/sendDraft: the background video
// upload, jobs.create, POST /pending-sends so the recipe reaches them once it's written) -> SuccessBurst "On its way to Leo"
// -> the Recipes tab, where a greyed "still cooking" row tracks it. Videos only upload from the
// phone app; the web explains that instead.
// Retention PR 7 touches (RETENTION-HANDOFF 4): while it works the button says "Wrapping…" beside
// its spinner; the burst holds a paper plane that lifts off, and under "On its way to Leo" a small
// pot's lid settles on: "You can close the app" (the uploads are the OS's background transfers).
// Dev aids (web screenshots): `?preview=1|dish` (stills), `?preview=done` (the burst),
// `?preview=wrapping` (the button mid-send).
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { askForPushSoon } from '@/components/push/PushAskSheet';
import { addClips, clearDraft, getDraft, toggleClip, useDraft, type DraftClip } from '@/components/record/draft';
import { phoneOnly } from '@/components/record/pick';
import { AddVideosSheet, PhoneOnlySheet } from '@/components/record/sheets';
import { usePickVideos } from '@/components/record/usePickVideos';
import { AddMoreLink, VideoGrid } from '@/components/record/VideoGrid';
import { HelloCard } from '@/components/record/HelloCard';
import { LidPot } from '@/components/record/LidPot';
import { MAX_TITLE, sendDraft } from '@/components/record/sendDraft';
import { ActionButton, Avatar, BackPill, Chip, PressableScale, ScreenWash, SendIcon, SuccessBurst, Txt, type ActionState } from '@/components/ui';
import { WEB_URL, errorMessage, type Profile } from '@/lib/api';
import { daysAgo } from '@/lib/format';
import { useSession } from '@/lib/session';
import { MAX_RECORDING_HOURS, uploadsConfigured } from '@/lib/uploads';
import { uploadVoice, type VoiceRecording } from '@/lib/voice';
import { colors, motion, shadows, space } from '@/theme/tokens';

type Who = string | 'everyone';

/** After sending: the Recipes tab, where the recording shows as a greyed row until it's written. */
function goToRecipes() {
  if (router.canGoBack()) router.dismissTo('/parent/recipes');
  else router.replace('/parent/recipes');
}

/** Dev aid (web screenshots only): `/send?preview=1` (or `wrapping`) fills the draft with three still images. */
function useDevPreview(mode: string | undefined) {
  const on = mode === '1' || mode === 'dish' || mode === 'wrapping';
  useEffect(() => {
    if (!__DEV__ || !on || getDraft().clips.length > 0) return;
    const now = new Date();
    const at = (h: number, m: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).toISOString();
    const stills = [
      ['photo-hands-kneading.jpg', at(14, 10), 12],
      ['dish-dumplings.jpg', at(14, 34), 14],
      ['photo-steaming-pot.jpg', at(15, 5), 9],
    ] as const;
    addClips(
      stills.map<DraftClip>(([file, recordedAt, min], i) => ({
        key: `preview-${i}`,
        asset: { uri: `${WEB_URL}/media/stock/${file}`, width: 0, height: 0, type: 'video', duration: min * 60_000 },
        source: 'camera',
        recordedAt,
        selected: true,
        previewImage: `${WEB_URL}/media/stock/${file}`,
      })),
      mode === 'dish' || mode === 'wrapping' ? { dish: 'Sunday eggs' } : {},
    );
  }, [on, mode]);
}

export default function SendScreen() {
  const params = useLocalSearchParams<{ preview?: string }>();
  useDevPreview(params.preview);
  const insets = useSafeAreaInsets();
  const { me, owner, profiles, learners } = useSession();
  const draft = useDraft();
  const pick = usePickVideos();

  // People to send to: the learners, then "Everyone" (every other person in the family).
  const others = useMemo(() => profiles.filter((p) => p.id !== me?.id), [profiles, me?.id]);
  const people = useMemo(() => learners.filter((p) => p.id !== me?.id), [learners, me?.id]);
  const [who, setWho] = useState<Who | null>(null);
  const defaultWho: Who | null =
    (draft.everyone && others.length > 0 ? 'everyone' : null) ??
    (draft.requestFrom && others.some((p) => p.id === draft.requestFrom) ? draft.requestFrom : null) ??
    people[0]?.id ??
    (others.length > 0 ? 'everyone' : null);
  const picked: Who | null = who ?? defaultWho;
  const pickedProfile = picked && picked !== 'everyone' ? others.find((p) => p.id === picked) ?? null : null;
  const recipients: Profile[] = picked === 'everyone' ? others : pickedProfile ? [pickedProfile] : [];

  // The dish: known from a request (the heading; tap it to change), else typed here.
  const [typed, setTyped] = useState<string | null>(null);
  const [editRequested, setEditRequested] = useState(false);
  const title = typed ?? draft.dish ?? '';
  const editingTitle = editRequested || !draft.dish;
  const dish = title.trim();

  const [hello, setHello] = useState<VoiceRecording | null>(null);
  // The hello is only kept once it's stopped, so Send waits for that (or it would go without it).
  const [helloRecording, setHelloRecording] = useState(false);
  const [addSheet, setAddSheet] = useState(false);
  const [phoneSheet, setPhoneSheet] = useState(false);
  const [state, setState] = useState<ActionState>(() => (__DEV__ && params.preview === 'wrapping' ? 'loading' : 'idle'));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(() => (__DEV__ && params.preview === 'done' ? 'On its way to Leo' : null));
  // Set when Send is tapped while something is missing: the helper turns red.
  const [nudge, setNudge] = useState(false);
  const titleRef = useRef<TextInput>(null);

  const clips = draft.clips;
  const selected = clips.filter((c) => c.selected);
  const totalS = selected.reduce((a, c) => a + (c.asset.duration ?? 0) / 1000, 0);
  const tooLong = totalS > MAX_RECORDING_HOURS * 3600;
  const allToday = clips.length > 0 && clips.every((c) => c.recordedAt && daysAgo(c.recordedAt) === 0);

  const sendLabel =
    picked === 'everyone' ? 'Send to everyone' : pickedProfile ? `Send to ${pickedProfile.name}` : 'Send to your recipes';
  const toLabel = picked === 'everyone' ? 'everyone' : pickedProfile?.name ?? null;

  let helper = '';
  let blocked = false;
  if (!phoneOnly && !uploadsConfigured()) {
    helper = 'Sending isn’t set up in this build yet.';
    blocked = true;
  } else if (selected.length === 0) {
    helper = clips.length === 0 ? 'Add your videos first.' : 'Pick at least one video.';
    blocked = true;
  } else if (tooLong) {
    helper = `Over ${MAX_RECORDING_HOURS} hours of video. Leave a part out.`;
    blocked = true;
  } else if (!dish) {
    helper = 'Name the dish first.';
    blocked = true;
  } else if (helloRecording) {
    helper = 'Stop your hello first.';
    blocked = true;
  }
  if (error) helper = error;

  // Content fades out for the success burst (motion spec 5).
  const content = useSharedValue(done ? 0 : 1);
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.value }));
  const mounted = useRef(true);
  const sentJob = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
      if (sentJob.current) clearDraft();
    },
    [],
  );

  const send = async () => {
    if (state !== 'idle') return;
    if (blocked) {
      setNudge(true);
      if (!dish && selected.length > 0) titleRef.current?.focus();
      return;
    }
    if (phoneOnly) {
      setPhoneSheet(true);
      return;
    }
    if (!me) {
      setError('Pick who you are first.');
      return;
    }
    setError(null);
    setState('loading');
    const started = Date.now();
    try {
      let helloUp: { path: string; duration_s: number } | null = null;
      if (hello) {
        try {
          helloUp = await uploadVoice(hello);
        } catch (e) {
          throw new Error(`Your hello didn’t upload. ${errorMessage(e, '')} Try again, or remove it.`.replace(/\s+/g, ' '));
        }
      }
      await sendDraft({ me, draft, clips: selected, kid: pickedProfile, recipients, toLabel, dish, hello: helloUp });
      // The videos are a job now (the home card tracks it): the draft must not outlive this screen,
      // or Record would offer them for sending again. (Cleared on unmount; kept on screen until then.)
      sentJob.current = true;
      const wait = motion.loadingMinMs - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!mounted.current) return;
      setState('idle');
      content.set(withTiming(0, { duration: 200 }));
      setTimeout(() => mounted.current && setDone(toLabel ? `On its way to ${toLabel}` : 'On its way'), 220);
    } catch (e) {
      const wait = motion.loadingMinMs - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!mounted.current) return;
      const msg = e instanceof Error && e.message ? e.message : errorMessage(e);
      setError(/connection|reach/i.test(msg) ? msg : `${msg.replace(/\.?$/, '.')} Check the connection and try again.`.replace(/\.\./g, '.'));
      setState('error');
      setTimeout(() => mounted.current && setState('idle'), 1800);
    }
  };

  const openAdd = () => (phoneOnly ? setPhoneSheet(true) : setAddSheet(true));

  const addFrom = (kind: 'camera' | 'library') => {
    setAddSheet(false);
    // Let the sheet's Modal finish closing before the camera / picker presents (iOS).
    // The sheet closes in 240 ms, then its native Modal still has to go away; presenting over it
    // fails on iOS. (usePickVideos also recovers if a picker never shows.)
    setTimeout(() => void (kind === 'camera' ? pick.record() : pick.library()), 600);
  };

  const heading = `Send your ${dish || 'recipe'}`;
  const sending = state === 'loading';

  // No leaving mid-send (Back pill or the iOS swipe): the job and the draft change hands here.
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !sending });
  }, [navigation, sending]);

  return (
    <View style={styles.screen}>
      <ScreenWash tone="parent" height={300} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Animated.View style={[styles.flex, contentStyle]} pointerEvents={done ? 'none' : 'auto'}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.col,
              { paddingTop: Math.max(space.topDetail, insets.top + 9), paddingBottom: 24 + 64 + 10 + 20 + 40 },
            ]}>
            <BackPill
              onPress={sending ? undefined : () => (router.canGoBack() ? router.back() : router.replace('/record'))}
              style={sending ? styles.dim : undefined}
            />

            {editingTitle ? (
              <View style={styles.titleBlock}>
                <Txt variant="display" size={34} accessibilityRole="header">
                  {heading}
                </Txt>
                <View style={styles.field}>
                  <TextInput
                    ref={titleRef}
                    value={title}
                    onChangeText={(t) => {
                      setTyped(t);
                      if (error) setError(null);
                    }}
                    placeholder="What’s the dish?"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                    autoCapitalize="sentences"
                    returnKeyType="done"
                    maxLength={MAX_TITLE}
                    editable={!sending}
                    accessibilityLabel="The dish’s name"
                  />
                </View>
              </View>
            ) : (
              <PressableScale
                onPress={() => setEditRequested(true)}
                scaleTo={0.99}
                accessibilityLabel={`${heading}. Tap to change the dish’s name.`}>
                <Txt variant="display" size={34}>
                  {heading}
                </Txt>
              </PressableScale>
            )}

            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Txt variant="title" size={17} weight={700} accessibilityRole="header">
                  {allToday ? 'Today’s videos' : 'Your videos'}
                </Txt>
                {clips.length > 0 ? <AddMoreLink onPress={openAdd} /> : null}
              </View>
              <VideoGrid
                clips={clips}
                onToggle={(key) => !sending && toggleClip(key)}
                onAdd={openAdd}
              />
            </View>

            {others.length > 0 ? (
              <View style={styles.section}>
                <Txt variant="title" size={17} weight={700} accessibilityRole="header">
                  Who is it for?
                </Txt>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.peopleScroll}
                  contentContainerStyle={styles.people}>
                  {people.map((p) => (
                    <Chip
                      key={p.id}
                      size="lg"
                      selectedTone="ink"
                      label={p.name}
                      selected={picked === p.id}
                      onPress={() => !sending && setWho(p.id)}
                      leading={<Avatar profile={p} size={40} />}
                    />
                  ))}
                  <Chip
                    size="lg"
                    selectedTone="ink"
                    label="Everyone"
                    selected={picked === 'everyone'}
                    onPress={() => !sending && setWho('everyone')}
                    accessibilityLabel="Everyone in the family"
                  />
                </ScrollView>
              </View>
            ) : null}

            <HelloCard hello={hello} onChange={setHello} onRecordingChange={setHelloRecording} disabled={sending} />
          </ScrollView>
        </Animated.View>

        {/* Content scrolls under the pinned button; fade it into the page. */}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(247,247,242,0)', colors.page]}
          locations={[0, 0.45]}
          style={styles.fade}
        />
        <Animated.View style={[styles.bottom, contentStyle]} pointerEvents={done ? 'none' : 'box-none'}>
          <ActionButton
            label={sendLabel}
            size="xl"
            state={state}
            onPress={send}
            icon={<SendIcon size={22} color={colors.card} />}
            loadingLabel="Wrapping…"
            errorLabel="Didn’t send"
            style={styles.stretch}
            accessibilityHint="Sends your videos in the background. You can close the app."
          />
          {helper ? (
            <Txt
              variant="meta"
              size={14}
              align="center"
              color={error || (nudge && blocked) ? colors.danger : colors.muted}
              accessibilityLiveRegion="polite">
              {helper}
            </Txt>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>

      {done ? (
        <Animated.View entering={FadeIn.duration(120)} style={[StyleSheet.absoluteFill, styles.done]} pointerEvents="none">
          {/* TODO(caleb): "You can close the app" holds while the phone locks or the app goes to the
              background (iOS background URLSession, lib/uploads.ts), but iOS cancels those uploads
              when the app is swiped away in the app switcher, and nothing restarts them on the next
              launch. Check a force-quit mid-upload on a phone; then add a resume-on-launch for a job
              whose files didn't finish, or soften the line. */}
          <SuccessBurst
            title={done}
            glyph="plane"
            subtitle="You can close the app"
            subtitleIcon={<LidPot />}
            onDone={() => {
              clearDraft();
              goToRecipes();
              // Right after Send: "Want a note when Leo writes back?" (once; never on a lent phone).
              const to = recipients.find((p) => p.role === 'learner') ?? recipients[0];
              if (me && to && (!owner || owner.id === me.id)) {
                askForPushSoon({ kind: 'cook-first-send', profileId: me.id, name: to.name, profile: to });
              }
            }}
          />
        </Animated.View>
      ) : null}

      <AddVideosSheet
        visible={addSheet}
        onClose={() => setAddSheet(false)}
        onRecord={() => addFrom('camera')}
        onLibrary={() => addFrom('library')}
      />
      <PhoneOnlySheet visible={phoneSheet || pick.phoneSheet} onClose={() => (setPhoneSheet(false), pick.closePhoneSheet())} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  flex: { flex: 1 },
  col: { paddingHorizontal: space.gutter, gap: 24 },
  titleBlock: { gap: 16 },
  field: {
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.card,
    boxShadow: shadows.field,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  input: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 17,
    color: colors.ink,
    paddingVertical: 0,
    outlineStyle: 'none',
  } as object,
  section: { gap: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 22 },
  // Edge to edge, so a long family scrolls instead of wrapping (the bible's row is one line).
  // paddingVertical 4 on the row keeps the chip shadows; -4 here keeps the bible's 12 / 24 gaps.
  peopleScroll: { marginHorizontal: -space.gutter, marginVertical: -4, overflow: 'visible' },
  people: { paddingHorizontal: space.gutter, gap: 10, paddingVertical: 4 },
  bottom: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    bottom: 24,
    alignItems: 'center',
    gap: 10,
  },
  stretch: { alignSelf: 'stretch' },
  dim: { opacity: 0.5 },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150 },
  done: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
});

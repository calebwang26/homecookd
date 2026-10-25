// Dev showcase of every Hearth primitive, for screenshots against the bible renders.
// Open /dev/gallery (web: http://localhost:8090/dev/gallery).
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HomiePot } from '@/components/homie';
import { LaunchSplash } from '@/components/LaunchSplash';
import {
  ActionButton,
  ArrowRightIcon,
  Avatar,
  BackIcon,
  BackPill,
  BookIcon,
  BottomSheet,
  Brand,
  CameraIcon,
  Card,
  ChatIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  Chip,
  ClockIcon,
  CloseIcon,
  CopyIcon,
  Dropdown,
  EmptyState,
  EyeIcon,
  FloatingTabBar,
  GridIcon,
  HeartIcon,
  HomeIcon,
  IconButton,
  LinkIcon,
  ListCard,
  ListRow,
  MessageIcon,
  MicIcon,
  MoreIcon,
  PauseIcon,
  Pill,
  PlayIcon,
  PlusIcon,
  PotMark,
  PressableScale,
  RecordDotIcon,
  ScreenWash,
  SearchIcon,
  SegmentedChoice,
  SendIcon,
  ShareIcon,
  Skeleton,
  SkeletonRow,
  SparkleIcon,
  SpoonIcon,
  StopIcon,
  SuccessBurst,
  ToastProvider,
  Txt,
  useToast,
  VideoIcon,
  VoiceIcon,
  Waveform,
  WhatsAppIcon,
  type FloatingTabBarProps,
} from '@/components/ui';
import { setHomie, showMoment, type HomieState } from '@/lib/homie/store';
import { speak } from '@/lib/live/speak';
import { alpha, colors, shadows } from '@/theme';

export default function GalleryScreen() {
  return (
    <ToastProvider bottom={40}>
      <Gallery />
    </ToastProvider>
  );
}

function Gallery() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [seg, setSeg] = useState<'cook' | 'learner'>('cook');
  const [cook, setCook] = useState('Everyone');
  const [who, setWho] = useState('Leo');
  const [saved, setSaved] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [sent, setSent] = useState<{ title: string; subtitle?: string } | null>(null);
  const [burstKey, setBurstKey] = useState(0);
  const [splash, setSplash] = useState(false);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}>
        <ScreenWash tone="kid" height={360} />
        <View style={[styles.top, { paddingTop: Math.max(60, insets.top + 13) }]}>
          <BackPill onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <Brand />
          <Txt variant="display" size={40}>
            Hearth gallery
          </Txt>
          <Txt variant="lead">Every primitive from the design bible, on one page.</Txt>
        </View>

        <Section title="homie">
          <HomieStates />
        </Section>

        <Section title="Type">
          <Txt variant="display" size={34}>Good morning, Mom</Txt>
          <Txt variant="display">Our family table</Txt>
          <Txt variant="display" size={30}>Sunday Chili</Txt>
          <Txt variant="section">Picked for you</Txt>
          <Txt variant="kitchen">Dad&apos;s kitchen</Txt>
          <Txt variant="name">Dad</Txt>
          <Txt variant="quote">“One more shake. Trust me.”</Txt>
          <Txt variant="quoteLg">“How long for a soft egg?”</Txt>
          <Txt variant="lead">Tap your face to come in.</Txt>
          <Txt variant="title">Leo asked you</Txt>
          <Txt variant="meta">Lunch all week · 50 min</Txt>
          <Txt variant="eyebrow">In this step</Txt>
        </Section>

        <Section title="Colour">
          <View style={styles.wrap}>
            {(Object.entries(colors) as [string, string][]).map(([k, v]) => (
              <View key={k} style={styles.swatchItem}>
                <View style={[styles.swatch, { backgroundColor: v }]} />
                <Txt variant="tiny" numberOfLines={1}>{k}</Txt>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Icons">
          <View style={styles.wrap}>
            {[
              <HomeIcon key="a" />, <GridIcon key="b" />, <ChatIcon key="c" />, <MicIcon key="d" />, <BookIcon key="e" />,
              <BackIcon key="f" />, <ChevronRightIcon key="g" />, <ChevronDownIcon key="h" />, <ChevronUpIcon key="i" />,
              <CloseIcon key="j" />, <ArrowRightIcon key="k" />, <PlusIcon key="l" />, <SearchIcon key="m" />, <ClockIcon key="n" />,
              <CheckIcon key="o" color={colors.green} />, <EyeIcon key="p" />, <VideoIcon key="q" />, <CameraIcon key="q2" />,
              <VoiceIcon key="r" />, <SendIcon key="s" />, <ShareIcon key="t" />, <LinkIcon key="u" />, <CopyIcon key="v" />,
              <MessageIcon key="w" />, <WhatsAppIcon key="x" />, <MoreIcon key="y" />, <HeartIcon key="z" />,
              <HeartIcon key="z2" filled color={colors.danger} />, <PlayIcon key="pl" size={22} />, <PauseIcon key="pa" size={22} />,
              <StopIcon key="st" size={22} color={colors.danger} />, <RecordDotIcon key="rd" />, <SpoonIcon key="sp" />,
              <SparkleIcon key="sk" gradient />, <PotMark key="pot" size={34} />,
            ].map((icon, i) => (
              <View key={i} style={styles.iconCell}>{icon}</View>
            ))}
          </View>
        </Section>

        <Section title="Action buttons">
          <ActionButton label="Start cooking" iconRight={<ArrowRightIcon color={colors.card} />} onPress={() => {}} />
          <ActionButton
            label="Send to Leo"
            size="xl"
            successLabel="Sent to Leo"
            icon={<SendIcon color={colors.card} />}
            onPress={() => new Promise((r) => setTimeout(r, 900))}
          />
          <ActionButton
            label="This one fails"
            variant="ink"
            onPress={() => new Promise((_, reject) => setTimeout(() => reject(new Error('nope')), 700))}
          />
          <ActionButton label="Ask about a dish" variant="ink" icon={<PlusIcon color={colors.card} strokeWidth={2.2} />} onPress={() => {}} />
          <View style={styles.grid2}>
            <ActionButton label="Watch · 0:48" variant="outline" size="sm" icon={<PlayIcon color={colors.ink} />} onPress={() => {}} style={styles.flex} />
            <ActionButton label="Hear Dad · 0:24" variant="outline" size="sm" icon={<VoiceIcon size={18} color={colors.ink} />} onPress={() => {}} style={styles.flex} />
          </View>
          <ActionButton label="Answer with your voice" icon={<MicIcon color={colors.card} />} onPress={() => {}} />
          <PhotoBlock height={140} radius={32}>
            <View style={styles.heroRow}>
              <ActionButton label="Hear Dad · 0:24" variant="glass" size="sm" labelSize={16} icon={<PlayIcon size={18} color={colors.card} />} onPress={() => {}} style={styles.flex} />
              <IconButton tone="cream" size={52} accessibilityLabel="Open" icon={<ArrowRightIcon color={colors.ink} />} style={{ boxShadow: undefined }} />
            </View>
          </PhotoBlock>
        </Section>

        <Section title="Pills">
          <View style={styles.wrapGap}>
            <Pill label="2 of 6" />
            <Pill tone="butter" size="sm" label="Waiting for your answer" />
            <Pill tone="butter" size="xs" label="Waiting" />
            <Pill tone="sun" size="xs" label="New" />
            <Pill
              tone="peach"
              size="lg"
              label="New voice note · 0:38"
              leading={
                <View style={styles.playDisc}>
                  <PlayIcon size={11} color={colors.peachInk} />
                </View>
              }
            />
            <Pill tone="cream" size="xl" color={colors.muted} leading={<Avatar name="Dad" size={32} />} label="About Sunday Chili" onPress={() => {}} />
          </View>
          <PhotoBlock height={80} radius={24}>
            <Pill tone="glass" size="xl" leading={<Avatar name="Dad" size={32} />} label="Just in from Dad" />
          </PhotoBlock>
        </Section>

        <Section title="Chips">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={[styles.chipRow, styles.bleedPad]}>
            {['Everyone', 'Dad', 'Grandma', 'Auntie Lin', 'Miles'].map((c) => (
              <Chip key={c} label={c} selected={cook === c} onPress={() => setCook(c)} />
            ))}
          </ScrollView>
          <View style={styles.chipRow}>
            {['Leo', 'Maya', 'Everyone'].map((n) => (
              <Chip
                key={n}
                label={n}
                size="lg"
                selectedTone="ink"
                selected={who === n}
                onPress={() => setWho(n)}
                leading={n === 'Everyone' ? undefined : <Avatar name={n} size={40} />}
              />
            ))}
          </View>
        </Section>

        <Section title="Icon buttons">
          <View style={styles.wrapGap}>
            <IconButton accessibilityLabel="Back" icon={(c) => <BackIcon color={c} />} />
            <IconButton accessibilityLabel="Close" icon={(c) => <CloseIcon size={20} color={c} />} />
            <IconButton accessibilityLabel="Play" tone="ink" size={44} icon={(c) => <PlayIcon color={c} />} />
            <IconButton accessibilityLabel="Play" tone="well" size={44} icon={(c) => <PlayIcon color={c} />} />
            <IconButton accessibilityLabel="Add a hello" tone="peach" size={52} icon={(c) => <MicIcon color={c} />} />
            <IconButton accessibilityLabel="Search by voice" tone="field" size={52} icon={(c) => <MicIcon size={22} color={c} />} />
            <IconButton
              accessibilityLabel="Save"
              tone="clear"
              size={44}
              onPress={() => setSaved((s) => !s)}
              icon={<HeartIcon filled={saved} color={saved ? colors.danger : colors.muted} />}
            />
            <IconButton accessibilityLabel="Talk" tone="ink" size={56} icon={(c) => <MicIcon color={c} />} />
          </View>
          <PhotoBlock height={80} radius={24}>
            <View style={styles.heroRow}>
              <IconButton tone="glass" accessibilityLabel="Back" icon={(c) => <BackIcon color={c} />} />
              <View style={styles.flex} />
              <IconButton tone="glassDark" size={40} accessibilityLabel="Save" icon={(c) => <HeartIcon size={20} color={c} />} />
              <IconButton tone="glass" accessibilityLabel="Saved" icon={<HeartIcon filled color={colors.danger} />} />
            </View>
          </PhotoBlock>
          <BackPill />
        </Section>

        <Section title="Avatars">
          <View style={styles.wrapGap}>
            <Avatar name="Mom" size={68} dot />
            <Avatar name="Dad" size={68} />
            <Avatar name="Grandma" size={68} />
            <Avatar name="Leo" size={68} badge="New" />
            <Avatar name="Maya" size={68} />
            <Avatar name="Leo" size={48} ring />
            <Avatar name="Leo" size={48} check />
            <Avatar name="Mom" size={52} dot />
            <Avatar name="Maya" size={52} />
            <Avatar name="Dad" size={28} />
            <Avatar name="Auntie Lin" size={40} />
          </View>
        </Section>

        <Section title="Cards">
          <Card elevation="raised" padding={24} gap={16}>
            <View style={styles.row12}>
              <Avatar name="Leo" size={48} />
              <View>
                <Txt variant="title">Leo asked you</Txt>
                <Txt variant="body" size={15}>About your Sunday Chili</Txt>
              </View>
            </View>
            <Txt variant="quoteLg">“How spicy should it be?”</Txt>
            <ActionButton label="Answer with your voice" flat icon={<MicIcon color={colors.card} />} onPress={() => {}} />
          </Card>
          <ListCard>
            {[
              { n: 'Dad', t: 'Dad answered you', m: 'Sunday Chili · 0:38', ink: true },
              { n: 'Grandma', t: 'Why she never cuts a noodle', m: 'Noodle Soup · 1:12' },
              { n: 'Dad', t: 'One more shake', m: 'Sunday Chili · 0:18' },
            ].map((r, i, a) => (
              <ListRow key={i} last={i === a.length - 1}>
                <Avatar name={r.n} size={48} />
                <View style={styles.flex}>
                  <Txt variant="rowTitle">{r.t}</Txt>
                  <Txt variant="meta">{r.m}</Txt>
                </View>
                <IconButton tone={r.ink ? 'ink' : 'well'} size={44} accessibilityLabel="Play" icon={(c) => <PlayIcon color={c} />} />
              </ListRow>
            ))}
          </ListCard>
          <Card tone="butter" padding={12} style={styles.row14}>
            <View style={[styles.thumb, { backgroundColor: colors.peach }]} />
            <View style={styles.flex}>
              <Txt variant="rowTitle">A butter tinted card</Txt>
              <Txt variant="meta" color={colors.butterInk}>Hidden when there is no real data</Txt>
            </View>
            <ChevronRightIcon size={20} />
          </Card>
        </Section>

        <Section title="Segmented choice">
          <SegmentedChoice
            accessibilityLabel="Cook or learner"
            value={seg}
            onChange={setSeg}
            options={[
              { key: 'cook', title: 'Cooks', subtitle: 'Teaches the food' },
              { key: 'learner', title: 'Learns', subtitle: 'Misses the food' },
            ]}
          />
        </Section>

        <Section title="Dropdown">
          <Dropdown title="More from Dad">
            <View style={{ gap: 18 }}>
              <View style={styles.row12top}>
                <Avatar name="Dad" size={36} />
                <View style={styles.bubbleQuote}>
                  <Txt variant="quote">“Low and slow. Don&apos;t rush the beans.”</Txt>
                </View>
              </View>
              <View style={{ gap: 4 }}>
                <Txt variant="eyebrow">In this step</Txt>
                <View style={[styles.ingRow, styles.hair]}>
                  <Txt variant="rowTitle" weight={600}>“a big spoon of chili powder”</Txt>
                  <Txt variant="meta">~2 tbsp</Txt>
                </View>
                <View style={styles.ingRow}>
                  <Txt variant="rowTitle" weight={600}>“a can of beans”</Txt>
                  <Txt variant="meta">~15 oz</Txt>
                </View>
              </View>
              <View style={styles.lookFor}>
                <EyeIcon size={20} color={colors.olive} />
                <Txt variant="label" color={colors.olive} leading={1.35} style={styles.flex}>
                  Look for a thick stew that coats the spoon.
                </Txt>
              </View>
            </View>
          </Dropdown>
          <Dropdown variant="link" title="Swaps and shopping tips">
            <Txt variant="body">Low-confidence amounts would be listed here, with an “Ask Dad” link.</Txt>
          </Dropdown>
        </Section>

        <Section title="Voice note">
          <View style={styles.voiceBubble}>
            <IconButton tone="ink" size={44} accessibilityLabel="Play" icon={(c) => <PlayIcon color={c} />} />
            <Waveform />
            <Txt variant="label" size={14} weight={700} color={colors.peachInk}>0:38</Txt>
          </View>
          <View style={styles.voiceBubble}>
            <IconButton tone="ink" size={44} accessibilityLabel="Pause" icon={(c) => <PauseIcon color={c} />} />
            <Waveform seed="msg-42" progress={0.4} />
            <Txt variant="label" size={14} weight={700} color={colors.peachInk}>0:15</Txt>
          </View>
        </Section>

        <Section title="Loading & empty">
          <ListCard>
            <SkeletonRow />
            <SkeletonRow round />
          </ListCard>
          <Skeleton height={200} radius={24} />
          <Card>
            <EmptyState
              compact
              title="No recipes yet"
              body="Record one dish you love, and Leo can cook it tonight."
              actionLabel="Record a new recipe"
              onAction={() => {}}
            />
          </Card>
        </Section>

        <Section title="Motion">
          <ActionButton label="Open a bottom sheet" variant="ink" onPress={() => { setSent(null); setSheet(true); }} />
          <ActionButton label="Show a toast" variant="outline" onPress={() => toast.show('Link copied')} />
          <ActionButton label="Replay success burst" variant="outline" onPress={() => setBurstKey((k) => k + 1)} />
          <Card style={{ alignItems: 'center', paddingVertical: 32 }}>
            <SuccessBurst key={burstKey} title="Sent to Leo" subtitle="He'll hear your hello first." />
          </Card>
          <ActionButton label="Replay launch splash" variant="outline" onPress={() => setSplash(true)} />
          <PressableScale scaleTo={0.97} style={styles.pressDemo} accessibilityLabel="Press me">
            <Txt variant="rowTitle">Press and hold this card (scale 0.97)</Txt>
          </PressableScale>
        </Section>

        <Section title="Tab bars">
          <TabBarDemo kind="kid" />
          <TabBarDemo kind="parent" />
        </Section>
      </ScrollView>

      <BottomSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        success={sent}
        footer={
          <ActionButton
            label="Send to Leo"
            size="xl"
            icon={<SendIcon color={colors.card} />}
            onPress={() =>
              new Promise<void>((r) => setTimeout(r, 700)).then(() => setSent({ title: 'Sent to Leo', subtitle: 'He can cook it tonight.' }))
            }
          />
        }>
        <View style={styles.sheetHead}>
          <View style={styles.sheetThumb}>
            <PotMark size={64} />
          </View>
          <Txt variant="display" size={24} align="center">Sunday Chili</Txt>
          <Txt variant="meta" align="center">by Dad · 50 min</Txt>
        </View>
        <ActionButton label="Copy link" variant="outline" size="sm" icon={<LinkIcon size={18} color={colors.ink} />} onPress={() => toast.show('Link copied')} />
      </BottomSheet>

      {splash ? <LaunchSplash onDone={() => setSplash(false)} /> : null}
    </View>
  );
}

const HOMIE_STATES: HomieState[] = ['off', 'lit', 'listening', 'thinking', 'speaking', 'timer'];
// TODO(caleb): native check of the Marathi sample.
const QUESTION = 'कांदे झाले हे कसं ओळखायचं?';

/** One pot with its state under it: listening at a mid mic level, a timer 60% left. The cell leaves room for the halo. */
function PotCell({ state, size, timer = state === 'timer', label = state }: { state: HomieState; size: number; timer?: boolean; label?: string }) {
  return (
    <View style={[styles.homieCell, { width: Math.round(size * 1.6) }]}>
      <View style={{ margin: Math.round(size * 0.3) }}>
        <HomiePot state={state} level={0.5} size={size} timerProgress={timer ? 0.6 : null} />
      </View>
      <Txt variant="caption">{label}</Txt>
    </View>
  );
}

/** Every pot state at the header's 48, cook mode's bar 60 and the centred moment's 176, plus the moments:
 *  Grandma's live question (Marathi) and the corner pot's states. */
function HomieStates() {
  const [corner, setCorner] = useState<HomieState>('off');
  const ask = () => void speak(QUESTION, { lang: 'mr' });
  const sample = () => {
    showMoment({
      id: 'gallery',
      question: QUESTION,
      questionEn: 'How do you know the onions are done?',
      listening: { label: 'बोला, मी ऐकतोय', sublabel: 'Just say it, I’m listening' },
      options: [
        { id: 'again', label: 'पुन्हा सांग', sublabel: 'Say it again', keepOpen: true },
        { id: 'not_now', label: 'आत्ता नको', sublabel: 'Not now' },
      ],
      onChoose: (id) => {
        if (id === 'again') ask();
      },
    });
    ask();
  };
  const nextCorner = () => {
    const next = HOMIE_STATES[(HOMIE_STATES.indexOf(corner) + 1) % HOMIE_STATES.length];
    setCorner(next);
    setHomie({ state: next, level: next === 'listening' ? 0.7 : 0, timer: next === 'timer' ? { endsAt: Date.now() + 60_000, totalS: 60 } : undefined });
  };
  return (
    <>
      {[48, 60].map((size) => (
        <View key={size} style={styles.homieRow}>
          {HOMIE_STATES.map((st) => (
            <PotCell key={st} state={st} size={size} />
          ))}
          <PotCell state="listening" size={size} timer label="listening + timer" />
        </View>
      ))}
      <View style={styles.homieRow}>
        {HOMIE_STATES.map((st) => (
          <PotCell key={st} state={st} size={176} />
        ))}
      </View>
      <ActionButton label="Open a sample moment" variant="ink" onPress={sample} />
      <ActionButton label={`Corner pot: ${corner} (tap for next)`} variant="outline" onPress={nextCorner} />
      <ActionButton label="homie says hi" variant="outline" onPress={() => void speak('Hi, I’m homie.')} />
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Txt variant="section">{title}</Txt>
      {children}
    </View>
  );
}

/** A stand-in for a photo: the hero's olive base with the bible's bottom shade. */
function PhotoBlock({ height, radius, children }: { height: number; radius: number; children?: ReactNode }) {
  return (
    <View style={[styles.photo, { height, borderRadius: radius }]}>
      <LinearGradient colors={[colors.olive, '#7A5A3A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[alpha.photoShadeTop, alpha.photoShade]} style={StyleSheet.absoluteFill} />
      <View style={styles.photoInner}>{children}</View>
    </View>
  );
}

function TabBarDemo({ kind }: { kind: 'kid' | 'parent' }) {
  const tabs =
    kind === 'kid'
      ? [
          { name: 'home', title: 'Home', Icon: HomeIcon },
          { name: 'recipes', title: 'Recipes', Icon: GridIcon },
          { name: 'ask', title: 'Ask', Icon: ChatIcon, badge: 2 },
        ]
      : [
          { name: 'home', title: 'Home', Icon: HomeIcon },
          { name: 'record', title: 'Record', Icon: MicIcon },
          { name: 'messages', title: 'Messages', Icon: ChatIcon, badge: 1 },
          { name: 'recipes', title: 'Recipes', Icon: BookIcon },
        ];
  const [index, setIndex] = useState(0);
  const routes = tabs.map((t) => ({ key: `${kind}-${t.name}`, name: t.name }));
  const descriptors = Object.fromEntries(
    tabs.map((t) => [
      `${kind}-${t.name}`,
      {
        options: {
          title: t.title,
          tabBarBadge: 'badge' in t ? t.badge : undefined,
          tabBarIcon: ({ color }: { color: string }) => <t.Icon color={color} />,
        },
      },
    ]),
  );
  const navigation = {
    emit: () => ({ defaultPrevented: false }),
    navigate: (name: string) => setIndex(tabs.findIndex((t) => t.name === name)),
  };
  const props = { state: { routes, index }, descriptors, navigation, insets: { top: 0, bottom: 0, left: 0, right: 0 } } as unknown as FloatingTabBarProps;
  return (
    <View style={styles.tabDemo}>
      <FloatingTabBar {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  top: { paddingHorizontal: 24, gap: 14 },
  section: { paddingHorizontal: 24, paddingTop: 36, gap: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wrapGap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
  swatchItem: { width: 72, gap: 4 },
  swatch: { height: 40, borderRadius: 12, boxShadow: '0 0 0 1px rgba(30,36,16,0.08)' },
  iconCell: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', boxShadow: shadows.chip },
  grid2: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photo: { overflow: 'hidden' },
  photoInner: { flex: 1, justifyContent: 'flex-end', padding: 16 },
  playDisc: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  chipRow: { flexDirection: 'row', gap: 8 },
  bleed: { marginHorizontal: -24 },
  bleedPad: { paddingHorizontal: 24 },
  row12: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row12top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  row14: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  thumb: { width: 64, height: 64, borderRadius: 16 },
  bubbleQuote: { flex: 1, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: colors.peach, borderTopLeftRadius: 4, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 18 },
  ingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 10, gap: 12 },
  hair: { borderBottomWidth: 1, borderBottomColor: colors.well },
  lookFor: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.sage },
  voiceBubble: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 16,
    backgroundColor: colors.peach,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    borderBottomLeftRadius: 6,
  },
  pressDemo: { height: 72, borderRadius: 24, backgroundColor: colors.card, boxShadow: shadows.card, alignItems: 'center', justifyContent: 'center' },
  tabDemo: { height: 124, marginHorizontal: -24 },
  sheetHead: { alignItems: 'center', gap: 6, paddingTop: 8 },
  homieRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  homieCell: { alignItems: 'center' },
  sheetThumb: { width: 120, height: 120, borderRadius: 20, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
});

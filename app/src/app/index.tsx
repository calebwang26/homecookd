// "Who's in the kitchen?" (bible Main). Netflix-style profile picker for the family: the cooks, then
// the ones who miss it, each tile with a real line under the face (see components/profiles/status).
// Tap a face -> a green ring draws, the others step back, and the screen hands off to that person's
// home. Faces this phone can't come in as open a small sheet instead (components/profiles/PersonSheet):
//   on their own phone ("On their phone", FEEDBACK-OCT16c E1): only that phone can be them, so the
//       sheet says "Dad uses their own phone." with up to 3 of "Dad's recipes" and Message Dad (both
//       as whoever is in, else this phone's own person, and both open over that person's home);
//   invited the old way, not joined yet ("Hasn't joined yet"): "Dad hasn't joined yet." with Send again.
// Each section ends with a + tile, for everyone (E4), the gateway (`/?pick=1`) included:
//   a phone that has its person (or a shared family-code phone): either + ("Add") opens the
//       invite share sheet (components/profiles/AddFamilySheet); whoever joins picks their own
//       section;
//   a phone that came in through a family invite and hasn't said who it is (deviceNeedsProfile,
//       E3): the line under the title reads "Tap your face, or + if you're new.", each + reads "Add me" and
//       asks "What does your family call you?" (components/profiles/SelfSheet): a cook under the
//       cooks, a learner under the ones who miss it; then in as them, to their home. Tapping a face
//       asks the family instead (NewPhoneSheet, below).
//
// Your own profile by default: a phone with a default person (session `defaultPerson`: its owner,
// else whoever was picked here last) never stops here; it goes straight to their home. The screen
// shows before anyone is picked, for a phone that hasn't said who it is yet, and at `/?pick=1`
// (tapping your own face on Home) with "Back to <you>": pick someone without a phone of their own
// to cook as them, or add family with + (an invite link, or someone without a phone, like Grandma).
// A phone that just joined with a family link can't take over a face: tapping one asks "Is this you
// on a new phone?" (NewPhoneSheet), and the family lets them in.
// Opened from Home ("Mom ▾", `/?pick=1`), a quiet foot holds a cook's "Invite family :)" (moved off
// Parent Home on Oct 24, as kid Home's went to the Ask tab) and the phone's own settings: a cook's
// "Your language" (components/profiles/LanguageEntry), "Switch family" (the code screen,
// /join-code) and "Sign out of this phone", which asks first ("Sign out on this phone?" with Sign
// out / Keep) and then signs this phone out (session leaveFamily).
//
// Launch (motion spec 1): while the bloom covers the screen this page waits hidden; when the
// overlay clears it fades in from scale 1.03 -> 1 and the tiles rise in one after another.
// The Sunday table (RETENTION-HANDOFF 3.2): a small flame on the faces that did their part this week
// (GET /table answers faces-only with nobody picked); nothing on the others. Not asked for when this
// phone goes straight to its person's home.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { InviteButton } from '@/components/invite/InviteButton';
import { getLaunchPhase, useLaunchPhase } from '@/components/LaunchSplash';
import {
  ADD_BAR_HEIGHT,
  AddFamilySheet,
  AddFamilyTile,
  LanguageEntry,
  NewPhoneSheet,
  PersonSheet,
  ProfileTile,
  SelfSheet,
  TILE_HEIGHT,
  TileSkeleton,
  useFamilyStatus,
  type PersonStatus,
  type TileChoice,
} from '@/components/profiles';
import { ActionButton, BackPill, BottomSheet, Brand, listEnter, PressableScale, ScreenWash, Txt, usePotMood } from '@/components/ui';
import type { Profile, Role } from '@/lib/api';
import { moveApi } from '@/lib/moveRequests';
import { useSession } from '@/lib/session';
import { litIds } from '@/lib/sundayTable';
import { useTable } from '@/lib/tableApi';
import { colors, motion, space } from '@/theme/tokens';

const GAP = 12;
const COLS = 3;

export default function Profiles() {
  const insets = useSafeAreaInsets();
  // The pot by the brand: sleepy late at night, waving on Sunday (retention PR 7).
  const potMood = usePotMood();
  const reduce = useReducedMotion();
  const { width: winW } = useWindowDimensions();
  const { status, family, cooks, learners, profiles, me, setMe, homeFor, refresh, deviceNeedsProfile, defaultPerson, leaveFamily } =
    useSession();
  const statuses = useFamilyStatus(profiles, family?.id ?? null);
  // Tapped their own face on Home: the family gateway, with Back to them.
  const choosing = useLocalSearchParams<{ pick?: string }>().pick === '1';
  // Otherwise a phone with a default person goes straight to them (no tap, nothing to mis-tap).
  const autoEnter = !!defaultPerson && !choosing && !deviceNeedsProfile && (status === 'ready' || status === 'offline');
  // Who's at the table this week (flames on their faces); not asked for on the way straight home.
  const { table } = useTable({ enabled: !autoEnter && status === 'ready' });
  const lit = useMemo(() => litIds(table), [table]);
  const entered = useRef(false);
  useEffect(() => {
    if (!autoEnter || !defaultPerson || entered.current) return;
    entered.current = true;
    setMe(defaultPerson);
    router.replace(homeFor(defaultPerson));
  }, [autoEnter, defaultPerson, setMe, homeFor]);
  const backTo = choosing ? (me ?? defaultPerson) : null;
  const goBack = () => {
    if (!backTo) return;
    setMe(backTo);
    router.replace(homeFor(backTo));
  };

  // Every time this screen opens, fetch the family again, so someone who just joined on their own
  // phone is here to pick (not only after a restart).
  const familyReady = status === 'ready';
  useFocusEffect(
    useCallback(() => {
      if (familyReady) void refresh();
    }, [familyReady, refresh]),
  );

  // Back here before this phone has said who it is: ask again, since tapping a face and writing as
  // them makes the phone theirs (then the hint goes).
  const askedAgain = useRef(false);
  useEffect(() => {
    if (askedAgain.current || !deviceNeedsProfile || status !== 'ready') return;
    askedAgain.current = true;
    void refresh();
  }, [deviceNeedsProfile, status, refresh]);

  // --- Launch hand-off ---------------------------------------------------------------------
  const phase = useLaunchPhase();
  const covered = phase === 'playing';
  const reveal = useSharedValue(getLaunchPhase() === 'playing' ? 0 : 1);
  useLayoutEffect(() => {
    if (phase === 'playing') reveal.set(0);
    else if (reveal.get() < 1) reveal.set(withTiming(1, { duration: reduce ? 150 : 300, easing: Easing.out(Easing.cubic) }));
  }, [phase, reveal, reduce]);
  const revealStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: reduce ? [] : [{ scale: 1.03 - 0.03 * reveal.value }],
  }));

  // --- Grid geometry: three columns, gap 12, inside the 24 px gutters ------------------------
  const [gridW, setGridW] = useState(Math.min(winW, 600) - space.gutter * 2);
  const tileW = Math.floor((gridW - GAP * (COLS - 1)) / COLS);

  // --- Choosing a face ----------------------------------------------------------------------
  const [chosen, setChosen] = useState<string | null>(null);
  const leaving = useRef(false);
  /** `wait`: let a closing sheet slide away first. */
  const enter = (p: Profile, wait = 0) => {
    if (leaving.current) return;
    leaving.current = true;
    setChosen(p.id);
    setMe(p);
    setTimeout(() => router.replace(homeFor(p)), wait + (reduce ? 60 : 260));
  };
  const choiceOf = (p: Profile): TileChoice => (!chosen ? 'idle' : chosen === p.id ? 'chosen' : 'other');

  // --- Sheets: invite family (+), "What does your family call you?" (+ before this phone has its
  // person), and the small sheet for a face this phone can't come in as. Each keeps its content
  // while it slides away. -------------------------------------------------------------------
  const [inviting, setInviting] = useState(false);
  const [self, setSelf] = useState<{ open: boolean; role: Role }>({ open: false, role: 'cook' });
  const [person, setPerson] = useState<{ open: boolean; who: Profile | null }>({ open: false, who: null });
  const [moving, setMoving] = useState<{ open: boolean; who: Profile | null; resume: boolean }>({ open: false, who: null, resume: false });
  const [signingOut, setSigningOut] = useState(false);
  // A phone that just joined (no person yet) never takes over a face: it asks the family.
  const pick = (p: Profile) =>
    deviceNeedsProfile && !p.invited
      ? setMoving({ open: true, who: p, resume: false })
      : p.locked || p.invited
        ? setPerson({ open: true, who: p })
        : enter(p);
  // Back here while an earlier "let me in" request still waits: show it again.
  const checkedMove = useRef(false);
  useEffect(() => {
    if (checkedMove.current || !deviceNeedsProfile || status !== 'ready' || profiles.length === 0) return;
    checkedMove.current = true;
    moveApi
      .mine()
      .then((r) => {
        const who = r && r.status === 'pending' ? profiles.find((p) => p.id === r.profile_id) : undefined;
        if (who) setMoving({ open: true, who, resume: true });
      })
      .catch(() => {});
  }, [deviceNeedsProfile, status, profiles]);
  const addTile = (role: Role): AddTile =>
    deviceNeedsProfile
      ? {
          label: 'Add me',
          a11y: {
            label: role === 'cook' ? 'Add yourself to the cooks' : 'Add yourself to the ones who miss it',
            hint: 'Asks what your family calls you',
          },
          onPress: () => setSelf({ open: true, role }),
        }
      : { label: 'Add', a11y: { label: role === 'cook' ? 'Add a cook' : 'Add family' }, onPress: () => setInviting(true) };

  const loading = status === 'loading' && profiles.length === 0;
  const offline = status === 'offline' && profiles.length === 0;

  // Handing straight to the owner: just the wash, so the picker never flashes up.
  if (autoEnter) {
    return (
      <View style={styles.root}>
        <ScreenWash tone="parent" height={420} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[styles.content, { paddingTop: Math.max(64, insets.top + 16), paddingBottom: Math.max(40, insets.bottom + 24) }]}
        showsVerticalScrollIndicator={false}>
        <ScreenWash tone="parent" height={420} />
        <Animated.View style={[styles.page, revealStyle]}>
          {/* Bible: the 34x32 pot box sets the row height (32). */}
          {backTo ? (
            <View style={styles.brandRow}>
              <Brand mood={potMood} />
              <BackPill label={`Back to ${backTo.name}`} onPress={goBack} />
            </View>
          ) : (
            <Brand mood={potMood} style={styles.brand} />
          )}

          <View style={styles.headline}>
            {/* TODO: Fraunces opsz-40 static instance; until then tighter tracking matches the bible's line width (218.6 px). */}
            <Txt variant="display" size={40} leading={1.08} accessibilityRole="header" style={styles.title}>
              Who’s in the kitchen?
            </Txt>
            <Txt variant="lead">{deviceNeedsProfile ? 'Tap your face, or + if you’re new.' : 'Tap your face to come in.'}</Txt>
          </View>

          {offline ? (
            <View style={styles.offline}>
              <Txt variant="title">We can’t reach your kitchen</Txt>
              <Txt variant="meta">Check your connection and try again.</Txt>
              <ActionButton
                label="Try again"
                variant="outline"
                size="sm"
                onPress={async () => {
                  // Reject while the kitchen is still out of reach: the button says so, then
                  // comes back for another try (never a checkmark on a failed retry).
                  if (!(await refresh())) throw new Error('offline');
                }}
                errorLabel="Still offline"
                style={styles.retry}
              />
            </View>
          ) : null}

          <View onLayout={(e) => setGridW(Math.round(e.nativeEvent.layout.width))} style={styles.groups}>
            {loading ? (
              <>
                <SkeletonGroup title="The cooks" count={3} tileW={tileW} />
                <SkeletonGroup title="The ones who miss it" count={2} tileW={tileW} />
              </>
            ) : !offline ? (
              <>
                <Group
                  title="The cooks"
                  people={cooks}
                  statuses={statuses}
                  lit={lit}
                  tileW={tileW}
                  covered={covered}
                  startIndex={0}
                  choiceOf={choiceOf}
                  onPick={pick}
                  add={addTile('cook')}
                  dimAdd={!!chosen}
                />
                <Group
                  title="The ones who miss it"
                  people={learners}
                  statuses={statuses}
                  lit={lit}
                  tileW={tileW}
                  covered={covered}
                  startIndex={cooks.length + 1}
                  choiceOf={choiceOf}
                  onPick={pick}
                  add={addTile('learner')}
                  dimAdd={!!chosen}
                />
              </>
            ) : null}
          </View>


          {choosing && !loading && !covered ? (
            <Animated.View entering={listEnter(profiles.length + 2)} style={styles.foot}>
              {me?.role === 'cook' ? <InviteButton style={styles.invite} /> : null}
              <LanguageEntry />
              <PressableScale
                onPress={() => router.push('/join-code')}
                accessibilityRole="button"
                accessibilityLabel="Switch family"
                accessibilityHint="Type another family’s code"
                style={styles.footLink}>
                <Txt variant="label" weight={600} color={colors.muted}>
                  Switch family
                </Txt>
              </PressableScale>
              <PressableScale
                onPress={() => setSigningOut(true)}
                accessibilityRole="button"
                accessibilityLabel="Sign out of this phone"
                accessibilityHint="Asks first"
                style={styles.footLink}>
                <Txt variant="label" weight={600} color={colors.muted}>
                  Sign out of this phone
                </Txt>
              </PressableScale>
            </Animated.View>
          ) : null}
        </Animated.View>
      </ScrollView>

      <AddFamilySheet
        visible={inviting}
        onClose={() => setInviting(false)}
        onSwitch={(them) => enter(them, motion.sheetCloseMs + 40)}
      />
      <SelfSheet
        visible={self.open}
        role={self.role}
        onClose={() => setSelf((s) => ({ ...s, open: false }))}
        onDone={(me) => {
          setSelf((s) => ({ ...s, open: false }));
          enter(me, motion.sheetCloseMs + 40);
        }}
      />
      <PersonSheet visible={person.open} person={person.who} onClose={() => setPerson((s) => ({ ...s, open: false }))} />
      <NewPhoneSheet
        visible={moving.open}
        person={moving.who}
        resume={moving.resume}
        onClose={() => setMoving((s) => ({ ...s, open: false }))}
        // Let in: the family reloads with this phone as theirs, and the default person takes them home.
        onIn={() => setMoving((s) => ({ ...s, open: false }))}
      />
      <BottomSheet
        visible={signingOut}
        onClose={() => setSigningOut(false)}
        accessibilityLabel="Sign out on this phone?"
        footer={
          <View style={styles.choices}>
            <ActionButton
              label="Sign out"
              variant="outline"
              size="lg"
              fg={colors.danger}
              borderColor={colors.danger}
              labelWeight={700}
              haptics
              // The sheet goes first: signing out sends the app to /join, never under a closing Modal.
              onPress={() => {
                setSigningOut(false);
                setTimeout(() => void leaveFamily(), motion.sheetCloseMs + 40);
              }}
              accessibilityHint="Signs this phone out of the family"
              style={styles.choice}
            />
            <ActionButton label="Keep" size="lg" onPress={() => setSigningOut(false)} accessibilityLabel="Stay signed in" style={styles.choice} />
          </View>
        }>
        <View style={styles.signOut}>
          <Txt variant="display" size={28} leading={1.15} align="center" accessibilityRole="header">
            Sign out on this phone?
          </Txt>
          <Txt variant="body" size={16} align="center">
            You may need a new invite to come back.
          </Txt>
        </View>
      </BottomSheet>
    </View>
  );
}

/** `label`: the word under the + ("Add", or "Add me"); `a11y.label` is what VoiceOver reads. */
type AddTile = { label?: string; a11y?: { label?: string; hint?: string }; onPress: () => void };

function Group({
  title,
  people,
  statuses,
  lit,
  tileW,
  covered,
  startIndex,
  choiceOf,
  onPick,
  add,
  dimAdd,
}: {
  title: string;
  people: Profile[];
  statuses: Record<string, PersonStatus | undefined>;
  /** At the Sunday table this week (a flame on the face). */
  lit: ReadonlySet<string>;
  tileW: number;
  covered: boolean;
  startIndex: number;
  choiceOf: (p: Profile) => TileChoice;
  onPick: (p: Profile) => void;
  /** The + tile at the end of the section. */
  add: AddTile;
  dimAdd: boolean;
}) {
  // A full last row of faces: + becomes a short bar under them, not a lone tall tile.
  const compact = people.length > 0 && people.length % COLS === 0;
  return (
    <View style={styles.group} accessibilityLabel={title}>
      <Txt variant="heading" accessibilityRole="header">
        {title}
      </Txt>
      <View style={styles.grid}>
        {/* Tiles mount when the launch overlay starts to clear, so their entrance is seen. */}
        {covered
          ? null
          : people.map((p, i) => (
              <Animated.View key={p.id} entering={listEnter(startIndex + i)}>
                <ProfileTile profile={p} status={statuses[p.id]} width={tileW} choice={choiceOf(p)} lit={lit.has(p.id)} onPress={() => onPick(p)} />
              </Animated.View>
            ))}
        {covered ? null : (
          <Animated.View entering={listEnter(startIndex + people.length)}>
            <AddFamilyTile
              width={compact ? tileW * COLS + GAP * (COLS - 1) : tileW}
              compact={compact}
              label={add.label}
              a11y={add.a11y}
              onPress={add.onPress}
              dimmed={dimAdd}
            />
          </Animated.View>
        )}
        {/* Hold the grid's height meanwhile, so nothing moves when the tiles arrive. */}
        {covered ? <View style={{ height: gridHeight(people.length, compact) }} /> : null}
      </View>
    </View>
  );
}

/** Faces plus the + (a tile in the last row, or a bar of its own under a full row). */
function gridHeight(faces: number, compact: boolean) {
  if (compact) return Math.ceil(faces / COLS) * (TILE_HEIGHT + GAP) + ADD_BAR_HEIGHT;
  const rows = Math.ceil((faces + 1) / COLS);
  return rows * TILE_HEIGHT + (rows - 1) * GAP;
}

function SkeletonGroup({ title, count, tileW }: { title: string; count: number; tileW: number }) {
  return (
    <View style={styles.group}>
      <Txt variant="heading">{title}</Txt>
      <View style={styles.grid}>
        {Array.from({ length: count }, (_, i) => (
          <TileSkeleton key={i} width={tileW} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.gutter },
  page: { flex: 1, gap: 32 },
  brand: { height: 32 },
  brandRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // The phone's own settings, quiet at the very end (only when opened from Home).
  foot: { marginTop: 16, alignItems: 'center', gap: 4 },
  invite: { alignSelf: 'stretch', marginBottom: 12 },
  footLink: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  signOut: { alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 4, paddingHorizontal: 8 },
  choices: { flexDirection: 'row', gap: 12 },
  choice: { flex: 1 },
  headline: { gap: 10 },
  // Static Fraunces 500 is cut at a small optical size, ~7% wider than the bible's opsz 40.
  title: { letterSpacing: -1.44 },
  groups: { gap: 32 },
  group: { gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  offline: {
    gap: 6,
    padding: 20,
    borderRadius: 24,
    backgroundColor: colors.card,
    boxShadow: '0 8px 24px rgba(30,36,16,0.06)',
  },
  retry: { alignSelf: 'flex-start', marginTop: 8 },
});

// Month in the kitchen, the Home card (both Homes; RETENTION-HANDOFF 3.7): "Your November in the
// kitchen" from the 1st to the 7th, when last month had something in it and this person hasn't opened
// it yet on this phone. One per month. An empty month is simply quiet: no card, no placeholder.
//
//   const recap = useRecapCard(me?.id);                  // the kid Home's slot, in Invite's place
//   const recap = useRecapCard(me?.id, { last: true });  // the cook Home: the last thing on screen
//   <RecapCard card={recap} onOpen={(month) => router.push({ pathname: '/recap', params: { month } })} />
//
// The card never moves what's already on screen:
// - The kid Home's slot: its space is kept (`held`: the same card, unseen and untouchable) while the
//   first answer for this person and month is on its way, so the card fades into a space that's
//   already there. An empty month, an opened one or a failed call lets the space go, and Invite takes
//   the slot at the same height.
// - `last` (the cook Home, where the card comes after everything else): nothing is held, since a card
//   arriving under the last thing on screen moves nothing. It fades in as soon as its answer is in,
//   and an empty month or a failed call simply never draws anything.
// - The answer is remembered per person per month (lib/recapApi: memory, then this phone's storage),
//   so a Home drawn again that week has the card, or no card, with its first layout.
// - After a failed call (offline, the route not deployed yet) no space is held. Home asks again when
//   it leaves the screen (another tab, another screen), so a card found then is there when Home comes
//   back, and on foreground; a card found while the kid Home is on screen waits until Home is off
//   screen (with `last` it shows at once, and focus asks again too).
// The day is read again on focus and foreground, so a phone that kept the app open overnight into
// the 1st still gets the card. Opening the recap (RecapScreen marks it) hides the card at once, even
// with the recap on top of this Home. `now` & `load` are for tests.
//
// Sizes: the cook Home's full card (bars, the title, a real line from the month, an arrow; the line
// always has two lines of room, so the card is one height whatever the line) and the kid Home's
// `slot` card, which takes the big "Invite family" button's place under the hero at that button's
// height, so the hero and the fold stay exactly as on any other day.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ArrowRightIcon, PressableScale, Txt } from '@/components/ui';
import {
  cardMonth,
  onRecapOpened,
  openedKey,
  recapApi,
  recapCardNow,
  recapCardStored,
  recapTitle,
  rememberRecapCard,
  type RecapCardKnown,
  type RecapResult,
} from '@/lib/recapApi';
import { alpha, colors, motion, radii, shadows, space } from '@/theme/tokens';

/** The card for this person right now: its space held while the answer comes, shown, or null. */
export type RecapCardState = { month: string; held: boolean; teaser: string | null } | null;

/**
 * hold: the first answer is on its way (the space is kept; with `last`, nothing is drawn) · show: on
 * screen · none: no card yet, asked again on blur & foreground (the last call failed) · later: a card
 * found while Home was on screen, shown once Home is off screen · done: no card this month (opened
 * or empty).
 */
type Slot = { key: string; phase: 'hold' | 'show' | 'none' | 'later' | 'done'; teaser: string | null };

/** Keys whose call failed in this run: a Home drawn again doesn't hold a space for them. */
const failedOnce = new Set<string>();

function startSlot(profileId: string | null | undefined, month: string | null): Slot {
  if (!profileId || !month) return { key: '', phase: 'done', teaser: null };
  const key = openedKey(profileId, month);
  const known = recapCardNow(profileId, month);
  if (known === 'opened' || known === 'empty') return { key, phase: 'done', teaser: null };
  if (known) return { key, phase: 'show', teaser: known.teaser };
  return { key, phase: failedOnce.has(key) ? 'none' : 'hold', teaser: null };
}

/** The slot once an answer is in (undefined: the call failed). `last`: shown whenever it's found. */
function settle(s: Slot, known: RecapCardKnown | undefined, offScreen: boolean, last: boolean): Slot {
  if (s.phase === 'done' || s.phase === 'show') return s;
  if (known === 'opened' || known === 'empty') return { ...s, phase: 'done', teaser: null };
  if (!known) return s.phase === 'hold' ? { ...s, phase: 'none' } : s;
  return { ...s, phase: s.phase === 'hold' || offScreen || last ? 'show' : 'later', teaser: known.teaser };
}

/**
 * `last`: the card is the last thing on its screen (the cook Home), so no space is held while its
 * answer is on its way (nothing is drawn until it's known) and a card found later shows at once.
 */
export function useRecapCard(
  profileId: string | null | undefined,
  {
    now,
    load = recapApi.get,
    last = false,
  }: { now?: Date; load?: (month: string) => Promise<RecapResult>; last?: boolean } = {},
): RecapCardState {
  const [month, setMonth] = useState(() => cardMonth(now ?? new Date()));
  const key = profileId && month ? openedKey(profileId, month) : '';
  const [slot, setSlot] = useState<Slot>(() => startSlot(profileId, month));
  // A new person or a new month: what this run knows at once, until its own answer is in.
  const fresh = useMemo(() => startSlot(profileId, month), [profileId, month]);
  const cur = slot.key === key ? slot : fresh;

  // For the async answer (never read while drawing): the latest slot, and whether Home is in focus.
  const live = useRef(cur);
  useEffect(() => {
    live.current = cur;
  });
  const focused = useRef(false);
  // Each ask: `retry` also asks again after a failed call (blur & foreground; focus asks only first,
  // or every time with `last`, where a late card moves nothing).
  const [ask, setAsk] = useState({ n: 0, retry: false });
  const reveal = useCallback(() => setSlot((s) => (s.phase === 'later' ? { ...s, phase: 'show' } : s)), []);

  // Focus: read the day again (a new month asks). Blur: a card that waited shows now, and a failed
  // call is tried again while Home is off screen.
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setMonth(cardMonth(now ?? new Date()));
      setAsk((a) => ({ n: a.n + 1, retry: false }));
      return () => {
        focused.current = false;
        reveal();
        setAsk((a) => ({ n: a.n + 1, retry: true }));
      };
    }, [now, reveal]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return reveal();
      setMonth(cardMonth(now ?? new Date()));
      setAsk((a) => ({ n: a.n + 1, retry: true }));
    });
    return () => sub.remove();
  }, [now, reveal]);

  // Opened (the recap is on top of this Home, so this one listens while out of focus too): gone.
  useEffect(() => {
    if (!key) return;
    return onRecapOpened((opened) => {
      if (opened === key) setSlot({ key, phase: 'done', teaser: null });
    });
  }, [key]);

  useEffect(() => {
    if (ask.n === 0 || !profileId || !month) return; // the first focus asks
    const k = openedKey(profileId, month);
    const at = live.current.key === k ? live.current : startSlot(profileId, month);
    if (at.phase !== 'hold' && !(at.phase === 'none' && (ask.retry || last))) return;
    let alive = true;
    void (async () => {
      let known = await recapCardStored(profileId, month);
      if (known === undefined) {
        try {
          known = await rememberRecapCard(profileId, month, await load(month));
        } catch {
          failedOnce.add(k); // offline or not deployed yet: asked again on the next blur or foreground
        }
      }
      if (!alive) return;
      const offScreen = !focused.current || AppState.currentState !== 'active';
      setSlot((s) => settle(s.key === k ? s : startSlot(profileId, month), known, offScreen, last));
    })();
    return () => {
      alive = false;
    };
  }, [ask, profileId, month, load, last]);

  if (!month || (cur.phase !== 'hold' && cur.phase !== 'show')) return null;
  if (cur.phase === 'hold' && last) return null; // nothing held under the last thing on screen
  return { month, held: cur.phase === 'hold', teaser: cur.teaser };
}

const fadeIn = FadeIn.duration(motion.listEnterMs);
const noop = () => {};

/**
 * The card from useRecapCard: nothing for null; while `held`, its space (the same card, unseen and
 * out of reach of taps and VoiceOver); then the card, fading into that space. `slot`: the kid Home's
 * card in the "Invite family" button's place.
 */
export function RecapCard({
  card,
  onOpen,
  slot,
  style,
}: {
  card: RecapCardState;
  onOpen: (month: string) => void;
  slot?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!card) return null;
  if (card.held)
    return (
      <View style={[style, styles.held]} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <RecapCardView month={card.month} teaser={null} slot={slot} onPress={noop} />
      </View>
    );
  return (
    <Animated.View entering={fadeIn} style={style}>
      <RecapCardView month={card.month} teaser={card.teaser} slot={slot} onPress={() => onOpen(card.month)} />
    </Animated.View>
  );
}

/**
 * The card alone. Full: thin story bars, "Your November in the kitchen", a real line from the month
 * (two lines of room, whatever its length), an arrow. `slot`: the title and the arrow at the "Invite
 * family" button's height; the line still reaches VoiceOver through the label.
 */
export function RecapCardView({ month, teaser, onPress, slot }: { month: string; teaser: string | null; onPress: () => void; slot?: boolean }) {
  const title = recapTitle(month);
  // "the kitchen" stays together, so a narrow card never leaves "kitchen" alone on a line.
  const shown = title.replace(/ the kitchen$/, ' the kitchen');
  const label = teaser ? `${title}. ${teaser}` : title;
  if (slot)
    return (
      <PressableScale
        onPress={onPress}
        haptic
        scaleTo={0.97}
        accessibilityLabel={label}
        accessibilityHint="Opens a few moments from your month"
        style={[styles.card, styles.slot]}>
        <View style={[styles.row, styles.rowSlot]}>
          <Txt variant="display" size={19} leading={1.1} color={colors.card} style={styles.text}>
            {shown}
          </Txt>
          <View style={[styles.go, styles.goSlot]}>
            <ArrowRightIcon size={22} color={colors.ink} />
          </View>
        </View>
      </PressableScale>
    );
  return (
    <PressableScale
      onPress={onPress}
      haptic
      scaleTo={0.97}
      accessibilityLabel={label}
      accessibilityHint="Opens a few moments from your month"
      style={[styles.card, styles.full]}>
      <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={[styles.bar, i === 0 ? styles.barOn : null]} />
        ))}
      </View>
      <View style={styles.row}>
        <View style={styles.text}>
          <Txt variant="display" size={26} leading={1.15} color={colors.card}>
            {shown}
          </Txt>
          <View>
            {/* Two lines of room at any text size, so the card is as tall before its line arrives. */}
            <Txt variant="lead" style={styles.unseen} accessibilityElementsHidden importantForAccessibility="no">
              {' \n '}
            </Txt>
            {teaser ? (
              <Txt variant="lead" color={alpha.glassChip} numberOfLines={2} style={styles.line}>
                {teaser}
              </Txt>
            ) : null}
          </View>
        </View>
        <View style={styles.go}>
          <ArrowRightIcon size={24} color={colors.ink} />
        </View>
      </View>
    </PressableScale>
  );
}

/** The "Invite family" button's height (ActionButton xl), which the kid Home's slot card keeps. */
const SLOT_HEIGHT = 64;

const styles = StyleSheet.create({
  held: { opacity: 0, pointerEvents: 'none' },
  card: { backgroundColor: colors.green, boxShadow: shadows.cardRaised },
  full: { borderRadius: radii.panel, padding: space.xxl, gap: space.lg },
  slot: {
    minHeight: SLOT_HEIGHT,
    borderRadius: radii.pill,
    justifyContent: 'center',
    paddingLeft: space.xxl,
    paddingRight: space.sm,
    paddingVertical: space.sm,
  },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: radii.step, backgroundColor: 'rgba(255,255,255,0.28)' },
  barOn: { backgroundColor: colors.yolk },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  rowSlot: { gap: space.md },
  text: { flex: 1, gap: space.sm },
  unseen: { opacity: 0 },
  line: { position: 'absolute', left: 0, right: 0, top: 0 },
  go: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goSlot: { width: 48, height: 48, borderRadius: 24 },
});

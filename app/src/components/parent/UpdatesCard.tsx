// Parent Home's one compact updates card. On top, while a kid is cooking one of my dishes right now,
// a live row per kid ("Leo is making your Sunday Chili" · "Step 3 of 8" · a heart that sends them a
// heart mid-cook; RETENTION-HANDOFF 3.1, polled every 15 s while Home is focused); it goes when the
// session ends. Then someone on a new phone waiting to be let in (always before the rest:
// "Dad is on a new phone" + Let in, which opens the Home pop-up), then what's for me, newest first,
// then what's for the whole family, newest first:
//  - questions for me (kitchen's questionFor): the 1:1 ones asked of me (the server's open list; the
//    inbox's guess only until it loads), recipe requests from the inbox, and family-circle questions
//    about my dish -> "Leo asked about your Sunday Chili", the question, a mic "Answer". Circle
//    questions about another cook's dish stay off; ones about a dish no family cook made (or about
//    no dish, if they read as a question) come last as "Leo asked the family"
//  - "Leo made your Sunday Chili": someone cooked one of MY dishes -> my recipe page; its x clears
//    it for good (remembered per profile on this phone; cooking it again brings a new row). With a
//    photo it is a postcard (retention PR 3, components/postcard/PostcardRow): Leo's photo, the
//    rating if Leo gave one, "Just like mine" and "Hold to talk" (a voice reply sent from right
//    here). A postcard is a new row even if the plain one was cleared before it came. Until I answer
//    it "Just like mine", it ranks at least as high as the newest "made" row and hearts never go above
//    it (its push said "Sent you a postcard." and opened Home).
//  - "Leo hearted your Sunday Chili" (RETENTION-HANDOFF 3.5): the newest 3 hearts on my dishes from
//    GET /hearts/recent (last 14 days, polled with the inbox), mixed in by time with the "made" rows
//    but never above a question or someone on a new phone (a heart is a passive tap; those need an
//    answer, so hearts never push them behind "See all") -> my recipe page; its x clears it like
//    "made" (a heart again after an un-heart is a new row). No push for hearts: this row is the
//    only place they arrive.
// Header "3 updates", the live rows and then the first 3 other rows (live rows never push "is on a
// new phone" or a new question behind "See all"), then "See all ›" when there are more: an "All
// updates" sheet with every row and the same buttons (each closes the sheet on its way out).
// Nothing to show: no card at all. Still loading: one compact skeleton.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';

import { LiveCookingRow } from '@/components/cooking/LiveCookingRow';
import { HeartUpdateRow, useHeartsRecent } from '@/components/hearts';
import { PostcardRow } from '@/components/postcard';
import { questionWords } from '@/components/messages/helpers';
import { isSpoken } from '@/components/messages/HearQuestion';
import {
  Avatar,
  BottomSheet,
  ChevronRightIcon,
  CloseIcon,
  fadeOutFast,
  haptic,
  listEnter,
  MicIcon,
  PauseIcon,
  PlayIcon,
  PressableScale,
  ScrollHold,
  Skeleton,
  Txt,
  useScrollHold,
} from '@/components/ui';
import type { Message, Profile } from '@/lib/api';
import { cookingApi } from '@/lib/cookingApi';
import { liveKey, type LiveCooking } from '@/lib/cookingLogic';
import { mmss } from '@/lib/format';
import { heartUpdates, mixInHearts } from '@/lib/heartsCopy';
import { useOpenQuestions } from '@/lib/messaging';
import { useMoveRequests, type MoveRequest } from '@/lib/moveRequests';
import { isPostcard, madeKey, rankMine } from '@/lib/postcardLogic';
import { getCachedEntry, recipesByCook, useLibrary } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { kvGetJson, kvSetJson } from '@/lib/storage';
import type { LibraryEntry } from '@/lib/types';
import { useLiveCooking } from '@/lib/useLiveCooking';
import { useVoicePlayback } from '@/lib/voice';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';
import { colors, radii, shadows, space } from '@/theme/tokens';

import { openMoveRequest } from '@/components/profiles/MoveRequestPrompt';

import { dishName, questionFor, questionText, requestDish, useKitchen, type KitchenItem } from './kitchen';

/** Rows shown on the card besides the live ones (those sit on top while a kid cooks). */
const SHOWN = 3;

type AskUpdate = { kind: 'ask'; key: string; at: string; who: Profile; message: Message; chatId: string; for: 'mine' | 'family' };
type MadeUpdate = {
  kind: 'made';
  key: string;
  at: string;
  who: Profile;
  entry: LibraryEntry;
  message: Message;
  threadId: string;
  /** The card is in the family circle (older builds sent them there), not our 1:1. */
  circle: boolean;
  liked: boolean;
};
type MoveUpdate = { kind: 'move'; key: string; at: string; request: MoveRequest };
type CookingUpdate = { kind: 'cooking'; key: string; at: string; live: LiveCooking; entry: LibraryEntry | undefined };
type HeartUpdate = { kind: 'heart'; key: string; at: string; who: Profile; entry: LibraryEntry };
type Update = CookingUpdate | AskUpdate | MadeUpdate | HeartUpdate | MoveUpdate;

/** Rows the x can clear for good on this phone ("made" and "heart"). */
const clearable = (u: Update): u is MadeUpdate | HeartUpdate => u.kind === 'made' || u.kind === 'heart';

/** A postcard I haven't answered "Just like mine" yet: its push opened Home, so it ranks like a question. */
const awaitingAnswer = (u: Update) => u.kind === 'made' && !u.liked && isPostcard(u.message);

function useUpdates(dismissed: readonly string[]): { items: Update[]; ready: boolean } {
  const moveRequests = useMoveRequests();
  const { me, profiles, profileById } = useSession();
  const { entries } = useLibrary();
  const k = useKitchen();
  const open = useOpenQuestions();
  // Kids cooking one of my dishes right now (GET /cooking: the server sends only my dishes, fresh
  // rows, and kids who said yes).
  const { rows: liveRows } = useLiveCooking({ forId: me?.role === 'cook' ? me.id : null });
  // Hearts on my dishes (GET /hearts/recent answers only the dish's cook). Never a push.
  const { hearts } = useHeartsRecent({ enabled: me?.role === 'cook' });

  const asks = new Map<string, AskUpdate>();
  const addAsk = (who: Profile, message: Message, chatId: string, threadKind: 'circle' | 'pair') => {
    if (asks.has(message.id)) return;
    const forMe = questionFor({ message, thread_kind: threadKind }, me, profiles);
    if (forMe) asks.set(message.id, { kind: 'ask', key: message.id, at: message.created_at, who, message, chatId, for: forMe });
  };

  // The family circle's open questions that are for me (any cook answers them there).
  if (open.circleId) for (const q of open.questions) addAsk(q.asker, q.message, open.circleId, 'circle');

  // 1:1: the server's open list (same as Messages); the inbox guess only until it loads. Recipe
  // requests aren't in that list, so they always come from the inbox.
  const circleIds = new Set(k.threads.filter((t) => t.kind === 'circle').map((t) => t.id));
  const pairWaiting = k.waiting.filter((w) => !circleIds.has(w.threadId) && w.threadId !== open.circleId);
  const serverDown = open.loading || (!!open.error && !open.all.length);
  const pairQs: KitchenItem[] = serverDown
    ? pairWaiting
    : open.all
        .filter((q) => q.thread_kind === 'pair')
        .map((q) => ({ threadId: q.message.thread_id, other: q.asker, message: q.message }));
  for (const w of pairQs) addAsk(w.other, w.message, w.threadId, 'pair');
  for (const w of pairWaiting) if (w.message.kind === 'request') addAsk(w.other, w.message, w.threadId, 'pair');

  // Someone cooked one of my own dishes (anyone can forward anyone's recipe; this says "your").
  // One row per person and dish; never the "Leo has your ..." fallback for a dish only sent.
  const mineIds = new Set(recipesByCook(entries, me?.name).map((e) => e.id));
  const made: MadeUpdate[] = [];
  const seen = new Set<string>();
  for (const c of k.cooked) {
    const id = c.message.recipe_id;
    const entry = id && mineIds.has(id) ? getCachedEntry(id) : undefined;
    const key = `${c.other.id}:${id}`;
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    made.push({
      kind: 'made',
      key: madeKey(c.message),
      at: c.message.created_at,
      who: profileById(c.message.sender_id) ?? c.other,
      entry,
      message: c.message,
      threadId: c.threadId,
      circle: circleIds.has(c.threadId) || c.threadId === open.circleId,
      liked: k.liked.has(c.message.id),
    });
  }

  // Someone hearted one of my dishes: the newest 3 not cleared, people still in the family, never me.
  const heartRows: HeartUpdate[] = heartUpdates(hearts, profiles, mineIds, { meId: me?.id, dismissed, max: 3 }).flatMap((h) => {
    const entry = getCachedEntry(h.recipeId);
    return entry ? [{ kind: 'heart' as const, key: h.key, at: h.at, who: h.who, entry }] : [];
  });

  // Parse, don't string-compare: the circle and inbox timestamps may differ in format.
  const time = (at: string) => Date.parse(at) || 0;
  const newest = (a: Update, b: Update) => time(b.at) - time(a.at);
  // Someone on a new phone waiting to be let in goes first: they can't use the app until then.
  // Then what's mine, then what's for the whole family.
  const moves: MoveUpdate[] = moveRequests.map((r) => ({ kind: 'move', key: `move:${r.id}`, at: r.created_at, request: r }));
  // Live rows go first: they only exist while someone is cooking. Kid + dish + session start is the
  // key, so a new session is a new row (its heart starts empty).
  const cooking: CookingUpdate[] = liveRows
    .map((r): CookingUpdate => ({ kind: 'cooking', key: `cooking:${liveKey(r)}`, at: r.updated_at, live: r, entry: getCachedEntry(r.recipe_id) }))
    .sort(newest);
  const all = [...asks.values()];
  // Newest first, a postcard still waiting for its answer at least as high as the newest "made" row.
  const mine = rankMine<Update>(
    [...all.filter((u) => u.for === 'mine'), ...made],
    (u) => u.at,
    (u) => (u.kind === 'ask' ? 'ask' : awaitingAnswer(u) ? 'postcard' : 'made'),
  );
  const family = all.filter((u) => u.for === 'family').sort(newest);
  // Hearts by time among the "made" rows, never above a row that needs an answer (a waiting postcard counts).
  const rest = mixInHearts<Update>([...moves, ...mine, ...family], heartRows, (u) => u.kind === 'ask' || u.kind === 'move' || awaitingAnswer(u));
  const items = [...cooking, ...rest];
  return { items, ready: k.inboxReady && (!open.loading || !!open.error) };
}

/**
 * "Leo asked about your Sunday Chili" (about another dish: "Leo asked about Sunday Chili"), "Leo
 * asked for your Sunday eggs", "Leo asked you" (1:1), or "Leo asked the family".
 */
function askTitle(u: AskUpdate, me: Pick<Profile, 'name'> | null, t: T): string {
  const m = u.message;
  const name = u.who.name;
  if (u.for === 'family') return t('parent.updates.askedFamily', { name });
  const e = m.recipe_id ? getCachedEntry(m.recipe_id) : undefined;
  // The short dish name ("Sunday Chili", not "Dad's Sunday Chili") so the row stays one line.
  const dish = e ? dishName(e.title, e.cook_name, t) : null;
  if (m.kind === 'request') {
    const asked = requestDish(m.body) ?? dish;
    return asked ? t('parent.updates.askedFor', { name, dish: asked }) : t('parent.ask.askedYou', { name });
  }
  if (!e || !dish) return t('parent.ask.askedYou', { name });
  const yours = !!me && e.cook_name.trim().toLowerCase() === me.name.trim().toLowerCase();
  return t(yours ? 'parent.updates.askedAboutYour' : 'parent.updates.askedAbout', { name, dish });
}

/** How many cleared update ids we remember per profile (oldest drop off). */
const DISMISSED_MAX = 200;

/** "Made it" and heart updates this profile cleared, remembered on this phone. `loaded` = read from storage. */
function useDismissed(profileId: string | null | undefined) {
  const key = profileId ? `updates.dismissed.${profileId}` : null;
  const [state, setState] = useState<{ key: string | null; ids: string[]; loaded: boolean }>({ key: null, ids: [], loaded: false });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    kvGetJson<string[]>(key).then((ids) => {
      if (alive) setState({ key, ids: Array.isArray(ids) ? ids : [], loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  const current = state.key === key ? state : { key, ids: [] as string[], loaded: !key };
  const dismiss = useCallback(
    (id: string) => {
      if (!key) return;
      setState((s) => {
        const ids = [...(s.key === key ? s.ids : []).filter((x) => x !== id), id].slice(-DISMISSED_MAX);
        void kvSetJson(key, ids);
        return { key, ids, loaded: true };
      });
    },
    [key],
  );
  return { ids: current.ids, loaded: current.loaded, dismiss };
}

export function UpdatesCard({ enterIndex = 0 }: { enterIndex?: number }) {
  const { me } = useSession();
  const { t } = useWords();
  const madeTitle = (u: MadeUpdate) => t('parent.home.madeYour', { name: u.who.name, dish: dishName(u.entry.title, u.entry.cook_name, t) });
  const dismissed = useDismissed(me?.id);
  const all = useUpdates(dismissed.ids);
  const ready = all.ready && dismissed.loaded;
  const items = all.items.filter((u) => !clearable(u) || !dismissed.ids.includes(u.key));
  const [allOpen, setAllOpen] = useState(false);
  // A postcard's "Hold to talk" holds the sheet still while a finger is on it (ui/ScrollHold).
  const sheetHold = useScrollHold();
  // The last update went (the card goes too): the sheet mustn't pop back open with the next one.
  if (!items.length && allOpen) setAllOpen(false);
  if (!items.length) return ready ? null : <UpdatesSkeleton />;
  const count = t(items.length === 1 ? 'parent.updates.countOne' : 'parent.updates.countMany', { n: items.length });
  // Live rows come first in `items` and are shown on top of the SHOWN others.
  const shown = items.slice(0, items.filter((u) => u.kind === 'cooking').length + SHOWN);
  const row = (u: Update, onGo?: () => void) =>
    u.kind === 'cooking' ? (
      <LiveCookingRow
        kid={u.live.profile}
        dish={u.entry ? dishName(u.entry.title, u.entry.cook_name, t) : t('parent.dish.fallback')}
        step={u.live.step}
        total={u.live.total}
        onHeart={() => cookingApi.sendHeart(u.live.profile.id, u.live.recipe_id)}
      />
    ) : u.kind === 'move' ? (
      <MoveRow u={u} onGo={onGo} />
    ) : u.kind === 'ask' ? (
      <AskRow u={u} onGo={onGo} />
    ) : u.kind === 'heart' ? (
      <HeartUpdateRow
        who={u.who}
        dish={dishName(u.entry.title, u.entry.cook_name, t)}
        posterUrl={u.entry.poster_url}
        onPress={() => {
          onGo?.();
          router.push({ pathname: '/my-recipe/[id]', params: { id: u.entry.id } });
        }}
        onClear={() => dismissed.dismiss(u.key)}
      />
    ) : isPostcard(u.message) && me ? (
      <PostcardRow
        who={u.who}
        title={madeTitle(u)}
        recipeId={u.entry.id}
        message={u.message}
        threadId={u.threadId}
        circle={u.circle}
        meId={me.id}
        liked={u.liked}
        onGo={onGo}
        onClear={() => dismissed.dismiss(u.key)}
      />
    ) : (
      <MadeRow u={u} onGo={onGo} onClear={() => dismissed.dismiss(u.key)} />
    );
  return (
    <Animated.View entering={listEnter(enterIndex)} exiting={fadeOutFast} layout={LinearTransition.duration(220)} style={styles.card}>
      <View style={styles.head}>
        <Txt variant="title" accessibilityRole="header">
          {count}
        </Txt>
        {items.length > shown.length ? (
          <PressableScale
            onPress={() => setAllOpen(true)}
            hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t(items.length === 1 ? 'parent.updates.seeAllOne' : 'parent.updates.seeAllMany', { n: items.length })}
            accessibilityHint={t('parent.updates.seeAllHint')}
            style={styles.seeAll}>
            <Txt variant="label" weight={700} color={colors.yolkDeep}>
              {t('parent.updates.seeAll')}
            </Txt>
            <ChevronRightIcon size={16} strokeWidth={2.4} color={colors.yolkDeep} />
          </PressableScale>
        ) : null}
      </View>
      {shown.map((u) => (
        <Animated.View key={u.key} exiting={fadeOutFast} layout={LinearTransition.duration(220)}>
          {row(u)}
        </Animated.View>
      ))}
      <BottomSheet visible={allOpen && items.length > 0} onClose={() => setAllOpen(false)} title={t('parent.updates.all')} accessibilityLabel={t('parent.updates.all')}>
        <ScrollHold value={sheetHold.set}>
          <ScrollView scrollEnabled={!sheetHold.held} style={styles.sheetScroll} contentContainerStyle={styles.sheetPad} showsVerticalScrollIndicator={false}>
            {items.map((u) => (
              <Animated.View key={u.key} exiting={fadeOutFast} layout={LinearTransition.duration(220)}>
                {row(u, () => setAllOpen(false))}
              </Animated.View>
            ))}
          </ScrollView>
        </ScrollHold>
      </BottomSheet>
    </Animated.View>
  );
}

/** `onGo`: runs before a row's button leaves for another screen (the "All updates" sheet closes). */
function AskRow({ u, onGo }: { u: AskUpdate; onGo?: () => void }) {
  const { me } = useSession();
  const { t } = useWords();
  const title = askTitle(u, me, t);
  const spoken = u.message.kind === 'question' && isSpoken(u.message);
  const words = u.message.kind === 'question' ? questionWords(u.message) : questionText(u.message, t);
  const answer = () => {
    onGo?.();
    router.push({ pathname: '/chat/[id]', params: { id: u.chatId, q: u.message.id } });
  };
  const head = (
    <>
      <Txt variant="rowTitle" leading={1.3} numberOfLines={1}>
        {title}
      </Txt>
      {spoken ? null : (
        <Txt variant="meta" size={15} leading={1.35} numberOfLines={2}>
          {words}
        </Txt>
      )}
    </>
  );
  // Title and question get the full width; the Answer pill sits under them. The words and the
  // pill are siblings, never one button inside another (web forbids nested buttons).
  return (
    <View style={styles.row}>
      <Avatar profile={u.who} size={40} />
      <View style={styles.rowText}>
        {spoken ? (
          <View style={styles.words}>
            {head}
            <HearChip who={u.who} message={u.message} />
          </View>
        ) : (
          <PressableScale
            onPress={answer}
            scaleTo={0.98}
            accessibilityLabel={`${title}. ${words}`}
            accessibilityHint={t('parent.updates.answerHint')}
            style={styles.words}>
            {head}
          </PressableScale>
        )}
        <PressableScale
          onPress={answer}
          haptic
          hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          accessibilityLabel={t('parent.updates.answerName', { name: u.who.name })}
          accessibilityHint={t('parent.updates.answerHint')}
          style={styles.answer}>
          <MicIcon size={16} color={colors.green} />
          <Txt variant="label" size={14} weight={700} color={colors.green}>
            {t('parent.ask.answer')}
          </Txt>
        </PressableScale>
      </View>
    </View>
  );
}

/** A small "Hear Leo · 0:04" play pill for a question asked out loud with no words to show. */
function HearChip({ who, message }: { who: Pick<Profile, 'name'>; message: Message }) {
  const v = useVoicePlayback(message);
  const { t } = useWords();
  const playing = v.phase === 'playing' || v.phase === 'loading';
  const time = (playing || v.phase === 'paused') && v.elapsed > 0 ? mmss(v.elapsed) : mmss(v.total);
  return (
    <View>
      <PressableScale
        onPress={v.toggle}
        disabled={!v.available}
        haptic
        hitSlop={{ top: 9, bottom: 9, left: 6, right: 6 }}
        accessibilityLabel={playing ? t('parent.updates.pause', { name: who.name }) : t('parent.updates.hearQuestion', { name: who.name })}
        style={[styles.hear, !v.available ? styles.dim : null]}>
        {playing ? <PauseIcon size={12} color={colors.ink} /> : <PlayIcon size={12} color={colors.ink} />}
        <Txt variant="label" size={14} weight={700} color={colors.ink} style={styles.tnum} numberOfLines={1}>
          {t('parent.updates.hear', { name: who.name, time })}
        </Txt>
      </PressableScale>
    </View>
  );
}

function MadeRow({ u, onClear, onGo }: { u: MadeUpdate; onClear: () => void; onGo?: () => void }) {
  const { t } = useWords();
  const title = t('parent.home.madeYour', { name: u.who.name, dish: dishName(u.entry.title, u.entry.cook_name, t) });
  // The row and its x are siblings, never one button inside another (web forbids it).
  return (
    <View style={[styles.row, styles.madeRow]}>
      <PressableScale
        onPress={() => {
          onGo?.();
          router.push({ pathname: '/my-recipe/[id]', params: { id: u.entry.id } });
        }}
        scaleTo={0.98}
        accessibilityLabel={title}
        accessibilityHint={t('parent.home.opensRecipe')}
        style={styles.madeMain}>
        <Avatar profile={u.who} size={40} />
        <Txt variant="rowTitle" leading={1.3} numberOfLines={2} style={styles.flex}>
          {title}
        </Txt>
        {u.entry.poster_url ? (
          <Image source={{ uri: u.entry.poster_url }} style={styles.thumb} contentFit="cover" transition={150} />
        ) : null}
      </PressableScale>
      <PressableScale
        onPress={() => {
          haptic('selection');
          onClear();
        }}
        hitSlop={8}
        accessibilityLabel={t('parent.updates.clear', { title })}
        style={styles.clear}>
        <CloseIcon size={16} strokeWidth={2.4} color={colors.muted} />
      </PressableScale>
    </View>
  );
}

function MoveRow({ u, onGo }: { u: MoveUpdate; onGo?: () => void }) {
  const who = u.request.profile;
  const { t } = useWords();
  return (
    <View style={[styles.row, styles.madeRow]}>
      <Avatar profile={who} size={40} />
      <Txt variant="rowTitle" leading={1.3} numberOfLines={2} style={styles.flex}>
        {t('parent.updates.newPhone', { name: who.name })}
      </Txt>
      <PressableScale
        onPress={() => {
          onGo?.();
          openMoveRequest(u.request.id);
        }}
        haptic
        hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
        accessibilityLabel={t('parent.updates.letInLabel', { name: who.name })}
        accessibilityHint={t('parent.updates.letInHint')}
        style={styles.answer}>
        <Txt variant="label" size={14} weight={700} color={colors.green}>
          {t('parent.updates.letIn')}
        </Txt>
      </PressableScale>
    </View>
  );
}

function UpdatesSkeleton() {
  const { t } = useWords();
  return (
    <View style={styles.card} accessible accessibilityLabel={t('parent.updates.loading')}>
      <Skeleton width={96} height={16} style={styles.skHead} />
      <View style={[styles.row, styles.madeRow]}>
        <Skeleton circle height={40} />
        <View style={[styles.flex, styles.skLines]}>
          <Skeleton width="70%" height={15} />
          <Skeleton width="50%" height={13} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: {
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  head: { minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: 8 },
  words: { gap: 2 },
  madeRow: { alignItems: 'center' },
  madeMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  clear: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 10 },
  answer: {
    alignSelf: 'flex-start',
    height: 36,
    paddingLeft: 10,
    paddingRight: 12,
    borderRadius: 999,
    backgroundColor: colors.greenTint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hear: {
    alignSelf: 'flex-start',
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.yolkTint,
    borderWidth: 1.5,
    borderColor: colors.yolk, // a tint alone vanishes into cream and white
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dim: { opacity: 0.5 },
  tnum: { fontVariant: ['tabular-nums'], flexShrink: 1 },
  thumb: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.well },
  skHead: { marginBottom: space.sm },
  sheetScroll: { maxHeight: 560 },
  sheetPad: { paddingBottom: space.sm },
  skLines: { gap: 8 },
});

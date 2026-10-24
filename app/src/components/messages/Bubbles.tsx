// Chat bubbles for every message kind, in the two bible layouts.
//
// Kid-Chat (learner):   my bubbles lavender #ECE6F2 (radius 20 20 6 20, right, max 270), the cook's
//                       peach #F9E3CF (20 20 20 6, left, max 290); 16/1.4 text, padding 12 16;
//                       step chip 13/700 #3F3558 above; times 12 muted.
// Parent-Chat (cook):   the learner's bubbles lavender on the left (22 22 22 6, max 280), mine peach on
//                       the right (22 22 6 22, max 290); 17/1.4, padding 14 18; step chip 14/700;
//                       times 13 muted; the open question ringed in sun (0 0 0 2px #FEBE29).
// Voice: a 44 ink play disc + 16-bar waveform (130 x 28) + duration 14/700, padding 10 16 10 10
// ("Your voice · 0:38" 16/700 without bars for the cook's own notes). Its transcript always shows
// right under the bubble (muted, no wider than the bubble), like iMessage.
// Dish attachment: a message that names a recipe ("Ask about a dish") carries a small cream card
// inside the top of its bubble (44 thumb, title, "by Dad" / "Step 3 · Boil"); it opens the recipe
// (the cook's own page if theirs), or that step for a step question about someone else's dish.
// Until the dish's name loads, a skeleton line stands in for it.
// "Made it" (cooked): the dish's thumb with a green check and "Leo made your chili", or, once a
// photo of their own bowl is on it (the postcard, retention PR 3), that photo big at the top as a
// postcard (a cream frame, a slight tilt, none under Reduce Motion) and the pots they rated it.
// "Just like mine" shows as a small stamp under it (ChatLog's ReactionStamp).
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { PostcardPhoto, RatingLine } from '@/components/postcard';
import { ArrowRightIcon, CheckIcon, PauseIcon, PlayIcon, PressableScale, Skeleton, Txt, Waveform } from '@/components/ui';
import type { Message, Profile } from '@/lib/api';
import { mmss, totalTimeLabel } from '@/lib/format';
import { ratingAsk } from '@/lib/postcardLogic';
import { refreshThreadMedia, type ChatMessage } from '@/lib/messaging';
import type { LibraryEntry, Recipe } from '@/lib/types';
import { useVoicePlayback } from '@/lib/voice';
import { colors, shadows } from '@/theme/tokens';

import { dishName, isCookOf } from './helpers';
import { openDish } from './open';

export type ChatLayout = 'kid' | 'parent';

export const LAYOUT = {
  kid: { font: 16, padV: 12, padH: 16, radius: 20, maxMine: 270, maxTheirs: 290, chip: 13, time: 12, gap: 14 },
  parent: { font: 17, padV: 14, padH: 18, radius: 22, maxMine: 290, maxTheirs: 280, chip: 14, time: 13, gap: 18 },
} as const;

/** Bubble fill + ink for a side: learners are lavender, cooks peach (by layout). */
export function bubbleTone(layout: ChatLayout, mine: boolean) {
  const lavender = layout === 'kid' ? mine : !mine;
  return lavender ? { bg: colors.lavender, ink: colors.lavenderInk } : { bg: colors.peach, ink: colors.peachInk };
}

function corners(layout: ChatLayout, mine: boolean): ViewStyle {
  const r = LAYOUT[layout].radius;
  return mine
    ? { borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomRightRadius: 6, borderBottomLeftRadius: r }
    : { borderTopLeftRadius: r, borderTopRightRadius: r, borderBottomRightRadius: r, borderBottomLeftRadius: 6 };
}

export type BubbleContext = {
  layout: ChatLayout;
  me: Profile | null;
  /** Pair: the other person. Circle: a stand-in ("Family"); use `profile(sender_id)`. */
  other: Profile | null;
  entry: (id: string | null | undefined) => LibraryEntry | null;
  recipes: Record<string, Recipe>;
  /** The family circle: bubbles are toned by the sender's role, each group shows who sent it. */
  circle?: boolean;
  /** Everyone in the thread (the inbox's list, which may know a newcomer before the session does). */
  members?: Profile[];
  /** Anyone in the family, or someone removed (their old messages keep a name and face). */
  profile?: (id: string) => Profile | null;
};

/**
 * Who sent a message: me; else the thread's members, then the family (former people included);
 * a pair's other person. In the circle an unknown sender is null (no name), never "Family".
 */
export function senderOf(ctx: BubbleContext, m: Pick<Message, 'sender_id'>, mine: boolean): Profile | null {
  if (mine) return ctx.me;
  const known = ctx.members?.find((p) => p.id === m.sender_id) ?? ctx.profile?.(m.sender_id) ?? null;
  if (known) return known;
  return ctx.circle ? null : ctx.other;
}

/** Bubble tone for a message. In the circle: learners lavender, cooks peach (whoever reads). */
export function toneFor(ctx: BubbleContext, m: Pick<Message, 'sender_id'>, mine: boolean) {
  if (ctx.circle) {
    const who = senderOf(ctx, m, mine);
    if (who) return who.role === 'learner' ? { bg: colors.lavender, ink: colors.lavenderInk } : { bg: colors.peach, ink: colors.peachInk };
  }
  return bubbleTone(ctx.layout, mine);
}

/**
 * "Step 3 · Roll the wrappers" (taps through to that step); without a step, the dish's name
 * (opens the recipe). `asBubble` = a step question sent without words: the chip sits inside its
 * own bubble.
 */
export function StepChip({ m, ctx, mine, asBubble, ring }: { m: Message; ctx: BubbleContext; mine: boolean; asBubble?: boolean; ring?: boolean }) {
  const recipe = m.recipe_id ? ctx.recipes[m.recipe_id] : undefined;
  const step = recipe?.steps.find((s) => s.order === m.step_order);
  const entry = ctx.entry(m.recipe_id);
  const dish = entry ? dishName(entry) : (recipe?.title ?? '');
  const label = m.step_order ? `Step ${m.step_order}${step ? ` · ${step.title}` : ''}` : dish;
  const L = LAYOUT[ctx.layout];
  const open = () => {
    if (!m.recipe_id) return;
    if (m.step_order) router.push({ pathname: '/cook/[id]', params: { id: m.recipe_id, step: String(m.step_order) } });
    else openDish(m.recipe_id, { mine: isCookOf(entry, ctx.me) });
  };
  const tone = toneFor(ctx, m, mine);
  if (!label) return null;
  return (
    <PressableScale
      onPress={m.recipe_id ? open : undefined}
      accessibilityRole="link"
      accessibilityLabel={`Open ${label}`}
      hitSlop={8}
      style={[
        { alignSelf: mine ? 'flex-end' : 'flex-start' },
        asBubble
          ? [
              styles.bubble,
              corners(ctx.layout, mine),
              { backgroundColor: tone.bg, paddingVertical: L.padV, paddingHorizontal: L.padH },
              ring ? { boxShadow: '0 0 0 2px #FEBE29' } : null,
            ]
          : null,
      ]}>
      <Txt
        variant="label"
        size={asBubble ? L.font - 1 : L.chip}
        weight={700}
        color={colors.lavenderInk}
        numberOfLines={asBubble ? 2 : 1}
        align={mine && !asBubble ? 'right' : 'left'}>
        {asBubble ? `A question about ${label}` : label}
      </Txt>
    </PressableScale>
  );
}

/** A plain words bubble; `attachment` (a dish card) sits inside its top, the words under it. */
export function TextBubble({
  text,
  layout,
  mine,
  ring,
  dim,
  tone: toneIn,
  attachment,
  style,
}: {
  text: string;
  layout: ChatLayout;
  mine: boolean;
  /** The open question (sun ring). */
  ring?: boolean;
  /** Sending: slightly faded. */
  dim?: boolean;
  /** Fill override (the circle tones by the sender's role). */
  tone?: { bg: string; ink: string };
  attachment?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const L = LAYOUT[layout];
  const tone = toneIn ?? bubbleTone(layout, mine);
  return (
    <View
      style={[
        styles.bubble,
        corners(layout, mine),
        { backgroundColor: tone.bg, opacity: dim ? 0.75 : 1 },
        attachment ? styles.withAttachment : { paddingVertical: L.padV, paddingHorizontal: L.padH },
        ring ? { boxShadow: shadows.ringSun } : null,
        style,
      ]}>
      {attachment}
      {text ? (
        <Txt
          variant="bodyInk"
          size={L.font}
          leading={1.4}
          selectable
          style={attachment ? { paddingHorizontal: L.padH - 6, paddingTop: 8, paddingBottom: L.padV - 6 } : null}>
          {text}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * What a dish card shows: title, one meta line ("by Dad", "Your recipe", "Step 3 · Boil"), photo.
 * `title` is null until the library entry or the recipe has loaded (never a made-up name).
 */
export function dishInfo(ctx: Pick<BubbleContext, 'entry' | 'recipes' | 'me'>, id: string, step?: number | null) {
  const entry = ctx.entry(id);
  const recipe = ctx.recipes[id];
  const cook = entry?.cook_name ?? recipe?.cook.name ?? null;
  const mine = isCookOf(cook ? { cook_name: cook } : null, ctx.me);
  const title = entry ? dishName(entry) : recipe ? dishName({ title: recipe.title, cook_name: recipe.cook.name }) : null;
  const stepTitle = step ? recipe?.steps.find((s) => s.order === step)?.title : undefined;
  const meta = step ? `Step ${step}${stepTitle ? ` · ${stepTitle}` : ''}` : mine ? 'Your recipe' : cook ? `by ${cook}` : null;
  return { title, meta, poster: entry?.poster_url ?? recipe?.media.poster_url ?? null, mine };
}

/**
 * The dish a message is about, inside the top of its bubble. Tap: the recipe (the cook's own page
 * if theirs); a step question lands on that step for everyone but the dish's cook.
 */
export function DishAttachment({ m, ctx }: { m: Pick<Message, 'recipe_id' | 'step_order'>; ctx: BubbleContext }) {
  if (!m.recipe_id) return null;
  const id = m.recipe_id;
  const step = m.step_order;
  const dish = dishInfo(ctx, id, step);
  const open = () => {
    if (step && !dish.mine) router.push({ pathname: '/cook/[id]', params: { id, step: String(step) } });
    else openDish(id, { mine: dish.mine });
  };
  return (
    <PressableScale
      onPress={open}
      scaleTo={0.97}
      accessibilityRole="link"
      accessibilityLabel={`Open the recipe${dish.title ? `: ${dish.title}` : ''}`}
      style={styles.dish}>
      {dish.poster ? (
        <Image source={{ uri: dish.poster }} style={styles.dishThumb} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.dishThumb, styles.dishThumbEmpty]} />
      )}
      <View style={styles.dishText}>
        {dish.title ? (
          <Txt variant="rowTitle" size={15} numberOfLines={2}>
            {dish.title}
          </Txt>
        ) : (
          <Skeleton width={120} height={15} radius={6} />
        )}
        {dish.meta ? (
          <Txt variant="caption" numberOfLines={1}>
            {dish.meta}
          </Txt>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Voice note: play/pause, waveform with progress, duration; the transcript under it when there is one. */
export function VoiceBubble({
  m,
  ctx,
  mine,
  ring,
  attachment,
}: {
  m: ChatMessage;
  ctx: BubbleContext;
  mine: boolean;
  /** The open question (sun ring), for a spoken question. */
  ring?: boolean;
  /** A dish card inside the top of the bubble. */
  attachment?: ReactNode;
}) {
  const v = useVoicePlayback(m);
  // The transcript wraps at the bubble's own width, never wider: it waits for the bubble's first
  // layout, then fades in already wrapped (no wide-then-narrow jump).
  const [bubbleW, setBubbleW] = useState(0);
  // A failed play is most often an expired signed URL: fetch the thread again once for fresh ones.
  const refetched = useRef(false);
  useEffect(() => {
    if (v.phase !== 'error' || m.local || refetched.current) return;
    refetched.current = true;
    void refreshThreadMedia(m.thread_id);
  }, [v.phase, m.local, m.thread_id]);
  const tone = toneFor(ctx, m, mine);
  const ownCookNote = ctx.layout === 'parent' && mine;
  const active = v.phase === 'playing' || v.phase === 'loading' || v.phase === 'paused';
  const time = active && v.elapsed > 0 ? mmss(v.elapsed) : mmss(v.total);
  const playing = v.phase === 'playing' || v.phase === 'loading';
  const sender = senderOf(ctx, m, mine);
  const transcript = (m.transcript ?? '').trim();
  const label = `${playing ? 'Pause' : 'Play'} ${mine ? 'your' : `${sender?.name ?? 'their'}’s`} voice note, ${mmss(v.total)}`;
  const side = mine ? 'flex-end' : 'flex-start';

  return (
    <View style={[styles.voiceCol, { alignItems: side }]}>
      <View
        onLayout={(e) => setBubbleW(Math.round(e.nativeEvent.layout.width))}
        style={[
          styles.bubble,
          corners(ctx.layout, mine),
          { backgroundColor: tone.bg, opacity: m.local === 'sending' ? 0.75 : 1 },
          attachment ? styles.withAttachment : null,
          ring ? { boxShadow: shadows.ringSun } : null,
        ]}>
        {attachment}
        <View style={[styles.voice, { paddingRight: ownCookNote ? 18 : 16 }, attachment ? styles.voiceInset : null]}>
          <PressableScale
            onPress={v.toggle}
            disabled={!v.available}
            haptic
            accessibilityLabel={label}
            style={[styles.play, !v.available ? { opacity: 0.4 } : null]}>
            {playing ? <PauseIcon size={16} color={colors.card} /> : <PlayIcon size={16} color={colors.card} />}
          </PressableScale>
          {ownCookNote ? (
            <Txt variant="label" size={16} weight={700} color={tone.ink}>
              {`Your voice · ${time}`}
            </Txt>
          ) : (
            <>
              <View style={styles.wave}>
                <Waveform seed={m.localId ?? m.id} color={tone.ink} progress={active ? v.progress : undefined} />
              </View>
              <Txt variant="label" size={14} weight={700} color={tone.ink} style={styles.tnum}>
                {time}
              </Txt>
            </>
          )}
        </View>
      </View>
      {v.phase === 'error' ? (
        <Txt variant="tiny" color={colors.danger}>
          This voice note won’t play right now.
        </Txt>
      ) : null}
      {transcript && bubbleW ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ maxWidth: bubbleW }}>
          <Txt variant="body" size={ctx.layout === 'parent' ? 16 : 15} leading={1.4} selectable style={styles.transcript}>
            {transcript}
          </Txt>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A recipe sent in the chat: photo, title, "by Dad · ~50 min", the note; opens the recipe. */
export function RecipeBubble({ m, ctx, mine }: { m: Message; ctx: BubbleContext; mine: boolean }) {
  const entry = ctx.entry(m.recipe_id);
  const recipe = m.recipe_id ? ctx.recipes[m.recipe_id] : undefined;
  const tone = toneFor(ctx, m, mine);
  const L = LAYOUT[ctx.layout];
  const title = entry?.title ?? recipe?.title ?? null;
  const cook = entry?.cook_name ?? recipe?.cook.name ?? null;
  const time = totalTimeLabel(recipe?.total_time);
  const meta = [cook ? `by ${cook}` : null, time].filter(Boolean).join(' · ');
  const poster = entry?.poster_url ?? recipe?.media.poster_url ?? null;
  const note = (m.body ?? '').trim();
  const mineRecipe = isCookOf(entry ?? (recipe ? { cook_name: recipe.cook.name } : null), ctx.me);
  const open = () => {
    openDish(m.recipe_id, { mine: mineRecipe });
  };
  return (
    <PressableScale
      onPress={open}
      scaleTo={0.97}
      accessibilityRole="link"
      accessibilityLabel={title ? `Open the recipe: ${title}` : 'Open the recipe'}
      style={[styles.bubble, styles.recipe, corners(ctx.layout, mine), { backgroundColor: tone.bg }]}>
      {poster ? (
        <View>
          <Image source={{ uri: poster }} style={styles.recipePhoto} contentFit="cover" transition={180} accessibilityIgnoresInvertColors />
          <View style={styles.openDisc}>
            <ArrowRightIcon size={18} color={colors.ink} strokeWidth={2.2} />
          </View>
        </View>
      ) : null}
      <View style={styles.recipeText}>
        {title ? (
          <Txt variant="kitchen" size={20} leading={1.25} numberOfLines={2}>
            {title}
          </Txt>
        ) : (
          <Skeleton width="70%" height={20} radius={6} />
        )}
        {meta ? (
          <Txt variant="meta" size={14} color={tone.ink}>
            {meta}
          </Txt>
        ) : null}
        {note ? (
          <Txt variant="bodyInk" size={L.font} leading={1.4} style={styles.recipeNote} selectable>
            {note}
          </Txt>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** "Leo made your Sunday Chili" with a green check, the dish photo (or their postcard) and their note. */
export function CookedBubble({ m, ctx, mine }: { m: Message; ctx: BubbleContext; mine: boolean }) {
  const entry = ctx.entry(m.recipe_id);
  const tone = toneFor(ctx, m, mine);
  const L = LAYOUT[ctx.layout];
  const dish = entry ? dishName(entry) : 'it';
  const yours = isCookOf(entry, ctx.me);
  const who = mine ? 'You' : (senderOf(ctx, m, mine)?.name ?? 'They');
  const headline = mine ? `You made ${dish}` : `${who} made ${yours ? 'your ' : ''}${dish}`;
  const note = (m.body ?? '').trim();
  const open = () => {
    openDish(m.recipe_id, { mine: yours });
  };
  // A photo that won't load is most often an expired signed URL: fetch the thread again once.
  const refetched = useRef(false);
  const photoFailed = () => {
    if (m.id.startsWith('local-') || refetched.current) return;
    refetched.current = true;
    void refreshThreadMedia(m.thread_id);
  };
  return (
    <PressableScale
      onPress={m.recipe_id ? open : undefined}
      scaleTo={0.97}
      accessibilityLabel={headline}
      style={[
        styles.bubble,
        corners(ctx.layout, mine),
        { backgroundColor: tone.bg, paddingVertical: L.padV, paddingHorizontal: L.padH, gap: 10 },
      ]}>
      {m.photo_url ? (
        <PostcardPhoto
          uri={m.photo_url}
          id={m.id}
          onError={photoFailed}
          label={mine ? 'Your photo of the dish' : `${who}’s photo of the dish`}
          style={[styles.cookedPhoto, { width: (mine ? L.maxMine : L.maxTheirs) - 2 * L.padH }]}
        />
      ) : null}
      <View style={styles.cookedHead}>
        {!m.photo_url && entry?.poster_url ? (
          <View>
            <Image source={{ uri: entry.poster_url }} style={styles.cookedThumb} contentFit="cover" />
            <View style={styles.cookedCheck}>
              <CheckIcon size={11} strokeWidth={3.5} color={colors.card} />
            </View>
          </View>
        ) : (
          <View style={[styles.cookedCheck, styles.cookedCheckBig]}>
            <CheckIcon size={14} strokeWidth={3.5} color={colors.card} />
          </View>
        )}
        <Txt variant="label" size={L.font} weight={700} style={styles.flex}>
          {headline}
        </Txt>
      </View>
      {m.photo_url ? (
        <RatingLine
          words={yours ? 'How close to yours' : ratingAsk(entry?.cook_name || ctx.recipes[m.recipe_id ?? '']?.cook.name || 'the cook').replace(/\?$/, '')}
          value={m.rating}
          size={L.font + 1}
          textSize={L.font - 2}
        />
      ) : null}
      {note ? (
        <Txt variant="bodyInk" size={L.font} leading={1.4} selectable>
          {note}
        </Txt>
      ) : null}
    </PressableScale>
  );
}

/** Small label above a bubble ("Recipe request"). */
export function KindLabel({ children, layout, mine }: { children: ReactNode; layout: ChatLayout; mine: boolean }) {
  return (
    <Txt
      variant="label"
      size={LAYOUT[layout].chip}
      weight={700}
      color={colors.lavenderInk}
      align={mine ? 'right' : 'left'}
      style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
      {children}
    </Txt>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '100%' },
  // A bubble carrying a dish card: a thin rim around the card, room for a readable title.
  withAttachment: { padding: 6, minWidth: 220 },
  dish: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    paddingRight: 12,
    minHeight: 60,
    borderRadius: 14,
    backgroundColor: colors.card,
  },
  dishThumb: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.well },
  dishThumbEmpty: { backgroundColor: colors.peach },
  dishText: { flex: 1, minWidth: 0, gap: 2 },
  voiceCol: { gap: 6 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 10 },
  // Inside a bubble that already has the 6 px rim.
  voiceInset: { paddingTop: 6, paddingBottom: 4, paddingLeft: 4, paddingRight: 10 },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: { width: 130 },
  tnum: { fontVariant: ['tabular-nums'] },
  transcript: { paddingHorizontal: 6 },
  recipe: { width: 264, padding: 8, gap: 0 },
  recipePhoto: { width: '100%', height: 132, borderRadius: 14, backgroundColor: colors.well },
  recipeText: { paddingHorizontal: 8, paddingTop: 12, paddingBottom: 8, gap: 4 },
  recipeNote: { marginTop: 6 },
  openDisc: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,253,247,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cookedHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cookedThumb: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.well },
  cookedPhoto: { aspectRatio: 1 },
  cookedCheck: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 0 2px #FFFDF7',
  },
  cookedCheckBig: { position: 'relative', right: 0, bottom: 0, width: 28, height: 28, borderRadius: 14 },
  flex: { flex: 1 },
});

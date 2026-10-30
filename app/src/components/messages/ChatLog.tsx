// The conversation: messages grouped by sender (same day, within 10 minutes), one time under each
// group, a day line between days (Kid-Chat), and the bible's status lines:
//   "11:52 pm · Sent" under my newest message, in every chat, until someone writes after it
//   parent "Last night · waiting for you" (13/700 ink) + yolk ring on the question being answered
// The family circle adds: the sender's face + name over each group, quiet centred system notes,
// "Answered by Dad" under answered questions, "Answer this" under other open ones (cooks), and
// "Saved to the recipe" / "Save to recipe" under a cook's answers ("Saved to the recipe · Undo" under
// my own, which takes it back out of the recipe). 1:1 chats ring the question being
// answered the same way, offer "Answer this" under their other open questions (cooks), and say
// "Answered by …" under an answered question whose answer isn't the very next message.
// A message sent with a dish attached (a typed or spoken question, a request) shows the dish card
// inside its bubble, except a question repeating the dish (and step) of the sender's previous
// question that day. A reply only carries its question's dish, so it shows no card of its own when
// that dish is the question's or the message right above's. Recipe / step / "made it" messages keep
// their own cards.
// A reaction (RETENTION-HANDOFF 3.1 & 3.4) is never a bubble, a word or an answer: one that answers a
// message here ("Just like mine" on a dish someone made) is a small stamp under that message
// ("♥ “Just like mine.” · Mom"); a heart sent mid-cook answers nothing, so it is a quiet centred line
// in its place ("♥ Mom"), repeated taps in a row showing once. The grouping, the reaction split and
// the "Sent" group live in ./chatGroups.ts (tested under Node); a quiet line that opens a day hands
// the day to the next time line ("Today, 6:40 pm") in the parent layout, which has no day lines.
// Optimistic bubbles pop in (scale 0.9 -> 1); failed ones offer "Tap to try again".
// `focusId` (the question an Answer button opened the chat for): its bubble's top, from the log's
// top, goes to `onFocusLayout`, so the chat can scroll it into view instead of to the bottom.
import { Fragment, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ReactionStamp } from '@/components/cooking/ReactionStamp';
import { Avatar, bubblePop, CheckIcon, PressableScale, Txt } from '@/components/ui';
import type { Message } from '@/lib/api';
import { chatDay, chatStamp, clock, differentDay, relativeDay } from '@/lib/format';
import type { ChatMessage } from '@/lib/messaging';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

import {
  CookedBubble,
  DishAttachment,
  KindLabel,
  LAYOUT,
  RecipeBubble,
  senderOf,
  StepChip,
  TextBubble,
  toneFor,
  VoiceBubble,
  type BubbleContext,
} from './Bubbles';
import { groupMessages, lastWrittenGroup, splitReactions } from './chatGroups';
import { answeredBy, isServerQuestion, waitingQuestion } from './helpers';

/** Kinds that already are a dish card of their own (or never show one: a reaction). */
const OWN_CARD = new Set<Message['kind']>(['recipe', 'step', 'cooked', 'system', 'reaction']);

/**
 * The messages that show a dish card. Questions and requests carry a dish only when someone attached
 * it, so they show it, unless a question repeats the dish and step of the sender's previous question
 * that day (older clients stamped one dish on every question in a 1:1). Text and voice notes carry
 * the dish of what they answer: they skip the card when it repeats their question's dish or the dish
 * of the message right above (system notes skipped), e.g. a reply under a step card.
 */
function dishCards(list: ChatMessage[], byId: Map<string, Message>): Set<ChatMessage> {
  const out = new Set<ChatMessage>();
  const lastBySender = new Map<string, ChatMessage>();
  let prev: ChatMessage | undefined;
  for (const m of list) {
    if (m.kind === 'system' || m.kind === 'reaction') continue;
    const above = prev;
    const before = lastBySender.get(m.sender_id);
    prev = m;
    lastBySender.set(m.sender_id, m);
    if (!m.recipe_id || OWN_CARD.has(m.kind)) continue;
    if (m.kind === 'text' || m.kind === 'voice') {
      const q = m.reply_to ? byId.get(m.reply_to) : undefined;
      if (q?.recipe_id === m.recipe_id || above?.recipe_id === m.recipe_id) continue;
    }
    if (
      m.kind === 'question' &&
      before?.kind === 'question' &&
      before.recipe_id === m.recipe_id &&
      (before.step_order ?? null) === (m.step_order ?? null) &&
      !differentDay(before.created_at, m.created_at)
    ) {
      continue;
    }
    out.add(m);
  }
  return out;
}

/** A cook's own message that can be kept in a recipe (it names one, or answers a question that does). */
function savable(m: ChatMessage, byId: Map<string, Message>): boolean {
  if (m.local || m.saved_to_recipe || (m.kind !== 'text' && m.kind !== 'voice')) return false;
  if (m.recipe_id) return true;
  const q = m.reply_to ? byId.get(m.reply_to) : null;
  return !!q?.recipe_id;
}

export function ChatLog({
  messages: all,
  ctx,
  animateAfter,
  onRetry,
  onDiscard,
  target,
  onAnswer,
  onSave,
  onUndoSave,
  focusId,
  onFocusLayout,
}: {
  messages: ChatMessage[];
  ctx: BubbleContext;
  /** Server messages from others newer than this pop in (null = none, e.g. first load). */
  animateAfter: string | null;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
  /** Cook: the question my next message answers (yolk ring + "waiting for you"); null = none. */
  target?: string | null;
  /** Cook: answer this other open question instead. */
  onAnswer?: (m: ChatMessage) => void;
  /** Cook: "Save to recipe" on one of my messages. */
  onSave?: (m: ChatMessage) => Promise<void>;
  /** "Undo" beside "Saved to the recipe" under my own message: take it back out of the recipe. */
  onUndoSave?: (m: ChatMessage) => Promise<void>;
  /** A message whose position to report (see onFocusLayout). */
  focusId?: string | null;
  /** The focus message's top, in px from the top of the log (each time its layout changes). */
  onFocusLayout?: (y: number) => void;
}) {
  const { t } = useWords();
  const L = LAYOUT[ctx.layout];
  const meId = ctx.me?.id;
  // A reaction (a heart, "Just like mine") is never a bubble or a word in the log, and never counts
  // as an answer: a stamp under what it answers, or a quiet line where it was sent.
  const { messages, flow, under } = splitReactions(all);
  const groups = groupMessages(flow, meId);
  const lastGroup = lastWrittenGroup(groups);
  const stampName = (m: ChatMessage) => (m.sender_id === meId ? null : (senderOf(ctx, m, false)?.name ?? null));
  const isCook = (id: string) => (id === meId ? ctx.me?.role === 'cook' : ctx.profile?.(id)?.role === 'cook');
  const answered = answeredBy(messages, isCook, { pair: !ctx.circle });
  const byId = new Map(messages.map((m) => [m.id, m] as const));
  const withDish = dishCards(messages, byId);
  // 1:1: the message that follows each one (system notes skipped), to tell when an answer sits
  // right under its question.
  const nextOf = new Map<string, ChatMessage>();
  if (!ctx.circle) {
    let after: ChatMessage | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (after) nextOf.set(m.id, after);
      if (m.kind !== 'system' && m.kind !== 'reaction') after = m;
    }
  }
  // The ring follows the question being answered: `target` when the chat says (null = none, e.g.
  // after the strip's ×); left out, a pair rings its open question (the newest one from them with
  // nothing from me after).
  const pairOpen = ctx.circle || target !== undefined ? null : waitingQuestion(messages, meId);
  const ringId = ctx.layout !== 'parent' ? null : target !== undefined ? target : (pairOpen?.id ?? null);
  const cookView = ctx.layout === 'parent' && ctx.me?.role === 'cook';
  // The focus bubble's top = its group's top + its own top inside the group.
  const focusAt = useRef<{ group: number | null; item: number | null }>({ group: null, item: null });
  const reportFocus = (part: 'group' | 'item', y: number) => {
    focusAt.current[part] = y;
    const { group, item } = focusAt.current;
    if (group !== null && item !== null) onFocusLayout?.(group + item);
  };

  return (
    <View style={{ gap: L.gap }}>
      {groups.map((g) => {
        if (g.system) {
          const m = g.messages[0];
          return (
            <Fragment key={g.key}>
              {ctx.layout === 'kid' && g.firstOfDay ? <DayLine iso={m.created_at} /> : null}
              <Txt variant="caption" align="center" style={styles.system}>
                {(m.body ?? '').trim()}
              </Txt>
            </Fragment>
          );
        }
        if (g.stamp) {
          const m = g.messages[0];
          return (
            <Fragment key={g.key}>
              {ctx.layout === 'kid' && g.firstOfDay ? <DayLine iso={m.created_at} /> : null}
              <ReactionStamp body={m.body} name={stampName(m)} mine={m.sender_id === meId} />
            </Fragment>
          );
        }
        const tail = g.messages[g.messages.length - 1];
        const isLast = g === lastGroup;
        const align = g.mine ? 'flex-end' : 'flex-start';
        // Their column stretches every bubble to its widest one (bible: a flex column with no
        // align-items); mine hug the right edge (align-items: flex-end).
        const items = g.mine ? 'flex-end' : 'stretch';
        const maxWidth = g.mine ? L.maxMine : L.maxTheirs;
        const who = senderOf(ctx, tail, g.mine);
        const holdsFocus = !!focusId && !!onFocusLayout && g.messages.some((m) => m.id === focusId);

        let stamp: string | null = null;
        let stampStrong = false;
        if (!tail.local) {
          if (ctx.layout === 'parent') {
            if (ringId && g.messages.some((m) => m.id === ringId)) {
              const q = g.messages.find((m) => m.id === ringId)!;
              stamp = t('messages.log.waiting', { when: relativeDay(q.created_at, {}, t) });
              stampStrong = true;
            } else {
              // A quiet line that opened the day passes the day down to here (chatGroups showsDay).
              stamp = g.showsDay ? chatStamp(tail.created_at, undefined, t) : clock(tail.created_at, t);
            }
          } else {
            stamp = clock(tail.created_at, t);
          }
          if (isLast && g.mine) stamp = t('messages.log.sent', { time: stamp });
        }

        return (
          <Fragment key={g.key}>
            {ctx.layout === 'kid' && g.firstOfDay ? <DayLine iso={g.messages[0].created_at} /> : null}
            <View
              style={[styles.group, { alignSelf: align, alignItems: items, maxWidth }]}
              onLayout={holdsFocus ? (e) => reportFocus('group', e.nativeEvent.layout.y) : undefined}>
              {ctx.circle && !g.mine && who ? (
                <View style={styles.who}>
                  <Avatar profile={who} size={24} />
                  <Txt variant="label" size={13} weight={700} color={colors.muted} numberOfLines={1}>
                    {who.name}
                  </Txt>
                </View>
              ) : null}
              {g.messages.map((m) => {
                const pop = !!m.local || (!!animateAfter && !g.mine && m.created_at > animateAfter);
                // 1:1: only when the answer isn't right under the question (e.g. "Answer this" on an older one).
                const answerer = ctx.circle
                  ? m.kind === 'question'
                    ? answered.get(m.id)
                    : undefined
                  : isServerQuestion(m, true) && nextOf.get(m.id)?.reply_to !== m.id
                    ? answered.get(m.id)
                    : undefined;
                const answererName = answerer
                  ? (ctx.profile?.(answerer)?.name ?? (ctx.circle ? null : (ctx.other?.name ?? null)))
                  : null;
                const openForMe = cookView && !g.mine && isServerQuestion(m, !ctx.circle) && !answered.has(m.id) && m.id !== ringId;
                return (
                  <Animated.View
                    key={m.localId ?? m.id}
                    entering={pop ? bubblePop : undefined}
                    onLayout={holdsFocus && m.id === focusId ? (e) => reportFocus('item', e.nativeEvent.layout.y) : undefined}
                    style={[styles.item, { alignItems: items }]}>
                    <MessageBody m={m} ctx={ctx} mine={g.mine} ring={m.id === ringId} dish={withDish.has(m)} />
                    {(under.get(m.id) ?? []).map((r) => (
                      <ReactionStamp
                        key={r.id}
                        body={r.body}
                        name={stampName(r)}
                        mine={r.sender_id === meId}
                        style={{ alignSelf: g.mine ? 'flex-end' : 'flex-start' }}
                      />
                    ))}
                    {m.local ? <LocalStatus m={m} onRetry={onRetry} onDiscard={onDiscard} /> : null}
                    {answerer ? (
                      <Status
                        mine={g.mine}
                        done
                        text={
                          answerer === meId
                            ? t('messages.log.answeredByYou')
                            : answererName != null
                              ? t('messages.log.answeredBy', { name: answererName })
                              : ctx.circle
                                ? t('messages.log.answeredByFamily')
                                : t('messages.log.answeredByThem')
                        }
                      />
                    ) : null}
                    {openForMe && onAnswer ? (
                      <LinkStatus mine={false} label={t('messages.log.answerThis')} onPress={() => onAnswer(m)} />
                    ) : null}
                    {m.saved_to_recipe && g.mine && m.note_id && onUndoSave ? (
                      <SavedUndo m={m} onUndo={onUndoSave} />
                    ) : m.saved_to_recipe ? (
                      <Status mine={g.mine} done text={t('messages.log.saved')} />
                    ) : null}
                    {cookView && g.mine && onSave && savable(m, byId) ? <SaveLink m={m} onSave={onSave} /> : null}
                  </Animated.View>
                );
              })}
              {stamp ? (
                <Txt
                  variant="tiny"
                  size={L.time}
                  weight={stampStrong ? 700 : 400}
                  color={stampStrong ? colors.ink : colors.muted}
                  align={g.mine ? 'right' : 'left'}
                  style={g.mine ? null : styles.intrinsic}>
                  {stamp}
                </Txt>
              ) : null}
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}

function DayLine({ iso }: { iso: string }) {
  const { t } = useWords();
  return (
    <Txt variant="caption" weight={600} align="center" accessibilityRole="header">
      {chatDay(iso, undefined, t)}
    </Txt>
  );
}

function MessageBody({ m, ctx, mine, ring, dish }: { m: ChatMessage; ctx: BubbleContext; mine: boolean; ring: boolean; dish: boolean }) {
  const { t } = useWords();
  const body = (m.body ?? '').trim();
  const dim = m.local === 'sending';
  const tone = toneFor(ctx, m, mine);
  const attachment = dish ? <DishAttachment m={m} ctx={ctx} /> : undefined;
  switch (m.kind) {
    case 'voice':
      return <VoiceBubble m={m} ctx={ctx} mine={mine} attachment={attachment} />;
    case 'question': {
      const spoken = !body && (!!m.audio_url || !!m.duration_s);
      return spoken ? (
        <VoiceBubble m={m} ctx={ctx} mine={mine} ring={ring} attachment={attachment} />
      ) : (
        <TextBubble
          text={body || (m.transcript ?? '').trim()}
          layout={ctx.layout}
          mine={mine}
          ring={ring}
          dim={dim}
          tone={tone}
          attachment={attachment}
        />
      );
    }
    case 'recipe':
      return <RecipeBubble m={m} ctx={ctx} mine={mine} />;
    case 'cooked':
      return <CookedBubble m={m} ctx={ctx} mine={mine} />;
    case 'step':
      return body ? (
        <>
          <StepChip m={m} ctx={ctx} mine={mine} />
          <TextBubble text={body} layout={ctx.layout} mine={mine} ring={ring} dim={dim} tone={tone} />
        </>
      ) : (
        <StepChip m={m} ctx={ctx} mine={mine} asBubble ring={ring} />
      );
    case 'request':
      return (
        <>
          <KindLabel layout={ctx.layout} mine={mine}>
            {t('messages.log.request')}
          </KindLabel>
          <TextBubble text={body} layout={ctx.layout} mine={mine} ring={ring} dim={dim} tone={tone} attachment={attachment} />
        </>
      );
    default:
      return body || attachment ? (
        <TextBubble text={body} layout={ctx.layout} mine={mine} ring={ring} dim={dim} tone={tone} attachment={attachment} />
      ) : null;
  }
}

/** "✓ Answered by Dad" / "✓ Saved to the recipe". */
function Status({ text, mine, done }: { text: string; mine: boolean; done?: boolean }) {
  return (
    <View style={[styles.status, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
      {done ? <CheckIcon size={13} strokeWidth={3} color={colors.green} /> : null}
      <Txt variant="tiny" size={13} weight={700} color={colors.green}>
        {text}
      </Txt>
    </View>
  );
}

function LinkStatus({ label, mine, onPress }: { label: string; mine: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={[styles.link, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
      <Txt variant="label" size={14} weight={700} color={colors.yolkDeep}>
        {label}
      </Txt>
    </PressableScale>
  );
}

/** "✓ Saved to the recipe · Undo" under my own saved message. */
function SavedUndo({ m, onUndo }: { m: ChatMessage; onUndo: (m: ChatMessage) => Promise<void> }) {
  const { t } = useWords();
  const [busy, setBusy] = useState(false);
  const undo = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onUndo(m);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[styles.status, { alignSelf: 'flex-end' }]}>
      <CheckIcon size={13} strokeWidth={3} color={colors.green} />
      <Txt variant="tiny" size={13} weight={700} color={colors.green}>
        {t('messages.log.savedDot')}
      </Txt>
      <PressableScale
        onPress={undo}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('messages.log.undo')}
        accessibilityHint={t('messages.log.undoHint')}
        hitSlop={12}
        style={styles.undo}>
        {busy ? <ActivityIndicator size="small" color={colors.yolkDeep} /> : null}
        <Txt variant="label" size={13} weight={700} color={colors.yolkDeep} style={styles.underline}>
          {t('messages.log.undo')}
        </Txt>
      </PressableScale>
    </View>
  );
}

function SaveLink({ m, onSave }: { m: ChatMessage; onSave: (m: ChatMessage) => Promise<void> }) {
  const { t } = useWords();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(m);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PressableScale
      onPress={save}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={t('messages.log.saveToRecipe')}
      accessibilityHint={t('messages.log.saveHint')}
      hitSlop={8}
      style={[styles.link, { alignSelf: 'flex-end' }]}>
      {busy ? <ActivityIndicator size="small" color={colors.yolkDeep} /> : null}
      <Txt variant="label" size={14} weight={700} color={colors.yolkDeep}>
        {t('messages.log.saveToRecipe')}
      </Txt>
    </PressableScale>
  );
}

function LocalStatus({
  m,
  onRetry,
  onDiscard,
}: {
  m: ChatMessage;
  onRetry: (m: ChatMessage) => void;
  onDiscard: (m: ChatMessage) => void;
}) {
  const { t } = useWords();
  if (m.local === 'sending') {
    return (
      <Txt variant="tiny" align="right">
        {t('messages.log.sending')}
      </Txt>
    );
  }
  return (
    <View style={styles.failed}>
      <PressableScale onPress={() => onRetry(m)} accessibilityLabel={t('messages.log.didntSendLabel')} hitSlop={8}>
        <Txt variant="tiny" weight={700} color={colors.danger}>
          {t('messages.log.didntSend')}
        </Txt>
      </PressableScale>
      <PressableScale onPress={() => onDiscard(m)} accessibilityLabel={t('messages.log.removeLabel')} hitSlop={8}>
        <Txt variant="tiny" weight={600}>
          {t('messages.log.remove')}
        </Txt>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  item: { gap: 6, maxWidth: '100%' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  system: { alignSelf: 'center', maxWidth: 300, paddingVertical: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 20 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 20 },
  underline: { textDecorationLine: 'underline' },
  failed: { flexDirection: 'row', gap: 12, alignItems: 'center', alignSelf: 'flex-end' },
  intrinsic: { alignSelf: 'flex-start' },
});

// One conversation, about anything. Layout follows who is reading:
//  learner -> bible Kid-Chat: round back + 40 avatar + name (Fraunces 24), lavender/peach bubbles,
//             composer (field + round ink mic). A dish picked on the way in (Ask sheet, a step, the
//             ingredients) waits in the composer as a removable attachment; the next message goes
//             out as a question carrying it (recipe_id) and shows it as a card in the chat.
//  cook    -> bible Parent-Chat: "< Back" pill, avatar + name on the right, the question being
//             answered ringed in sun, and the big "Tap to talk" panel.
// The family circle (kind 'circle'): stacked faces + "Family" (tap: everyone, with a "Message" pill
// each); a learner's message is a question when it carries a dish or reads as one ("?", or
// "how…", "can…"; a "hello" or a voice note without a dish is a plain message); a cook's message
// answers a question (reply_to, which saves the answer into that question's recipe) only when they
// came for it (?q=, an Answer button) or tapped "Answer this" on it. Otherwise it goes to everyone
// ("Write to the family"). A cook can also "Save to recipe" any of their own dish messages.
// 1:1 chats: a learner's message with a dish attached, their first message after the Ask sheet
// (ask=1) and any message ending in "?" (unless it's answering theirs) is a question for the other
// person; their reply (reply_to) answers it, and a cook's answer to a dish question is saved into
// the recipe, like the circle. The newest open question is answered on its own here, unless the ×
// on the strip cancels it.
// A cook who comes to ask (a step's "Ask Dad": ask=1 with a dish) gets the dish in the box too, and
// that message goes out as a question with its recipe_id and step_order, like a learner's.
// Whenever the next message answers something, "Answering Leo: …" is pinned above the composer.
// Params: id = thread id; recipe / step = the dish (and step) to attach; q = the question to answer
// (Answer buttons: the chat opens with it in the upper third of the screen, ringed, instead of at
// the bottom); ask=1 = the next message is a question (Ask sheet); request=1 = the first message
// asks the cook to teach a dish; noread=1 = don't mark read (dev screenshots). Polls every 3 s.
// A 1:1 with someone who was removed from the family stays readable, with one line where the
// composer was ("Dad isn't in the family anymore."): the server takes no new messages for them.
// A lent phone (its owner cooking as someone without a phone): the box reads "Grandma: write to
// Priya" with Grandma's face in it, so it's clear whose name a message goes out under.
// The Sunday table (RETENTION-HANDOFF 3.2), 1:1 only: a kid & cook who keep showing up for each other
// see a small flame and "6 weeks" under the other's name (GET /table sends a pair only to its two
// people; nothing for 0 or while an ember shows), and at 4, 12, 26 & 52 weeks a one-time burst
// ("12 weeks at the table with Mom") the next time either opens the chat (MilestoneBurst; it never
// takes a touch). Never with a memorial cook (the server keeps no pair with them).
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AnswerPanel,
  answeredBy,
  AnsweringStrip,
  ChatLog,
  CircleFaces,
  dishInfo,
  isServerQuestion,
  KidComposer,
  MembersSheet,
  openCircleQuestions,
  questionWords,
  readsAsQuestion,
  useChatRecipes,
  useDishLookup,
  waitingQuestion,
  type Answering,
  type BubbleContext,
  type ChatLayout,
} from '@/components/messages';
import { MilestoneBurst } from '@/components/table/MilestoneBurst';
import { WeeksBadge } from '@/components/table/WeeksBadge';
import { ActionButton, Avatar, BackIcon, BackPill, IconButton, PressableScale, Skeleton, ToastViewport, Txt, useToast } from '@/components/ui';
import { errorMessage, type NewMessage } from '@/lib/api';
import { stopAudio } from '@/lib/media';
import { removeNote, saveToRecipe, useKnownSenders, useThread, type ChatMessage, type VoiceExtra } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { pairWith, weeksOf } from '@/lib/sundayTable';
import { useTable } from '@/lib/tableApi';
import type { VoiceRecording } from '@/lib/voice';
import { colors, space } from '@/theme/tokens';

/** The log's top padding (kid / parent), where ChatLog's own positions start. */
const LOG_TOP_KID = 18;
const LOG_TOP_PARENT = 28;

/** A short acknowledgement after an answer (a plain reply in the circle, not a new question). */
const ACK = /^(thanks?|thank you|thx|ty|ok(ay)?|got it|cool|yum|perfect|great|nice|love (it|you)|will do)\b/i;

export default function ChatScreen() {
  const params = useLocalSearchParams<{
    id: string;
    recipe?: string;
    step?: string;
    q?: string;
    ask?: string;
    request?: string;
    noread?: string;
  }>();
  const threadId = typeof params.id === 'string' ? params.id : null;
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { me, owner, profiles, profileById } = useSession();
  // The phone is lent: its owner is writing as someone without a phone of their own.
  const lentTo = me && owner && me.id !== owner.id ? me : null;
  // `?noread=1` (screenshots / demos) looks without marking the thread read.
  const chat = useThread(threadId, { markRead: params.noread !== '1' });
  const { entry } = useDishLookup();
  const layout: ChatLayout = me?.role === 'cook' ? 'parent' : 'kid';
  const circle = chat.kind === 'circle';
  const other = chat.other;
  // Our weeks at the table (a kid & cook pair only; null otherwise, and in the circle).
  const { table } = useTable({ enabled: !circle });
  const pair = circle ? null : pairWith(table, me?.id, other?.id);

  // A voice note stops when you leave the chat (back, or into a recipe from a dish card).
  useFocusEffect(useCallback(() => () => stopAudio(), []));

  // The dish (and step) picked on the way in rides on the learner's next message, until they take it off.
  // Anyone can attach one with the composer's "+" (`picked`); a new pick replaces the one before.
  // `ask`: it came with ask=1 (a step's "Ask Dad"), so a cook asks with it too.
  const [attached, setAttached] = useState<{ id: string; step: number | null; picked?: boolean; ask?: boolean } | null>(() => {
    const id = typeof params.recipe === 'string' && params.recipe ? params.recipe : null;
    const n = Number.parseInt(String(params.step ?? ''), 10);
    return id ? { id, step: Number.isFinite(n) && n > 0 ? n : null, ask: params.ask === '1' } : null;
  });
  const attachment = layout === 'kid' || attached?.picked || attached?.ask ? attached : null;
  /** This dish rides on a question (a learner's dish, or one a cook came to ask about). */
  const asksAbout = (dish: typeof attachment): dish is NonNullable<typeof attachment> => !!dish && (layout === 'kid' || !!dish.ask);
  const attach = (id: string) => setAttached({ id, step: null, picked: true });

  // Circle: which questions are still open, and the one a cook's next message answers: only the
  // one they tapped ("Answer this") or came for (?q=). Never a guess, so a hello is never filed as
  // an answer. Unsent replies don't count: while mine is sending (or failed), the question stays.
  const isCook = (id: string) => profileById(id)?.role === 'cook';
  const answered = answeredBy(chat.messages, isCook);
  const openQs = circle ? openCircleQuestions(chat.messages, me?.id, answered) : [];
  const [chosenQ, setChosenQ] = useState<string | null>(typeof params.q === 'string' && params.q ? params.q : null);
  const target = circle && layout === 'parent' ? (openQs.find((q) => q.id === chosenQ) ?? null) : null;
  const asker = target ? profileById(target.sender_id) : null;

  // Pair: the question my next message answers: the one I came for (?q=, from a Waiting card) while
  // it's still open, else the newest thing they asked with nothing from me after it (unless I
  // cancelled that one with the strip's ×).
  const pairAnswered = circle ? null : answeredBy(chat.messages, isCook, { pair: true });
  const chosenPair =
    !circle && chosenQ
      ? (chat.messages.find((m) => m.id === chosenQ && m.sender_id !== me?.id && isServerQuestion(m, true) && !pairAnswered?.has(m.id)) ?? null)
      : null;
  const [dropped, setDropped] = useState<string | null>(null);
  const waiting = circle ? null : waitingQuestion(chat.messages, me?.id);
  const open = circle ? null : (chosenPair ?? (waiting && waiting.id !== dropped ? waiting : null));
  // Pair replies are tagged with a dish only when we know that's what they answer.
  const replyRecipe = open?.recipe_id ?? null;
  // Pair, learner: the next message is a question (came from "Ask about a dish").
  const [askPending, setAskPending] = useState(params.ask === '1');
  const recipes = useChatRecipes([attachment?.id, ...chat.messages.map((m) => m.recipe_id)]);
  const [requestMode, setRequestMode] = useState(params.request === '1' && !circle);

  // Messages from others that arrive after the first load pop in.
  const [baseline, setBaseline] = useState<string | null>(null);
  if (!chat.loading && baseline === null) {
    const last = chat.messages.filter((m) => !m.local).pop();
    setBaseline(last?.created_at ?? '');
  }

  // Keep the newest message in view (unless someone scrolled up to read). Opened for a question
  // (?q=), the first scroll puts that question in the upper third instead (once its place is known).
  const scroller = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const firstScroll = useRef(true);
  const viewH = useRef(0);
  const { height: winH } = useWindowDimensions();
  const focusId = typeof params.q === 'string' && params.q ? params.q : null;
  const focusDone = useRef(false);
  const waitForFocus = !!focusId && chat.messages.some((m) => m.id === focusId);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    nearBottom.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
  };
  const onContentSize = () => {
    if (firstScroll.current && waitForFocus && !focusDone.current) return;
    if (firstScroll.current || nearBottom.current) {
      scroller.current?.scrollToEnd({ animated: !firstScroll.current });
      if (!chat.loading) firstScroll.current = false;
    }
  };
  const onFocusLayout = (y: number) => {
    if (focusDone.current || !firstScroll.current) return;
    focusDone.current = true;
    firstScroll.current = false;
    nearBottom.current = false;
    const top = (layout === 'kid' ? LOG_TOP_KID : LOG_TOP_PARENT) + y;
    const h = viewH.current || winH * 0.6;
    requestAnimationFrame(() => scroller.current?.scrollTo({ y: Math.max(0, top - h / 3), animated: false }));
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else if (me) router.replace(me.role === 'cook' ? '/parent/messages' : '/kid/ask');
    else router.replace('/');
  };

  /**
   * A learner in the circle asks when the words read as a question (a "?", or "how / what / can /
   * should / do…", since kids often leave the "?" off); a "hello" is a plain message, so it never
   * lands on a cook's Home as "asked you". A short acknowledgement ("thanks", "got it") right after
   * a cook answered one of my questions replies to that answer.
   */
  const kidCircleThanks = (): ChatMessage | null => {
    const last = [...chat.messages].reverse().find((m) => m.kind !== 'system' && m.kind !== 'reaction' && !m.local);
    if (!last || last.sender_id === me?.id || !last.reply_to || !isCook(last.sender_id)) return null;
    const q = chat.messages.find((m) => m.id === last.reply_to);
    return q && q.sender_id === me?.id ? last : null;
  };

  /**
   * What a reply answers (circle: the target; pair: their open question) and the dish it names. A
   * cook's attached dish rides along, except on an answer to a question about another dish: the
   * server files an answer under the message's own dish, so that answer keeps the question's dish and
   * the attached one is `held` for the next message.
   */
  const replyFields = (dish: { id: string } | null) => {
    const reply_to = circle ? (target?.id ?? null) : replyTarget();
    const about = circle ? (target?.recipe_id ?? null) : replyRecipe;
    const held = !!dish && !!reply_to && !!about && about !== dish.id;
    return { fields: { reply_to, recipe_id: dish && !held ? dish.id : about }, held };
  };
  /** Sent with the dish: it comes off the composer (unless it was held back, see replyFields). */
  const afterDish = (dish: { id: string } | null, held: boolean) => {
    if (!dish) return;
    if (!held) return setAttached(null);
    toast.show(`Sent as your answer. ${composerDish?.title ?? 'The dish'} is still attached.`, { tone: 'info' });
  };

  const sendText = (body: string) => {
    nearBottom.current = true;
    const dish = attachment;
    const reply = replyFields(layout === 'parent' && !asksAbout(dish) ? dish : null);
    let msg: NewMessage;
    if (requestMode) msg = { kind: 'request', body, recipe_id: dish?.id ?? null };
    else if (asksAbout(dish)) {
      // A question about the attached dish, so the answer is saved into that recipe.
      msg = { kind: 'question', body, recipe_id: dish.id, step_order: dish.step };
    } else if (circle && layout === 'kid') {
      const t = body.trim();
      const thanks = t.length <= 40 && ACK.test(t) && !t.includes('?') ? kidCircleThanks() : null;
      msg = thanks ? { kind: 'text', body, reply_to: thanks.id } : readsAsQuestion(t) ? { kind: 'question', body } : { kind: 'text', body };
    } else if (circle) {
      msg = { kind: 'text', body, ...reply.fields };
    } else if (layout === 'kid' && (askPending || (!replyTarget() && /\?\s*$/.test(body.trim())))) {
      // While the strip says "Answering Mom", a "?" is a reply to her, not a new question.
      msg = { kind: 'question', body };
    } else {
      msg = { kind: 'text', body, ...reply.fields };
    }
    chat.send(msg);
    if (requestMode) setRequestMode(false);
    if (askPending) setAskPending(false);
    afterDish(dish, reply.held);
  };
  const sendVoice = (rec: VoiceRecording) => {
    nearBottom.current = true;
    const dish = attachment;
    const reply = replyFields(layout === 'parent' && !asksAbout(dish) ? dish : null);
    let extra: VoiceExtra;
    if (asksAbout(dish)) extra = { kind: 'question', recipe_id: dish.id, step_order: dish.step };
    // A learner's voice note to the family without a dish: we can't tell it asks, so a plain note.
    else if (circle && layout === 'kid') extra = {};
    else if (circle) extra = reply.fields;
    else if (layout === 'kid' && askPending) extra = { kind: 'question' };
    else extra = reply.fields;
    chat.sendVoice(rec, extra);
    if (askPending) setAskPending(false);
    afterDish(dish, reply.held);
  };
  /**
   * Pair: answering their question links the reply to it, so it counts as the answer (a cook's
   * answer about a dish is saved into the recipe; "Save to recipe" quotes it).
   */
  function replyTarget(): string | null {
    return open && isServerQuestion(open, true) ? open.id : null;
  }

  const onUndoSave = async (m: ChatMessage) => {
    const q = m.reply_to ? chat.messages.find((x) => x.id === m.reply_to) : null;
    if (!m.note_id) return;
    try {
      // The recipe whose notes to refresh ('' when its question isn't loaded here).
      await removeNote({ id: m.note_id, recipe_id: m.recipe_id ?? q?.recipe_id ?? '', answer_message_id: m.id });
      toast.show('Taken out of the recipe', { tone: 'success' });
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t undo that. Try again.'), { tone: 'error' });
    }
  };

  // TODO(caleb): saved answers show nowhere in the app since round 2 (components/recipe/FamilyNotes.tsx).
  const onSave = async (m: ChatMessage) => {
    if (!threadId) return;
    try {
      await saveToRecipe(threadId, m.id);
      toast.show('Saved to the recipe', { tone: 'success' });
    } catch (e) {
      toast.show(errorMessage(e, 'Couldn’t save that. Try again.'), { tone: 'error' });
    }
  };

  // The question the next message answers, pinned above the composer with a × to cancel it.
  // A next message that asks answers nothing, so no strip (or ring) then: a learner's request,
  // first message after the Ask sheet or one with a dish, and a cook's from a step's "Ask Dad".
  const nextAsks = (layout === 'kid' && (requestMode || askPending)) || asksAbout(attachment);
  const answeringMsg = nextAsks ? null : circle ? target : open && replyTarget() ? open : null;
  const answering: Answering | null = answeringMsg
    ? {
        who: profileById(answeringMsg.sender_id) ?? (circle ? null : other),
        words: questionWords(answeringMsg),
        onCancel: () => {
          setChosenQ(null);
          // Pair: drop the newest one too, so the strip doesn't jump to it after cancelling an older one.
          if (!circle) setDropped(waiting?.id ?? answeringMsg.id);
        },
      }
    : null;

  const ctx: BubbleContext = { layout, me, other, entry, recipes, circle, members: chat.members, profile: profileById };
  // Someone the family list doesn't know yet wrote (they just joined): fetch the family once.
  useKnownSenders(circle ? chat.messages.filter((m) => !chat.members.some((p) => p.id === m.sender_id)).map((m) => m.sender_id) : []);
  const name = circle ? 'Family' : (other?.name ?? '');
  const headerTop = Math.max(space.topDetail, insets.top + 9);
  const composerDish = attachment ? { ...dishInfo(ctx, attachment.id, attachment.step), id: attachment.id } : null;
  const [membersOpen, setMembersOpen] = useState(false);
  const faces = circle ? <CircleFaces members={chat.members} me={me} size={40} /> : other ? <Avatar profile={other} size={40} /> : <Skeleton circle height={40} />;
  // The circle's header (faces + "Family") opens everyone in it.
  const who = (children: ReactNode, style: StyleProp<ViewStyle>) =>
    circle ? (
      <PressableScale
        onPress={() => setMembersOpen(true)}
        scaleTo={0.97}
        accessibilityRole="button"
        accessibilityLabel="Family"
        accessibilityHint="Shows everyone, with a button to message each person"
        style={style}>
        {children}
      </PressableScale>
    ) : (
      <View style={style}>{children}</View>
    );

  const notFound = chat.gone || (!chat.loading && !chat.messages.length && !!chat.error && !other);
  // They were removed (the inbox says so, or they're only among former family now).
  const otherGone =
    !circle && !!other && (other.removed === true || (profiles.length > 0 && !profiles.some((p) => p.id === other.id) && !!profileById(other.id)));

  const log = chat.loading ? (
    <ChatSkeleton />
  ) : notFound ? (
    <EmptyNote text="We couldn’t open this conversation." />
  ) : chat.messages.length ? (
    <ChatLog
      messages={chat.messages}
      ctx={ctx}
      animateAfter={baseline || null}
      onRetry={chat.retry}
      onDiscard={chat.discard}
      target={nextAsks ? null : circle ? (target?.id ?? null) : layout === 'parent' ? (open?.id ?? null) : null}
      onAnswer={(m) => {
        setChosenQ(m.id);
        setDropped(null);
        // A cook who came to ask (a step's "Ask Dad") and taps "Answer this" is answering now:
        // the asked-about dish comes off, so the reply goes out as their answer, not a question.
        if (layout === 'parent' && attached?.ask) setAttached(null);
      }}
      onSave={onSave}
      onUndoSave={onUndoSave}
      focusId={focusId}
      onFocusLayout={onFocusLayout}
    />
  ) : layout === 'kid' && attachment && !requestMode ? null /* the attached dish and the placeholder say it */ : layout === 'kid' ? (
    <EmptyNote
      text={
        requestMode
          ? `Tell ${name || 'them'} which dish you miss.`
          : circle
            ? 'Ask the family anything.'
            : `Ask ${name || 'them'} anything.`
      }
    />
  ) : (
    <EmptyNote text={circle ? 'Say hello to the family.' : `Say hello to ${name || 'them'}.`} />
  );

  const placeholder = requestMode
    ? `What should ${name || 'they'} teach you?`
    : attachment
      ? attachment.step
        ? `Ask about step ${attachment.step}`
        : 'Ask about this dish'
      : lentTo
        ? `${lentTo.name}: write to ${circle ? 'the family' : name || 'them'}`
        : circle
          ? 'Ask the family'
          : `Message ${name || 'them'}`;
  // The cook's box: who the message goes to ("Write to the family", "Write to Leo" while answering,
  // "Message Priya" in a 1:1), and on a lent phone whose name it goes out under.
  const answerTo = circle ? (asker?.name ?? 'the family') : name || 'them';
  const answerPrompt = lentTo ? `${lentTo.name}: write to ${answerTo}` : circle ? `Write to ${answerTo}` : `Message ${answerTo}`;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: name ? `${name} · homecookd` : 'Messages' }} />

      {layout === 'kid' ? (
        <View style={[styles.kidHeader, { paddingTop: headerTop }]}>
          <View style={styles.kidTop}>
            <IconButton icon={<BackIcon size={22} color={colors.ink} strokeWidth={2.2} />} accessibilityLabel="Back" onPress={goBack} />
            {who(
              <>
                {faces}
                <View style={styles.shrink}>
                  <Txt variant="chatName" numberOfLines={1} accessibilityRole="header">
                    {name}
                  </Txt>
                  <WeeksBadge weeks={weeksOf(pair)} />
                </View>
              </>,
              styles.kidWho,
            )}
          </View>
        </View>
      ) : (
        <View style={[styles.parentHeader, { paddingTop: headerTop }]}>
          <BackPill onPress={goBack} />
          <View style={styles.flex} />
          {who(
            <>
              {faces}
              <View style={styles.parentName}>
                <Txt variant="chatName" numberOfLines={1} accessibilityRole="header">
                  {name}
                </Txt>
                <WeeksBadge weeks={weeksOf(pair)} />
              </View>
            </>,
            styles.parentWho,
          )}
        </View>
      )}

      <View style={styles.flex}>
        <ScrollView
          ref={scroller}
          style={styles.flex}
          contentContainerStyle={[styles.logPad, layout === 'kid' ? styles.logKid : styles.logParent]}
          onScroll={onScroll}
          onLayout={(e) => {
            viewH.current = e.nativeEvent.layout.height;
          }}
          scrollEventThrottle={64}
          onContentSizeChange={onContentSize}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          {log}
        </ScrollView>
        {/* Messages fade softly under the header and the composer. */}
        <LinearGradient pointerEvents="none" colors={[colors.page, 'rgba(247,247,242,0)']} style={[styles.fade, styles.fadeTop]} />
        <LinearGradient pointerEvents="none" colors={['rgba(247,247,242,0)', colors.page]} style={[styles.fade, styles.fadeBottom]} />
      </View>

      {notFound ? (
        <View style={[styles.composer, { paddingBottom: Math.max(28, insets.bottom + 8) }]}>
          <ActionButton label="Back to messages" variant="ink" onPress={goBack} />
        </View>
      ) : otherGone ? (
        <View style={[styles.composer, styles.goneLine, { paddingBottom: Math.max(28, insets.bottom + 8) }]}>
          <Txt variant="meta" align="center">
            {other?.name ?? 'They'} isn’t in the family anymore.
          </Txt>
        </View>
      ) : layout === 'kid' ? (
        <View style={[styles.composer, styles.kidComposer, { paddingBottom: Math.max(28, insets.bottom + 8) }]}>
          {answering ? <AnsweringStrip answering={answering} /> : null}
          <KidComposer
            placeholder={placeholder}
            face={lentTo}
            attachment={composerDish}
            onRemoveAttachment={() => setAttached(null)}
            onAttach={attach}
            onSendText={sendText}
            onSendVoice={sendVoice}
          />
        </View>
      ) : (
        <AnswerPanel
          otherName={circle ? (asker?.name ?? 'the family') : name || 'They'}
          personId={me?.id}
          prompt={answerPrompt}
          face={lentTo}
          answering={answering}
          attachment={composerDish}
          onRemoveAttachment={() => setAttached(null)}
          onAttach={attach}
          onSendText={sendText}
          onSendVoice={sendVoice}
        />
      )}
      <ToastViewport position="top" />
      {pair ? <MilestoneBurst meId={me?.id} pair={pair} otherName={other?.name ?? ''} /> : null}
      {circle ? <MembersSheet visible={membersOpen} onClose={() => setMembersOpen(false)} members={chat.members} /> : null}
    </KeyboardAvoidingView>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <Animated.View entering={FadeIn.duration(240)} style={styles.empty}>
      <Txt variant="body" size={15} leading={1.45} align="center">
        {text}
      </Txt>
    </Animated.View>
  );
}

function ChatSkeleton() {
  return (
    <View style={styles.skel} accessibilityLabel="Loading messages">
      <Skeleton width={220} height={64} radius={20} style={styles.right} />
      <Skeleton width={250} height={64} radius={20} />
      <Skeleton width={180} height={48} radius={20} style={styles.right} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  // Above the scroll view and its fade, so the back circle keeps its whole shadow.
  kidHeader: { paddingHorizontal: space.gutter, position: 'relative', zIndex: 2 },
  kidTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kidWho: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch' },
  parentWho: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  parentHeader: {
    position: 'relative',
    zIndex: 2,
    paddingHorizontal: space.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  parentName: { flexShrink: 1 },
  logPad: { paddingHorizontal: space.gutter, paddingBottom: 20 },
  logKid: { paddingTop: LOG_TOP_KID },
  logParent: { paddingTop: LOG_TOP_PARENT },
  composer: { paddingHorizontal: space.gutter, paddingTop: 10 },
  kidComposer: { gap: 10 },
  goneLine: { paddingTop: 16 },
  empty: { paddingVertical: 40, paddingHorizontal: 16 },
  skel: { gap: 14, paddingTop: 8 },
  fade: { position: 'absolute', left: 0, right: 0, height: 16 },
  fadeTop: { top: 0, height: 24 },
  fadeBottom: { bottom: 0 },
  right: { alignSelf: 'flex-end' },
});

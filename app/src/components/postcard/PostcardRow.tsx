// The cook's "Leo made your Sunday Chili" row once it carries a postcard (retention PR 3,
// RETENTION-HANDOFF 3.4), on Parent Home's updates card:
//
//   (Leo)  Leo made your Sunday Chili                      (x)
//   ┌──────────────────────────────────────────┐
//   │        Leo's photo (tilted ≤ 1.5°)         │  [Just like mine] stamp once sent
//   └──────────────────────────────────────────┘
//   How close to yours  ● ● ● ● ○                (only when Leo rated it)
//   [   Just like mine   ]   [ (mic) Hold to talk ]
//
// The words open my recipe and the x clears the row, as on the plain "made it" row. "Just like mine"
// sends a `reaction` answering Leo's cooked card (a medium haptic at once, then the stamp lands on the
// photo with a success haptic; it stays sent, disabled, here and on the next visit). "Hold to talk"
// records a voice reply in place and sends it in our 1:1 answering the card (HoldToTalk). A card in the
// family circle (older builds sent them there) keeps its stamp under it in the circle, but the voice
// reply still goes to our 1:1, as a plain voice note (a reply can only point at a message in its own
// thread). Leo gets a push for each (the server's). Nothing here speaks for me: the words are mine to tap.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Avatar, CheckIcon, CloseIcon, haptic, PressableScale, Txt, useToast } from '@/components/ui';
import { errorMessage, type Message, type Profile } from '@/lib/api';
import { openChatWith, sendJustLikeMine, sendVoiceReply } from '@/lib/messaging';
import type { VoiceRecording } from '@/lib/voice';
import { colors, space } from '@/theme/tokens';

import { keepSent, refetchKitchenThread } from '../parent/kitchen';
import { HoldToTalk } from './HoldToTalk';
import { LikeStamp, PostcardPhoto } from './PostcardPhoto';
import { RatingLine } from './RatingPots';

type LikeState = 'idle' | 'sending' | 'sent' | 'error';

export function PostcardRow({
  who,
  title,
  recipeId,
  message,
  threadId,
  circle = false,
  meId,
  liked,
  onClear,
  onGo,
}: {
  who: Profile;
  /** "Leo made your Sunday Chili". */
  title: string;
  recipeId: string;
  /** Their `cooked` card, with `photo_url` (and maybe `rating`). */
  message: Message;
  threadId: string;
  /** The card is in the family circle: the voice reply goes to our 1:1 instead (no reply_to). */
  circle?: boolean;
  meId: string;
  /** I already answered this card "Just like mine". */
  liked: boolean;
  onClear: () => void;
  /** Runs before the words leave for my recipe (the "All updates" sheet closes). */
  onGo?: () => void;
}) {
  const toast = useToast();
  const [like, setLike] = useState<LikeState>(liked ? 'sent' : 'idle');
  const [landed, setLanded] = useState(false);
  if (liked && like === 'idle') setLike('sent');
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (errTimer.current) clearTimeout(errTimer.current);
    },
    [],
  );

  const sendLike = async () => {
    if (like === 'sending' || like === 'sent') return;
    setLike('sending');
    try {
      const saved = await sendJustLikeMine(threadId, message);
      keepSent(meId, threadId, saved);
      haptic('success');
      setLanded(true);
      setLike('sent');
      AccessibilityInfo.announceForAccessibility?.(`Sent to ${who.name}`);
    } catch (e) {
      haptic('error');
      toast.show(errorMessage(e, `Couldn’t send it to ${who.name}. Try again.`), { tone: 'error' });
      setLike('error');
      errTimer.current = setTimeout(() => setLike('idle'), 2400);
    }
  };

  // A photo that won't load is most often an expired signed URL (they last 1 h): fetch the thread
  // again, once per URL.
  const failedFor = useRef<string | null>(null);
  const photoFailed = () => {
    if (!message.photo_url || failedFor.current === message.photo_url) return;
    failedFor.current = message.photo_url;
    refetchKitchenThread(meId, threadId);
  };

  // Hold to talk: answering the card in our 1:1; a circle card's reply goes to our 1:1 on its own.
  const sendVoice = (rec: VoiceRecording) =>
    circle ? openChatWith(message.sender_id).then((chat) => sendVoiceReply(chat, rec, null)) : sendVoiceReply(threadId, rec, message.id);

  const sent = like === 'sent';
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <PressableScale
          onPress={() => {
            onGo?.();
            router.push({ pathname: '/my-recipe/[id]', params: { id: recipeId } });
          }}
          scaleTo={0.98}
          accessibilityLabel={title}
          accessibilityHint="Opens your recipe"
          style={styles.main}>
          <Avatar profile={who} size={40} />
          <Txt variant="rowTitle" leading={1.3} numberOfLines={2} style={styles.flex}>
            {title}
          </Txt>
        </PressableScale>
        <PressableScale
          onPress={() => {
            haptic('selection');
            onClear();
          }}
          hitSlop={8}
          accessibilityLabel={`Clear: ${title}`}
          style={styles.clear}>
          <CloseIcon size={16} strokeWidth={2.4} color={colors.muted} />
        </PressableScale>
      </View>

      <PostcardPhoto
        uri={message.photo_url}
        id={message.id}
        label={`${who.name}’s photo of the dish`}
        onError={photoFailed}
        stamp={sent ? <LikeStamp animate={landed} /> : null}
        style={styles.photo}
      />

      <RatingLine words="How close to yours" value={message.rating} size={20} style={styles.rating} />

      <View style={styles.actions}>
        <View style={styles.grow}>
          <PressableScale
            onPress={() => void sendLike()}
            haptic="medium"
            disabled={like === 'sending' || sent}
            accessibilityLabel={sent ? `Sent to ${who.name}: Just like mine` : `Tell ${who.name}: Just like mine`}
            accessibilityState={{ busy: like === 'sending', disabled: sent }}
            style={[styles.like, sent ? styles.likeSent : like === 'error' ? styles.likeError : null, like === 'sending' ? styles.dim : null]}>
            {sent ? <CheckIcon size={16} color={colors.muted} /> : null}
            <Txt variant="label" size={15} weight={700} color={sent ? colors.muted : colors.ink} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.words}>
              {sent ? 'Sent' : like === 'error' ? 'Try again' : 'Just like mine'}
            </Txt>
          </PressableScale>
        </View>
        <HoldToTalk toName={who.name} onSend={sendVoice} style={styles.grow} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  wrap: { paddingVertical: 8, gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  main: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  clear: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.well, alignItems: 'center', justifyContent: 'center' },
  // A little room each side so the tilted corners stay inside the card.
  photo: { marginHorizontal: 4, aspectRatio: 3 / 2 },
  rating: { paddingHorizontal: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // Two equal halves that never change size as their words change ("Sent", "Let go to send"): every
  // label fits half a 375-pt card; on a narrower phone the words shrink to fit (native). The padding
  // sits on the pills inside, so both halves start from the same zero.
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  like: {
    height: 52,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: colors.yolk,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  likeSent: { backgroundColor: colors.well },
  likeError: { backgroundColor: colors.yolkTint },
  dim: { opacity: 0.6 },
  words: { flexShrink: 1 },
});

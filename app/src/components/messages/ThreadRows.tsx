// Inbox rows for both inboxes (kid "Ask", parent "Messages"), laid out like an Instagram DM list:
// a 56 round avatar (the family circle: two stacked faces), the name (17) and ONE line under it,
// "preview · time" (15 muted). Unread: name + preview bold ink and a 10 pt green dot on the far
// right. No chevrons, pills, dish line or hairlines; rows sit on the page, 80 tall. The line is
// always the newest message and its time (mine too: "You: …"), so a sent hello shows at once.
// Circle senders come from the thread's members, then the family (former people included); an
// unknown one fetches the family once and shows no name meanwhile, never "Family".
// "New message" is the same shape: a tinted plus disc and its label.
import { StyleSheet, View } from 'react-native';

import { Avatar, PlusIcon, PressableScale, Txt } from '@/components/ui';
import type { Message, Profile, ThreadSummary } from '@/lib/api';
import { mmss } from '@/lib/format';
import { useKnownSenders } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import type { LibraryEntry } from '@/lib/types';
import { english, type T } from '@/lib/words/words';
import { useWords } from '@/lib/words/useWords';
import { colors, space } from '@/theme/tokens';

import { dishName, inboxTime } from './helpers';

type Lookup = (id: string | null | undefined) => LibraryEntry | null;

const AVATAR = 56;

/** One line of words for a thread's newest message ("You: …", circle "Leo: …"). */
export function previewText(
  m: Message,
  opts: { mine: boolean; entry: LibraryEntry | null; /** Circle: "Leo: …" */ senderName?: string | null },
  t: T = english,
): string {
  const name = opts.mine ? null : opts.senderName || null;
  const named = opts.mine || !!name;
  // "You: …" / "Leo: …" (no one named: the words alone).
  const you = (text: string) => (opts.mine ? t('messages.preview.you', { text }) : name ? t('messages.preview.from', { name, text }) : text);
  const dish = opts.entry ? dishName(opts.entry) : null;
  const body = (m.body ?? '').trim();
  const voice = you(m.duration_s ? t('messages.preview.voiceTime', { time: mmss(m.duration_s) }) : t('messages.preview.voice'));
  switch (m.kind) {
    case 'system':
      return body;
    case 'reaction':
      // Never a preview (the server never makes one a thread's newest message; this is the guard).
      return '';
    case 'voice':
      return voice;
    case 'question': {
      const q = body || (m.transcript ?? '').trim();
      return q ? you(q) : voice;
    }
    case 'recipe':
      if (body) return you(body);
      if (opts.mine) return dish != null ? t('messages.preview.youSent', { dish }) : t('messages.preview.youSentRecipe');
      if (named) return dish != null ? t('messages.preview.nameSent', { name, dish }) : t('messages.preview.nameSentRecipe', { name });
      return dish != null ? t('messages.preview.sentYou', { dish }) : t('messages.preview.sentYouRecipe');
    case 'cooked':
      if (body) return you(body);
      if (opts.mine) return dish != null ? t('messages.preview.youMade', { dish }) : t('messages.preview.youMadeRecipe');
      if (named) return dish != null ? t('messages.preview.nameMade', { name, dish }) : t('messages.preview.nameMadeRecipe', { name });
      return dish != null ? t('messages.preview.made', { dish }) : t('messages.preview.madeRecipe');
    case 'step':
      return you(body || (m.step_order != null ? t('messages.question.aboutStep', { step: m.step_order }) : t('messages.preview.stepNoNumber')));
    case 'request':
      if (body) return you(body);
      if (opts.mine) return dish != null ? t('messages.preview.youAskedFor', { dish }) : t('messages.preview.youAskedForRecipe');
      if (named) return dish != null ? t('messages.preview.nameAskedFor', { name, dish }) : t('messages.preview.nameAskedForRecipe', { name });
      return dish != null ? t('messages.preview.askedYouFor', { dish }) : t('messages.preview.askedYouForRecipe');
    default:
      return you(body || t('messages.preview.sentMessage'));
  }
}

export function ThreadRow({
  thread,
  me,
  entry,
  unread,
  onPress,
}: {
  thread: ThreadSummary;
  me: Profile | null;
  entry: Lookup;
  /** New messages, or a question for me still waiting for my answer: bold + dot. */
  unread: boolean;
  onPress: () => void;
}) {
  const { profileById } = useSession();
  const { t } = useWords();
  const m = thread.last;
  const mine = !!m && m.sender_id === me?.id;
  const circle = thread.kind === 'circle';
  const name = circle ? t('messages.family') : thread.other.name;
  const sender = circle && m && !mine && m.kind !== 'system' ? (thread.members?.find((p) => p.id === m.sender_id) ?? profileById(m.sender_id)) : null;
  useKnownSenders(circle && m && !mine && !sender ? [m.sender_id] : []);
  const senderName = sender?.name ?? null;
  const preview = m ? previewText(m, { mine, senderName, entry: entry(m.recipe_id) ?? entry(thread.recipe_id) }, t) : '';
  const time = inboxTime(m?.created_at, undefined, t);
  const label = [name, unread ? t('messages.inbox.unread') : null, preview || null, time || null].filter(Boolean).join(', ');
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} pressedOpacity={0.6} accessibilityLabel={label} accessibilityHint={t('messages.inbox.opensChat')} style={styles.row}>
      {circle ? <CircleFaces thread={thread} me={me} size={AVATAR} /> : <Avatar profile={thread.other} size={AVATAR} />}
      <View style={styles.text}>
        <Txt variant="title" weight={unread ? 700 : 400} numberOfLines={1}>
          {name}
        </Txt>
        {preview || time ? (
          <View style={styles.line}>
            {preview ? (
              <Txt variant="meta" size={15} weight={unread ? 600 : 400} color={unread ? colors.ink : colors.muted} numberOfLines={1} style={styles.shrink}>
                {preview}
              </Txt>
            ) : null}
            {time ? (
              <Txt variant="meta" size={15} numberOfLines={1} style={styles.time}>
                {preview ? ` · ${time}` : time}
              </Txt>
            ) : null}
          </View>
        ) : null}
      </View>
      {unread ? <View style={styles.dot} /> : null}
    </PressableScale>
  );
}

/** "New message": the first row of both inboxes, always (opens everyone in the family). */
export function NewMessageRow({ onPress }: { onPress: () => void }) {
  const { t } = useWords();
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.98}
      pressedOpacity={0.6}
      accessibilityLabel={t('messages.inbox.newMessage')}
      accessibilityHint={t('messages.inbox.newMessageHint')}
      style={styles.row}>
      <View style={styles.newDisc}>
        <PlusIcon size={24} color={colors.peachInk} strokeWidth={2.2} />
      </View>
      <Txt variant="title" weight={400} style={styles.text}>
        {t('messages.inbox.newMessage')}
      </Txt>
    </PressableScale>
  );
}

// ---------------------------------------------------------------------------------------------
// The family circle's face: two people overlapped on the avatar square's diagonal (cooks first;
// a learner sees the cooks, a cook sees everyone else).

export function circleFaces(members: Profile[], me: Profile | null): Profile[] {
  // Up to three, for labels; the tile draws the first two.
  const others = members.filter((p) => p.id !== me?.id);
  const cooks = others.filter((p) => p.role === 'cook');
  const rest = others.filter((p) => p.role !== 'cook');
  return (me?.role === 'learner' && cooks.length ? cooks : [...cooks, ...rest]).slice(0, 3);
}

export function CircleFaces({
  thread,
  members,
  me,
  size = 52,
}: {
  thread?: Pick<ThreadSummary, 'members'>;
  members?: Profile[];
  me: Profile | null;
  size?: number;
}) {
  const { t } = useWords();
  const all = circleFaces(members ?? thread?.members ?? [], me);
  if (all.length <= 1) return <Avatar profile={all[0] ?? { name: t('messages.family') }} size={size} />;
  // Two faces on the diagonal read better than three at this size.
  const faces = all.slice(0, 2);
  const small = Math.round(size * 0.7);
  const spots = [
    { left: 0, top: 0 },
    { left: size - small, top: size - small },
  ];
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={t('messages.inbox.familyFaces', { names: all.map((f) => f.name).join(', ') })}>
      {faces.map((p, i) => (
        <Avatar key={p.id} profile={p} size={small} ring style={[styles.face, spots[i]]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 80, paddingVertical: 12, paddingHorizontal: space.gutter },
  text: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'baseline' },
  shrink: { flexShrink: 1 },
  time: { flexShrink: 0 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green, marginLeft: 4 },
  newDisc: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.peach },
  face: { position: 'absolute' },
});

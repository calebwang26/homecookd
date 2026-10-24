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
import { colors, space } from '@/theme/tokens';

import { dishName, inboxTime } from './helpers';

type Lookup = (id: string | null | undefined) => LibraryEntry | null;

const AVATAR = 56;

/** One line of words for a thread's newest message ("You: …", circle "Leo: …"). */
export function previewText(m: Message, opts: { mine: boolean; entry: LibraryEntry | null; /** Circle: "Leo: …" */ senderName?: string | null }): string {
  const who = opts.mine ? 'You' : (opts.senderName ?? null);
  const you = who ? `${who}: ` : '';
  const dish = opts.entry ? dishName(opts.entry) : 'a recipe';
  const body = (m.body ?? '').trim();
  const voice = `${you}Voice message${m.duration_s ? ` · ${mmss(m.duration_s)}` : ''}`;
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
      return q ? `${you}${q}` : voice;
    }
    case 'recipe':
      return body ? `${you}${body}` : who ? `${who} sent ${dish}` : `Sent you ${dish}`;
    case 'cooked':
      return body ? `${you}${body}` : who ? `${who} made ${dish}` : `Made ${dish}`;
    case 'step':
      return `${you}${body || `A question about step ${m.step_order ?? ''}`.trim()}`;
    case 'request':
      return body ? `${you}${body}` : who ? `${who} asked for ${dish}` : `Asked you for ${dish}`;
    default:
      return `${you}${body || 'Sent a message'}`;
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
  const m = thread.last;
  const mine = !!m && m.sender_id === me?.id;
  const circle = thread.kind === 'circle';
  const name = circle ? 'Family' : thread.other.name;
  const sender = circle && m && !mine && m.kind !== 'system' ? (thread.members?.find((p) => p.id === m.sender_id) ?? profileById(m.sender_id)) : null;
  useKnownSenders(circle && m && !mine && !sender ? [m.sender_id] : []);
  const senderName = sender?.name ?? null;
  const preview = m ? previewText(m, { mine, senderName, entry: entry(m.recipe_id) ?? entry(thread.recipe_id) }) : '';
  const time = inboxTime(m?.created_at);
  const label = [name, unread ? 'unread' : null, preview || null, time || null].filter(Boolean).join(', ');
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} pressedOpacity={0.6} accessibilityLabel={label} accessibilityHint="Opens the chat" style={styles.row}>
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
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} pressedOpacity={0.6} accessibilityLabel="New message" accessibilityHint="Pick someone in the family" style={styles.row}>
      <View style={styles.newDisc}>
        <PlusIcon size={24} color={colors.peachInk} strokeWidth={2.2} />
      </View>
      <Txt variant="title" weight={400} style={styles.text}>
        New message
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
  const all = circleFaces(members ?? thread?.members ?? [], me);
  if (all.length <= 1) return <Avatar profile={all[0] ?? { name: 'Family' }} size={size} />;
  // Two faces on the diagonal read better than three at this size.
  const faces = all.slice(0, 2);
  const small = Math.round(size * 0.7);
  const spots = [
    { left: 0, top: 0 },
    { left: size - small, top: size - small },
  ];
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={`Family: ${all.map((f) => f.name).join(', ')}`}>
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

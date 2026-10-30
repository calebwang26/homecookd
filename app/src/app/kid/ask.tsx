// Kid "Ask" tab: yolk-tint wash, "Ask your family" (32), the big dark "+ Ask about a dish" button
// (opens the Ask sheet: pick a dish or "Something else", then who: the one way to start a chat, so
// there is a single "+" on the screen), then the inbox as a DM list: the family circle, then every
// 1:1 chat (newest first), then one quiet "Invite family" row last (moved here from kid Home in round
// 2; the same family-link share sheet as the Invite button).
// Unread chats are bold with a green dot. Polls every 8 s while focused.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AskSheet, ThreadRow, useDishLookup } from '@/components/messages';
import { AddFamilySheet } from '@/components/profiles';
import { ActionButton, Card, EmptyState, LargeHeader, listEnter, PlusIcon, PressableScale, ScreenWash, ShareIcon, SkeletonRow, Txt } from '@/components/ui';
import { inboxOrder, useThreads } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { colors, space, tabBar } from '@/theme/tokens';

export default function KidAsk() {
  const { me } = useSession();
  const { threads: raw, loading, error, refresh } = useThreads();
  const threads = inboxOrder(raw);
  const { entry } = useDishLookup();
  const [asking, setAsking] = useState(false);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenWash tone="kid" height={300} />
        <LargeHeader title="Ask your family" />
        <View style={styles.ask}>
          <ActionButton
            label="Ask about a dish"
            variant="ink"
            icon={<PlusIcon size={22} color={colors.card} strokeWidth={2.2} />}
            onPress={() => setAsking(true)}
            accessibilityHint="Pick a dish, then who to ask"
          />
        </View>
        <View style={styles.list}>
          {loading ? (
            [0, 1, 2].map((i) => (
              <View key={i} style={styles.skel}>
                <SkeletonRow thumb={56} round />
              </View>
            ))
          ) : threads.length ? (
            <Animated.View entering={listEnter(0)}>
              {threads.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  me={me}
                  entry={entry}
                  unread={t.unread > 0 && t.last?.sender_id !== me?.id}
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: t.id } })}
                />
              ))}
            </Animated.View>
          ) : error ? (
            <Card padding={24} gap={12} style={styles.gutter}>
              <Txt variant="title">Can’t reach your family.</Txt>
              <Txt variant="body" leading={1.4}>
                {error}
              </Txt>
              <ActionButton label="Try again" variant="outline" size="sm" onPress={() => refresh()} />
            </Card>
          ) : (
            <EmptyState title="No questions yet" />
          )}
          {loading ? null : <InviteRow />}
        </View>
      </ScrollView>

      <AskSheet visible={asking} onClose={() => setAsking(false)} />
    </View>
  );
}

/** "Invite family", in the inbox row's shape (a tinted disc and its label). */
function InviteRow() {
  // A fresh key per open, so the sheet starts over every time (as InviteButton does).
  const [sheet, setSheet] = useState({ open: false, n: 0 });
  return (
    <>
      <PressableScale
        onPress={() => setSheet((s) => ({ open: true, n: s.n + 1 }))}
        scaleTo={0.98}
        pressedOpacity={0.6}
        accessibilityLabel="Invite family"
        accessibilityHint="Add someone to your family on homecookd"
        style={styles.row}>
        <View style={styles.disc}>
          <ShareIcon size={22} color={colors.page} strokeWidth={2.2} />
        </View>
        <Txt variant="title" weight={400} style={styles.rowText}>
          Invite family
        </Txt>
      </PressableScale>
      <AddFamilySheet key={sheet.n} visible={sheet.open} onClose={() => setSheet((s) => ({ ...s, open: false }))} />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: tabBar.clearance + 16 },
  ask: { paddingHorizontal: space.gutter, marginTop: 24 },
  list: { marginTop: 24 },
  skel: { paddingHorizontal: space.gutter },
  gutter: { marginHorizontal: space.gutter },
  // The inbox row's shape (ThreadRows: 80 tall, 56 disc, 14 gap).
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 80, paddingVertical: 12, paddingHorizontal: space.gutter },
  disc: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  rowText: { flex: 1, minWidth: 0 },
});

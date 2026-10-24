// Parent "Messages" tab: peach wash, "Messages" (34), then the inbox as a DM list: the family
// "New message" first, always (anyone in the family), then the circle, then every 1:1 chat (newest first).
// A chat is unread (bold + green dot) when it has new messages or a question for me still waiting
// for my answer (GET /questions/open through kitchen's questionFor: a 1:1 question, or a family
// question about my dish; or their last 1:1 message asks something). Each row shows the newest
// message, and opens the chat as it is: answering is an explicit tap there ("Answer this").
// Polls every 8 s while focused.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { MembersSheet, NewMessageRow, ThreadRow, useDishLookup } from '@/components/messages';
import { questionFor } from '@/components/parent/kitchen';
import { ActingAsBar } from '@/components/profiles';
import { ActionButton, Card, LargeHeader, listEnter, ScreenWash, SkeletonRow, Txt } from '@/components/ui';
import type { ThreadSummary } from '@/lib/api';
import { inboxOrder, isQuestion, useOpenQuestions, useThreads } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { colors, space, tabBar } from '@/theme/tokens';

export default function ParentMessages() {
  const { me, profiles } = useSession();
  const { threads: raw, loading, error, refresh } = useThreads();
  const threads = inboxOrder(raw);
  const open = useOpenQuestions();
  const { entry } = useDishLookup();
  const [composing, setComposing] = useState(false);

  const circleId = threads.find((t) => t.kind === 'circle')?.id ?? open.circleId;
  // The newest open question for me in this chat (circle questions may come without a thread id).
  const openQuestion = (t: ThreadSummary) =>
    open.all.find(
      (q) => (q.message.thread_id || (q.thread_kind !== 'pair' ? circleId : null)) === t.id && questionFor(q, me, profiles) === 'mine',
    ) ?? null;
  const fresh = (t: ThreadSummary) => t.unread > 0 && !!t.last && t.last.sender_id !== me?.id;
  const unread = (t: ThreadSummary) => {
    const asked = t.kind !== 'circle' && !!t.last && t.last.sender_id !== me?.id && isQuestion(t.last);
    return fresh(t) || asked || !!openQuestion(t);
  };
  // No `q=`: from here a message goes to the chat as written (B01), never filed as an answer.
  const openThread = (t: ThreadSummary) => router.push({ pathname: '/chat/[id]', params: { id: t.id } });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenWash tone="parent" height={300} />
        <LargeHeader title="Messages" size={34} />
        <ActingAsBar />
        <View style={styles.list}>
          {loading ? (
            [0, 1, 2].map((i) => (
              <View key={i} style={styles.skel}>
                <SkeletonRow thumb={56} round />
              </View>
            ))
          ) : threads.length || !error ? (
            <Animated.View entering={listEnter(0)}>
              <NewMessageRow onPress={() => setComposing(true)} />
              {threads.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  me={me}
                  entry={entry}
                  unread={unread(t)}
                  onPress={() => openThread(t)}
                />
              ))}
            </Animated.View>
          ) : (
            <Card padding={24} gap={12} style={styles.gutter}>
              <Txt variant="title">Can’t reach your family.</Txt>
              <Txt variant="body" leading={1.4}>
                {error}
              </Txt>
              <ActionButton label="Try again" variant="outline" size="sm" onPress={() => refresh()} />
            </Card>
          )}
        </View>
      </ScrollView>
      <MembersSheet mode="new" visible={composing} onClose={() => setComposing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { paddingBottom: tabBar.clearance + 16 },
  list: { marginTop: 24 },
  skel: { paddingHorizontal: space.gutter },
  gutter: { marginHorizontal: space.gutter },
});

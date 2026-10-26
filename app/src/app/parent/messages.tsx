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
import { ActionButton, Card, LargeHeader, listEnter, ScreenWash, SkeletonRow, Txt } from '@/components/ui';
import type { ThreadSummary } from '@/lib/api';
import { inboxOrder, isQuestion, useOpenQuestions, useThreads } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors, space, tabBar } from '@/theme/tokens';

export default function ParentMessages() {
  const { me, profiles } = useSession();
  const { t } = useWords();
  const { threads: raw, loading, error, refresh } = useThreads();
  const threads = inboxOrder(raw);
  const open = useOpenQuestions();
  const { entry } = useDishLookup();
  const [composing, setComposing] = useState(false);

  const circleId = threads.find((th) => th.kind === 'circle')?.id ?? open.circleId;
  // The newest open question for me in this chat (circle questions may come without a thread id).
  const openQuestion = (th: ThreadSummary) =>
    open.all.find(
      (q) => (q.message.thread_id || (q.thread_kind !== 'pair' ? circleId : null)) === th.id && questionFor(q, me, profiles) === 'mine',
    ) ?? null;
  const fresh = (th: ThreadSummary) => th.unread > 0 && !!th.last && th.last.sender_id !== me?.id;
  const unread = (th: ThreadSummary) => {
    const asked = th.kind !== 'circle' && !!th.last && th.last.sender_id !== me?.id && isQuestion(th.last);
    return fresh(th) || asked || !!openQuestion(th);
  };
  // No `q=`: from here a message goes to the chat as written (B01), never filed as an answer.
  const openThread = (th: ThreadSummary) => router.push({ pathname: '/chat/[id]', params: { id: th.id } });

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenWash tone="parent" height={300} />
        <LargeHeader title={t('messages.title')} size={34} />
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
              {threads.map((th) => (
                <ThreadRow
                  key={th.id}
                  thread={th}
                  me={me}
                  entry={entry}
                  unread={unread(th)}
                  onPress={() => openThread(th)}
                />
              ))}
            </Animated.View>
          ) : (
            <Card padding={24} gap={12} style={styles.gutter}>
              <Txt variant="title">{t('messages.inbox.cantReach')}</Txt>
              <Txt variant="body" leading={1.4}>
                {error}
              </Txt>
              <ActionButton label={t('messages.inbox.tryAgain')} variant="outline" size="sm" onPress={() => refresh()} />
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

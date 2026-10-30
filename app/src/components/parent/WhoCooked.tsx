// "Who cooked it" (bible Parent-Recipe): one row per learner in the family.
//  cooked     avatar with a green check, "Leo cooked it", their note in Fraunces italic
//  not yet    name, "Not yet" (+ "sent Monday" / "opened it twice" when true), and an outline
//             "Send to Maya" (POST /send-recipe) that spins, then becomes a green "✓ Sent"
//  loading    skeleton rows (never "Not yet" from data that hasn't arrived)
//  failed     names only, no status and no Send (we can't tell what's true offline)
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionButton, Avatar, CheckIcon, ListCard, ListRow, Skeleton, Txt } from '@/components/ui';
import type { Profile, RecipeActivity } from '@/lib/api';
import { relativeDay } from '@/lib/format';
import { sendRecipe } from '@/lib/messaging';
import { refreshUnread } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import type { T } from '@/lib/words/words';
import { alpha, colors } from '@/theme/tokens';

import { madeVerb } from './kitchen';

/** "Opened it once / twice / 3 times", or with "Not yet · " before it (lower case). */
function opened(n: number, t: T, notYet = false): string {
  if (notYet) return n === 1 ? t('parent.who.notYetOpenedOnce') : n === 2 ? t('parent.who.notYetOpenedTwice') : t('parent.who.notYetOpenedTimes', { n });
  return n === 1 ? t('parent.who.openedOnce') : n === 2 ? t('parent.who.openedTwice') : t('parent.who.openedTimes', { n });
}

export function WhoCooked({
  recipeId,
  tags,
  title,
  learners,
  activity,
  ready,
  failed = false,
  sentAt,
  onSent,
}: {
  recipeId: string;
  tags: string[];
  title: string;
  learners: Profile[];
  activity: RecipeActivity | null;
  /** Activity and my sent recipe cards have both arrived. */
  ready: boolean;
  /** Activity or the inbox couldn't load: show who, but claim nothing. */
  failed?: boolean;
  /** When I last sent this recipe to that person (ISO), or null. */
  sentAt: (profileId: string) => string | null;
  onSent?: (p: Profile) => void;
}) {
  const [justSent, setJustSent] = useState<Record<string, true>>({});
  const { t } = useWords();
  if (!learners.length) return null;
  const verb = madeVerb(tags, title);

  if (!ready && !failed) {
    return (
      <ListCard>
        {learners.map((p, i) => (
          <ListRow key={p.id} last={i === learners.length - 1} padV={14}>
            <Skeleton circle height={48} />
            <View style={[styles.text, { gap: 8 }]}>
              <Skeleton width="45%" height={16} />
              <Skeleton width="30%" height={13} />
            </View>
          </ListRow>
        ))}
      </ListCard>
    );
  }

  if (!ready) {
    return (
      <ListCard>
        {learners.map((p, i) => (
          <ListRow key={p.id} last={i === learners.length - 1} padV={14}>
            <Avatar profile={p} size={48} />
            <View style={styles.text}>
              <Txt variant="title" size={17} numberOfLines={1}>
                {p.name}
              </Txt>
            </View>
          </ListRow>
        ))}
      </ListCard>
    );
  }

  return (
    <ListCard>
      {learners.map((p, i) => {
        const cooked = activity?.cooked.find((c) => c.profile.id === p.id) ?? null;
        const viewed = activity?.viewed.find((v) => v.profile.id === p.id)?.count ?? 0;
        const sent = sentAt(p.id);
        const last = i === learners.length - 1;

        if (cooked) {
          return (
            <ListRow key={p.id} last={last} padV={14}>
              <Avatar profile={p} size={48} check />
              <View style={styles.text}>
                <Txt variant="title" size={17}>
                  {t(verb === 'baked' ? 'parent.who.baked' : 'parent.who.cooked', { name: p.name })}
                </Txt>
                {cooked.note ? (
                  <Txt variant="quote" size={15} leading={1.35} color={colors.text} numberOfLines={2}>
                    “{cooked.note.trim()}”
                  </Txt>
                ) : (
                  <Txt variant="body" size={15}>
                    {relativeDay(cooked.at, {}, t)}
                  </Txt>
                )}
              </View>
            </ListRow>
          );
        }

        const showSend = !sent || justSent[p.id];
        // Short when the Send button shares the row; otherwise the one extra true thing we know.
        const status = justSent[p.id]
          ? t('parent.who.notYet')
          : showSend
            ? viewed > 0
              ? opened(viewed, t)
              : t('parent.who.notYet')
            : viewed > 0
              ? opened(viewed, t, true)
              : t('parent.who.notYetSent', { day: relativeDay(sent, { lower: true }, t) });

        return (
          <ListRow key={p.id} last={last} padV={14}>
            <Avatar profile={p} size={48} />
            <View style={styles.text}>
              <Txt variant="title" size={17} numberOfLines={1}>
                {p.name}
              </Txt>
              <Txt variant="body" size={15} numberOfLines={1}>
                {status}
              </Txt>
            </View>
            {justSent[p.id] ? (
              <View style={styles.sent} accessible accessibilityLabel={t('parent.who.sentTo', { name: p.name })}>
                <CheckIcon size={16} strokeWidth={3} color={colors.green} />
                <Txt variant="label" size={15} weight={700} color={colors.green}>
                  {t('parent.who.sent')}
                </Txt>
              </View>
            ) : showSend ? (
              <ActionButton
                label={t('parent.who.send')}
                accessibilityLabel={t('parent.send.toName', { name: p.name })}
                variant="outline"
                size="xs"
                fg={colors.yolkDeep}
                borderColor={alpha.borderStrong}
                padH={16}
                labelWeight={700}
                accessibilityHint={t('parent.who.sendHint', { name: p.name })}
                onPress={async () => {
                  await sendRecipe(recipeId, [p.id]);
                  setJustSent((s) => ({ ...s, [p.id]: true }));
                  refreshUnread();
                  onSent?.(p);
                }}
              />
            ) : null}
          </ListRow>
        );
      })}
    </ListCard>
  );
}

const styles = StyleSheet.create({
  text: { flex: 1, gap: 2 },
  sent: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
});

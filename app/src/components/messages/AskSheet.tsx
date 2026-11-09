// "+ Ask about a dish" (Kid-Messages), two steps in one bottom sheet:
//  1. "Ask about a dish": the family's dishes (the shared DishList from RecipePickerSheet: 64 thumb
//     radius 18, 16/700 title, 14 muted "by Dad"), then "Something else".
//  2. "Who should answer?": "The family" (title only; opens the circle), then each person (the
//     dish's cook first). Either opens the normal chat with the dish waiting in the composer as an
//     attachment (`recipe`), so the question goes out carrying it and its answer is saved into the
//     recipe. A person's chat also gets `ask=1`: the first message is a question for them, dish or not.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Appear, Avatar, BackIcon, BottomSheet, ChatIcon, ChevronRightIcon, IconButton, ListCard, ListRow, Txt, useToast } from '@/components/ui';
import { afterClose } from '@/lib/sheets/coordinator';
import { errorMessage, type Profile } from '@/lib/api';
import { openChatWith, openCircle } from '@/lib/messaging';
import { useSession } from '@/lib/session';
import type { LibraryEntry } from '@/lib/types';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors } from '@/theme/tokens';

import { dishName, possessivePronoun } from './helpers';
import { familyOrder } from './MembersSheet';
import { DishList, useFamilyDishes } from './RecipePickerSheet';
import { CircleFaces } from './ThreadRows';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** What the question is about: a dish, or "Something else" (no dish). */
type Choice = { dish: LibraryEntry | null };

/** "Her recipe" / "His recipe" / "Their recipe" under the dish's cook. */
const THEIR_RECIPE: Record<ReturnType<typeof possessivePronoun>, WordKey> = {
  her: 'messages.ask.herRecipe',
  his: 'messages.ask.hisRecipe',
  their: 'messages.ask.theirRecipe',
};

export function AskSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { me, profiles } = useSession();
  const dishes = useFamilyDishes();
  const toast = useToast();
  const { t } = useWords();
  const { height: winH } = useWindowDimensions();
  const [opening, setOpening] = useState<string | null>(null);
  const [pick, setPick] = useState<Choice | null>(null);
  // Every open starts at the dishes.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setPick(null);
  }

  // Who can be asked: everyone else, the dish's cook first.
  const others = familyOrder(profiles, me?.id);
  const cookOfDish = pick?.dish ? (others.find((p) => norm(p.name) === norm(pick.dish!.cook_name)) ?? null) : null;
  const people = cookOfDish ? [cookOfDish, ...others.filter((p) => p.id !== cookOfDish.id)] : others;

  const go = async (key: string, open: () => Promise<{ id: string; ask?: boolean }>) => {
    if (opening) return;
    setOpening(key);
    try {
      const { id, ask } = await open();
      const recipe = pick?.dish?.id;
      onClose();
      // The chat opens once the sheet's Modal is gone (lib/sheets/coordinator), never under it.
      afterClose(() =>
        router.push({
          pathname: '/chat/[id]',
          params: { id, ...(recipe ? { recipe } : {}), ...(ask ? { ask: '1' } : {}) },
        }),
      );
    } catch (e) {
      toast.show(errorMessage(e, t('messages.openFailed')), { tone: 'error' });
    } finally {
      setTimeout(() => setOpening(null), 300);
    }
  };

  const personLine = (p: Profile) => {
    if (cookOfDish && p.id === cookOfDish.id) return t(THEIR_RECIPE[possessivePronoun(p)]);
    const rel = (p.relation ?? '').trim();
    return rel && norm(rel) !== norm(p.name) ? rel : null;
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={pick ? t('messages.ask.whoTitle') : t('messages.ask.title')}
      accessibilityLabel={pick ? t('messages.ask.whoTitle') : t('messages.ask.title')}>
      <ScrollView style={[styles.scroll, { maxHeight: Math.max(320, winH * 0.92 - 230) }]} contentContainerStyle={styles.scrollPad} showsVerticalScrollIndicator={false}>
        {!pick ? (
          <Appear key="dishes">
            <DishList dishes={dishes} onPick={(d) => setPick({ dish: d })} rowLabel={(d) => t('messages.ask.aboutDish', { dish: d.title })}>
              <OptionRow
                icon={<ChatIcon size={24} color={colors.ink} />}
                title={t('messages.ask.somethingElse')}
                last
                onPress={() => setPick({ dish: null })}
              />
            </DishList>
          </Appear>
        ) : (
          <Appear key="who" style={styles.who}>
            <View style={styles.context}>
              <IconButton
                icon={<BackIcon size={20} color={colors.ink} strokeWidth={2.2} />}
                tone="well"
                size={48}
                accessibilityLabel={t('messages.ask.backToDishes')}
                onPress={() => setPick(null)}
              />
              {pick.dish ? (
                <View style={styles.dishPill}>
                  {pick.dish.poster_url ? (
                    <Image source={{ uri: pick.dish.poster_url }} style={styles.pillThumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.pillThumb, styles.thumbEmpty]} />
                  )}
                  <Txt variant="meta" weight={700} color={colors.ink} numberOfLines={1} style={styles.shrink}>
                    {dishName(pick.dish)}
                  </Txt>
                </View>
              ) : (
                <View style={styles.dishPill}>
                  <View style={[styles.pillThumb, styles.optionThumb]}>
                    <ChatIcon size={18} color={colors.ink} />
                  </View>
                  <Txt variant="meta" weight={700} color={colors.ink}>
                    {t('messages.ask.somethingElse')}
                  </Txt>
                </View>
              )}
            </View>
            <ListCard padH={12}>
              <TargetRow
                face={<CircleFaces members={profiles} me={me} size={52} />}
                title={t('messages.ask.theFamily')}
                label={t('messages.ask.askFamily')}
                busy={opening === 'family'}
                last={!people.length}
                onPress={() => go('family', async () => ({ id: await openCircle() }))}
              />
              {people.map((p, i) => (
                <TargetRow
                  key={p.id}
                  face={<Avatar profile={p} size={52} />}
                  title={p.name}
                  label={t('messages.ask.askName', { name: p.name })}
                  line={personLine(p)}
                  busy={opening === p.id}
                  last={i === people.length - 1}
                  onPress={() => go(p.id, async () => ({ id: await openChatWith(p.id), ask: true }))}
                />
              ))}
            </ListCard>
          </Appear>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

function OptionRow({ icon, title, last, onPress }: { icon: ReactNode; title: string; last?: boolean; onPress: () => void }) {
  return (
    <ListRow padV={8} last={last} onPress={onPress} accessibilityLabel={title}>
      <View style={[styles.thumb, styles.optionThumb]}>{icon}</View>
      <View style={styles.rowText}>
        <Txt variant="rowTitle">{title}</Txt>
      </View>
      <ChevronRightIcon size={22} color={colors.muted} strokeWidth={2.2} />
    </ListRow>
  );
}

function TargetRow({
  face,
  title,
  label,
  line,
  busy,
  last,
  onPress,
}: {
  face: ReactNode;
  title: string;
  /** Its accessibility label ("Ask Dad"). */
  label: string;
  line?: string | null;
  busy: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <ListRow padV={10} last={last} onPress={onPress} accessibilityLabel={label}>
      {face}
      <View style={styles.rowText}>
        <Txt variant="title" numberOfLines={1}>
          {title}
        </Txt>
        {line ? (
          <Txt variant="meta" numberOfLines={1}>
            {line}
          </Txt>
        ) : null}
      </View>
      {busy ? <ActivityIndicator color={colors.ink} /> : <ChevronRightIcon size={22} color={colors.muted} strokeWidth={2.2} />}
    </ListRow>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -4 },
  scrollPad: { paddingHorizontal: 4, paddingBottom: 12, paddingTop: 2 },
  thumb: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.well },
  thumbEmpty: { backgroundColor: colors.well },
  optionThumb: { backgroundColor: colors.yolkTint, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, gap: 3, justifyContent: 'center' },
  who: { gap: 14 },
  context: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  dishPill: {
    flexShrink: 1,
    height: 40,
    paddingLeft: 4,
    paddingRight: 14,
    borderRadius: 999,
    backgroundColor: colors.well,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillThumb: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.well },
  shrink: { flexShrink: 1 },
});

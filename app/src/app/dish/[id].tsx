// /dish/<id>: a dish-ask card in the app (docs/design/phase5-cold-parents, artboards 11–13; V2-LINKING.md §2.6),
// opened by ClaimLink after a claim and by the "Mom answered" push. dishAsks.get (lib/dishCards), live.
//   The kid, waiting:       "Your braised pork", "Asked Mom · filming it Sunday", tonight's version with every amount
//                           marked "guess" ("Your guess for tonight · Mom will fix it"), the steps
//   The kid, Mom answered:  "Mom's braised pork", "Mom answered", her clip first in her words, the ingredients she
//                           settled tagged "Mom", her tip under its step with its clip
//   Mom (side 'cook'):      "Your braised pork, for Caleb", the big green "Surprise Caleb: film it" (→ /record with
//                           the dish filled in), what Caleb sees, "See all of it"
// Never a stock photo for the dish (components/request/DishCard). A card the kid never sent has no Ask button here:
// its ask link lives only on the web. A kid who deleted their account reads "Your kid".
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DishCard } from '@/components/request/DishCard';
import { ActionButton, CheckIcon, CloseIcon, IconButton, listEnter, PauseIcon, PlayIcon, PressableScale, RecordDotIcon, ScreenWash, Txt } from '@/components/ui';
import { useMyCard } from '@/lib/dishCards';
import { amountText, boldParts, clipFor, firstClip, ingredientTag, relationLabel, shownRecipe, type DishAnswer, type DishRecipe, type MyCard } from '@/lib/dishView';
import { mmss } from '@/lib/format';
import { useClipAudio } from '@/lib/media';
import { dayName } from '@/lib/reminders';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows, space } from '@/theme/tokens';

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function DishScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useMyCard(id);
  const insets = useSafeAreaInsets();
  const { t } = useWords();
  const cook = card?.side === 'cook';

  return (
    <View style={styles.page}>
      <ScreenWash tone={cook ? 'parent' : 'kid'} height={420} />
      <ScrollView contentContainerStyle={[styles.col, { paddingTop: Math.max(space.topDetail, insets.top + 8), paddingBottom: Math.max(40, insets.bottom + 24) }]} showsVerticalScrollIndicator={false}>
        <IconButton icon={<CloseIcon size={20} color={colors.ink} />} accessibilityLabel={t('dish.back')} onPress={close} />
        {card === undefined ? (
          <ActivityIndicator color={colors.yolkDeep} style={styles.wait} />
        ) : card === null ? (
          <View style={styles.missing}>
            <Txt variant="title" size={20} align="center">
              {t('dish.missing')}
            </Txt>
            <ActionButton label={t('dish.home')} variant="outline" size="md" onPress={() => router.replace('/')} />
          </View>
        ) : (
          <>
            <Animated.View entering={listEnter(0)}>
              <DishCard dish={card.dish} photoUrl={card.photoUrls[0] ?? null} />
            </Animated.View>
            {cook ? <CookSide card={card} /> : <KidSide card={card} />}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function KidSide({ card }: { card: MyCard }) {
  const { t } = useWords();
  const who = relationLabel(card.relation);
  const recipe = shownRecipe(card);
  const answered = !!card.version;
  const clip = answered ? firstClip(card) : null;
  const day = card.filmingDay != null ? ` · ${t('dish.filming', { day: dayName(card.filmingDay, t) })}` : '';
  return (
    <>
      <Txt variant="display" size={34} leading={1.08} accessibilityRole="header">
        {answered ? t('dish.whosDish', { who, dish: card.dish }) : t('dish.yourDish', { dish: card.dish })}
      </Txt>
      {card.status !== 'draft' ? (
        <View style={[styles.pill, answered ? styles.pillDone : styles.pillWait]}>
          {answered ? <CheckIcon size={18} color={colors.green} /> : null}
          <Txt variant="label" size={17} weight={700} color={answered ? colors.green : colors.ink} style={styles.shrink}>
            {(answered ? t('dish.answered', { who }) : t('dish.asked', { who })) + day}
          </Txt>
        </View>
      ) : null}
      {card.merging && !answered ? (
        <Txt variant="body" size={17} color={colors.muted}>
          {t('dish.merging', { who })}
        </Txt>
      ) : null}
      {clip ? <MomClip cardId={card.id} answer={clip} who={who} /> : null}
      <Facts recipe={recipe} />
      <Ingredients card={card} recipe={recipe} label={answered ? t('dish.ingredients') : t('dish.yourGuess', { who })} who={who} />
      <Steps card={card} recipe={recipe} />
    </>
  );
}

function CookSide({ card }: { card: MyCard }) {
  const { t } = useWords();
  const [all, setAll] = useState(false);
  const kid = card.kidName?.trim() || t('dish.yourKid');
  const recipe = shownRecipe(card);
  const film = () => router.push({ pathname: '/record', params: { dish: card.dish, from: kid, ask: card.id } });
  return (
    <>
      <View style={styles.titles}>
        <Txt variant="display" size={34} leading={1.08} accessibilityRole="header">
          {t('dish.forKid', { dish: card.dish, kid })}
        </Txt>
        <Txt variant="body" size={18} leading={1.4} color={colors.text}>
          {t('dish.cookTonight', { kid })}
        </Txt>
      </View>
      <PressableScale onPress={film} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={t('dish.filmIt', { kid })} accessibilityHint={t('dish.filmItLine', { kid })} style={styles.film}>
        <View style={styles.filmDot}>
          <RecordDotIcon size={16} color={colors.danger} />
        </View>
        <View style={styles.shrink}>
          <Txt variant="title" size={22} weight={700} color={colors.ink}>
            {t('dish.filmIt', { kid })}
          </Txt>
          <Txt variant="body" size={17} color={colors.ink}>
            {t('dish.filmItLine', { kid })}
          </Txt>
        </View>
      </PressableScale>
      <Ingredients card={card} recipe={recipe} label={t('dish.kidSees', { kid })} who={relationLabel(card.relation)} max={all ? undefined : 3} />
      {all ? (
        <Steps card={card} recipe={recipe} />
      ) : (
        <PressableScale onPress={() => setAll(true)} accessibilityRole="button" hitSlop={8} style={styles.seeAll}>
          <Txt variant="label" size={18} weight={700} color={colors.yolkDeep}>
            {t('dish.seeAll')}
          </Txt>
        </PressableScale>
      )}
    </>
  );
}

function Facts({ recipe }: { recipe: DishRecipe }) {
  const { t } = useWords();
  const facts = [recipe.servings ? t('dish.servings', { n: recipe.servings }) : null, recipe.time, recipe.cost].filter((f): f is string => !!f);
  if (!facts.length) return null;
  return (
    <View style={styles.facts}>
      {facts.map((f) => (
        <View key={f} style={styles.fact}>
          <Txt variant="label" size={17} weight={600}>
            {f}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function Ingredients({ card, recipe, label, who, max }: { card: MyCard; recipe: DishRecipe; label: string; who: string; max?: number }) {
  const { t } = useWords();
  const rows = max ? recipe.ingredients.slice(0, max) : recipe.ingredients;
  if (!rows.length) return null;
  return (
    <View style={styles.box}>
      <Txt variant="label" size={17} weight={600} color={colors.ink}>
        {label}
      </Txt>
      {rows.map((ing, i) => {
        const tag = ingredientTag(ing);
        const amount = amountText(ing);
        return (
          <View key={`${card.id}:${i}`} style={[styles.ingredient, tag === 'mom' ? styles.momRow : tag === 'guess' ? styles.guessRow : null]}>
            <Txt variant="bodyInk" size={18} leading={1.3} style={styles.shrink}>
              {amount ? (
                <Txt variant="bodyInk" size={18} weight={700} leading={1.3}>
                  {amount}{' '}
                </Txt>
              ) : null}
              {ing.name}
            </Txt>
            {tag === 'mom' ? (
              <View style={styles.momTag}>
                <Txt variant="label" size={14} weight={700} color={colors.green}>
                  {who}
                </Txt>
              </View>
            ) : tag === 'guess' ? (
              <Txt variant="meta" size={15} color={colors.muted} style={styles.italic}>
                {t('dish.tagGuess')}
              </Txt>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Steps({ card, recipe }: { card: MyCard; recipe: DishRecipe }) {
  const { t } = useWords();
  if (!recipe.steps.length) return null;
  return (
    <View style={styles.steps}>
      <Txt variant="section" size={24}>
        {t('dish.steps')}
      </Txt>
      {recipe.steps.map((s, i) => (
        <View key={`${card.id}:step:${i}`} style={styles.stepBlock}>
          <View style={styles.step}>
            <View style={styles.num}>
              <Txt variant="label" size={16} weight={700} color={colors.green}>
                {i + 1}
              </Txt>
            </View>
            <View style={styles.shrink}>
              <Txt variant="bodyInk" size={18} leading={1.35}>
                {s.title}
              </Txt>
              {s.lines.map((l, j) => (
                <Txt key={j} variant="body" size={17} leading={1.35} color={colors.text}>
                  {boldParts(l.text).map((p, k) => (
                    <Txt key={k} variant="body" size={17} weight={p.bold ? 700 : undefined} leading={1.35} color={colors.text}>
                      {p.text}
                    </Txt>
                  ))}
                </Txt>
              ))}
            </View>
          </View>
          {s.tip ? <Tip cardId={card.id} words={s.tip.words} answer={clipFor(card, s.tip.clip)} /> : null}
        </View>
      ))}
    </View>
  );
}

/** Her clip, first on the kid's side: her words and "Hear Mom · 0:12". */
function MomClip({ cardId, answer, who }: { cardId: string; answer: DishAnswer; who: string }) {
  const { t } = useWords();
  const play = useClipAudio({ url: answer.audioUrl ?? '', key: `dish:${cardId}:${answer.id}`, start_s: 0, end_s: null });
  const length = play.duration > 0 ? play.duration : answer.durationS;
  return (
    <PressableScale onPress={play.toggle} scaleTo={0.98} accessibilityRole="button" accessibilityLabel={play.playing ? t('dish.pause') : t('dish.hearShort', { who })} style={styles.clip}>
      <View style={styles.clipPlay}>{play.playing ? <PauseIcon size={18} color={colors.card} /> : <PlayIcon size={18} color={colors.card} />}</View>
      <View style={styles.shrink}>
        <Txt variant="quote" size={19} leading={1.3} color={colors.ink}>
          “{answer.words}”
        </Txt>
        <Txt variant="label" size={16} weight={700} color={colors.ink}>
          {length > 0 ? t('dish.hear', { who, time: mmss(play.playing ? play.elapsed : length) }) : t('dish.hearShort', { who })}
        </Txt>
      </View>
    </PressableScale>
  );
}

/** Her tip under its step, in her words, with her clip when there is one. */
function Tip({ cardId, words, answer }: { cardId: string; words: string; answer: DishAnswer | null }) {
  const play = useClipAudio({ url: answer?.audioUrl ?? '', key: `dish:${cardId}:tip:${answer?.id ?? ''}`, start_s: 0, end_s: null });
  return (
    <PressableScale onPress={answer ? play.toggle : undefined} disabled={!answer} scaleTo={0.98} accessibilityRole={answer ? 'button' : undefined} style={styles.tip}>
      {answer ? <View style={styles.tipPlay}>{play.playing ? <PauseIcon size={14} color={colors.card} /> : <PlayIcon size={14} color={colors.card} />}</View> : null}
      <Txt variant="quote" size={17} leading={1.3} color={colors.ink} style={styles.shrink}>
        “{words}”
      </Txt>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  col: { flexGrow: 1, paddingHorizontal: space.gutter, gap: 18 },
  wait: { marginTop: 80 },
  missing: { alignItems: 'center', gap: 16, paddingTop: 80 },
  shrink: { flex: 1, minWidth: 0 },
  italic: { fontStyle: 'italic' },
  titles: { gap: 6 },
  pill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, maxWidth: '100%' },
  pillWait: { backgroundColor: colors.yolkTint },
  pillDone: { backgroundColor: colors.greenTint },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: { backgroundColor: colors.card, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, boxShadow: shadows.chip },
  box: { backgroundColor: colors.card, borderRadius: radii.panel, paddingVertical: 20, paddingHorizontal: 22, gap: 12, boxShadow: shadows.card },
  ingredient: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  // The brand's row colours: his guesses in the yolk tint, her answers in the green tint.
  guessRow: { backgroundColor: colors.yolkTint, borderRadius: 12, marginHorizontal: -10, paddingHorizontal: 10, paddingVertical: 6 },
  momRow: { backgroundColor: colors.greenTint, borderRadius: 12, marginHorizontal: -10, paddingHorizontal: 10, paddingVertical: 6 },
  momTag: { backgroundColor: colors.card, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  steps: { gap: 14 },
  stepBlock: { gap: 10 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  num: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.greenTint, alignItems: 'center', justifyContent: 'center' },
  clip: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.greenTint, borderRadius: 24, paddingVertical: 16, paddingHorizontal: 18 },
  clipPlay: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  tip: { marginLeft: 46, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.greenTint, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14 },
  tipPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  film: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.yolk, borderRadius: radii.panel, paddingVertical: 20, paddingHorizontal: 22, boxShadow: shadows.cta },
  filmDot: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  seeAll: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
});

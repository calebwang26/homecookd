// Small pieces shared by the recipe flow screens, sized exactly as the bible draws them.
//  AskStepPill "Ask Dad" on a cook-mode step (52 tall, cream, 1.5px rgba(31,36,48,0.12) outline,
//              15/600 ink, a chat glyph): opens my 1:1 with the dish's cook, the dish and step
//              in the box (ask=1), so the next message is a question about that step; a dish with no
//              cook in the family reads "Ask the family" (the circle, any cook can answer). ask=1
//              also lets a cook who asks carry the dish (the chat shows the chip for cooks too)
//  RecipeFacts the overview's "~45 min   Serves 4", big (A-Overview: 22/700 ink, clock and people)
//  StepList    the overview's "N steps": per step, the green number and the title. Nothing else
//  IngredientChecklist  the overview's "Ingredients": "~1 tbsp kosher salt" (amount bold), tap to
//              tick it; ticks are saved per profile + dish (progress.ts) and get the hand-drawn strike
//  BottomBar   the pinned bottom row (left/right 24, bottom 28) over a soft page-colour fade so
//              scrolled content slips under it
//  CookAvatar  the cook as a person in this family (their photo only if their profile has one, else
//              their initial), else a library cook by name (the demo cooks' faces, else the initial)
//  useScreenTop / useScreenBottom: the bible's 56 / 28 px, never closer than the safe area allows
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { Avatar, ChatIcon, CheckIcon, ClockIcon, PressableScale, Txt, useToast } from '@/components/ui';
import { errorMessage, type Profile } from '@/lib/api';
import { openChatWith, openCircle } from '@/lib/messaging';
import { cookProfile } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import type { Recipe, Step } from '@/lib/types';
import { alpha, colors, radii, shadows } from '@/theme/tokens';

import { ingredientKey, useChecklist } from './progress';
import { StepNumber } from './StepNumber';
import { StruckText } from './Strike';
import { cap, ingredientLines, servingsLabel, spokenIngredient, timeLabel, type IngredientLine } from './text';

export function useScreenTop(): number {
  const insets = useSafeAreaInsets();
  return Math.max(56, insets.top + 4);
}

export function useScreenBottom(): number {
  const insets = useSafeAreaInsets();
  return Math.max(28, insets.bottom + 6);
}

/** Who a step question goes to: the dish's cook (1:1), the family circle, or nobody (my own dish, or no other cook). */
export type AskTarget = { kind: 'cook'; cook: Profile } | { kind: 'family' } | null;

export function useAskTarget(recipe: Pick<Recipe, 'cook'> | null | undefined): AskTarget {
  const { profiles, me, cooks } = useSession();
  const cook = cookProfile(recipe, profiles);
  if (cook) return cook.id === me?.id ? null : { kind: 'cook', cook };
  return cooks.some((c) => c.id !== me?.id) ? { kind: 'family' } : null;
}

/** "Ask Dad" (or "Ask the family") under a step's Watch and Hear. Full width. */
export function AskStepPill({ recipe, step, target }: { recipe: Pick<Recipe, 'id'>; step: number; target: NonNullable<AskTarget> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const who = target.kind === 'cook' ? target.cook.name : 'the family';
  const ask = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = target.kind === 'cook' ? await openChatWith(target.cook.id) : await openCircle();
      router.push({ pathname: '/chat/[id]', params: { id, recipe: recipe.id, step: String(step), ask: '1' } });
    } catch (e) {
      toast.show(errorMessage(e, `Couldn’t reach ${who} right now.`), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <PressableScale onPress={ask} disabled={busy} accessibilityLabel={`Ask ${who} about step ${step}`} style={styles.pill}>
      <ChatIcon size={18} color={colors.ink} />
      <Txt variant="label" size={15} weight={600} color={colors.ink} numberOfLines={1} style={styles.pillText}>
        {`Ask ${who}`}
      </Txt>
    </PressableScale>
  );
}

/** Two people (A-Overview's "Serves 4"; the ui kit has no such icon). */
function PeopleIcon({ size = 24, color = colors.ink }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 19.5a6.5 6.5 0 0 1 13 0" />
      <Path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 19.5a6.5 6.5 0 0 0-4.5-6.2" />
    </Svg>
  );
}

/** "~45 min   Serves 4" (each only when known; nothing at all when neither is). */
export function RecipeFacts({ recipe }: { recipe: Pick<Recipe, 'total_time' | 'servings'> }) {
  const time = timeLabel(recipe.total_time);
  const serves = servingsLabel(recipe.servings);
  if (!time && !serves) return null;
  return (
    <View style={styles.facts}>
      {time ? (
        <View style={styles.fact} accessible accessibilityLabel={`Takes about ${time.replace(/^~/, '')}`}>
          <ClockIcon size={24} color={colors.ink} />
          <Txt variant="title" size={22} leading={1.25} style={styles.factText}>
            {time}
          </Txt>
        </View>
      ) : null}
      {serves ? (
        <View style={styles.fact} accessible accessibilityLabel={cap(serves)}>
          <PeopleIcon />
          <Txt variant="title" size={22} leading={1.25} style={styles.factText}>
            {cap(serves)}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

/** "6 steps", then one row per step: the green number and the title. */
export function StepList({ steps }: { steps: Pick<Step, 'order' | 'title'>[] }) {
  if (!steps.length) return null;
  return (
    <View style={styles.stepSection}>
      <Txt variant="section" accessibilityRole="header">
        {steps.length === 1 ? '1 step' : `${steps.length} steps`}
      </Txt>
      <View accessibilityRole="list">
        {steps.map((s, i) => (
          <View key={`${s.order}-${i}`} style={[styles.stepRow, i ? styles.divider : null]} accessible accessibilityLabel={`Step ${i + 1}, ${s.title}`}>
            <StepNumber n={i + 1} size={32} />
            <Txt variant="heading" size={17} leading={1.35} style={styles.stepTitle}>
              {s.title}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One ingredient line's height (DM Sans 17 at 1.35), for the strike on web, which can't measure lines. */
const INGREDIENT_LINE = 23;

/** "Ingredients": every line in one cream card; tap a row to tick it off. Nothing when there are none. */
export function IngredientChecklist({ recipe }: { recipe: Pick<Recipe, 'id' | 'ingredients'> }) {
  const checklist = useChecklist(recipe.id);
  const lines = useMemo(() => ingredientLines(recipe.ingredients), [recipe.ingredients]);
  if (!lines.length) return null;
  return (
    <View style={styles.ingredientSection}>
      <Txt variant="section" accessibilityRole="header">
        Ingredients
      </Txt>
      <View style={styles.card} accessibilityRole="list">
        {lines.map((line, i) => {
          const k = ingredientKey(recipe.ingredients[i], i);
          return <CheckRow key={k} line={line} seed={i} done={checklist.has(k)} settled={checklist.loaded} onToggle={() => checklist.toggle(k)} />;
        })}
      </View>
    </View>
  );
}

function CheckRow({ line, seed, done, settled, onToggle }: { line: IngredientLine; seed: number; done: boolean; settled: boolean; onToggle: () => void }) {
  const on = useDerivedValue(() => withTiming(done ? 1 : 0, { duration: 180 }), [done]);
  const pop = useDerivedValue(() => (done ? withSpring(1, { damping: 14, stiffness: 320, mass: 1 }) : withTiming(0, { duration: 120 })), [done]);
  const disc = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.value, [0, 1], ['rgba(52,67,12,0)', colors.green]),
    borderColor: interpolateColor(on.value, [0, 1], [alpha.checkRing, 'rgba(52,67,12,0)']),
  }));
  const tick = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.6 + 0.4 * pop.value }] }));
  const color = done ? colors.muted : colors.ink;

  return (
    <PressableScale
      onPress={onToggle}
      haptic
      scaleTo={0.98}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      // react-native-web drops accessibilityState.checked; aria-checked reaches the browser too.
      aria-checked={done}
      accessibilityLabel={spokenIngredient(line)}
      style={styles.row}>
      <Animated.View style={[styles.disc, disc]}>
        <Animated.View style={tick}>
          <CheckIcon size={16} strokeWidth={3} color={colors.card} />
        </Animated.View>
      </Animated.View>
      <View style={styles.rowText}>
        <StruckText done={done} settled={settled} seed={seed} lineHeight={INGREDIENT_LINE}>
          <Txt variant="bodyInk" size={17} leading={1.35} color={color}>
            {line.amount ? (
              <Txt variant="bodyInk" size={17} weight={700} leading={1.35} color={color}>
                {line.amount}{' '}
              </Txt>
            ) : null}
            {line.name}
            {line.note ? (
              <Txt variant="meta" size={15} color={colors.muted}>
                {` · ${line.note}`}
              </Txt>
            ) : null}
          </Txt>
        </StruckText>
      </View>
    </PressableScale>
  );
}

export function BottomBar({ children, fade = true }: { children: ReactNode; fade?: boolean }) {
  const bottom = useScreenBottom();
  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingBottom: bottom }]}>
      {fade ? (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(251,245,234,0)', 'rgba(251,245,234,0.94)', colors.page]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={styles.barRow}>{children}</View>
    </View>
  );
}

/** Height the scroll content needs at the bottom to clear a BottomBar holding a 60 px button. */
export function useBottomClearance(): number {
  return useScreenBottom() + 60 + 28;
}

export function CookAvatar({ recipe, size = 24 }: { recipe: Pick<Recipe, 'cook'>; size?: number }) {
  const { profiles } = useSession();
  const p = cookProfile(recipe, profiles);
  return p ? <Avatar profile={p} size={size} /> : <Avatar name={recipe.cook.name} size={size} />;
}

/** The dish's cook as someone else in this family (they can be asked), else null (a library cook, or me). */
export function useOtherCook(recipe: Pick<Recipe, 'cook'> | null | undefined): Profile | null {
  const { profiles, me } = useSession();
  const p = cookProfile(recipe, profiles);
  return p && p.id !== me?.id ? p : null;
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: alpha.border,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  pillText: { flexShrink: 1 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 22, rowGap: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  factText: { flexShrink: 1 },
  stepSection: { gap: 6 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: colors.well },
  // (32 circle - 23 line) / 2: a one-line title sits centred on its number.
  stepTitle: { flex: 1, paddingTop: 4.5 },
  ingredientSection: { gap: 10 },
  card: { borderRadius: radii.panel, backgroundColor: colors.card, boxShadow: shadows.card, paddingVertical: 6, paddingHorizontal: 8 },
  row: { minHeight: 52, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  disc: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowText: { flex: 1 },
  bar:{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 36 },
  barRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 24 },
});

// "Ingredients" on a cook-mode step (kid QA round 2, notes 13 and 14): exactly what this step needs,
// one line each, the amount in bold then the name, worded as the overview words them (text.ts
// ingredientLine). From the recipe's `uses` (pipeline/shorten.py), else the ingredients matched to the
// step (lib/recipes stepIngredients). A step that needs none shows nothing: no placeholders.
import { StyleSheet, View } from 'react-native';

import { Txt } from '@/components/ui';
import { stepIngredients } from '@/lib/recipes';
import type { Recipe, Step } from '@/lib/types';
import { colors } from '@/theme/tokens';

import { stepUses, wordAmount } from './steps';
import { ingredientLine, spokenIngredient } from './text';

export function StepIngredients({ recipe, step }: { recipe: Recipe; step: Step }) {
  const lines = stepUses(step, recipe.ingredients, () => stepIngredients(recipe, step)).map((ing) => wordAmount(ing) ?? ingredientLine(ing));
  if (!lines.length) return null;
  return (
    <View style={styles.wrap}>
      <Txt variant="label" size={15} weight={700} accessibilityRole="header">
        Ingredients
      </Txt>
      <View style={styles.card}>
        {lines.map((line, i) => (
          <View
            key={`${line.amount}-${line.name}-${i}`}
            style={[styles.row, i ? styles.hair : null]}
            accessible
            accessibilityLabel={spokenIngredient({ ...line, note: null })}>
            <Txt variant="bodyInk" size={17} leading={1.4} color={colors.text}>
              {line.amount ? (
                <Txt variant="bodyInk" size={17} leading={1.4} weight={700} color={colors.ink}>
                  {`${line.amount} `}
                </Txt>
              ) : null}
              {line.name}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 16 },
  row: { paddingVertical: 12 },
  hair: { borderTopWidth: 1, borderTopColor: colors.well },
});

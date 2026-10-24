// The kid's Recipes tab is a stack: the list, then a dish (/kid/recipes/<id>, the same recipe screen
// as /recipe/<id>). Every dish a kid opens anywhere lands here (lib/navigation openRecipe), so Back
// returns to the list. The tab bar hides on the dish (kid/_layout). Ingredients and cook mode stay
// root screens over the tabs.
import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

export const unstable_settings = { initialRouteName: 'index' };

export default function KidRecipesStack() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page }, animation: 'fade', animationDuration: 260 }}>
      <Stack.Screen name="index" options={{ title: 'Recipes' }} />
      {/* One dish at a time: opening another dish replaces it, so Back always means the list. */}
      <Stack.Screen name="[id]" options={{ title: 'Recipe' }} dangerouslySingular={() => 'dish'} />
    </Stack>
  );
}

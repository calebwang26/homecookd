// Parent (cook) tabs: Home | Messages | Recipes, on the bible's floating pill tab bar. Record is a
// pushed screen (/record), opened from Home.
// While the phone is lent, each tab shows "Cooking as Grandma" at the top of its own content.
// A cook who hasn't picked her language yet gets the language screen first (components/language).
import { Tabs } from 'expo-router/js-tabs';

import { LanguageTiles } from '@/components/language/LanguageTiles';
import { BookIcon, ChatIcon, FloatingTabBar, HomeIcon } from '@/components/ui';
import { useAiConsent } from '@/lib/aiConsent';
import { useUnread } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme';

function useMessagesBadge(): number | undefined {
  return useUnread().total || undefined;
}

export default function ParentTabs() {
  const messages = useMessagesBadge();
  // Nothing of home mounts before "Before we start" (the root layout sends them there).
  const consent = useAiConsent();
  const { t, needsChoice } = useWords();
  if (consent !== 'given') return null;
  if (needsChoice) return <LanguageTiles />;
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}>
      <Tabs.Screen name="home" options={{ title: t('parent.tab.home'), tabBarIcon: ({ color }) => <HomeIcon color={String(color)} /> }} />
      <Tabs.Screen
        name="messages"
        options={{ title: t('parent.tab.messages'), tabBarBadge: messages || undefined, tabBarIcon: ({ color }) => <ChatIcon color={String(color)} /> }}
      />
      <Tabs.Screen name="recipes" options={{ title: t('parent.tab.recipes'), tabBarIcon: ({ color }) => <BookIcon color={String(color)} /> }} />
    </Tabs>
  );
}

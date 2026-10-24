// Parent (cook) tabs: Home | Messages | Recipes, on the bible's floating pill tab bar. Record is a
// pushed screen (/record), opened from Home.
// While the phone is lent, each tab shows "Cooking as Grandma" at the top of its own content.
import { Tabs } from 'expo-router/js-tabs';

import { BookIcon, ChatIcon, FloatingTabBar, HomeIcon } from '@/components/ui';
import { useUnread } from '@/lib/session';
import { colors } from '@/theme';

function useMessagesBadge(): number | undefined {
  return useUnread().total || undefined;
}

export default function ParentTabs() {
  const messages = useMessagesBadge();
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.page } }}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: ({ color }) => <HomeIcon color={String(color)} /> }} />
      <Tabs.Screen
        name="messages"
        options={{ title: 'Messages', tabBarBadge: messages || undefined, tabBarIcon: ({ color }) => <ChatIcon color={String(color)} /> }}
      />
      <Tabs.Screen name="recipes" options={{ title: 'Recipes', tabBarIcon: ({ color }) => <BookIcon color={String(color)} /> }} />
    </Tabs>
  );
}

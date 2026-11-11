// "Update homecookd" (lib/appUpdate.ts has the machine and the rules): a card on parent Home and kid Home when the App
// Store has a newer homecookd than this phone's own build. "Update" opens homecookd in the App Store; "Later" hides it
// (SNOOZE_MS, or until a newer store version). A card, never a blocking screen: the one check per launch runs after Home
// shows, and offline, slow or odd answers just mean no card.
// One machine for the whole launch, held outside React, so both Homes (and a person switch) share one check and one "Later".
// Dev aid (web screenshots only): Home's `?preview=update` shows the card.
import * as Updates from 'expo-updates';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { ActionButton, listEnter, Txt } from '@/components/ui';
import { APP_STORE_URL, appUpdateMachine, lookupStoreVersion, runCheck, SNOOZE_KEY, type Snooze } from '@/lib/appUpdate';
import { holdMachine } from '@/lib/machine';
import { kvGetJson, kvSetJson } from '@/lib/storage';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

const PREVIEW = __DEV__ && Platform.OS === 'web' && /[?&]preview=update\b/.test(globalThis.location?.search ?? '');

const listeners = new Set<() => void>();
const held = holdMachine(appUpdateMachine, 'idle', () => {
  for (const l of listeners) l();
});
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** The store version the card offers, for "Later" to save. */
let offered: string | null = null;

/** This phone's own build version: the runtime version, which app.json's policy makes the native app version. */
function ownVersion(): string | null {
  try {
    return Updates.runtimeVersion ?? null;
  } catch {
    return null;
  }
}

function checkOnce() {
  if (held.now() !== 'idle') return;
  void runCheck(held.send, {
    ios: Platform.OS === 'ios',
    own: ownVersion(),
    lookup: () => lookupStoreVersion(),
    snooze: () => kvGetJson<Snooze>(SNOOZE_KEY),
    now: Date.now,
  }).then((v) => {
    if (v) offered = v;
  });
}

export function AppUpdateCard({ enterIndex = 0, style }: { enterIndex?: number; style?: StyleProp<ViewStyle> }) {
  const { t } = useWords();
  const state = useSyncExternalStore(subscribe, held.now, held.now);
  const [preview, setPreview] = useState(PREVIEW);
  useEffect(() => {
    if (!PREVIEW) checkOnce();
  }, []);
  if (state !== 'offered' && !preview) return null;

  const update = () => {
    if (!preview) void Linking.openURL(APP_STORE_URL).catch(() => {});
  };
  const later = () => {
    if (preview) return setPreview(false);
    const version = offered;
    if (held.send('later') && version) void kvSetJson(SNOOZE_KEY, { version, at: Date.now() } satisfies Snooze);
  };

  return (
    <Animated.View entering={listEnter(enterIndex)} style={[styles.card, style]}>
      <Txt variant="display" size={28} leading={1.15} accessibilityRole="header">
        {t('common.appUpdate.title')}
      </Txt>
      <Txt variant="body" size={19} color={colors.muted}>
        {t('common.appUpdate.line')}
      </Txt>
      <View style={styles.buttons}>
        <ActionButton label={t('common.appUpdate.update')} size="xl" flat onPress={update} accessibilityHint={t('common.appUpdate.updateHint')} />
        <ActionButton label={t('common.appUpdate.later')} size="lg" variant="outline" onPress={later} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.panel, padding: 22, gap: 14, boxShadow: shadows.card },
  buttons: { gap: 12, marginTop: 6 },
});

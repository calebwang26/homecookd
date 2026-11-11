// "Update homecookd" (lib/appUpdate.ts has the machine and the rules): a popup in the middle of the screen over blurred
// glass, on parent Home and kid Home, when the App Store has a newer homecookd than this phone's own build. Caleb, Nov 10:
// "the background of the popup is like blurry glass. And then so that the popup stands out and the popup should be in
// the middle of the screen". Home's own layout never moves under it. "Update" opens homecookd in the App Store;
// "Later" closes it (SNOOZE_MS, or until a newer store version).
// It is a BottomSheet (placement "center"), so its Modal goes through the sheet coordinator as every sheet's does, and it
// is the lowest of them (popupShows): it comes up only when no sheet's Modal is up, and gives way to any sheet that
// wants to present ("Dad is on a new phone", the push ask), coming back once that has gone. No timer anywhere.
// Never blocking: Later always closes it, and so does a tap on the glass (TODO(caleb): the glass is "Later" too, saved
// the same; the other choice is that a tap there does nothing).
// VoiceOver: a modal view it can't leave for Home underneath (role "dialog" on the web), the title as a heading, then
// Update and Later, both buttons.
// One machine for the whole launch, held outside React, so both Homes (and a person switch) share one check and one "Later".
// Dev aid (web screenshots only): Home's `?preview=update` shows the popup, through the same rules.
import { useIsFocused } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { useLaunchPhase } from '@/components/LaunchSplash';
import { ActionButton, BottomSheet, Txt } from '@/components/ui';
import { APP_STORE_URL, appUpdateMachine, lookupStoreVersion, popupShows, runCheck, SNOOZE_KEY, type Snooze } from '@/lib/appUpdate';
import { holdMachine } from '@/lib/machine';
import { useSheetsHeld, useSheetsUp } from '@/lib/sheets/coordinator';
import { kvGetJson, kvSetJson } from '@/lib/storage';
import { useWords } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';

const PREVIEW = __DEV__ && Platform.OS === 'web' && /[?&]preview=update\b/.test(globalThis.location?.search ?? '');

const listeners = new Set<() => void>();
const held = holdMachine(appUpdateMachine, 'idle', () => {
  for (const l of listeners) l();
});
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** The store version the popup offers, for "Later" to save. */
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

export function AppUpdatePopup() {
  const { t } = useWords();
  const state = useSyncExternalStore(subscribe, held.now, held.now);
  const [preview, setPreview] = useState(PREVIEW);
  const homeOnScreen = useIsFocused();
  const bloom = useLaunchPhase();
  const sheetsUp = useSheetsUp();
  const sheetsHeld = useSheetsHeld();
  useEffect(() => {
    if (!PREVIEW) checkOnce();
  }, []);

  // Up or not, from the screen and the sheets' own state (popupShows), decided while rendering as PushAskHost does.
  const [up, setUp] = useState(false);
  const next = popupShows(up, { state: preview ? 'offered' : state, homeOnScreen, bloom, sheetsUp, sheetsHeld });
  if (next !== up) setUp(next);

  const update = () => {
    if (!preview) void Linking.openURL(APP_STORE_URL).catch(() => {});
  };
  const later = () => {
    if (preview) return setPreview(false);
    const version = offered;
    if (held.send('later') && version) void kvSetJson(SNOOZE_KEY, { version, at: Date.now() } satisfies Snooze);
  };

  return (
    <BottomSheet
      visible={up}
      placement="center"
      onClose={later}
      onDropped={() => {}}
      showClose={false}
      dismissOnDrag={false}
      accessibilityLabel={t('common.appUpdate.title')}
      contentStyle={styles.body}>
      <Txt variant="display" size={30} leading={1.15} align="center" accessibilityRole="header">
        {t('common.appUpdate.title')}
      </Txt>
      <Txt variant="body" size={19} align="center" color={colors.muted}>
        {t('common.appUpdate.line')}
      </Txt>
      <View style={styles.buttons}>
        <ActionButton label={t('common.appUpdate.update')} size="xl" flat onPress={update} accessibilityHint={t('common.appUpdate.updateHint')} />
        <ActionButton label={t('common.appUpdate.later')} size="lg" variant="outline" onPress={later} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  buttons: { gap: 12, marginTop: 12 },
});

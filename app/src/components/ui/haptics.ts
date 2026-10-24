// Haptics that never throw and do nothing on web.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticKind = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error';

export function haptic(kind: HapticKind = 'selection') {
  if (Platform.OS === 'web') return;
  try {
    let p: Promise<void>;
    switch (kind) {
      case 'selection':
        p = Haptics.selectionAsync();
        break;
      case 'light':
        p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'success':
        p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
    p.catch(() => {});
  } catch {
    // Haptics are a nicety; never let them break a tap.
  }
}

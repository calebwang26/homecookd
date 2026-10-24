// "Continue with Apple" and "Continue with Google" for the first screen, 56 tall, full width.
//   Apple   the system button (expo-apple-authentication's AppleAuthenticationButton: CONTINUE,
//           BLACK), with pill corners like every big button in the app (Apple's HIG allows any
//           corner radius). iOS only.
//   Google  Google's own branding: white, the four-colour G, "Continue with Google", a 1 px
//           #747775 border, a medium-weight label in the system font (Roboto Medium on Android).
//           Only in builds that have it.
// Only buttons that can work on this phone show (useSignInProviders). The web can't sign in either
// way, so it draws look-alikes of both for screenshots; tapping one says sign-in works in the app.
// While one is signing in, a spinner covers it and neither takes another tap.
import * as AppleAuthentication from 'expo-apple-authentication';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/ui';
import { useSignInProviders } from '@/lib/auth';
import { motion } from '@/theme/tokens';

export type Provider = 'apple' | 'google';

const HEIGHT = 56;
const WEB = Platform.OS === 'web';
// Google's light-theme button colours (developers.google.com/identity/branding-guidelines).
const GOOGLE = { bg: '#FFFFFF', border: '#747775', ink: '#1F1F1F' };

/** Which buttons will show here (the web shows both look-alikes). */
export function useProviderButtons(): { apple: boolean; google: boolean } {
  const { apple, google } = useSignInProviders();
  return WEB ? { apple: true, google: true } : { apple, google };
}

export function ProviderButtons({ busy, onPress }: { busy: Provider | null; onPress: (p: Provider) => void }) {
  const show = useProviderButtons();
  if (!show.apple && !show.google) return null;
  const tap = (p: Provider) => {
    if (!busy) onPress(p);
  };
  return (
    <View style={styles.stack}>
      {show.apple ? (
        <View style={[styles.slot, busy && busy !== 'apple' ? styles.dim : null]} pointerEvents={busy ? 'none' : 'auto'}>
          {WEB ? (
            <AppleLookAlike onPress={() => tap('apple')} />
          ) : (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={HEIGHT / 2}
              style={styles.fill}
              onPress={() => tap('apple')}
            />
          )}
          {busy === 'apple' ? <Busy bg="#000000" fg="#FFFFFF" /> : null}
        </View>
      ) : null}
      {show.google ? (
        <View style={[styles.slot, busy && busy !== 'google' ? styles.dim : null]} pointerEvents={busy ? 'none' : 'auto'}>
          <PressableScale
            onPress={() => tap('google')}
            accessibilityLabel="Continue with Google"
            style={[styles.fill, styles.pill, styles.google]}>
            <GoogleMark size={20} />
            <Text style={[styles.systemLabel, styles.googleLabel]} numberOfLines={1}>
              Continue with Google
            </Text>
          </PressableScale>
          {busy === 'google' ? <Busy bg={GOOGLE.bg} fg={GOOGLE.ink} border /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** The spinner that stands in for a button's label while it signs in (same as ActionButton). */
function Busy({ bg, fg, border }: { bg: string; fg: string; border?: boolean }) {
  return (
    <Animated.View
      entering={FadeIn.duration(motion.crossfadeMs)}
      style={[StyleSheet.absoluteFill, styles.pill, styles.center, { backgroundColor: bg }, border ? styles.googleBorder : null]}
      accessibilityLabel="Signing in"
      accessibilityState={{ busy: true }}>
      <ActivityIndicator color={fg} />
    </Animated.View>
  );
}

/** Web only (screenshots): the system Apple button as iOS draws it. */
function AppleLookAlike({ onPress }: { onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityLabel="Continue with Apple" style={[styles.fill, styles.pill, styles.appleWeb]}>
      <Svg width={20} height={24} viewBox="0 0 17 20">
        <Path
          fill="#FFFFFF"
          d="M14.06 10.6c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.63 1.11 8.8.73 1.06 1.6 2.25 2.75 2.21 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.33-3.56zM11.86 4.13c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.69-.93 2.69.98.08 1.98-.5 2.59-1.23z"
        />
      </Svg>
      <Text style={[styles.systemLabel, styles.appleLabel]} numberOfLines={1}>
        Continue with Apple
      </Text>
    </PressableScale>
  );
}

/** Google's standard four-colour "G" (never recoloured). */
export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  slot: { height: HEIGHT, width: '100%' },
  dim: { opacity: 0.45 },
  fill: { width: '100%', height: HEIGHT },
  pill: { borderRadius: HEIGHT / 2 },
  center: { alignItems: 'center', justifyContent: 'center' },
  google: {
    backgroundColor: GOOGLE.bg,
    borderWidth: 1,
    borderColor: GOOGLE.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  googleBorder: { borderWidth: 1, borderColor: GOOGLE.border },
  appleWeb: { backgroundColor: '#000000', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
  // The system font, as on Apple's own button (and Roboto, Google's font, on Android).
  systemLabel: { fontSize: 19, fontWeight: '600', letterSpacing: -0.2 },
  appleLabel: { color: '#FFFFFF' },
  googleLabel: { color: GOOGLE.ink, fontWeight: '500' },
});

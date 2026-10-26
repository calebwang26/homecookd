// The frame and small parts every sign-in screen shares (join, join-code, i, r), in the bible's
// Main look: the peach wash, the pot + "homecookd" row (a Back pill on the right when there's
// somewhere to go back to), a Fraunces 40 headline and at most one short line under it.
//
//   <SignInScreen onBack={...}>
//     <Headline title="Family code" line="You're in Our family." />
//     <SignInField ... />  <ErrorLine error={error} />  <SmallLink label="Not now" onPress={...} />
//     <TermsLine />   ("By continuing you agree to our Terms of use and Privacy policy.", under a way in)
//   </SignInScreen>
//
// Children stack with a 32 gap; give the last group `marginTop: 'auto'` to sit it at the bottom.
import { forwardRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackPill, Brand, PressableScale, ScreenWash, Txt, usePotMood } from '@/components/ui';
import { openPage, PRIVACY_URL, TERMS_URL } from '@/lib/links';
import { useWords } from '@/lib/words/useWords';
import { english, type T } from '@/lib/words/words';
import { colors, fonts, radii, shadows } from '@/theme/tokens';

export function SignInScreen({ onBack, children }: { onBack?: (() => void) | null; children?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const potMood = usePotMood();
  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenWash tone="parent" height={420} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(64, insets.top + 16), paddingBottom: Math.max(32, insets.bottom + 16) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Brand mood={potMood} style={styles.brand} />
          {onBack ? (
            <Animated.View entering={FadeIn.duration(180)}>
              <BackPill onPress={onBack} style={styles.back} />
            </Animated.View>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** The one Fraunces 40 headline, and at most one short line under it. */
export function Headline({ title, line, lineColor }: { title: string; line?: string | null; lineColor?: string }) {
  return (
    <View style={styles.headline}>
      <Txt variant="display" size={40} leading={1.08} accessibilityRole="header" style={styles.title}>
        {title}
      </Txt>
      {line ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <Txt variant="lead" color={lineColor}>
            {line}
          </Txt>
        </Animated.View>
      ) : null}
    </View>
  );
}

export type SignInFieldProps = TextInputProps & {
  /** Red border (the error sentence goes in an <ErrorLine> under the field). */
  invalid?: boolean;
  /** A code: centered, letter-spaced, semibold. */
  code?: boolean;
  /** Room on the right for a button laid over the field. */
  padRight?: number;
};

/** The bible's cream field: 64 tall, radius 20, a green ring while typing. */
export const SignInField = forwardRef<TextInput, SignInFieldProps>(function SignInField(
  { invalid, code, padRight, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor="rgba(95,99,82,0.45)"
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.field,
        code ? styles.fieldCode : null,
        padRight ? { paddingRight: padRight } : null,
        focused ? styles.fieldFocused : null,
        invalid ? styles.fieldError : null,
        style,
      ]}
    />
  );
});

/**
 * Server text that isn't written for people ("No route for POST /invites/accept", "Request failed
 * (404).") reads as our trouble instead. Everything else is already a sentence that says what to do.
 */
export function plainError(message: string | null | undefined, t: T = english): string | null {
  const m = (message ?? '').trim();
  if (!m) return null;
  if (/^No route\b|^Request failed \(\d+\)|\bheader\)?\.?$/i.test(m)) return t('signin.error.ourSide');
  return m;
}

/** A sentence that says what went wrong and what to do (read out by screen readers), at body size. */
export function ErrorLine({ error, align }: { error: string | null | undefined; align?: 'center' }) {
  const { t } = useWords();
  const text = plainError(error, t);
  if (!text) return null;
  return (
    <Animated.View entering={FadeIn.duration(180)}>
      <Txt variant="body" color={colors.danger} align={align} accessibilityRole="alert" accessibilityLiveRegion="polite">
        {text}
      </Txt>
    </Animated.View>
  );
}

/** The small green text link ("Have a family code?", "Not now"), 48 tall to tap. `color`: a quieter one. */
export function SmallLink({
  label,
  onPress,
  hint,
  color = colors.greenDeep,
  style,
}: {
  label: string;
  onPress: () => void;
  hint?: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="link" accessibilityLabel={label} accessibilityHint={hint} style={[styles.link, style]}>
      <Txt variant="label" color={color}>
        {label}
      </Txt>
    </PressableScale>
  );
}

/** The small print under a way in: the Terms of use and Privacy policy, each opening homecookd.app. */
export function TermsLine() {
  const { t } = useWords();
  // One sentence with the two links in its {holes}, wherever her language puts them.
  return (
    <Txt variant="meta" align="center" style={styles.terms}>
      {t('signin.terms.line')
        .split(/\{(terms|privacy)\}/)
        .map((part, i) =>
          i % 2 === 0 ? (
            part
          ) : part === 'terms' ? (
            <TermsLink key={i} label={t('signin.terms.terms')} url={TERMS_URL} />
          ) : (
            <TermsLink key={i} label={t('signin.shared.privacy')} url={PRIVACY_URL} />
          ),
        )}
    </Txt>
  );
}

function TermsLink({ label, url }: { label: string; url: string }) {
  const { t } = useWords();
  return (
    <Txt variant="meta" weight={600} color={colors.greenDeep} onPress={() => void openPage(url)} accessibilityRole="link" accessibilityHint={t('signin.shared.opensSite')}>
      {label}
    </Txt>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 24, gap: 32, flexGrow: 1 },
  topRow: { height: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { height: 32 },
  back: { alignSelf: 'auto' },
  headline: { gap: 10 },
  // Matches "Who's in the kitchen?" (static Fraunces 500 is a touch wide at 40).
  title: { letterSpacing: -1.44 },
  field: {
    height: 64,
    borderRadius: radii.quote,
    backgroundColor: colors.card,
    boxShadow: shadows.field,
    paddingHorizontal: 20,
    fontFamily: fonts.sans,
    fontSize: 19,
    color: colors.ink,
    borderWidth: 1.5,
    borderColor: 'transparent',
    outlineWidth: 0,
  },
  fieldCode: { fontFamily: fonts.sansSemi, fontSize: 22, letterSpacing: 2, textAlign: 'center' },
  fieldFocused: { borderColor: colors.green },
  fieldError: { borderColor: colors.danger },
  link: { alignSelf: 'center', minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  terms: { paddingHorizontal: 8, lineHeight: 21 },
});

// "Paste invite" on the first screen, for someone who installed homecookd from an invite's web page
// ("Get the app" put the link on the clipboard, and the page says "In the app, tap Paste invite.").
//   iOS 16+    the row "Paste invite" with the system Paste button (expo-clipboard's
//              ClipboardPasteButton, Apple's UIPasteControl): it reads the clipboard without the
//              "Allow Paste" prompt. The 6 letters the web page shows are typed on the code screen
//              instead: the first screen's one small link reads "Have a code?" (see PASTE_BUTTON).
//   elsewhere  "Have an invite code?" opens one field for those 6 letters (a pasted link works
//              there too), and the small link stays "Have a family code?".
// `primary`: the row is the screen's main way in (green Paste); else Paste is quiet (sage), so the
// first screen keeps one strong button. useInviteOnClipboard() says when to promote it: iOS can tell
// a link is on the clipboard without reading it (no prompt, no banner).
// The web (screenshots only) draws the iPhone row; its Paste reads the browser's clipboard.
// Whatever comes in goes through parseInviteInput: an invite or share link -> onInvite(input);
// anything else shows a sentence saying what to do, right under the row.
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';

import { ArrowRightIcon, ChevronRightIcon, IconButton, PressableScale, Txt } from '@/components/ui';
import { NOT_AN_INVITE, parseInviteInput, type InviteInput } from '@/lib/auth';
import { colors, radii, shadows } from '@/theme/tokens';

import { ErrorLine, SignInField } from './SignInScreen';

const WEB = Platform.OS === 'web';
const NATIVE_PASTE = Platform.OS === 'ios' && safePasteAvailable();
/**
 * The Paste invite row shows (iOS 16+, and the web's look-alike). Then there's no invite-code field
 * on the first screen, so its one small link says "Have a code?" (family or invite code).
 */
export const PASTE_BUTTON = NATIVE_PASTE || WEB;
const BAD_PASTE = `${NOT_AN_INVITE} Copy the whole link, then tap Paste.`;
const BAD_CODE = `${NOT_AN_INVITE} Check the 6 letters and try again.`;

function safePasteAvailable(): boolean {
  try {
    return Clipboard.isPasteButtonAvailable === true;
  } catch {
    return false;
  }
}

/** One paste can arrive as several items (a link and its text, an image): the first invite wins. */
const SAME_PASTE_MS = 1000;

/**
 * True while the clipboard holds a link (iOS only; checked on open and on coming back to the app).
 * It never reads the clipboard, so nothing is asked or shown.
 */
export function useInviteOnClipboard(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let alive = true;
    const check = () =>
      void Clipboard.hasUrlAsync()
        .then((v) => {
          if (alive) setHas(v);
        })
        .catch(() => {});
    check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return has;
}

export function PasteInvite({
  onInvite,
  codeOnly,
  primary,
}: {
  onInvite: (input: InviteInput) => void;
  /** Dev: show the code fallback. */
  codeOnly?: boolean;
  /** The screen's main way in: a green Paste (else a quiet one). */
  primary?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const paste = !codeOnly && PASTE_BUTTON;
  const tookAt = useRef(0);
  const badLater = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (badLater.current) clearTimeout(badLater.current);
    },
    [],
  );

  const take = (text: string | null | undefined) => {
    const input = parseInviteInput(text);
    if (input) {
      if (Date.now() - tookAt.current < SAME_PASTE_MS) return;
      tookAt.current = Date.now();
      if (badLater.current) clearTimeout(badLater.current);
      setError(null);
      onInvite(input);
      return;
    }
    // Only say so when no other item of the same paste was an invite.
    if (badLater.current) clearTimeout(badLater.current);
    badLater.current = setTimeout(() => {
      if (Date.now() - tookAt.current > SAME_PASTE_MS) setError(BAD_PASTE);
    }, 250);
  };

  const typed = (text: string) => {
    const input = parseInviteInput(text);
    setError(input ? null : BAD_CODE);
    if (input) onInvite(input);
  };

  return (
    <View style={styles.wrap}>
      {paste ? (
        <PasteRow onPaste={take} primary={!!primary} />
      ) : (
        <CodeRow onCode={typed} onEdit={() => setError(null)} />
      )}
      <ErrorLine error={error} />
    </View>
  );
}

/** `onPaste(null)` = something that isn't text (an image). */
function PasteRow({ onPaste, primary }: { onPaste: (text: string | null) => void; primary: boolean }) {
  const [bg, fg] = primary ? [colors.green, colors.card] : [colors.sage, colors.sageInk];
  return (
    <View style={styles.row}>
      <Txt variant="heading" style={styles.rowLabel} numberOfLines={2}>
        Paste invite
      </Txt>
      {NATIVE_PASTE ? (
        <Clipboard.ClipboardPasteButton
          // A new look needs a fresh native button.
          key={primary ? 'primary' : 'quiet'}
          onPress={(data) => onPaste(data.type === 'text' ? data.text : null)}
          acceptedContentTypes={['plain-text', 'url']}
          displayMode="iconAndLabel"
          cornerStyle="capsule"
          backgroundColor={bg}
          foregroundColor={fg}
          style={styles.paste}
        />
      ) : (
        <WebPaste onPaste={onPaste} bg={bg} fg={fg} />
      )}
    </View>
  );
}

/** Web only: the system Paste button as iOS draws it, reading the browser clipboard. */
function WebPaste({ onPaste, bg, fg }: { onPaste: (text: string | null) => void; bg: string; fg: string }) {
  return (
    <PressableScale
      onPress={async () => onPaste(await Clipboard.getStringAsync().catch(() => null))}
      accessibilityLabel="Paste"
      style={[styles.paste, styles.webPaste, { backgroundColor: bg }]}>
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Rect x={5} y={4} width={14} height={17} rx={2.5} />
        <Path d="M9 4.5V3.5h6v1M9 11h6M9 15h4" />
      </Svg>
      <Txt variant="button" size={17} weight={600} color={fg}>
        Paste
      </Txt>
    </PressableScale>
  );
}

/** "Have an invite code?" -> one field for the 6 letters, with a round arrow to go. */
function CodeRow({ onCode, onEdit }: { onCode: (text: string) => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const go = () => {
    if (code.trim()) onCode(code);
  };

  if (!open) {
    return (
      <PressableScale scaleTo={0.97} onPress={() => setOpen(true)} accessibilityLabel="Have an invite code?" accessibilityHint="Opens a field for the code" style={styles.row}>
        <Txt variant="heading" style={styles.rowLabel}>
          Have an invite code?
        </Txt>
        <View style={styles.chevron}>
          <ChevronRightIcon size={22} color={colors.greenDeep} />
        </View>
      </PressableScale>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <SignInField
        code
        value={code}
        onChangeText={(t) => {
          setCode(t.toUpperCase());
          onEdit();
        }}
        placeholder="6-letter code"
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        autoFocus={!WEB}
        returnKeyType="go"
        onSubmitEditing={go}
        maxLength={300}
        padRight={64}
        accessibilityLabel="Invite code"
      />
      <IconButton
        tone="green"
        size={48}
        icon={(c) => <ArrowRightIcon size={22} color={c} />}
        accessibilityLabel="Use this invite code"
        onPress={go}
        disabled={!code.trim()}
        style={[styles.go, !code.trim() ? styles.goOff : null]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: {
    minHeight: 72,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    boxShadow: shadows.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 12,
    paddingVertical: 12,
  },
  rowLabel: { flex: 1 },
  paste: { width: 116, height: 48 },
  webPaste: {
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  chevron: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  go: { position: 'absolute', right: 8, top: 8 },
  goOff: { opacity: 0.45 },
});

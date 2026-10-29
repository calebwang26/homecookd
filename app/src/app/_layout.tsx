// Root: Hearth fonts (Fraunces + DM Sans, never blocking more than 2.5 s), the app-wide providers
// (session, toasts, Watch/Hear sheet, share sheet), the Stack, and the launch bloom once per cold start.
// SessionGate sends a phone with no family to the first screen (join), and a family with nobody picked
// to "Who's in the kitchen?". Join (/i), recipe (/r), dinner-invite (/d) and dish-card (/miss, /a)
// links pass through either way; any other link opened before anyone was picked opens on top of their
// home once it shows. setLinksMoved hands the session Convex's links.moved (lib/live imports the
// session, so it can't import lib/live): after a move, a solo family's recipes come along.
// PushBridge (RETENTION-HANDOFF 2.3) opens the screen a tapped push points at (the same hold covers a
// push that launched the app), files this phone's push token under its person (with the api, and with
// Convex through lib/live/pushTokens), and starts "heard" logging; PushAskHost is the one "Want a note
// when…?" sheet any screen can ask for. HomieOverlay is homie, the pot that rests top-right on every
// screen (components/homie). AiConsentHost is the one "homecookd uses AI for this" sheet, raised the
// first time something would go to the AI companies (lib/aiConsent). ResendUnsent sends, in the
// background and as its cook, an in-app recording the app died before finishing
// (components/record/useResendUnsent).
//
// Stack motion (docs/design/ANIMATIONS.md 3): detail screens use a quick fade underneath their own
// Reanimated hero/content entrances; drill-down screens (ingredients -> steps, chat) slide.
import { setAudioModeAsync } from 'expo-audio';
import {
  DefaultTheme,
  type Href,
  Stack,
  ThemeProvider,
  useGlobalSearchParams,
  usePathname,
  useRootNavigationState,
  useRouter,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AiConsentHost } from '@/components/consent/AiConsentSheet';
import { HomieOverlay } from '@/components/homie';
import { LaunchSplash } from '@/components/LaunchSplash';
import { MediaSheetProvider } from '@/components/media';
import { useResendUnsent } from '@/components/record/useResendUnsent';
import { PushAskHost } from '@/components/push/PushAskSheet';
import { holdAfterPick, holdPushAfterPick, linkSearch, openHeld, peekAfterPick, takeAfterPick } from '@/components/signin/handoff';
import { ToastProvider } from '@/components/ui';
import { forgetAiConsent, useAiConsent } from '@/lib/aiConsent';
import { api } from '@/lib/api';
import { HOMIE_ON } from '@/lib/homie/switch';
import { registerHeardLogging } from '@/lib/listening';
import { linksMoved } from '@/lib/live/links';
import { convexPush } from '@/lib/live/pushTokens';
import { PLAYBACK_AUDIO_MODE } from '@/lib/media';
import { openRecipe } from '@/lib/navigation';
import { addTapListener, initPush, pushUrl, setConvexPush, syncRegistration, type PushData, type PushPlatform } from '@/lib/push';
import { SessionProvider, setLinksMoved, useSession } from '@/lib/session';
import { ShareSheetProvider } from '@/lib/share';
import { UiLanguageProvider } from '@/lib/words/useWords';
import { colors } from '@/theme/tokens';
import { useAppFonts } from '@/theme/fonts';

SplashScreen.preventAutoHideAsync().catch(() => {});
setConvexPush(convexPush);
setLinksMoved(linksMoved);

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.green,
    background: colors.page,
    card: colors.page,
    text: colors.ink,
    border: 'transparent',
  },
};

/**
 * The bloom plays once per cold start. On the web it is skipped for deep links and the `?as=` dev
 * aid, so headless screenshots of a screen show that screen.
 */
function shouldPlaySplash(): boolean {
  if (Platform.OS !== 'web') return true;
  try {
    const loc = globalThis.location;
    if (!loc) return false;
    const q = new URLSearchParams(loc.search);
    return (loc.pathname === '/' || loc.pathname === '') && !q.has('as') && !q.has('nosplash');
  } catch {
    return false;
  }
}

export default function RootLayout() {
  const fonts = useAppFonts();
  const [splash, setSplash] = useState(shouldPlaySplash);
  // Resending an unsent recording reaches the AI companies too: only once this phone said yes (it
  // waits for that yes and never asks on its own).
  const aiOk = useAiConsent() === 'given';

  useEffect(() => {
    if (fonts.ready) SplashScreen.hideAsync().catch(() => {});
  }, [fonts.ready]);

  useEffect(() => {
    // "Hear the cook" must play even with the iPhone's silent switch on.
    setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {});
  }, []);

  if (!fonts.ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={navTheme}>
        <SessionProvider>
          <UiLanguageProvider>
          <ToastProvider>
            <MediaSheetProvider>
              <ShareSheetProvider>
                <StatusBar style="dark" />
                <AppStack />
                <SessionGate />
                <PushBridge />
                {aiOk ? <ResendUnsent /> : null}
                <PushAskHost register={registerPush} />
                {HOMIE_ON ? <HomieOverlay /> : null}
                <AiConsentHost />
              </ShareSheetProvider>
            </MediaSheetProvider>
          </ToastProvider>
          </UiLanguageProvider>
        </SessionProvider>
        {splash ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <LaunchSplash onDone={() => setSplash(false)} />
          </View>
        ) : null}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function AppStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.page },
        animation: 'fade',
        animationDuration: 260,
      }}>
      <Stack.Screen name="index" options={{ title: 'Who’s in the kitchen?', animation: 'fade' }} />
      <Stack.Screen name="join" options={{ title: 'Sign in', animation: 'fade' }} />
      <Stack.Screen name="i" options={{ title: 'Invite', animation: 'fade' }} />
      <Stack.Screen name="r" options={{ title: 'homecookd', animation: 'none' }} />
      <Stack.Screen name="d" options={{ title: 'Dinner invite', animation: 'fade' }} />
      <Stack.Screen name="kid" options={{ title: 'homecookd', animation: 'fade' }} />
      <Stack.Screen name="parent" options={{ title: 'homecookd', animation: 'fade' }} />
      <Stack.Screen name="recipe/[id]/index" options={{ title: 'Recipe', animation: 'fade' }} />
      {/* Old links only: it redirects to the recipe. */}
      <Stack.Screen name="recipe/[id]/ingredients" options={{ title: 'Recipe', animation: 'fade' }} />
      {/* Edge swipe only: iOS 26's full-screen swipe-back would take over dragging the step clip's bar. */}
      <Stack.Screen name="cook/[id]" options={{ title: 'Cook', animation: 'slide_from_right', gestureEnabled: true, fullScreenGestureEnabled: false }} />
      <Stack.Screen name="my-recipe/[id]" options={{ title: 'Your recipe', animation: 'fade' }} />
      <Stack.Screen name="chat/[id]" options={{ title: 'Chat', animation: 'slide_from_right' }} />
      <Stack.Screen name="send" options={{ title: 'Send your recipe', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="record" options={{ title: 'Record', animation: 'slide_from_right' }} />
      {/* Grandma cooking while homie listens; the walkie-talkie answer to a kid's question. */}
      <Stack.Screen name="recording" options={{ title: 'Recording', animation: 'slide_from_right' }} />
      <Stack.Screen name="answer/[id]" options={{ title: 'Answer', animation: 'slide_from_bottom' }} />
      {/* A kid's ask (Phase 5): the request, her 2-minute voice recipe, then "Sent". */}
      <Stack.Screen name="request/[id]" options={{ title: 'Request', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="request/voice" options={{ title: 'Tell how you make it', animation: 'slide_from_right' }} />
      <Stack.Screen name="request/sent" options={{ title: 'Sent', animation: 'fade', gestureEnabled: false }} />
      <Stack.Screen name="dish/[id]" options={{ title: 'Dish', animation: 'slide_from_right' }} />
      {/* Month in the kitchen (RETENTION-HANDOFF 3.7): full screen, so Home doesn't peek behind the story; Close is always on screen. */}
      <Stack.Screen name="recap" options={{ title: 'Your month in the kitchen', presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="+not-found" options={{ title: 'homecookd', animation: 'fade' }} />
    </Stack>
  );
}

function ResendUnsent() {
  useResendUnsent();
  return null;
}

/** Screens that work without a signed-in phone: the first screen, join, recipe, dinner-invite and dish-card links. */
const SIGNED_OUT_ROUTES = new Set(['/join', '/i', '/r', '/d', '/miss', '/a']);
/** Screens that work without a chosen profile. */
const OPEN_ROUTES = new Set(['/', ...SIGNED_OUT_ROUTES]);
/** A held link waits this long after home appears, so it opens on top of home (Back lands there). */
const AFTER_PICK_DELAY_MS = 350;

/**
 * Without a family on this phone, every route leads to the first screen (sign-in). With one but
 * nobody chosen (every cold start: the profile lives in memory only), every route leads to "Who's
 * in the kitchen?". `?as=` picks the profile before status turns ready, so dev screenshots pass
 * straight. A recipe link opened before anyone was picked (r.tsx), or any other screen a link
 * opened on (a dish, a chat, /my-recipe/<id>), is held and opens once their home shows.
 */
function SessionGate() {
  const { status, me, homeFor } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = linkSearch(useGlobalSearchParams(), useSegments());
  const navReady = !!useRootNavigationState()?.key;
  // Only a link from before the first pick is held: once someone was in, a screen left behind
  // (a removed person's chat) belongs to them, not to whoever is picked next.
  const picked = useRef(false);
  useEffect(() => {
    if (me) picked.current = true;
  }, [me]);
  useEffect(() => {
    // The dev screens and the sitemap send themselves home in a production build (dev/_layout, _sitemap).
    if (!navReady || pathname.startsWith('/dev') || pathname === '/_sitemap') return;
    if (status === 'needs-code') {
      if (SIGNED_OUT_ROUTES.has(pathname)) return;
      // Signed out (removed from the family): nothing of that family's screens stays under /join.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/join');
      return;
    }
    if ((status === 'ready' || status === 'offline') && !me && !OPEN_ROUTES.has(pathname)) {
      if (!picked.current) holdAfterPick(pathname, search);
      // Drop the old profile's screens too (e.g. a warm resume deep in a chat), so Back can't reach them.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    }
  }, [navReady, status, me, pathname, search, router]);

  // Signed out: whoever signs in next on this phone may be someone else, so they're asked again.
  useEffect(() => {
    if (status === 'needs-code') void forgetAiConsent();
  }, [status]);

  const home = me ? homeFor(me) : null;
  const meId = me?.id ?? null;
  useEffect(() => {
    if (!navReady || !home || pathname !== home) return;
    const held = peekAfterPick();
    if (!held) return;
    const t = setTimeout(() => {
      if (takeAfterPick() !== held) return;
      // A push for someone else on this shared phone: "Who's in the kitchen?", never their chat.
      if (held.for && held.for !== meId) router.push('/?pick=1');
      else openHeld(router, held, home);
    }, AFTER_PICK_DELAY_MS);
    return () => clearTimeout(t);
  }, [navReady, home, meId, pathname, router]);
  return null;
}

const registerPush = (token: string, platform: PushPlatform) => api.pushToken({ token, platform });

/** '/recipe/<id>' from a push ("Just in from Dad"): the id, else null. */
const RECIPE_PUSH = /^\/recipe\/([a-z0-9][a-z0-9-]{0,99})$/;

/**
 * Push on this phone. No banner for the screen already showing; a tapped push opens its screen
 * (a dish opens where that person's dishes live; a push for someone else on a shared phone opens
 * "Who's in the kitchen?"); the token follows whoever this phone belongs to. Before anyone is picked
 * (a push that launched the app), SessionGate holds the link and opens it after the pick, only if
 * the person picked is the one it was sent to (else "Who's in the kitchen?"). Also
 * starts "heard" logging. No-ops on web and in Expo Go (lib/push.ts).
 */
function PushBridge() {
  const { me, owner, credentialVersion } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const navReady = !!useRootNavigationState()?.key;
  const here = useRef(pathname);
  const meId = useRef<string | null>(null);
  useEffect(() => {
    here.current = pathname;
    meId.current = me?.id ?? null;
  }, [pathname, me?.id]);
  useEffect(() => {
    registerHeardLogging();
    void initPush((url) => url === here.current);
  }, []);
  // The phone's own person, else whoever is cooking on a shared phone (the server moves the token).
  // Only once someone is in: the call acts as them. Never prompts (that's PushAskHost's job). Again
  // after a new key for the same person (signing in on a shared phone): the server's row still
  // points at the old key, which adopt() revokes, so the next push would drop it.
  const person = owner?.id ?? me?.id ?? null;
  const signedIn = !!me;
  useEffect(() => {
    if (person && signedIn) void syncRegistration({ register: registerPush, key: `${credentialVersion}|${person}`, profileId: person });
  }, [person, signedIn, credentialVersion]);
  useEffect(() => {
    if (!navReady) return;
    const open = {
      push: (href: Href) => {
        const dish = typeof href === 'string' ? RECIPE_PUSH.exec(href) : null;
        if (dish && meId.current) openRecipe(router, dish[1]);
        else router.push(href);
      },
    };
    return addTapListener(open, (data: PushData) => {
      const url = pushUrl(data);
      const forId = typeof data.profile_id === 'string' ? data.profile_id : null;
      if (!url || !forId) return url;
      // Nobody in yet (a tap that launched the app, before the session loads): hold it for that
      // person. "/" enters this phone's person, and SessionGate opens it only if it's them.
      if (!meId.current) {
        holdPushAfterPick(url, forId);
        return null;
      }
      return forId !== meId.current ? '/?pick=1' : url;
    });
  }, [navReady, router]);
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
});

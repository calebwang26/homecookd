// homie for a screen.
//
//   const slot = useHomieSlot()                  where the pot rests here: lay the header out around it
//                                                (chips under it start at slot.y + slot.size + HOMIE_LABEL_SPACE)
//   useHomieScreen({ dock: { x, y, size } })     rest somewhere else while this screen is focused
//   useHomieScreen({ hidden: true })             no pot on this screen
//   useHomieScreen({ onPress: toggleMic })       a tap does this instead of the screen's help line
//   useAiSpeaking()                              true while homie or any AI say is speaking (what the
//                                                screen shows: "AI voice" under the pot, nothing over it)
//   useHalfDuplex()                              true while the app itself makes sound: homie lit or
//                                                speaking, anything on the shared player, a step video.
//                                                Meanwhile each mic frame goes out as zeroed PCM of the
//                                                same length (STACK.md); lib/live/mic does that for
//                                                every caller, on each frame (logic halfDuplex)
import { useFocusEffect, usePathname } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNowPlaying, useVideoPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';

import { halfDuplex, homieRoute, restFrame, sayPhase, type HomieRoute } from './logic';
import { claimScreen, releaseScreen, useHomieSelect, type HomieFrame } from './store';

/** This screen's homie rules (hidden, help line) and the resting frame, before any dock. */
export function useHomieRoute(): { route: HomieRoute; frame: HomieFrame } {
  const pathname = usePathname();
  const { me } = useSession();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const route = homieRoute(pathname, me?.name ?? '');
  return { route, frame: restFrame(route, { width, insetsTop: insets.top }) };
}

/** Where the pot rests on this screen (a dock if one is set). */
export function useHomieSlot(): HomieFrame {
  const { frame } = useHomieRoute();
  return useHomieSelect((h) => h.dock) ?? frame;
}

export function useHomieScreen({ dock, hidden = false, onPress }: { dock?: HomieFrame | null; hidden?: boolean; onPress?: (() => void) | null }) {
  const [owner] = useState(() => ({}));
  const press = useRef(onPress);
  useEffect(() => {
    press.current = onPress;
  });
  const hasPress = !!onPress;
  const x = dock?.x;
  const y = dock?.y;
  const size = dock?.size;
  useFocusEffect(
    useCallback(() => {
      const frame = x != null && y != null && size != null ? { x, y, size } : undefined;
      claimScreen(owner, { dock: frame, hidden, onPress: hasPress ? () => press.current?.() : undefined });
      return () => releaseScreen(owner);
    }, [owner, x, y, size, hidden, hasPress]),
  );
}

export function useAiSpeaking(): boolean {
  const now = useNowPlaying();
  const speaking = useHomieSelect((h) => h.state === 'speaking');
  return sayPhase(now.key, now.phase) !== 'none' || speaking;
}

export function useHalfDuplex(): boolean {
  const now = useNowPlaying();
  const homie = useHomieSelect((h) => h.state);
  const video = useVideoPlaying();
  return halfDuplex({ homie, audio: now.phase, video });
}

// Loads the brand kit's three families: Fraunces 400/500/600 (+ italics), DM Sans 400/500/600/700 and
// Caveat 500/700 (only for what the cook "wrote").
// Never blocks longer than 2.5 s: after that (or on an error) `ready` is true and text falls back
// to the system font until the files arrive.
import { Caveat_500Medium } from '@expo-google-fonts/caveat/500Medium';
import { Caveat_700Bold } from '@expo-google-fonts/caveat/700Bold';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { DMSans_700Bold } from '@expo-google-fonts/dm-sans/700Bold';
import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { Fraunces_400Regular_Italic } from '@expo-google-fonts/fraunces/400Regular_Italic';
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces/500Medium';
import { Fraunces_500Medium_Italic } from '@expo-google-fonts/fraunces/500Medium_Italic';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { useFonts } from 'expo-font';
import { useEffect, useState } from 'react';

export const appFonts = {
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_500Medium_Italic,
  Fraunces_600SemiBold,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  Caveat_500Medium,
  Caveat_700Bold,
};

export const FONT_TIMEOUT_MS = 2500;

/** `{ loaded, ready }`: loaded = every face is in; ready = safe to render (loaded, failed or timed out). */
export function useAppFonts() {
  const [loaded, error] = useFonts(appFonts);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), FONT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);
  return { loaded, error, ready: loaded || !!error || timedOut };
}

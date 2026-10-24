// The pot mascot's moods where the brand row shows (retention PR 7, RETENTION-HANDOFF 4): sleepy from
// 22:00 to 06:00, waving on Sunday, by the phone's own clock (lib/touches potMoodAt; the web's dev
// `?now=` clock in screenshots). Only the brand row uses it ("Who's in the kitchen?" and the sign-in
// screens), never a photo placeholder or an image someone shares. Not the launch bloom: its steam and
// sparkle already sit where the z's and the arm go.
//   usePotMood()            the mood now, re-read every minute while shown
//   <BrandPot size mood />  PotMark with the mood; waving rocks the pot twice from its base when it
//                           first shows (about 1 s), then rests with the arm up. Reduce Motion: no rock.
import { useEffect, useState } from 'react';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { getNow } from '@/lib/recommend';
import { potMoodAt, type PotMood } from '@/lib/touches';

import { PotMark } from './icons';

export type { PotMood };

export function usePotMood(): PotMood {
  const [mood, setMood] = useState<PotMood>(() => potMoodAt(getNow()));
  useEffect(() => {
    const t = setInterval(() => setMood(potMoodAt(getNow())), 60_000);
    return () => clearInterval(t);
  }, []);
  return mood;
}

export function BrandPot({ size, mood }: { size: number; mood: PotMood }) {
  const reduce = useReducedMotion();
  const tilt = useSharedValue(0);
  useEffect(() => {
    if (mood !== 'waving' || reduce) {
      tilt.value = 0;
      return;
    }
    const ease = Easing.inOut(Easing.quad);
    tilt.value = withDelay(
      350,
      withSequence(
        withTiming(-7, { duration: 180, easing: ease }),
        withTiming(7, { duration: 220, easing: ease }),
        withTiming(-5, { duration: 200, easing: ease }),
        withTiming(4, { duration: 180, easing: ease }),
        withTiming(0, { duration: 160, easing: ease }),
      ),
    );
  }, [mood, reduce, tilt]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  return (
    <Animated.View style={[{ transformOrigin: '50% 90%' }, style]}>
      <PotMark size={size} mood={mood} />
    </Animated.View>
  );
}

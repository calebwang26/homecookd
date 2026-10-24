// Sign-in building blocks for the first screens (join, i, paste invite). SessionProvider does the
// signing in (useSession().signInWithApple() and friends); this says which buttons can work on this
// phone and reads pasted invites.
//
//   const { apple, google } = useSignInProviders(); // hide a button that is false
//   const x = parseInviteInput(text);               // null -> show NOT_AN_INVITE
//
// Apple: iOS only (Expo Go included). Google: dev and store builds with the client ids set; never
// in Expo Go or on the web. On the web both are false, so screens render their stand-ins there.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import * as apple from './apple';
import * as google from './google';

export { NOT_AN_INVITE, parseInviteInput, type InviteInput } from './links';

export type SignInProviders = { apple: boolean; google: boolean };

/** Which sign-in buttons work here. Apple starts as "iOS" and is confirmed a moment later. */
export function useSignInProviders(): SignInProviders {
  const [appleOk, setAppleOk] = useState(Platform.OS === 'ios');
  const [googleOk] = useState(google.isAvailable);
  useEffect(() => {
    let alive = true;
    void apple.isAvailable().then((ok) => {
      if (alive) setAppleOk(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { apple: appleOk, google: googleOk };
}

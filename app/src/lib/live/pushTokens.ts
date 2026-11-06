// This phone's push token in Convex (docs/build/V2-LINKING.md 1.2): Convex sends v2's pushes ("Mom
// answered", "Caleb is on homecookd"), the api keeps sending today's. lib/push.ts calls these in the
// background through setConvexPush (the root layout wires it), next to its api calls.
//   register    push.register as the person the token follows, with the phone's zone (quiet hours)
//   unregister  push.unregister on sign-out, with the session that registered the token, so it needs
//               no new session while the device key is going away
// Both are soft: before push.register is deployed they quietly do nothing.
import { AWS_ON } from '@/lib/aws/config';
import { messages } from '@/lib/aws/messages';
import type { ConvexPush } from '@/lib/push';

import { call, convexSession } from './convex';

let registeredWith: { token: string; sessionToken: string } | null = null;

/** 1.1 (AWS_ON): one token route for every push, as the person the token follows (the phone's own), with the zone. */
let awsOwner: { token: string; owner: string } | null = null;
const awsPush: ConvexPush = {
  async register(token, platform, tz, profileId) {
    if (!profileId) return;
    await messages.registerPush({ token, platform, tz }, profileId);
    awsOwner = { token, owner: profileId };
  },
  async unregister(token) {
    const held = awsOwner;
    awsOwner = null;
    if (!held || held.token !== token) return;
    await messages.removePush(token, held.owner);
  },
};

const convexOnly: ConvexPush = {
  async register(token, platform, tz, profileId) {
    const sessionToken = await convexSession(profileId ?? undefined);
    if (!sessionToken) return;
    await call('mutation', 'push:register', { sessionToken, token, platform, tz }, () => null, { soft: true });
    registeredWith = { token, sessionToken };
  },
  async unregister(token) {
    const held = registeredWith;
    registeredWith = null;
    if (!held || held.token !== token) return;
    await call('mutation', 'push:unregister', { sessionToken: held.sessionToken, token }, () => null, { soft: true });
  },
};

export const convexPush: ConvexPush = AWS_ON ? awsPush : convexOnly;

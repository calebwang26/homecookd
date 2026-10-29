// Who is using the app: the family this phone is signed in to, and the current profile.
//
//   <SessionProvider> ... </SessionProvider>           (root layout)
//   const { family, profiles, me, setMe, isCook, isLearner, refresh, status } = useSession();
//   const { total } = useUnread();                      (tab-bar badge; polls every 15 s)
//
// Signing in (docs/build/FEEDBACK-OCT16c.md B1). Each phone holds its own device key, saved in
// SecureStore (localStorage on the web) and sent as x-device-key; it is never logged or shown.
// The ways in, each resolving with a result to branch on (they never throw):
//   acceptInvite(tokenOrCode)            an invite link's token or its 6-letter code. An invite for
//                                        one person: in as them, now `me` (go to homeFor(me)). A
//                                        family invite (Oct 17, E3): in, with nobody picked, and
//                                        `deviceNeedsProfile` set (go to Profiles)
//   createSelf(name, role)               then, on Profiles, + under the cooks ('cook') or the ones
//                                        who miss it ('learner'): this phone's own person, now `me`
//                                        (the caller goes to homeFor(me))
//   signInWithApple / signInWithGoogle   a known person is in at once (Profiles next); someone new
//                                        gets `needs-name`, then finishSignIn({ name, role })
//                                        (role only when there was no share link)
//   joinFamily(code)                     the "Have a family code?" backup, swapped for a key too
//   joinByLink(ticket, name)             a dish card's link (docs/build/V2-LINKING.md 2.4): in as a new
//                                        person in the card's family, now `me`; 'unavailable' until
//                                        POST /auth/link is live (sign in with Apple or Google instead)
// Phones from before device keys have a saved family code: on boot it is swapped for a key
// (POST /devices) and then deleted. When the server refuses the key (401 "This phone was signed
// out.": someone removed this person), the key and the cache are cleared and status goes to
// `needs-code` with `error` "You were signed out of <Family>.". Only that answer, or "Sign out"
// (leaveFamily), ever signs this phone out (docs/agents/memory/never-signed-out-by-a-crash.md): any
// other error keeps the key and the cached family, and a keychain that can't be read at launch (a
// locked phone, a launch in the background) is read again when the app comes to the front. When the
// current person was removed from another phone (a 403 on their calls), nobody is picked any more:
// back to Profiles.
// `deviceProfileId` is the server's word for who holds this phone, trusted only when this phone
// signed in as a person (Apple, Google or an invite); a family-code phone is shared, so it's null.
// Locked faces (E1): someone with their own phone that isn't this one (`Profile.locked`). Only
// their phone can be them, so they are never `me` here: setMe() ignores them, and a person who
// becomes locked (they just signed in on their own phone) is let go at the next GET /family.
// Profiles come from GET /family and are cached, so the app opens offline with the last known family.
// One phone, one person: every launch goes straight to this phone's `defaultPerson`: its owner (a
// phone that signed in as someone: Apple, Google or an invite), else whoever was picked here last
// (a shared family-code phone). "Who's in the kitchen?" shows only before anyone is picked, for a
// phone that hasn't said who it is yet, or when someone taps their own face (`/?pick=1`) to cook as
// someone without a phone of their own. Every cold start goes through "/" (which enters the default
// person at once), and so does coming back after a long time away (RESUME_RESET_MS), unless the
// default person is already the one in.
// Web dev aid: `?as=<profile name>` (e.g. /kid/home?as=leo) selects that profile for that load,
// using EXPO_PUBLIC_FAMILY_CODE when this browser isn't signed in (headless screenshots). That
// code is never swapped for a key, so screenshots write nothing.
// Web dev aid: `/?profiles=locked,invited,needs&nosplash=1` draws "Who's in the kitchen?" from a
// made-up family with no API at all (states the server can't be put in for a screenshot): `locked`
// locks Dad and Leo, `invited` makes Maya invited, `needs` is a phone that came in through a family
// invite (Mom and Leo locked, "Tap + to add yourself."). createSelf() then adds them locally.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { AppState, Platform } from 'react-native';

import { haptic } from '@/components/ui/haptics';

import {
  api,
  ApiError,
  errorMessage,
  isSignedOutAnswer,
  setApiAuth,
  setApiTimeZone,
  setProfileRemovedHandler,
  setSignedOutHandler,
  SIGNED_OUT,
  type Family,
  type FamilyInfo,
  type InviteState,
  type Profile,
  type ProviderAuth,
  type ProviderAuthInput,
  type Role,
} from './api';
import * as apple from './auth/apple';
import * as google from './auth/google';
import { NOT_AN_INVITE, parseInviteInput } from './auth/links';
import { SignInError, type ProviderSignIn } from './auth/types';
import { lastMessagePushAt, unregister as unregisterPush } from './push';
import { kvGet, kvGetJson, kvSet, kvSetJson, secretGet, secretReadRetried, secretSet } from './storage';
import { buzzForUnread, TAP_WAIT_MS, tapStillDue, unreadSeenAfter, type UnreadSeen } from './touches';
import { deviceTimeZone } from './tz';

// Every signed-in call carries the phone's zone (x-tz): quiet hours, Sunday weeks, the 1st's recap.
// Not while the web `?as=` dev aid borrows the build's code (screenshots never write a zone).
setApiTimeZone(deviceTimeZone());

const ENV_CODE = (process.env.EXPO_PUBLIC_FAMILY_CODE ?? '').trim();

/** The web `?as=` dev aid is borrowing the build's code right now (see devAid in SessionProvider). */
let devAidOn = false;
/**
 * True while the web `?as=` dev aid borrows the build's code: screens skip writes that happen on
 * their own (cook mode's live session), so a screenshot never writes to that family.
 */
export function usingDevAid(): boolean {
  return devAidOn;
}
const KEY_DEVICE = 'deviceKey';
/** Legacy: the family code phones saved before device keys. Swapped for a key, then deleted. */
const KEY_CODE = 'familyCode';
const KEY_FAMILY = 'family';
/** How this phone's key came: 'person' (Apple, Google or an invite) or 'code' (a family code). */
const KEY_VIA = 'deviceVia';
/** Legacy: the profile used to be remembered across launches. Cleared on boot. */
const KEY_ME = 'me';
/** Who was picked on this phone last ({ familyId, id }): the default person on a shared phone. */
const KEY_LAST = 'lastPerson';
/** The profile id this phone signed in with Apple, so deleting that account can revoke it (auth/apple asksApple). */
const KEY_APPLE = 'appleSignIn.v1';
type LastPerson = { familyId: string; id: string };
const UNREAD_POLL_MS = 15_000;
/** Back from the background after this long = pick who's cooking again (short switches stay put). */
const RESUME_RESET_MS = 30 * 60_000;
const MAX_NAME = 40;

export type SessionStatus =
  | 'loading' // reading storage / first GET /family
  | 'ready' // family + profiles known (maybe from cache while offline)
  | 'needs-code' // not signed in, or the server refused this phone: show the first screen
  | 'offline'; // no cache and the server can't be reached

/** `shareToken` = the `/join?s=` link they came from: someone new joins that family as a learner. */
export type SignInOptions = { shareToken?: string | null };

export type SignInResult =
  /** In. "Who's in the kitchen?" comes next. */
  | { status: 'signed-in'; familyName: string; profileId: string | null; existing: boolean; joined: boolean }
  /**
   * Someone new: ask "What does your family call you?" (prefilled with `suggestedName`, maybe ''),
   * then, when `needsRole`, Record a dish (cook) / Learn a dish (learner); then finishSignIn().
   */
  | { status: 'needs-name'; suggestedName: string; needsRole: boolean }
  /** They closed the Apple or Google sheet: show nothing. */
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

export type FinishSignInResult =
  | Extract<SignInResult, { status: 'signed-in' }>
  /** Fixable here (a taken name, offline): show `error` and let them try again. */
  | { status: 'error'; error: string }
  /** The Apple / Google sign-in is gone (it went stale): show `error` with the sign-in buttons again. */
  | { status: 'restart'; error: string };

export type AcceptInviteResult =
  /**
   * In. An invite for one person: they are `me` now (go to homeFor(me)). `me` is null for a family
   * invite (they add themselves on "Who's in the kitchen?") or when the family couldn't load yet:
   * go to "/" either way.
   */
  | { status: 'joined'; familyName: string; me: Profile | null }
  /** Used, expired or turned off. `error` is the server's sentence; add "Ask <inviter> for a new one." */
  | { status: 'gone'; error: string; invite: Exclude<InviteState, 'pending'> }
  /** Not an invite, not found, offline or server trouble: show `error` with a way to try again. */
  | { status: 'error'; error: string };

export type JoinResult = { ok: true; family: Family } | { ok: false; error: string };

export type JoinByLinkResult =
  /** In as the new person (`profileId`), who is `me` now (`me` is null only when the family couldn't load yet). */
  | { status: 'joined'; familyName: string; profileId: string; me: Profile | null }
  /** POST /auth/link isn't live (404, 503) or refused the ticket (403): sign in first instead. */
  | { status: 'unavailable' }
  /** "Mom is already in this family", or a name it won't take: ask for another and send the same ticket. */
  | { status: 'name'; error: string }
  /** That side of the card already brought someone in. */
  | { status: 'taken'; error: string }
  | { status: 'error'; error: string };

/** createSelf(): in as the new person (`me`), or a sentence to show under the name field. */
export type CreateSelfResult = { ok: true; me: Profile } | { ok: false; error: string };

/**
 * Whose account this phone may delete, by POST /profiles/:id/remove's rules (docs/build/API.md):
 * 'own' is this phone's own person (deleting them signs this phone out); 'phoneless' is someone with no
 * phone of their own who isn't locked or only invited (Grandma on Mom's iPad; this phone stays in).
 */
export type AccountRemoval = 'own' | 'phoneless';

/**
 * deleteAccount(): gone, and whether that signed this phone out (the caller then calls leaveFamily,
 * else forgetPerson); or a sentence to show, and nothing has changed on this phone.
 */
export type DeleteAccountResult = { ok: true; signedOut: boolean } | { ok: false; error: string };

export type Session = {
  status: SessionStatus;
  /** This phone holds a family credential (its device key, or a family code not swapped yet). */
  signedIn: boolean;
  /**
   * Goes up whenever this phone's credential changes (a new key from a sign-in, a code swapped for a
   * key, sign-out). Never the key itself. For work tied to the key, e.g. push registration (the
   * server's token row points at the key it was registered with, and an old key gets revoked).
   */
  credentialVersion: number;
  family: Family | null;
  profiles: Profile[];
  cooks: Profile[];
  learners: Profile[];
  me: Profile | null;
  isCook: boolean;
  isLearner: boolean;
  /** Who signed in on this phone (Apple, Google or an invite); null on a family-code phone. */
  deviceProfileId: string | null;
  /**
   * Who signed in with Apple on this phone (from Oct 25; older sign-ins don't say), for "Delete my
   * account" to revoke it (auth/apple asksApple). null after any other way in, and after sign-out.
   */
  appleProfileId: string | null;
  /**
   * This phone's own person (its `deviceProfileId`, still in the family): the app opens straight to
   * them. null on a shared family-code phone or before the phone has said who it is.
   */
  owner: Profile | null;
  /**
   * Who this phone opens to: its owner, else whoever was picked here last (still in the family, not
   * on their own phone elsewhere, not only invited). null = "Who's in the kitchen?" asks.
   */
  defaultPerson: Profile | null;
  /**
   * This phone came in through a family invite and hasn't said who it is yet: Profiles reads "Tap +
   * to add yourself." and + becomes createSelf(). Tapping a face that isn't locked works too.
   */
  deviceNeedsProfile: boolean;
  /**
   * This phone's person may answer "<Name> is on a new phone" (GET /family `can_manage`: settled, a
   * day after their first phone joined, or the family's first person). True on an older server.
   */
  canManage: boolean;
  /** Last error sentence (safe to show), e.g. "You were signed out of Our family." on the first screen. */
  error: string | null;
  /** Pick the current profile (object, id or name). null = back to "Who's in the kitchen?". */
  setMe: (who: Profile | string | null) => void;
  /** Re-fetch GET /family. Resolves true when the family answered. */
  refresh: () => Promise<boolean>;
  /** Sign in with Apple (iOS). Check useSignInProviders() from '@/lib/auth' before showing the button. */
  signInWithApple: (opts?: SignInOptions) => Promise<SignInResult>;
  /** Sign in with Google (dev and store builds with the client ids set). */
  signInWithGoogle: (opts?: SignInOptions) => Promise<SignInResult>;
  /** After `needs-name`: their name and, without a share link, cook or learner. */
  finishSignIn: (input: { name: string; role?: Role | null }) => Promise<FinishSignInResult>;
  /** Use an invite (a link, its token or its 6-letter code). Joining another family replaces this one. */
  acceptInvite: (tokenOrCode: string) => Promise<AcceptInviteResult>;
  /** Check a family code, swap it for this phone's own key and switch to that family (Profiles next). */
  joinFamily: (code: string) => Promise<JoinResult>;
  /** A dish card's join ticket (/link/open): a new person, `name` (else the card's), in its family. */
  joinByLink: (ticket: string, name: string | null) => Promise<JoinByLinkResult>;
  /**
   * "This is me" (a phone with `deviceNeedsProfile`): adds this phone's own person to the family
   * (POST /profiles/self), reloads the family and makes them `me`. The caller goes to their home.
   * 409 sentences ("Dad is already in this family. …") come back as `error`.
   */
  createSelf: (name: string, role: Role) => Promise<CreateSelfResult>;
  /** Sign this phone out (its key stops working) and forget the family: back to the first screen. */
  leaveFamily: () => Promise<void>;
  /** Whether this phone may delete `p`'s account, and how (AccountRemoval); null when it may not. */
  accountRemoval: (p: Profile | null | undefined) => AccountRemoval | null;
  /**
   * "Delete my account" for `person` (accountRemoval says who): `erase` first (Convex's
   * account.deleteMe; lib/live imports this module, so the caller hands it in), then POST
   * /profiles/:id/remove. On `ok` the caller closes its sheet, then calls leaveFamily when
   * `signedOut`, else forgetPerson; until then a refused key isn't "You were signed out".
   */
  deleteAccount: (person: Profile, erase: (profileId: string) => Promise<unknown>) => Promise<DeleteAccountResult>;
  /** Someone deleted from this phone, which stays in: they leave the family here at once, then it reloads. */
  forgetPerson: (id: string) => void;
  /** Someone in the family, or someone removed (only so their old messages keep a name and face). */
  profileById: (id: string | null | undefined) => Profile | null;
  profileByName: (name: string | null | undefined) => Profile | null;
  /** "/kid/home" or "/parent/home" for a profile. */
  homeFor: (p: Profile) => '/kid/home' | '/parent/home';
};

type CachedFamily = {
  family: Family;
  profiles: Profile[];
  formerProfiles?: Profile[];
  deviceProfileId?: string | null;
  deviceNeedsProfile?: boolean;
  canManage?: boolean;
};
type Cred = { deviceKey: string | null; code: string | null };
type Provider = 'apple' | 'google';
type Via = 'person' | 'code';
/** A new person's Apple / Google sign-in, waiting for their name (memory only; never logged). */
type Pending = { provider: Provider; idToken: string; shareToken: string | null };

const NO_CRED: Cred = { deviceKey: null, code: null };
const credId = (c: Cred) => c.deviceKey ?? c.code;
const credAuth = (c: Cred) => (c.deviceKey ? { deviceKey: c.deviceKey } : { code: c.code });
const toCached = (res: FamilyInfo): CachedFamily => ({
  family: res.family,
  profiles: res.profiles,
  formerProfiles: Array.isArray(res.former_profiles) ? res.former_profiles : [],
  deviceProfileId: res.device_profile_id ?? null,
  deviceNeedsProfile: res.device_needs_profile === true,
  canManage: res.can_manage,
});

function removalOf(p: Profile | null | undefined, fam: CachedFamily | null): AccountRemoval | null {
  if (!p || !fam || fam.deviceNeedsProfile || !fam.profiles.some((x) => x.id === p.id)) return null;
  // The server's word, also for a swapped family code once it wrote as someone (device_profile_id).
  if (p.id === fam.deviceProfileId) return 'own';
  return !p.has_phone && !p.locked && !p.invited ? 'phoneless' : null;
}

/** How this phone shows up in the family's device list. */
function deviceLabel(): string {
  if (Platform.OS === 'ios') return Platform.isPad ? 'iPad' : 'iPhone';
  if (Platform.OS === 'android') return 'Android';
  return 'Web';
}

const providerAuth = (p: Provider, input: ProviderAuthInput) => (p === 'apple' ? api.authApple(input) : api.authGoogle(input));

/**
 * This phone's saved key: null when none is saved, undefined when the keychain can't answer while the
 * app isn't in front (a locked phone, a launch in the background), which is never "signed out"
 * (storage secretReadRetried).
 */
const readSavedKey = () => secretReadRetried(KEY_DEVICE);

/**
 * Save this phone's key and read it back: true only when it is really stored. Saved readable from the
 * first unlock after a restart, so a launch in the background (an upload finishing) can read it too.
 * The old item goes first: the keychain only changes the value of an item that's already there, not
 * when it can be read. (A key saved before Oct 24 keeps "while unlocked"; readSavedKey covers that.)
 */
async function saveKey(key: string): Promise<boolean> {
  await secretSet(KEY_DEVICE, null);
  await secretSet(KEY_DEVICE, key, { afterFirstUnlock: true });
  return (await secretGet(KEY_DEVICE)) === key;
}

/** A run already going hands back its promise, so a double tap signs in (or uses an invite) once. */
function singleFlight<R>(slot: { current: Promise<R> | null }, fn: () => Promise<R>): Promise<R> {
  if (slot.current) return slot.current;
  const run = fn().finally(() => {
    if (slot.current === run) slot.current = null;
  });
  slot.current = run;
  return run;
}

const SessionContext = createContext<Session | null>(null);

// Module snapshot for non-React helpers (lib/messaging.ts).
let snapshot: Session | null = null;
export function getSession(): Session | null {
  return snapshot;
}
function publishSnapshot(s: Session) {
  snapshot = s;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** `?as=` from the web URL, read once at startup. */
function webAsParam(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('as');
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** `?profiles=` (web dev only): a made-up family for screenshots, read once at startup. No API calls. */
function webProfilesFixture(): CachedFamily | null {
  if (!__DEV__ || Platform.OS !== 'web') return null;
  let flags: Set<string>;
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('profiles');
    if (!v) return null;
    flags = new Set(v.split(',').map((s) => s.trim().toLowerCase()));
  } catch {
    return null;
  }
  const needs = flags.has('needs');
  const locked = new Set(needs ? ['p-mom', 'p-leo'] : flags.has('locked') ? ['p-dad', 'p-leo'] : []);
  // The seeded demo family's faces (their avatar_keys), as in the bible's Main render.
  const person = (id: string, name: string, role: Role, avatar_key: string | null): Profile => ({
    id,
    name,
    role,
    relation: null,
    avatar_key,
    ...(locked.has(id) ? { locked: true, has_phone: true } : null),
    ...(id === 'p-maya' && flags.has('invited') ? { invited: true } : null),
  });
  return {
    family: { id: 'f-fixture', name: 'Our family' },
    profiles: [
      person('p-mom', 'Mom', 'cook', 'mom'),
      person('p-dad', 'Dad', 'cook', 'dad'),
      person('p-nainai', 'Nai Nai', 'cook', 'grandma'),
      person('p-leo', 'Leo', 'learner', 'leo'),
      person('p-maya', 'Maya', 'learner', null),
    ],
    formerProfiles: [],
    deviceProfileId: needs ? null : 'p-mom',
    deviceNeedsProfile: needs,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [cred, setCred] = useState<Cred>(NO_CRED);
  const [credentialVersion, setCredentialVersion] = useState(0);
  const [data, setData] = useState<CachedFamily | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [last, setLast] = useState<LastPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** This phone signed in as a person (Apple, Google, an invite), not with a shared family code. */
  const [personal, setPersonal] = useState(false);
  const [appleProfileId, setAppleProfileId] = useState<string | null>(null);
  const asParam = useRef<string | null>(webAsParam());
  const credRef = useRef<Cred>(NO_CRED);
  const dataRef = useRef<CachedFamily | null>(null);
  /** The credential is the build's dev-aid code: never swap it for a key. */
  const devAid = useRef(false);
  /** leaveFamily is running: a refused key on the way out is expected, not "You were signed out". */
  const leaving = useRef(false);
  const pending = useRef<Pending | null>(null);
  const signingIn = useRef<Promise<SignInResult> | null>(null);
  const finishing = useRef<Promise<FinishSignInResult> | null>(null);
  const accepting = useRef<Promise<AcceptInviteResult> | null>(null);
  const joining = useRef<Promise<JoinResult> | null>(null);
  const linking = useRef<Promise<JoinByLinkResult> | null>(null);
  const creating = useRef<Promise<CreateSelfResult> | null>(null);
  /** Web dev only: the `?profiles=` made-up family (no API at all). */
  const fixture = useRef<CachedFamily | null>(webProfilesFixture());
  /** The keychain couldn't be read at boot: boot again when the app comes to the front, or on refresh. */
  const keyUnread = useRef(false);
  const bootRef = useRef<() => Promise<boolean>>(async () => false);

  /** Point the session and the API client at a credential. */
  const setCredential = useCallback((c: Cred) => {
    if (credId(c)) keyUnread.current = false; // a sign-in meanwhile: nothing left to read
    if (credId(c) !== credId(credRef.current)) setCredentialVersion((v) => v + 1);
    credRef.current = c;
    setCred(c);
    setApiAuth({ deviceKey: c.deviceKey, code: c.code });
  }, []);

  const setVia = useCallback((via: Via | null) => {
    setPersonal(via === 'person');
    void kvSet(KEY_VIA, via);
  }, []);

  const rememberApple = useCallback((profileId: string | null) => {
    setAppleProfileId(profileId);
    void kvSet(KEY_APPLE, profileId);
  }, []);

  const applyFamily = useCallback((fam: CachedFamily) => {
    dataRef.current = fam;
    setData(fam);
    // ?as=<name> wins once the profiles are known.
    const wanted = asParam.current;
    if (wanted) {
      const p = fam.profiles.find((x) => norm(x.name) === norm(wanted) || x.id === wanted);
      if (p) {
        setApiAuth({ profileId: p.id }); // before child effects poll as this profile
        setMeId(p.id);
      }
      asParam.current = null;
    }
    // Drop a remembered profile that is no longer in this family, or is locked to its own phone now.
    setMeId((id) => (id && !fam.profiles.some((p) => p.id === id && !p.locked) ? null : id));
  }, []);

  const load = useCallback(
    async (c: Cred): Promise<boolean> => {
      const id = credId(c);
      if (!id) {
        setStatus('needs-code');
        return false;
      }
      try {
        const res = await api.family(credAuth(c));
        if (credId(credRef.current) !== id) return false; // switched family meanwhile
        const fam = toCached(res);
        applyFamily(fam);
        void kvSetJson(KEY_FAMILY, fam);
        setError(null);
        setStatus('ready');
        return true;
      } catch (e) {
        // Switched family, or signed out (a refused key is handled by the signed-out handler).
        if (credId(credRef.current) !== id) return false;
        // A saved family code the server no longer knows (a refused key is the handler's job).
        const deadCode = e instanceof ApiError && e.status === 401 && !c.deviceKey;
        setError(deadCode ? 'That family code stopped working. Ask your family for an invite.' : errorMessage(e));
        // Only a refused family code ends here. A key the server signed out never gets this far (the
        // handler dropped it), and any other answer for a key is trouble: keep what we had.
        if (!c.deviceKey && e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          setStatus('needs-code');
          return false;
        }
        // Keep whatever we had (cache); only "offline" when there is nothing to show.
        setStatus(dataRef.current ? 'ready' : 'offline');
        return false;
      }
    },
    [applyFamily],
  );

  /** Swap a saved family code for this phone's own key. 'later' = offline (keep the code for now). */
  const swapCode = useCallback(
    async (code: string): Promise<'swapped' | 'refused' | 'later'> => {
      try {
        const { device_key } = await api.devices({ label: deviceLabel() }, { code });
        if (!device_key || credRef.current.code !== code) return 'later';
        // The code goes only once the key is safely stored; else the next launch swaps it again
        // (this launch uses the new key from memory).
        if (await saveKey(device_key)) await secretSet(KEY_CODE, null);
        setCredential({ deviceKey: device_key, code: null });
        setVia('code');
        return 'swapped';
      } catch (e) {
        return e instanceof ApiError && e.status === 401 ? 'refused' : 'later';
      }
    },
    [setCredential, setVia],
  );

  /** Forget the key, any old code, the cache and whoever was chosen. */
  const forget = useCallback(async () => {
    pending.current = null;
    devAid.current = false;
    devAidOn = false;
    setApiTimeZone(deviceTimeZone());
    setCredential(NO_CRED);
    setApiAuth({ profileId: null });
    dataRef.current = null;
    setData(null);
    setMeId(null);
    setLast(null);
    void kvSet(KEY_LAST, null);
    setVia(null);
    rememberApple(null);
    await Promise.all([secretSet(KEY_DEVICE, null), secretSet(KEY_CODE, null), kvSet(KEY_FAMILY, null)]);
  }, [setCredential, setVia, rememberApple]);

  // Boot: storage first (instant), then the network.
  useEffect(() => {
    let alive = true;
    if (fixture.current) {
      setPersonal(!fixture.current.deviceNeedsProfile);
      applyFamily(fixture.current);
      setStatus('ready');
      return;
    }
    const boot = async (): Promise<boolean> => {
      const [savedKey, savedCode, cached, via, appleId] = await Promise.all([
        readSavedKey(),
        secretGet(KEY_CODE),
        kvGetJson<CachedFamily>(KEY_FAMILY),
        kvGet(KEY_VIA),
        kvGet(KEY_APPLE),
      ]);
      if (!alive) return false;
      void kvSet(KEY_ME, null);
      setAppleProfileId(appleId || null);
      // The keychain can't answer yet: never "signed out". The last family shows; the key is read again soon.
      keyUnread.current = savedKey === undefined;
      if (savedKey === undefined) {
        setPersonal(via === 'person');
        if (cached && Array.isArray(cached.profiles)) {
          applyFamily(cached);
          setStatus('ready');
        } else setStatus('offline');
        return false;
      }
      const key = savedKey?.trim() || null;
      const code = savedCode?.trim() || null;
      // A leftover code next to a key means a swap finished just before the app closed.
      if (key && code) void secretSet(KEY_CODE, null);
      setPersonal(!!key && via === 'person');
      let c: Cred = key ? { deviceKey: key, code: null } : code ? { deviceKey: null, code } : NO_CRED;
      // The build's code only stands in for the `?as=` dev aid; people sign in themselves.
      if (!credId(c) && asParam.current && ENV_CODE) {
        c = { deviceKey: null, code: ENV_CODE };
        devAid.current = true;
        devAidOn = true;
        setApiTimeZone(null);
      }
      setCredential(c);
      // The cache belongs to what this phone saved only.
      if (cached && Array.isArray(cached.profiles) && (key || code)) {
        applyFamily(cached);
        setStatus('ready');
      }
      // A refused code falls through: load() says so with the server's sentence.
      if (!key && code) await swapCode(code);
      return alive ? load(credRef.current) : false;
    };
    bootRef.current = boot;
    void boot();
    return () => {
      alive = false;
    };
  }, [applyFamily, load, setCredential, swapCode]);

  // Someone removed this person: the server refuses the key on any call.
  useEffect(() => {
    setSignedOutHandler((message) => {
      if (!credRef.current.deviceKey || leaving.current) return;
      const name = dataRef.current?.family.name;
      void forget();
      setError(name ? `You were signed out of ${name}.` : message || SIGNED_OUT);
      setStatus('needs-code');
    });
    return () => setSignedOutHandler(null);
  }, [forget]);

  // Who was picked here last (the default person on a shared phone).
  useEffect(() => {
    let alive = true;
    kvGetJson<LastPerson>(KEY_LAST).then((v) => {
      if (alive && v && typeof v.id === 'string' && typeof v.familyId === 'string') setLast(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  const profiles = useMemo(() => data?.profiles ?? [], [data]);
  const me = useMemo(() => profiles.find((p) => p.id === meId) ?? null, [profiles, meId]);

  const ownerId = personal ? (data?.deviceProfileId ?? null) : null;
  const owner = useMemo(() => profiles.find((p) => p.id === ownerId && !p.locked && !p.invited) ?? null, [profiles, ownerId]);
  const familyId = data?.family.id ?? null;
  const usable = (p: Profile | undefined) => (p && !p.locked && !p.invited ? p : null);
  const defaultPerson =
    owner ?? (last && last.familyId === familyId ? usable(profiles.find((p) => p.id === last.id)) : null);
  const defaultRef = useRef<string | null>(null);
  const meRef = useRef<string | null>(null);
  useEffect(() => {
    defaultRef.current = defaultPerson?.id ?? null;
    meRef.current = me?.id ?? null;
  }, [defaultPerson?.id, me?.id]);

  // A warm resume after a long time away goes back through "/", like a cold start: the default
  // person is entered again (a phone lent to Grandma comes back as its owner).
  useEffect(() => {
    let leftAt: number | null = null;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') leftAt = Date.now();
      else if (s === 'active') {
        // The keychain couldn't be read at launch (a locked phone): the phone is open now.
        if (keyUnread.current) void bootRef.current();
        // The zone may have changed while away (a flight home): quiet hours follow it from now on.
        if (!devAid.current) setApiTimeZone(deviceTimeZone());
        const away = leftAt !== null && Date.now() - leftAt > RESUME_RESET_MS;
        if (away && !(defaultRef.current && meRef.current === defaultRef.current)) {
          setApiAuth({ profileId: null });
          setMeId(null);
        }
        leftAt = null;
      }
    });
    return () => sub.remove();
  }, []);

  // Keep the API client's headers in sync.
  useEffect(() => {
    setApiAuth({ profileId: me?.id ?? null });
  }, [me?.id]);

  const setMe = useCallback(
    (who: Profile | string | null) => {
      let id: string | null = null;
      if (who && typeof who === 'object') id = who.id;
      else if (typeof who === 'string') {
        const p = profiles.find((x) => x.id === who || norm(x.name) === norm(who));
        id = p?.id ?? null;
      }
      // Someone on their own phone can only be them there (the server refuses anything as them).
      if (id && profiles.some((p) => p.id === id && p.locked)) return;
      setApiAuth({ profileId: id });
      setMeId(id);
      // Remembered as this phone's default (it only counts on a shared phone; an owner always wins).
      const fam = dataRef.current?.family.id;
      if (id && fam) {
        const next = { familyId: fam, id };
        setLast(next);
        void kvSetJson(KEY_LAST, next);
      }
    },
    [profiles],
  );

  const refresh = useCallback(async () => {
    if (fixture.current) return true;
    if (keyUnread.current) return bootRef.current();
    const c = credRef.current;
    if (!c.deviceKey && c.code && !devAid.current) await swapCode(c.code);
    return load(credRef.current);
  }, [load, swapCode]);

  // The current person was removed on another phone: nobody is picked now ("Who's in the kitchen?"),
  // and the family reloads without them. Many calls can fail at once; one reload covers them.
  const reloading = useRef(false);
  useEffect(() => {
    setProfileRemovedHandler((id) => {
      setMeId((cur) => (cur === id ? null : cur));
      if (reloading.current) return;
      reloading.current = true;
      void refresh().finally(() => {
        reloading.current = false;
      });
    });
    return () => setProfileRemovedHandler(null);
  }, [refresh]);

  /**
   * Save this phone's new key and switch to its family, with nobody chosen yet. `fam` skips the
   * fetch when the family is already known. Resolves true once the family is loaded; offline, the
   * key is still saved and refresh() finishes the job.
   */
  const adopt = useCallback(
    async (deviceKey: string, via: Via, fam?: CachedFamily): Promise<boolean> => {
      const old = credRef.current.deviceKey;
      pending.current = null;
      devAid.current = false;
      devAidOn = false;
      setApiTimeZone(deviceTimeZone());
      setCredential({ deviceKey, code: null });
      setVia(via);
      rememberApple(null); // enter() says so again for an Apple sign-in
      // The key this one replaces (another family, or this one again) should stop working too.
      if (old && old !== deviceKey) void api.revokeDevice({ deviceKey: old }).catch(() => {});
      setApiAuth({ profileId: null });
      setMeId(null);
      // An old family code goes only once the new key is safely stored.
      if (await saveKey(deviceKey)) await secretSet(KEY_CODE, null);
      if (fam) {
        applyFamily(fam);
        void kvSetJson(KEY_FAMILY, fam);
        setError(null);
        setStatus('ready');
        return true;
      }
      // Another family's faces must never show under this key.
      dataRef.current = null;
      setData(null);
      void kvSet(KEY_FAMILY, null);
      setStatus('loading');
      return load({ deviceKey, code: null });
    },
    [applyFamily, load, setCredential, setVia, rememberApple],
  );

  /** In with a new key from Apple or Google. */
  const enter = useCallback(
    async (
      provider: Provider,
      res: Extract<ProviderAuth, { needs_name: false }>,
    ): Promise<Extract<SignInResult, { status: 'signed-in' }> | { status: 'error'; error: string }> => {
      if (!res.device_key) return { status: 'error', error: 'Something went wrong on our side. Try again.' };
      await adopt(res.device_key, 'person');
      if (provider === 'apple') rememberApple(res.profile_id);
      return { status: 'signed-in', familyName: res.family_name, profileId: res.profile_id, existing: res.existing, joined: res.joined };
    },
    [adopt, rememberApple],
  );

  const providerSignIn = useCallback(
    (provider: Provider, opts: SignInOptions = {}) =>
      singleFlight(signingIn, async (): Promise<SignInResult> => {
        pending.current = null;
        let got: ProviderSignIn | null;
        try {
          got = provider === 'apple' ? await apple.signIn() : await google.signIn();
        } catch (e) {
          return { status: 'error', error: e instanceof SignInError ? e.message : 'Sign-in didn’t finish. Try again.' };
        }
        if (!got) return { status: 'cancelled' };
        const shareToken = opts.shareToken?.trim() || null;
        try {
          const res = await providerAuth(provider, { id_token: got.idToken, share_token: shareToken, device_label: deviceLabel() });
          if (res.needs_name) {
            pending.current = { provider, idToken: got.idToken, shareToken };
            const suggestedName = (got.name || res.suggested_name || '').trim().slice(0, MAX_NAME);
            return { status: 'needs-name', suggestedName, needsRole: !shareToken };
          }
          return await enter(provider, res);
        } catch (e) {
          return { status: 'error', error: errorMessage(e) };
        }
      }),
    [enter],
  );

  const signInWithApple = useCallback((opts?: SignInOptions) => providerSignIn('apple', opts), [providerSignIn]);
  const signInWithGoogle = useCallback((opts?: SignInOptions) => providerSignIn('google', opts), [providerSignIn]);

  const finishSignIn = useCallback(
    ({ name, role }: { name: string; role?: Role | null }) =>
      singleFlight(finishing, async (): Promise<FinishSignInResult> => {
        const p = pending.current;
        if (!p) return { status: 'restart', error: 'Sign in again to finish.' };
        const clean = name.trim();
        if (!clean) return { status: 'error', error: 'Type your name first.' };
        if (!p.shareToken && !role) return { status: 'error', error: 'Choose Record a dish or Learn a dish.' };
        try {
          const res = await providerAuth(p.provider, {
            id_token: p.idToken,
            name: clean,
            role: role ?? null,
            share_token: p.shareToken,
            device_label: deviceLabel(),
          });
          if (res.needs_name) return { status: 'error', error: 'Type your name first.' };
          return await enter(p.provider, res);
        } catch (e) {
          // A refused token (Apple's last 10 minutes) can't be fixed by typing: start over.
          if (e instanceof ApiError && e.status === 401) {
            pending.current = null;
            return { status: 'restart', error: errorMessage(e, 'Sign in again to finish.') };
          }
          return { status: 'error', error: errorMessage(e) };
        }
      }),
    [enter],
  );

  const acceptInvite = useCallback(
    (tokenOrCode: string) =>
      singleFlight(accepting, async (): Promise<AcceptInviteResult> => {
        const parsed = parseInviteInput(tokenOrCode);
        if (!parsed || (parsed.kind !== 'token' && parsed.kind !== 'code')) return { status: 'error', error: NOT_AN_INVITE };
        try {
          const ref = parsed.kind === 'token' ? { token: parsed.token } : { code: parsed.code };
          const res = await api.inviteAccept({ ...ref, device_label: deviceLabel() });
          if (!res.device_key) return { status: 'error', error: 'Something went wrong on our side. Try again.' };
          await adopt(res.device_key, 'person');
          // A family invite names nobody (profile_id null): this phone's person comes next, on
          // "Who's in the kitchen?" (deviceNeedsProfile). An invite for one person makes them `me`.
          const pid = res.profile_id;
          const me = pid ? (dataRef.current?.profiles.find((p) => p.id === pid && !p.locked) ?? null) : null;
          if (me) {
            setApiAuth({ profileId: me.id });
            setMeId(me.id);
          }
          return { status: 'joined', familyName: res.family_name, me };
        } catch (e) {
          if (e instanceof ApiError && e.status === 410) {
            const s = e.body?.status;
            return { status: 'gone', error: e.message, invite: s === 'expired' || s === 'revoked' ? s : 'used' };
          }
          return { status: 'error', error: errorMessage(e) };
        }
      }),
    [adopt],
  );

  const joinFamily = useCallback(
    (raw: string) =>
      singleFlight(joining, async (): Promise<JoinResult> => {
        const next = raw.trim().toUpperCase();
        if (!next) return { ok: false, error: 'Type your family code first.' };
        try {
          const res = await api.family({ code: next });
          const { device_key } = await api.devices({ label: deviceLabel() }, { code: next });
          if (!device_key) return { ok: false, error: 'Something went wrong on our side. Try again.' };
          await adopt(device_key, 'code', toCached(res));
          return { ok: true, family: res.family };
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            return { ok: false, error: 'That code doesn’t match a family. Check it and try again.' };
          }
          return { ok: false, error: errorMessage(e) };
        }
      }),
    [adopt],
  );

  const joinByLink = useCallback(
    (ticket: string, name: string | null) =>
      singleFlight(linking, async (): Promise<JoinByLinkResult> => {
        const clean = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) || null;
        try {
          const res = await api.authLink({ ticket, name: clean, device_label: deviceLabel() });
          const pid = res.profile_id;
          if (!res.device_key || !pid) return { status: 'error', error: 'Something went wrong on our side. Try again.' };
          await adopt(res.device_key, 'person');
          // The new person is the only one on this phone: they're in at once, as with an invite for one person.
          const me = dataRef.current?.profiles.find((p) => p.id === pid && !p.locked) ?? null;
          if (me) {
            setApiAuth({ profileId: me.id });
            setMeId(me.id);
          }
          return { status: 'joined', familyName: res.family_name, profileId: pid, me };
        } catch (e) {
          if (e instanceof ApiError) {
            if (e.status === 404 || e.status === 403 || e.status === 503) return { status: 'unavailable' };
            if (e.status === 400 || (e.status === 409 && /already in this family/i.test(e.message))) return { status: 'name', error: errorMessage(e) };
            if (e.status === 409) return { status: 'taken', error: errorMessage(e) };
          }
          return { status: 'error', error: errorMessage(e) };
        }
      }),
    [adopt],
  );

  const createSelf = useCallback(
    (name: string, role: Role) =>
      singleFlight(creating, async (): Promise<CreateSelfResult> => {
        const clean = name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME);
        if (!clean) return { ok: false, error: 'Type your name first.' };
        const fx = fixture.current;
        if (fx) {
          // Dev only: the made-up family takes them in locally.
          await new Promise((r) => setTimeout(r, 500));
          const same = fx.profiles.find((p) => norm(p.name) === norm(clean));
          if (same) return { ok: false, error: `${same.name} is already in this family. Pick another name or tap your face.` };
          const p: Profile = { id: `p-${Date.now()}`, name: clean, role, relation: null, avatar_key: null };
          fixture.current = { ...fx, profiles: [...fx.profiles, p], deviceProfileId: p.id, deviceNeedsProfile: false };
          setPersonal(true);
          applyFamily(fixture.current);
          setMeId(p.id);
          return { ok: true, me: p };
        }
        let made: Profile;
        try {
          made = await api.createSelf({ name: clean, role });
        } catch (e) {
          // "This phone already belongs to Dad.": the family on screen is behind; catch up.
          if (e instanceof ApiError && e.status === 409) void load(credRef.current);
          return { ok: false, error: errorMessage(e) };
        }
        // The family now has them and this phone is theirs. Offline right after, add them here so
        // they can come in now; the next GET /family puts the server's word back.
        const loaded = await load(credRef.current);
        const cur = dataRef.current;
        if (cur && (!loaded || !cur.profiles.some((p) => p.id === made.id))) {
          const fam: CachedFamily = {
            ...cur,
            profiles: [...cur.profiles.filter((p) => p.id !== made.id), made],
            deviceProfileId: made.id,
            deviceNeedsProfile: false,
          };
          applyFamily(fam);
          void kvSetJson(KEY_FAMILY, fam);
        }
        setApiAuth({ profileId: made.id });
        setMeId(made.id);
        return { ok: true, me: made };
      }),
    [applyFamily, load],
  );

  const leaveFamily = useCallback(async () => {
    const key = credRef.current.deviceKey;
    leaving.current = true;
    try {
      // Sign-out never waits on the network: the push token is forgotten here at once and the
      // server is told in the background, with the key captured now (it is dropped right after).
      // Order doesn't matter: the server skips a revoked phone's tokens, and after leaving the
      // family from this phone the key is already off.
      await unregisterPush({ remove: (token) => api.removePushToken({ token }, key ? { deviceKey: key } : {}) });
      if (key) void api.revokeDevice({ deviceKey: key }).catch(() => {}); // best effort: offline still signs out here
      await forget();
    } finally {
      leaving.current = false;
    }
    setError(null);
    setStatus('needs-code');
  }, [forget]);

  const deleteAccount = useCallback(
    async (person: Profile, erase: (profileId: string) => Promise<unknown>): Promise<DeleteAccountResult> => {
      const kind = removalOf(person, dataRef.current);
      if (!kind) return { ok: false, error: `Only ${person.name} can do this, on their own phone.` };
      const failed = (e: unknown): DeleteAccountResult => {
        leaving.current = false;
        return { ok: false, error: errorMessage(e, 'We couldn’t delete this account. Check your connection and try again.') };
      };
      const refused = (e: unknown) => e instanceof ApiError && isSignedOutAnswer(e.status, e.body);
      leaving.current = true;
      try {
        await erase(person.id);
      } catch (e) {
        console.warn('[session] account.deleteMe failed', String(e).slice(0, 160));
        return failed(null);
      }
      let signedOut = kind === 'own';
      try {
        await api.removeProfile(person.id, { profileId: person.id });
      } catch (e) {
        // Signed out already: an earlier try, whose answer was lost, took them out.
        if (!refused(e)) return failed(e);
        signedOut = true;
      }
      if (!signedOut) {
        // This phone should still be in, unless its key had become theirs meanwhile (a swapped family
        // code's first write as them): then the server signed it out with them.
        signedOut = await api.family(credAuth(credRef.current)).then(() => false, refused);
      }
      if (!signedOut) leaving.current = false;
      return { ok: true, signedOut };
    },
    [],
  );

  const forgetPerson = useCallback(
    (id: string) => {
      const fam = dataRef.current;
      if (fam) {
        const next = { ...fam, profiles: fam.profiles.filter((p) => p.id !== id) };
        applyFamily(next); // lets go of them as `me` too
        void kvSetJson(KEY_FAMILY, next);
      }
      void refresh();
    },
    [applyFamily, refresh],
  );

  const value = useMemo<Session>(() => {
    const former = data?.formerProfiles ?? [];
    const byId = (id: string | null | undefined) =>
      id ? (profiles.find((p) => p.id === id) ?? former.find((p) => p.id === id) ?? null) : null;
    const byName = (name: string | null | undefined) => {
      const n = norm(name);
      return n ? profiles.find((p) => norm(p.name) === n) ?? null : null;
    };
    return {
      status,
      signedIn: !!credId(cred),
      credentialVersion,
      family: data?.family ?? null,
      profiles,
      cooks: profiles.filter((p) => p.role === 'cook'),
      learners: profiles.filter((p) => p.role === 'learner'),
      me,
      isCook: me?.role === 'cook',
      isLearner: me?.role === 'learner',
      deviceProfileId: ownerId,
      appleProfileId,
      owner,
      defaultPerson,
      deviceNeedsProfile: !!data?.deviceNeedsProfile,
      canManage: data?.canManage !== false,
      error,
      setMe,
      refresh,
      signInWithApple,
      signInWithGoogle,
      finishSignIn,
      acceptInvite,
      joinFamily,
      joinByLink,
      createSelf,
      leaveFamily,
      accountRemoval: (p: Profile | null | undefined) => removalOf(p, data),
      deleteAccount,
      forgetPerson,
      profileById: byId,
      profileByName: byName,
      homeFor: (p: Profile) => (p.role === 'cook' ? '/parent/home' : '/kid/home'),
    };
  }, [
    status,
    cred,
    credentialVersion,
    data,
    profiles,
    me,
    ownerId,
    appleProfileId,
    owner,
    defaultPerson,
    error,
    setMe,
    refresh,
    signInWithApple,
    signInWithGoogle,
    finishSignIn,
    acceptInvite,
    joinFamily,
    joinByLink,
    createSelf,
    leaveFamily,
    deleteAccount,
    forgetPerson,
  ]);

  useEffect(() => {
    publishSnapshot(value);
  }, [value]);

  return (
    <SessionContext value={value}>
      <UnreadProvider meId={me?.id ?? null} ready={status === 'ready'}>
        {children}
      </UnreadProvider>
    </SessionContext>
  );
}

const notReady = { status: 'error' as const, error: 'Not ready yet.' };

const fallbackSession: Session = {
  status: 'loading',
  signedIn: false,
  credentialVersion: 0,
  family: null,
  profiles: [],
  cooks: [],
  learners: [],
  me: null,
  isCook: false,
  isLearner: false,
  deviceProfileId: null,
  appleProfileId: null,
  owner: null,
  defaultPerson: null,
  deviceNeedsProfile: false,
  canManage: false,
  error: null,
  setMe: () => {},
  refresh: async () => false,
  signInWithApple: async () => notReady,
  signInWithGoogle: async () => notReady,
  finishSignIn: async () => notReady,
  acceptInvite: async () => notReady,
  joinFamily: async () => ({ ok: false, error: 'Not ready yet.' }),
  joinByLink: async () => notReady,
  createSelf: async () => ({ ok: false, error: 'Not ready yet.' }),
  leaveFamily: async () => {},
  accountRemoval: () => null,
  deleteAccount: async () => ({ ok: false, error: 'Not ready yet.' }),
  forgetPerson: () => {},
  profileById: () => null,
  profileByName: () => null,
  homeFor: (p) => (p.role === 'cook' ? '/parent/home' : '/kid/home'),
};

export function useSession(): Session {
  return useContext(SessionContext) ?? fallbackSession;
}

// ---------------------------------------------------------------------------------------------
// Unread badge

type Unread = { total: number; refresh: () => void; /** Locally lower the count (after reading a thread). */ setTotal: (n: number) => void };

const UnreadContext = createContext<Unread>({ total: 0, refresh: () => {}, setTotal: () => {} });

let unreadRefresher: (() => void) | null = null;
/** Ask the badge to re-poll now (messaging calls this after sending / reading). */
export function refreshUnread() {
  unreadRefresher?.();
}

function UnreadProvider({ meId, ready, children }: { meId: string | null; ready: boolean; children: ReactNode }) {
  const [counts, setCounts] = useState<{ owner: string | null; total: number }>({ owner: null, total: 0 });
  const total = counts.owner === meId ? counts.total : 0;
  // The last count read (or lowered after reading a thread) while the app was in front, for the
  // new-message double tap. Forgotten when the app leaves the foreground (see the AppState listener).
  const known = useRef<UnreadSeen | null>(null);
  const setTotal = useCallback(
    (n: number) => {
      const next = { owner: meId, total: Math.max(0, n) };
      if (known.current?.owner === meId) known.current = next;
      setCounts(next);
    },
    [meId],
  );
  const [active, setActive] = useState(AppState.currentState !== 'background');
  const seq = useRef(0);
  // Where the person is, for the double tap (an open chat shows its own messages).
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  // The double tap waiting out its beat (one at a time: a burst of messages gets one).
  const tap = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (tap.current && clearTimeout(tap.current)), []);

  const poll = useCallback(() => {
    if (!meId || !ready) return;
    const mine = ++seq.current;
    api
      .unread({ profileId: meId })
      .then((r) => {
        if (mine !== seq.current) return;
        const next = { owner: meId, total: Math.max(0, Number(r.total) || 0) };
        // A new family message while the app is open: two light taps (RETENTION-HANDOFF 4, haptics;
        // never for what was waiting when the app opened or came back to the front). They wait a beat
        // for a push still on its way, and stay quiet when a message push already said it or a chat
        // is open (tapStillDue): one message, one signal.
        const appState = AppState.currentState;
        if (buzzForUnread(known.current, next, appState === 'active') && !tap.current) {
          tap.current = setTimeout(() => {
            tap.current = null;
            const due = tapStillDue({
              due: next,
              seen: known.current,
              active: AppState.currentState === 'active',
              pushAt: lastMessagePushAt(),
              now: Date.now(),
              path: path.current,
            });
            if (!due) return;
            haptic('light');
            setTimeout(() => haptic('light'), 120);
          }, TAP_WAIT_MS);
        }
        // A read that lands with the app away never becomes the baseline.
        known.current = unreadSeenAfter(appState, next);
        setCounts(next);
      })
      .catch(() => {});
  }, [meId, ready]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      // Leaving the foreground forgets the baseline, so the first read after coming back is silent
      // (what landed while away had its push), and drops a read still on its way, so it can't
      // become a stale baseline for that first read.
      known.current = unreadSeenAfter(s, known.current);
      if (s !== 'active') seq.current++;
      setActive(s === 'active');
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    unreadRefresher = poll;
    if (!active || !meId || !ready) return;
    poll();
    const t = setInterval(poll, UNREAD_POLL_MS);
    return () => clearInterval(t);
  }, [poll, active, meId, ready]);

  const value = useMemo(() => ({ total, refresh: poll, setTotal }), [total, poll, setTotal]);
  return <UnreadContext value={value}>{children}</UnreadContext>;
}

/** `{ total, refresh }` unread messages for the current profile (polled every 15 s). */
export function useUnread(): Unread {
  return useContext(UnreadContext);
}

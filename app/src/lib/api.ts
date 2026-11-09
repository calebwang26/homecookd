// Typed client for the homecookd backend (Supabase edge function `api`). Contract: docs/build/API.md.
//
//   import { api, ApiError } from '@/lib/api';
//   const { profiles } = await api.family();
//   await api.sendMessage(threadId, { kind: 'text', body: 'Hi Dad' });
//
// Auth: SessionProvider calls `setApiAuth()` whenever the phone's credential or the current profile
// changes. The credential is this phone's own device key (`x-device-key`), or, only until an older
// phone has swapped it for a key, the family code (`x-family-code`); the profile is `x-profile-id`.
// Any call can override them (`{ deviceKey, code, profileId }`); overriding one credential drops
// the other, e.g. the boot-time swap of an old saved family code. A 401 "This phone was signed out." on the
// phone's own device key means it was signed out (someone removed this person): the key is dropped
// and setSignedOutHandler() hears it once. Any other 401 is only an error (isSignedOutAnswer). A
// 403 for the current profile because that person was removed (from another phone)
// tells setProfileRemovedHandler(), so the session can go back to "Who's in the kitchen?". Device
// keys, family codes and id tokens are never logged.
// Every request has a 10 s timeout (longer for sign-in and joining, which do more on the server). Safe (idempotent) calls retry once on a network error or 5xx;
// calls that create something retry once only on 502/503/504 (the request never reached the
// function), so a message is never sent twice.
// 1.1 (EXPO_PUBLIC_BACKEND=aws, lib/aws/config.ts): the same routes go to the AWS api instead, through
// lib/aws/client.ts, which does the retrying; the Accounts routes keep their paths and shapes there
// (docs/build/contracts/ACCOUNTS.md on aws-migration). Only the api's own word that the key is gone signs
// this phone out (the client's onDeadKey).

import { AWS_ON } from './aws/config';
import { onDeadKey, request as awsRequest, setAwsCredentials, type RequestOpts } from './aws/client';
import { errorWords } from './aws/errorWords';
import { awsMessagesApi } from './aws/legacy';
import { isAwsError } from './aws/errors';
import { wordsFor } from './words/words';

// Public addresses, so a store build works without app/.env (EAS cloud builds never see that
// gitignored file, and an empty API_URL made every sign-in fail). .env still overrides them.
const RAW = process.env.EXPO_PUBLIC_API_URL || 'https://bsudybxsqvtwftsdmwmz.supabase.co/functions/v1/api';
export const API_URL = RAW.trim().replace(/\/+$/, '');
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'https://homecookd.app').trim().replace(/\/+$/, '');

const TIMEOUT_MS = 10_000;
/**
 * Sign-in and joining do several steps on the server (and may wake a cold function). They are
 * never retried, so give them longer: giving up early can leave a used invite and no key here.
 */
const SIGN_IN_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 600;

// ---------------------------------------------------------------------------------------------
// Types (mirror docs/build/API.md)

export type Role = 'cook' | 'learner';

export type Profile = {
  id: string;
  name: string;
  role: Role;
  relation: string | null;
  avatar_key: string | null;
  /**
   * Invited (POST /invites) and not joined yet (never signed in, never wrote or invited anyone here):
   * their tile reads "Hasn't joined yet", and nobody can be them until they join.
   */
  invited?: boolean;
  /** A phone is signed in as them, so removing them signs it out (GET /family). */
  has_phone?: boolean;
  /**
   * They have their own phone and it isn't this one: only their phone can open them. Their tile
   * shows, but tapping it never enters (the server answers 403 to anything done as them).
   */
  locked?: boolean;
  /**
   * Remembered, not here (retention guardrail 2; set by SQL in v1, TODO(caleb) #5). GET /family only,
   * and left out when the server can't read it: treat anything but `false` as unknown, so nothing
   * addresses them as present ("Grandma sees your hearts") unless the server said they aren't memorial.
   */
  memorial?: boolean;
};

export type Family = { id: string; name: string };

/**
 * GET /family. `former_profiles` = people who were removed, only for drawing their old messages
 * (never list them or offer them as "me"). `device_profile_id` = who signed in on this phone
 * (null for a family-code phone).
 */
export type FamilyInfo = {
  family: Family;
  profiles: Profile[];
  former_profiles?: Profile[];
  device_profile_id?: string | null;
  /**
   * This phone joined through a family invite and hasn't said who it is yet: "Who's in the
   * kitchen?" asks them to tap + under the cooks or the ones who miss it (api.createSelf).
   */
  device_needs_profile?: boolean;
  /**
   * This phone's person (settled: their first phone joined over a day ago, or they started the
   * family) may answer "<Name> is on a new phone" asks. Missing on older servers.
   */
  can_manage?: boolean;
};

export type MessageKind = 'text' | 'voice' | 'step' | 'recipe' | 'cooked' | 'request' | 'question' | 'system' | 'reaction';

export type Message = {
  id: string;
  thread_id: string;
  sender_id: string;
  kind: MessageKind;
  body: string | null;
  recipe_id: string | null;
  step_order: number | null;
  audio_url: string | null;
  duration_s: number | null;
  clip_start_s: number | null;
  clip_end_s: number | null;
  transcript: string | null;
  created_at: string;
  /** The message this one answers (same thread), or null. */
  reply_to?: string | null;
  /**
   * Questions only (a `question`; in a 1:1 chat also a learner's `step` with words): who answered
   * it first, and when. Circle: the first cook (not the asker) replying to it; 1:1: the person
   * asked. null = still open.
   */
  answered_by?: string | null;
  answered_at?: string | null;
  /** A recipe note was made from this message ("Saved to the recipe"). */
  saved_to_recipe?: boolean;
  /** That note's id, for "Undo" (POST /recipe-notes/:id/remove). */
  note_id?: string | null;
  /** `cooked`: a photo of the dish they made (fresh signed URL, 1 h), else null. */
  photo_url?: string | null;
  /** `cooked` with a postcard: "How close to Dad's?" in yolks, 1-5; null = not rated (retention PR 3). */
  rating?: number | null;
};

export type ThreadKind = 'pair' | 'circle';

export type ThreadSummary = {
  id: string;
  /**
   * For the circle this is a stand-in `{ id: 'family', name: 'Family' }`, not a real person: use
   * `kind` + `members`. `removed`: a 1:1 with someone no longer in the family (history only; new
   * messages get 403 "Dad isn't in the family anymore.").
   */
  other: Profile & { removed?: boolean };
  last: Message | null;
  unread: number;
  recipe_id: string | null;
  /** 'circle' = the whole family (always first in GET /threads, even when empty). */
  kind?: ThreadKind;
  /** Everyone in the thread, in family order (circle: every profile; pair: both people). */
  members?: Profile[];
  /** How many `cooked` cards in it carry a postcard (retention PR 3): one landing on an older card moves it. */
  postcards?: number;
};

export type Circle = { id: string; kind: 'circle'; members: Profile[] };

/**
 * An unanswered question for "Waiting for your answer" (GET /questions/open), newest first: the
 * circle's, plus (for a cook) the 1:1 questions asked of them. Reply in `message.thread_id`.
 */
export type OpenQuestion = { message: Message; asker: Profile; thread_kind?: ThreadKind };

/**
 * An open question about one dish (GET /recipes/:id/questions), newest first: the circle's, plus
 * the ones I asked in a 1:1. `waiting_for` = the person asked (1:1), null in the circle.
 */
export type RecipeQuestion = {
  id: string;
  thread_id: string;
  thread_kind: ThreadKind;
  step_order: number | null;
  body: string | null;
  created_at: string;
  asker: Profile;
  mine: boolean;
  waiting_for: Profile | null;
};

/** POST /favorites result: my favorites after the change, newest first. */
export type FavoriteResult = { ok: true; recipe_id: string; on: boolean; recipe_ids: string[] };

/** GET /me/recipe-stats: one row per dish I have history with, most recent activity first. */
export type RecipeStat = {
  recipe_id: string;
  /** How many times I opened it (repeat opens within 30 min count once). */
  views: number;
  last_viewed_at: string | null;
  /** How many times I tapped "I made it". */
  cooked: number;
  last_cooked_at: string | null;
  favorited: boolean;
  favorited_at: string | null;
  /** Newest time someone else sent it to me (a recipe card in a 1:1 chat or the family circle). */
  sent_to_me_at: string | null;
};

/** A cook's answer saved into the shared family recipe (and step). */
export type RecipeNote = {
  id: string;
  recipe_id: string;
  step_order: number | null;
  /** The question in the asker's words (body, or transcript of a spoken one); null for "Save to recipe" notes. */
  question: string | null;
  question_message_id: string | null;
  /** A spoken question's voice (fresh signed URL, 1 h) and length; null for typed questions. */
  question_audio_url: string | null;
  question_duration_s: number | null;
  asker: Profile | null;
  answer_text: string | null;
  /** Fresh signed URL (valid 1 h) for a voice answer, or a public recipe-audio clip URL. */
  answer_audio_url: string | null;
  answer_duration_s: number | null;
  answer_message_id: string;
  author: Profile;
  created_at: string;
};

/** A new device key: send it as `x-device-key` from now on. Shown once by the server; never log it. */
/** `profile_id` is null after an older family invite: the phone is in, and its person comes next (createSelf). */
export type DeviceAuth = { device_key: string; family_name: string; profile_id: string | null };

/**
 * POST /auth/apple and /auth/google (docs/build/JOIN-SIMPLE.md §3). `needs_name` = someone new with
 * no name sent: ask what their family calls them (and, with no link, cook or learner), then call again
 * with the same `id_token`. `needs_move` = a known person in another family tapped this link: nothing
 * changed; call again with `move: true` (a fresh sign-in) once they say yes. `moved` = they moved, and
 * `receipt` is Convex's proof for links.moved.
 */
export type ProviderAuth =
  | { existing: false; needs_name: true; needs_move?: never; /** Google's given name, when there is one. */ suggested_name?: string | null }
  | { existing: true; needs_move: true; needs_name?: false; from_family: string; to_family: string }
  | (DeviceAuth & {
      /** false = a new person (their own family, or the link's). */
      existing: boolean;
      needs_name: false;
      needs_move?: false;
      /** true when a new person joined the family of the link they came from. */
      joined: boolean;
      moved?: { receipt: string | null } | null;
    });

/**
 * One link at most: `join_token` (a family join link's /i?t=, or an older invite's) or `link_ticket`
 * (Convex's /link/open ticket for a dish card's link). `role` only matters for a join link; a ticket's
 * side says it.
 */
export type ProviderAuthInput = {
  id_token: string;
  name?: string | null;
  role?: Role | null;
  join_token?: string | null;
  link_ticket?: string | null;
  move?: boolean;
  /** "Yes, that's me": a new account becomes this phone-less person (a join link only; peek's `claimable`). */
  claim_profile_id?: string | null;
  device_label?: string | null;
};

/** 'revoked' reads "turned off" to people (a re-invite or a removal does that). */
export type InviteState = 'pending' | 'used' | 'expired' | 'revoked';

/**
 * POST /invites. `url` (https://homecookd.app/i?t=…&c=…) goes in the text; `code` is its 6-letter
 * twin. `phone` = the number picked for them (kept from last time on a re-invite), display only.
 */
export type Invite = { id: string; url: string; code: string; expires_at: string; profile_id: string | null; phone?: string | null };

/**
 * `{}` = a family invite (the usual one, Oct 17): for whoever opens it, who then adds themselves
 * with + under the cooks or the ones who miss it. Older shapes still work: someone new by `name` +
 * `role`, or a re-invite of someone not yet joined.
 */
export type NewInvite =
  | Record<string, never>
  | { name: string; role: Role; relation?: string | null; phone?: string | null }
  | { profile_id: string };

/** POST /invites/peek: what an invite or a family join link says, without using it. */
export type InvitePeek = {
  status: InviteState;
  family_name: string;
  inviter: { name: string; relation: string | null; avatar_key: string | null } | null;
  /** null for a family invite (not for one named person). */
  invitee: { name: string; role: Role; avatar_key: string | null } | null;
  expires_at: string;
  /** Only when this phone sent its device key: true when it's already signed in to that family. */
  same_family?: boolean;
  /** 'link': a family join link (22 characters), for anyone, any number of times, until it expires. */
  kind?: 'link';
  /**
   * Peeked with a `name` (a family link or invite): the one person in that family of exactly that name
   * who has no phone yet ("Are you Leo?"), else null.
   */
  claimable?: Claimable | null;
};

/** Someone added to the family before they had the app, whom a new sign-in can become. */
export type Claimable = { id: string; name: string; avatar_key: string | null };

/** POST /join-links: the family's join link to share (the same one while it has over a day left). */
export type JoinLink = { url: string; expires_at: string | null };

/** Body for POST /threads/:id/messages. Required fields depend on `kind` (see API.md). */
export type NewMessage = (
  | { kind: 'text'; body: string; recipe_id?: string | null; clip_start_s?: number; clip_end_s?: number }
  | { kind: 'request'; body: string; recipe_id?: string | null }
  | { kind: 'step'; recipe_id: string; step_order: number; body?: string | null; clip_start_s?: number; clip_end_s?: number }
  | { kind: 'recipe'; recipe_id: string; body?: string | null }
  /** `photo_path`: from POST /photo-upload, already uploaded ("Show Grandma yours"). */
  | { kind: 'cooked'; recipe_id: string; body?: string | null; photo_path?: string | null }
  | {
      kind: 'voice';
      duration_s: number;
      audio_path?: string;
      audio_url?: string;
      transcript?: string | null;
      recipe_id?: string | null;
      step_order?: number | null;
      clip_start_s?: number;
      clip_end_s?: number;
    }
  /** A typed question (`body`) or a spoken one (`audio_path` + `duration_s`); step_order needs recipe_id. */
  | { kind: 'question'; body: string; recipe_id?: string | null; step_order?: number | null }
  | {
      kind: 'question';
      duration_s: number;
      audio_path: string;
      transcript?: string | null;
      body?: string | null;
      recipe_id?: string | null;
      step_order?: number | null;
    }
  /** A cook's heart mid-cook, or "Just like mine" on a dish someone made (needs reply_to: that cooked message). */
  | { kind: 'reaction'; body: 'heart' | 'just_like_mine'; recipe_id?: string | null }
) & {
  /** Answer a message in the same thread. A cook replying (text/voice) to a question about a recipe saves a recipe note. */
  reply_to?: string | null;
};

/** POST /events kinds: 'started' = cook mode opened; 'heard' = a cook's recorded voice played >= 3 s. */
export type RecipeEventKind = 'viewed' | 'cooked' | 'started' | 'heard';
/** `cook_id`: whose dish it is (cookProfile); `duration_s` / `start_s`: a 'heard' clip's length and start. */
export type RecipeEventExtra = { cook_id?: string | null; duration_s?: number; start_s?: number };

export type VoiceUpload = {
  path: string;
  upload_url: string;
  method: 'PUT';
  headers: Record<string, string>;
  max_bytes: number;
  expires_in_s: number;
};

/** POST /photo-upload: same shape as a voice upload, into the private photos bucket. */
export type PhotoUpload = VoiceUpload;

export type SendRecipeResult = { sent: { profile_id: string; thread_id: string; message_id: string }[] };

export type Share = { token: string; url: string };

export type SharePublic = {
  token: string;
  recipe_id: string;
  recipe_url: string;
  sender: { name: string; relation: string | null; avatar_key: string | null } | null;
  family_name: string;
};

export type RecipeActivity = {
  cooked: { profile: Profile; at: string; note: string | null }[];
  viewed: { profile: Profile; count: number }[];
  last_sent_at: string | null;
};

// ---------------------------------------------------------------------------------------------
// Errors

export type ApiErrorKind = 'config' | 'network' | 'timeout' | 'http' | 'parse';

export class ApiError extends Error {
  /** HTTP status, or 0 for network / timeout / config problems. */
  readonly status: number;
  readonly kind: ApiErrorKind;
  /** The server's JSON error body, e.g. `{ error, status: 'used' }` on a 410 from POST /invites/accept. */
  readonly body: Record<string, unknown> | null;
  constructor(message: string, status: number, kind: ApiErrorKind, body: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
    this.body = body;
  }
  /** This phone isn't signed in (a refused device key or family code). */
  get unauthorized() {
    return this.status === 401;
  }
  /** Offline, timed out, or the server had trouble: worth trying again later. */
  get transient() {
    return this.kind === 'network' || this.kind === 'timeout' || this.status >= 500 || this.status === 429;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** A sentence that is safe to show people for any thrown error. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (e instanceof ApiError) return e.message || fallback;
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Auth state (set by SessionProvider)

/** The server's exact sentence for a device key it no longer accepts (the person was removed). */
export const SIGNED_OUT = 'This phone was signed out.';

/**
 * The server's definite word that this phone's key is off: a 401 with exactly SIGNED_OUT. Only that,
 * or the person's own "Sign out", may forget the key. Any other 401 (a gateway, a proxy, a deploy with
 * the wrong settings) is trouble to wait out, never a sign-out.
 */
export function isSignedOutAnswer(status: number, body: Record<string, unknown> | null): boolean {
  return status === 401 && body?.error === SIGNED_OUT;
}

type AuthState = { deviceKey: string | null; code: string | null; profileId: string | null };
let auth: AuthState = { deviceKey: null, code: null, profileId: null };
let signedOutHandler: ((message: string) => void) | null = null;
let profileRemovedHandler: ((profileId: string) => void) | null = null;

/** 1.1: the language the AWS api's refusals are shown in (the words provider sets it). */
let errorLanguage: string | null = null;
export function setApiLanguage(lang: string | null) {
  errorLanguage = lang;
}

export function setApiAuth(next: Partial<AuthState>) {
  auth = { ...auth, ...next };
  if (AWS_ON) setAwsCredentials({ deviceKey: auth.deviceKey, personId: auth.profileId });
}

if (AWS_ON) {
  onDeadKey(() => {
    auth = { ...auth, deviceKey: null, profileId: null };
    try {
      signedOutHandler?.(SIGNED_OUT);
    } catch {
      // the session's trouble
    }
  });
}

let timeZone: string | null = null;

/**
 * The phone's IANA zone, sent as `x-tz` on every signed-in call (the api keeps it on the acting
 * profile: quiet hours, Sunday weeks, the 1st's recap). session.tsx sets it from lib/tz.ts, so this
 * file stays import-free. null = don't send it.
 */
export function setApiTimeZone(tz: string | null) {
  timeZone = tz;
}

/** The zone the api client sends as `x-tz` (null: none), for the few calls made outside it. */
export function getApiTimeZone(): string | null {
  return timeZone;
}

/**
 * The phone's credentials, for code that calls our other functions (send `key` as x-device-key
 * and `code` as x-family-code) or keys an in-memory cache on the family
 * (`key ?? code`, so it resets when the phone switches family). Never log or show them.
 */
export function getApiAuth(): { key: string | null; code: string | null; profileId: string | null } {
  return { key: auth.deviceKey, code: auth.deviceKey ? null : auth.code, profileId: auth.profileId };
}

/**
 * SessionProvider's hook: called once when the server refuses this phone's own device key (401,
 * SIGNED_OUT). The key is already dropped from the client by then. A call made with some other
 * key or code (an override) never triggers it.
 */
export function setSignedOutHandler(fn: ((message: string) => void) | null) {
  signedOutHandler = fn;
}

/**
 * SessionProvider's hook: called when the server refuses the current profile because that person
 * was removed from the family (403 "That person was removed from this family. Pick who you are.")
 * or signed in on their own phone since (403 "<Name> uses their own phone.").
 * The profile is already dropped from the client by then.
 */
export function setProfileRemovedHandler(fn: ((profileId: string) => void) | null) {
  profileRemovedHandler = fn;
}

export function apiConfigured(): boolean {
  return !!API_URL;
}

// ---------------------------------------------------------------------------------------------
// Transport

type Retry = 'safe' | 'gateway' | 'none';

type CallOpts = {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** false = public route, no credential headers. */
  authed?: boolean;
  /** On a public route, also send this phone's own device key (never a family code), e.g. peek's same_family. */
  withKey?: boolean;
  /** Whether the route needs x-profile-id. */
  me?: boolean;
  retry?: Retry;
  deviceKey?: string | null;
  code?: string | null;
  profileId?: string | null;
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** Per-call auth. Passing `deviceKey` or `code` replaces the phone's credential for that call. */
export type AuthOverride = { deviceKey?: string | null; code?: string | null; profileId?: string | null; signal?: AbortSignal };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The credential for a call: an override (either kind) wins whole, else the phone's own. */
function credentialFor(o: CallOpts): { deviceKey: string; code: null } | { deviceKey: null; code: string } | null {
  const overridden = o.deviceKey !== undefined || o.code !== undefined;
  const deviceKey = ((overridden ? o.deviceKey : auth.deviceKey) ?? '').trim();
  if (deviceKey) return { deviceKey, code: null };
  const code = ((overridden ? o.code : auth.code) ?? '').trim();
  return code ? { deviceKey: null, code } : null;
}

/** A call to the AWS api (1.1): its AwsError comes back as the ApiError the screens already read. */
async function awsOnce<T>(path: string, o: CallOpts): Promise<T> {
  const overridden = o.deviceKey !== undefined || o.code !== undefined;
  const key = overridden ? (o.deviceKey ?? null) : auth.deviceKey;
  const pid = o.profileId !== undefined ? o.profileId : auth.profileId;
  if (o.me && !pid && o.authed !== false) throw new ApiError('Pick who you are first.', 403, 'config');
  const authed = o.authed !== false;
  if (authed && !key) throw new ApiError('Sign in to see your family.', 401, 'config');
  const opts: RequestOpts = {
    method: o.method ?? 'GET',
    body: o.body as Record<string, unknown> | undefined,
    // A public route sends this phone's key only when asked (peek's same_family).
    auth: authed || (o.withKey && key) ? 'key' : 'none',
    as: authed ? pid : null,
    deviceKey: key,
    timeoutMs: o.timeoutMs ?? TIMEOUT_MS,
    signal: o.signal,
  };
  try {
    return await awsRequest<T>(path, opts);
  } catch (e) {
    if (!isAwsError(e)) throw e;
    // The person's own words for its code, in their language (lib/aws/errorWords.ts).
    const msg = errorWords(e, wordsFor(errorLanguage));
    if (e.kind === 'network') throw new ApiError(msg, 0, e.code === 'timeout' ? 'timeout' : 'network');
    // The person this phone is acting as was removed, or now has their own phone: pick someone else.
    if (e.status === 403 && authed && pid && pid === auth.profileId && (e.code === 'removed_from_family' || e.code === 'own_phone' || /\bremoved\b|uses their own phone/i.test(e.message))) {
      auth = { ...auth, profileId: null };
      try {
        profileRemovedHandler?.(pid);
      } catch {
        // the session's trouble
      }
    }
    throw new ApiError(msg, e.status, 'http', { ...e.extra, error: e.code || e.message, code: e.code, requestId: e.requestId });
  }
}

async function once<T>(path: string, o: CallOpts): Promise<T> {
  if (AWS_ON) return awsOnce<T>(path, o);
  if (!API_URL) throw new ApiError("Messages aren't set up in this build yet.", 0, 'config');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  let sentKey: string | null = null;
  if (o.authed !== false) {
    const cred = credentialFor(o);
    if (!cred) throw new ApiError('Sign in to see your family.', 401, 'config');
    if (cred.deviceKey !== null) headers['x-device-key'] = sentKey = cred.deviceKey;
    else headers['x-family-code'] = cred.code;
  } else if (o.withKey && auth.deviceKey) {
    headers['x-device-key'] = auth.deviceKey;
  }
  const pid = o.profileId !== undefined ? o.profileId : auth.profileId;
  if (pid && o.authed !== false) headers['x-profile-id'] = pid;
  if (timeZone && o.authed !== false) headers['x-tz'] = timeZone;
  if (o.me && !pid) throw new ApiError('Pick who you are first.', 403, 'config');

  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  o.signal?.addEventListener?.('abort', onOuterAbort);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, o.timeoutMs ?? TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: o.method ?? 'GET',
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    if (timedOut) throw new ApiError('That took too long. Check your connection and try again.', 0, 'timeout');
    if (o.signal?.aborted) throw new ApiError('Cancelled', 0, 'network');
    throw new ApiError("Can't reach homecookd right now. Check your connection.", 0, 'network');
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener?.('abort', onOuterAbort);
  }

  let data: unknown = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (res.ok) throw new ApiError('homecookd sent back something unexpected.', res.status, 'parse');
    }
  }
  if (!res.ok) {
    const body = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
    const msg =
      (typeof body?.error === 'string' && body.error ? body.error : null) ??
      (res.status >= 500 ? 'Something went wrong on our side. Try again.' : `Request failed (${res.status}).`);
    // This phone's own key was refused: drop it before anything else can send it, then tell the session.
    if (sentKey && sentKey === auth.deviceKey && isSignedOutAnswer(res.status, body)) {
      auth = { ...auth, deviceKey: null, profileId: null };
      try {
        signedOutHandler?.(msg);
      } catch {
        // the session's trouble; this call still fails with the server's sentence
      }
    }
    // The person this phone is acting as was removed, or now has their own phone ("Maya uses their
    // own phone."): pick someone else.
    if (res.status === 403 && o.authed !== false && pid && pid === auth.profileId && /\bremoved\b|uses their own phone/i.test(msg)) {
      auth = { ...auth, profileId: null };
      try {
        profileRemovedHandler?.(pid);
      } catch {
        // the session's trouble
      }
    }
    throw new ApiError(msg, res.status, 'http', body);
  }
  return data as T;
}

async function call<T>(path: string, o: CallOpts = {}): Promise<T> {
  if (AWS_ON) return awsOnce<T>(path, o); // lib/aws/client.ts retries where it's safe
  const retry: Retry = o.retry ?? ((o.method ?? 'GET') === 'GET' ? 'safe' : 'none');
  try {
    return await once<T>(path, o);
  } catch (e) {
    if (!(e instanceof ApiError) || e.kind === 'config' || o.signal?.aborted) throw e;
    const again =
      retry === 'safe'
        ? e.kind === 'network' || e.kind === 'timeout' || e.status >= 500
        : retry === 'gateway'
          ? e.status === 502 || e.status === 503 || e.status === 504
          : false;
    if (!again) throw e;
    await sleep(RETRY_DELAY_MS);
    return once<T>(path, o);
  }
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------------------------
// Endpoints

const supabaseApi = {
  /** GET /family: the family, every profile (Mom, Dad, Grandma, Leo, Maya) and this phone's own profile. */
  family: (o: AuthOverride = {}) => call<FamilyInfo>('/family', { ...o, profileId: o.profileId ?? null }),

  /** POST /profiles: add someone to the family without inviting them (409 when the name is taken). */
  createProfile: (input: { name: string; role: Role; relation?: string | null }, o: AuthOverride = {}) =>
    call<Profile>('/profiles', { method: 'POST', body: input, retry: 'gateway', ...o }),

  /**
   * POST /profiles/:id/remove (me): leave the family. Only yourself (`profileId` = me), from your own
   * phone (which is signed out) or as someone with no phone; anyone else is 403 "Only Dad can remove
   * themselves.".
   */
  /**
   * POST /profiles/:id/role: move someone between the cooks and the ones who miss it. The api allows this
   * phone's own person, or someone with no phone of their own (as removeProfile); messages and recipes stay.
   */
  setRole: (profileId: string, role: Role, o: AuthOverride = {}) =>
    call<unknown>(`/profiles/${enc(profileId)}/role`, { method: 'POST', body: { role }, me: true, retry: 'safe', ...o }),

  removeProfile: (profileId: string, o: AuthOverride = {}) =>
    call<{ ok: true }>(`/profiles/${enc(profileId)}/remove`, { method: 'POST', body: {}, me: true, retry: 'safe', ...o }),

  /**
   * POST /devices (signed in by family code or device key): a new device key for this phone, not
   * tied to a person. Used once to swap a family code for a key. Never log the key.
   */
  devices: (input: { label?: string | null } = {}, o: AuthOverride = {}) =>
    call<{ device_key: string }>('/devices', { method: 'POST', body: input, retry: 'gateway', ...o, profileId: null }),

  /** POST /devices/revoke (device key): sign this phone out, so its key stops working everywhere. */
  revokeDevice: (o: AuthOverride = {}) =>
    call<{ ok: true }>('/devices/revoke', { method: 'POST', body: {}, retry: 'safe', ...o, profileId: null }),

  /**
   * POST /invites (me): invite someone new (creates their profile, so their face shows at once) or
   * re-invite someone who hasn't joined (their older links stop working). Put `invite.url` in the text.
   */
  createInvite: (input: NewInvite = {}, o: AuthOverride = {}) =>
    call<{ invite: Invite; profile: Profile | null }>('/invites', { method: 'POST', body: input, me: true, retry: 'gateway', ...o }),

  /**
   * POST /profiles/self (device key, no x-profile-id): a phone that joined through a family invite
   * adds its own person (+ under the cooks = 'cook', under the ones who miss it = 'learner'). The
   * phone becomes theirs. 409 when this phone already belongs to someone, or the name is taken.
   */
  createSelf: (input: { name: string; role: Role }, o: AuthOverride = {}) =>
    call<Profile>('/profiles/self', { method: 'POST', body: input, retry: 'gateway', ...o, profileId: null }),

  /**
   * POST /invites/peek (public): what an invite or a family join link (`token`, 16 or 22 characters)
   * says, without using it. 404 "That invite link doesn't work." Sends this phone's key when it has
   * one, for `same_family`. With `name` (the join card's, once it settles): `claimable`.
   */
  invitePeek: (token: string, { name, ...o }: Pick<AuthOverride, 'signal'> & { name?: string | null } = {}) =>
    call<InvitePeek>('/invites/peek', {
      method: 'POST',
      body: name ? { token, name } : { token },
      authed: false,
      withKey: true,
      retry: 'safe',
      ...o,
    }),

  /**
   * POST /join-links (me): the family's join link, homecookd.app/i?t=… ("Invite family" shares it). The
   * same link comes back while it has more than a day left.
   */
  joinLink: (o: AuthOverride = {}) => call<JoinLink>('/join-links', { method: 'POST', body: {}, me: true, retry: 'gateway', ...o }),

  /**
   * POST /auth/apple (public): Sign in with Apple, with the link they came from (ProviderAuthInput).
   * A known person gets a device key (or `needs_move`); someone new joins the link's family with
   * `name`, or gets `needs_name` without one (and, with no link, starts a family: send `role` too).
   * 409 a name already in that family, or a card side that brought someone in (LINK_USED); 410 an
   * expired or used invite (`ApiError.body.status`); 403 a ticket that didn't check out; 404 no such
   * link. Never retried: a retry after a lost answer would sign in a second time.
   */
  authApple: (input: ProviderAuthInput, o: Pick<AuthOverride, 'signal'> = {}) =>
    call<ProviderAuth>('/auth/apple', { method: 'POST', body: input, authed: false, retry: 'none', timeoutMs: SIGN_IN_TIMEOUT_MS, ...o }),

  /** POST /auth/google (public): the same as authApple. 503 "Google sign-in isn't set up yet." */
  authGoogle: (input: ProviderAuthInput, o: Pick<AuthOverride, 'signal'> = {}) =>
    call<ProviderAuth>('/auth/google', { method: 'POST', body: input, authed: false, retry: 'none', timeoutMs: SIGN_IN_TIMEOUT_MS, ...o }),

  /** GET /threads (me): the family circle first, then one per family member I have messages with, newest first. */
  threads: (o: AuthOverride = {}) => call<ThreadSummary[]>('/threads', { me: true, ...o }),

  /** POST /threads (me): get or create the thread with `otherId`. */
  openThread: (otherId: string, o: AuthOverride = {}) =>
    call<{ id: string; other: Profile }>('/threads', { method: 'POST', body: { other_id: otherId }, me: true, retry: 'safe', ...o }),

  /** GET /threads/:id/messages (me): oldest first; `after` = created_at of the last one I have. */
  messages: (threadId: string, after?: string | null, o: AuthOverride = {}) =>
    call<Message[]>(`/threads/${enc(threadId)}/messages${after ? `?after=${enc(after)}` : ''}`, { me: true, ...o }),

  /** POST /threads/:id/messages (me). Returns the stored message. */
  sendMessage: (threadId: string, msg: NewMessage, o: AuthOverride = {}) =>
    call<Message>(`/threads/${enc(threadId)}/messages`, { method: 'POST', body: msg, me: true, retry: 'gateway', ...o }),

  /** POST /threads/:id/read (me). */
  markRead: (threadId: string, o: AuthOverride = {}) =>
    call<{ ok: true }>(`/threads/${enc(threadId)}/read`, { method: 'POST', body: {}, me: true, retry: 'safe', ...o }),

  /** GET /unread (me): `{ total }` across my threads. */
  unread: (o: AuthOverride = {}) => call<{ total: number }>('/unread', { me: true, ...o }),

  /** POST /voice-upload (me): a signed URL to PUT the voice note bytes to. */
  voiceUpload: (contentType = 'audio/m4a', o: AuthOverride = {}) =>
    call<VoiceUpload>('/voice-upload', { method: 'POST', body: { content_type: contentType }, me: true, retry: 'safe', ...o }),

  /** POST /photo-upload (me): a signed URL to PUT a photo of a dish someone made to. */
  photoUpload: (contentType = 'image/jpeg', o: AuthOverride = {}) =>
    call<PhotoUpload>('/photo-upload', { method: 'POST', body: { content_type: contentType }, me: true, retry: 'safe', ...o }),

  /**
   * POST /messages/:id/postcard (me = its sender): the photo (already PUT via photoUpload) and the
   * optional 1-5 rating on my own `cooked` message. Posting again replaces both. Returns the message.
   */
  postcard: (messageId: string, input: { photo_path: string; rating?: number | null }, o: AuthOverride = {}) =>
    call<Message>(`/messages/${enc(messageId)}/postcard`, { method: 'POST', body: input, me: true, retry: 'safe', ...o }),

  /** POST /send-recipe (me): a `recipe` message to each person (or 'everyone'). */
  sendRecipe: (input: { recipe_id: string; to: string[] | 'everyone'; note?: string | null }, o: AuthOverride = {}) =>
    call<SendRecipeResult>('/send-recipe', { method: 'POST', body: input, me: true, retry: 'gateway', ...o }),

  /** POST /shares: the public link for a recipe (same link back every time). */
  createShare: (recipeId: string, o: AuthOverride = {}) =>
    call<Share>('/shares', { method: 'POST', body: { recipe_id: recipeId }, retry: 'safe', ...o }),

  /** GET /shares/:token (public). */
  share: (token: string, o: Pick<AuthOverride, 'signal'> = {}) =>
    call<SharePublic>(`/shares/${enc(token)}`, { authed: false, ...o }),

  /** POST /pending-sends (me = the cook who recorded): who gets the recipe once it's published. */
  pendingSend: (
    input: { job_id: string; recipient_ids: string[]; hello_path?: string | null; hello_duration_s?: number | null },
    o: AuthOverride = {},
  ) => call<{ ok: true; delivered?: number }>('/pending-sends', { method: 'POST', body: input, me: true, retry: 'safe', ...o }),

  /** POST /jobs/:job_id/published (signed in, no profile). Normally called by the pipeline worker. */
  jobPublished: (jobId: string, recipeId: string, o: AuthOverride = {}) =>
    call<{ delivered: number; already?: boolean }>(`/jobs/${enc(jobId)}/published`, {
      method: 'POST',
      body: { recipe_id: recipeId },
      retry: 'safe',
      ...o,
      profileId: null,
    }),

  /**
   * POST /events (me): 'viewed' (deduped for 30 min), 'cooked', 'started' (cook mode opened) or
   * 'heard' (a cook's voice played >= 3 s: `duration_s`, `start_s`). `cook_id`: whose dish it is.
   */
  event: (recipeId: string, kind: RecipeEventKind, extra: RecipeEventExtra = {}, o: AuthOverride = {}) =>
    call<{ ok: true; counted: boolean }>('/events', {
      method: 'POST',
      body: { recipe_id: recipeId, kind, ...extra },
      me: true,
      retry: 'safe',
      ...o,
    }),

  /** POST /push-tokens (me): this phone's Expo push token; the server files it under the phone's own person. */
  pushToken: (input: { token: string; platform: 'ios' | 'android' }, o: AuthOverride = {}) =>
    call<{ ok: true }>('/push-tokens', { method: 'POST', body: input, me: true, retry: 'safe', ...o }),

  /** POST /push-tokens/remove (signed in, no profile needed): sign-out. Send it before the key is dropped. */
  removePushToken: (input: { token: string }, o: AuthOverride = {}) =>
    call<{ ok: true }>('/push-tokens/remove', { method: 'POST', body: input, retry: 'none', timeoutMs: 3000, ...o, profileId: null }),

  /** GET /recipes/:id/activity: who cooked / viewed it, and when it was last sent. */
  activity: (recipeId: string, o: AuthOverride = {}) => call<RecipeActivity>(`/recipes/${enc(recipeId)}/activity`, { ...o }),

  /** GET /circle: the family circle thread (created if missing) and its members. */
  circle: (o: AuthOverride = {}) => call<Circle>('/circle', { ...o }),

  /**
   * GET /questions/open: unanswered questions, newest first. The circle's (mine left out when a
   * profile is set) plus, when the profile is a cook, 1:1 questions asked of them (`thread_kind: 'pair'`).
   */
  openQuestions: (o: AuthOverride = {}) => call<OpenQuestion[]>('/questions/open', { ...o }),

  /** POST /recipe-notes (me = a cook): "Save to recipe" for one of my own messages about a recipe. Idempotent. */
  saveToRecipe: (messageId: string, o: AuthOverride = {}) =>
    call<RecipeNote>('/recipe-notes', { method: 'POST', body: { message_id: messageId }, me: true, retry: 'safe', ...o }),

  /**
   * POST /recipe-notes/:id/remove (me = the answer's author, the asker or the dish's cook): take a
   * saved answer back out of the recipe; the question opens again unless someone else answered it.
   */
  removeNote: (noteId: string, o: AuthOverride = {}) =>
    call<{ ok: true; answer_message_id: string; question_message_id: string | null }>(`/recipe-notes/${enc(noteId)}/remove`, {
      method: 'POST',
      me: true,
      ...o,
    }),

  /** GET /recipes/:id/questions: open questions about a dish (the circle's, plus my own 1:1 ones). */
  recipeQuestions: (recipeId: string, o: AuthOverride = {}) => call<RecipeQuestion[]>(`/recipes/${enc(recipeId)}/questions`, { ...o }),

  /** GET /recipes/:id/notes: the family's saved answers for a recipe, by step then oldest first. */
  recipeNotes: (recipeId: string, o: AuthOverride = {}) => call<RecipeNote[]>(`/recipes/${enc(recipeId)}/notes`, { ...o }),

  /** GET /favorites (me): the dishes I hearted, newest first. */
  favorites: (o: AuthOverride = {}) => call<{ recipe_ids: string[] }>('/favorites', { me: true, ...o }),

  /** POST /favorites (me): heart (`on: true`) or un-heart a dish. Idempotent, so safe to retry. */
  setFavorite: (recipeId: string, on: boolean, o: AuthOverride = {}) =>
    call<FavoriteResult>('/favorites', { method: 'POST', body: { recipe_id: recipeId, on }, me: true, retry: 'safe', ...o }),

  /** GET /me/recipe-stats (me): my views, cooks, hearts and "sent to me" per dish. */
  recipeStats: (o: AuthOverride = {}) => call<RecipeStat[]>('/me/recipe-stats', { me: true, ...o }),
};

/**
 * Every call the screens make. Under AWS_ON (1.1) the Messages ones are answered by the AWS api in today's shapes
 * (lib/aws/legacy.ts); the rest go to the AWS api through awsOnce, with the same paths (the Accounts family routes).
 */
export const api: typeof supabaseApi = AWS_ON ? { ...supabaseApi, ...awsMessagesApi } : supabaseApi;

export type Api = typeof api;
